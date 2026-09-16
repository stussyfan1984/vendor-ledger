import base64
import datetime as dt
import gzip
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from server import Ledger, Conflict, FORMAT, TZ, make_handler, validate_snapshot


def record(rid=1, amount=100):
    return dict(id=rid,date='2026-09-16',vendor='其他',content='測試記錄',type='out',amount=amount,receipt=False,time='2026-09-16T00:00:00.000Z')


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.ledger=Ledger(self.tmp.name)
        self.ledger.import_initial({'format':FORMAT,'records':{'ledger':[record()],'revenue':[]}})

    def tearDown(self):
        self.ledger.db.close()
        self.tmp.cleanup()

    def test_local_commit_survives_restart_without_network(self):
        self.ledger.change('ledger',record(amount=150),expected=1)
        self.ledger.db.close()
        self.ledger=Ledger(self.tmp.name)
        self.assertEqual(self.ledger.rows('ledger')[0]['amount'],150)
        self.assertEqual(self.ledger.status()['cloudRevision'],-1)

    def test_stale_tab_cannot_overwrite_new_edit(self):
        self.ledger.change('ledger',record(amount=150),expected=1)
        with self.assertRaises(Conflict): self.ledger.change('ledger',record(amount=200),expected=1)
        self.assertEqual(self.ledger.rows('ledger')[0]['amount'],150)

    def test_retry_after_lost_create_response_does_not_duplicate(self):
        self.ledger.change('ledger',record(2),expected=None)
        revision=self.ledger.get('revision')
        self.ledger.change('ledger',record(2),expected=None)
        self.assertEqual(self.ledger.get('revision'),revision)
        self.assertEqual(len(self.ledger.rows('ledger')),2)

    def test_cloud_transport_retry_uses_fresh_redirect_and_same_backup_id(self):
        Path(self.tmp.name,'config.json').write_text(json.dumps({'scriptUrl':'https://script.google.com/macros/s/test/exec','backupToken':'test-secret'}))
        requests=[]
        def open_request(request,timeout):
            requests.append(request)
            if len(requests)==1:raise urllib.error.HTTPError(request.full_url,404,'Not Found',{},None)
            return io.BytesIO(b'{"status":"ok"}')
        with patch('server.urllib.request.urlopen',side_effect=open_request),patch('server.time.sleep'):
            self.assertEqual(self.ledger.cloud('backup_snapshot',backupId='same-id')['status'],'ok')
        self.assertNotEqual(requests[0].full_url,requests[1].full_url)
        self.assertEqual(requests[0].data,requests[1].data)
        self.assertNotIn('test-secret',requests[1].full_url)

    def test_delete_survives_restart_and_retains_audit(self):
        self.ledger.change('ledger',rid=1,expected=1)
        self.assertEqual(self.ledger.rows('ledger'),[])
        self.assertIn('before',self.ledger.snapshot()['audit'][-1]['detail'])
        with self.assertRaises(Conflict): self.ledger.import_initial({'format':FORMAT,'records':{'ledger':[record()],'revenue':[]}})

    def test_daily_backup_catches_up_and_is_immutable(self):
        b=self.ledger.daily_due(dt.datetime(2026,9,16,11,tzinfo=TZ))
        contents=(Path(self.tmp.name)/'backups'/b['filename']).read_bytes()
        self.ledger.change('ledger',record(amount=120),expected=1)
        self.assertIsNone(self.ledger.daily_due(dt.datetime(2026,9,16,12,tzinfo=TZ)))
        self.assertEqual(contents,(Path(self.tmp.name)/'backups'/b['filename']).read_bytes())
        self.assertIsNone(self.ledger.daily_due(dt.datetime(2026,9,17,3,tzinfo=TZ)))
        self.assertEqual(self.ledger.daily_due(dt.datetime(2026,9,17,4,tzinfo=TZ))['day'],'2026-09-17')

    def test_readback_required_and_old_ack_cannot_cover_new_revision(self):
        b=self.ledger.save_backup()
        text=(Path(self.tmp.name)/'backups'/b['filename']).read_text()
        calls=[]
        def cloud(action,**kw):
            calls.append(action)
            if action=='backup_snapshot':
                self.ledger.change('ledger',record(amount=120),expected=1)
                return {'backupId':b['id'],'checksum':b['checksum']}
            return {'content':base64.b64encode(gzip.compress(text.encode())).decode()}
        self.ledger.cloud=cloud
        self.ledger.upload(b)
        self.assertEqual(calls,['backup_snapshot','read_backup'])
        self.assertEqual(self.ledger.get('cloud_revision'),1)
        self.assertEqual(self.ledger.get('revision'),2)
        bad=self.ledger.save_backup()
        self.ledger.cloud=lambda action,**kw: {'backupId':bad['id'],'checksum':bad['checksum'],'content':base64.b64encode(gzip.compress(b'bad')).decode()}
        with self.assertRaises(ValueError): self.ledger.upload(bad)
        self.assertEqual(self.ledger.get('cloud_revision'),1)

    def test_restore_is_explicit_checked_and_keeps_previous_data(self):
        original=self.ledger.save_backup('daily','2026-09-16')
        self.ledger.change('ledger',record(amount=120),expected=1)
        preview=self.ledger.restore_preview(original['id'])
        self.ledger.change('ledger',record(amount=140),expected=2)
        with self.assertRaises(Conflict): self.ledger.restore(original['id'],preview['checksum'],preview['expectedRevision'])
        preview=self.ledger.restore_preview(original['id'])
        self.ledger.restore(original['id'],preview['checksum'],preview['expectedRevision'])
        self.assertEqual(self.ledger.rows('ledger')[0]['amount'],100)
        before=[b for b in self.ledger.backup_list() if b['kind']=='before-restore'][0]
        raw=json.loads((Path(self.tmp.name)/'backups'/before['filename']).read_text())
        self.assertEqual(raw['records']['ledger'][0]['amount'],140)

    def test_corrupt_backup_or_duplicate_ids_never_replace_records(self):
        b=self.ledger.save_backup()
        (Path(self.tmp.name)/'backups'/b['filename']).write_text('{}')
        with self.assertRaises(ValueError):self.ledger.restore_preview(b['id'])
        self.assertEqual(self.ledger.rows('ledger'),[record()])
        with self.assertRaises(ValueError):
            validate_snapshot({'format':FORMAT,'records':{'ledger':[record(),record()],'revenue':[]}})

    def test_new_disk_restoration_preserves_source_and_advances_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory,'config.json').write_text(json.dumps({'sourceId':'existing-source'}))
            recovered=Ledger(directory)
            self.assertEqual(recovered.get('source_id'),'existing-source')
            recovered.import_initial({'format':FORMAT,'records':{'ledger':[record()],'revenue':[]}})
            backup=recovered.save_backup()
            preview=recovered.restore_preview(backup['id'])
            recovered.restore(backup['id'],preview['checksum'],preview['expectedRevision'])
            self.assertGreater(recovered.get('revision'),1_000_000_000_000)
            recovered.db.close()

    def test_cross_site_write_is_rejected(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(self.ledger,Path(self.tmp.name),0))
        port=server.server_address[1]
        server.RequestHandlerClass=make_handler(self.ledger,Path(self.tmp.name),port)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            Path(self.tmp.name,'index.html').write_text('<h1>Ledger</h1>')
            navigation=urllib.request.Request(f'http://127.0.0.1:{port}/',headers={'Sec-Fetch-Site':'cross-site'})
            with urllib.request.urlopen(navigation) as response:self.assertEqual(response.status,200)
            foreign_read=urllib.request.Request(f'http://127.0.0.1:{port}/api/state',headers={'Sec-Fetch-Site':'cross-site'})
            with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(foreign_read)
            self.assertEqual(err.exception.code,403)
            request=urllib.request.Request(f'http://127.0.0.1:{port}/api/delete',data=json.dumps({'kind':'ledger','id':1,'expectedRevision':1}).encode(),headers={'Origin':'https://example.com','X-Ledger-Request':'local-app'})
            with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(request)
            self.assertEqual(err.exception.code,403)
            self.assertEqual(len(self.ledger.rows('ledger')),1)
        finally:server.shutdown();server.server_close()


if __name__=='__main__':unittest.main()
