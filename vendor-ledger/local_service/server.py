"""Single-machine ledger. SQLite is authoritative; the cloud only stores snapshots."""
import argparse
import base64
import datetime as dt
import gzip
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Taipei')
FORMAT = 'razzle-ledger-v1'
KINDS = ('ledger', 'revenue')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def clean(record):
    return {k: v for k, v in record.items() if k not in ('_pending', '_revision')}


def validate_record(kind, record):
    if kind not in KINDS or not isinstance(record, dict):
        raise ValueError('帳本種類或資料格式錯誤')
    record = clean(record)
    rid = record.get('id')
    if type(rid) is not int or not 0 < rid < 2**53:
        raise ValueError('記錄 ID 格式錯誤')
    date = record.get('date', '')
    if dt.date.fromisoformat(date).isoformat() != date:
        raise ValueError('日期格式錯誤')
    fields = ('amount',) if kind == 'ledger' else ('ccExpected', 'ccActual', 'deliveryRevenue', 'cashExpected', 'cashActual', 'expectedVendorBalance', 'actualVendorBalance')
    for field in fields:
        if type(record.get(field)) not in (int, float):
            raise ValueError('金額格式錯誤：' + field)
    encoded(record)  # Reject NaN/Infinity before any write.
    if kind == 'ledger' and (record.get('type') not in ('in', 'out') or record['amount'] < 0 or not str(record.get('content', '')).strip()):
        raise ValueError('貨款記錄內容錯誤')
    return record


def validate_snapshot(snapshot):
    if snapshot.get('format') != FORMAT or not isinstance(snapshot.get('records'), dict):
        raise ValueError('不是有效的完整帳本備份')
    result = {}
    for kind in KINDS:
        rows = snapshot['records'].get(kind)
        if not isinstance(rows, list):
            raise ValueError('備份缺少 ' + kind)
        result[kind] = [validate_record(kind, r) for r in rows]
        if len({r['id'] for r in result[kind]}) != len(rows):
            raise ValueError('備份含有重複 ID，已停止還原')
    return result


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp-' + secrets.token_hex(4))
    try:
        with open(tmp, 'x', encoding='utf-8') as handle:
            os.chmod(tmp, 0o600)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        tmp.unlink(missing_ok=True)


class Conflict(ValueError):
    pass


class Ledger:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.busy = False
        config_path = self.directory / 'config.json'
        source_id = json.loads(config_path.read_text()).get('sourceId') if config_path.exists() else None
        self.db = sqlite3.connect(self.directory / 'ledger.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA fullfsync=ON')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, payload TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(kind,id));
          CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, detail TEXT);
          CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, revision INTEGER, kind TEXT, day TEXT, created_at TEXT, checksum TEXT, filename TEXT, uploaded_at TEXT);
        ''')
        with self.db:
            for key, value in [('source_id', source_id or secrets.token_hex(16)), ('revision', 0), ('cloud_revision', -1), ('initialized', False)]:
                self.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)', (key, encoded(value)))
        os.chmod(self.directory / 'ledger.sqlite3', 0o600)

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (key, encoded(value)))

    def rows(self, kind, revisions=False):
        rows = []
        for r in self.db.execute('SELECT payload,revision FROM records WHERE kind=? ORDER BY id', (kind,)):
            row = json.loads(r['payload'])
            if revisions:
                row['_revision'] = r['revision']
            rows.append(row)
        return rows

    def snapshot(self):
        with self.lock:
            return {'format': FORMAT, 'sourceId': self.get('source_id'), 'revision': self.get('revision'), 'createdAt': now(),
                    'records': {k: self.rows(k) for k in KINDS},
                    'audit': [dict(r) for r in self.db.execute('SELECT * FROM audit ORDER BY seq')]}

    def status(self):
        with self.lock:
            return {'revision': self.get('revision'), 'cloudRevision': self.get('cloud_revision'),
                    'initialized': self.get('initialized'), 'localSavedAt': self.get('local_saved_at'),
                    'lastCloudBackupAt': self.get('last_cloud_backup_at'), 'lastDailyBackupAt': self.get('last_daily_backup_at'),
                    'lastBackupError': self.get('backup_error'), 'backupRunning': self.busy,
                    'schedule': '每日 04:00（台北時間），錯過時啟動後補做', 'retentionDays': 90}

    def state(self):
        with self.lock:
            return {'ledger': self.rows('ledger', True), 'revenue': self.rows('revenue', True), 'status': self.status()}

    def import_initial(self, snapshot):
        rows = validate_snapshot(snapshot)
        with self.lock, self.db:
            if self.get('initialized') or self.db.execute('SELECT count(*) FROM records').fetchone()[0]:
                raise Conflict('本機帳本已初始化，請使用明確的還原流程')
            for kind in KINDS:
                self.db.executemany('INSERT INTO records VALUES (?,?,?,1)', [(kind, str(r['id']), encoded(r)) for r in rows[kind]])
            self.put('revision', 1)
            self.put('initialized', True)
            self.put('local_saved_at', now())
            self.db.execute('INSERT INTO audit(time,detail) VALUES (?,?)', (now(), encoded({'action': 'initial_import', 'counts': {k: len(v) for k, v in rows.items()}})))
        self.save_backup('migration')
        self.wake.set()

    def change(self, kind, record=None, rid=None, expected=None, audit=None):
        if record is not None:
            record = validate_record(kind, record)
            rid = str(record['id'])
        if kind not in KINDS or rid is None:
            raise ValueError('記錄格式錯誤')
        rid = str(rid)
        with self.lock, self.db:
            if not self.get('initialized'):
                raise Conflict('請先完成本機帳本移轉')
            previous = self.db.execute('SELECT * FROM records WHERE kind=? AND id=?', (kind, rid)).fetchone()
            if previous and expected is None and record is not None and previous['payload'] == encoded(record):
                return self.state()  # Retry after a lost add response is idempotent.
            if (previous and previous['revision'] != expected) or (not previous and expected is not None):
                raise Conflict('這筆資料已在另一個分頁更新，請重新載入後再編輯')
            if record is not None and kind == 'revenue':
                if any(r['date'] == record['date'] and str(r['id']) != rid for r in self.rows(kind)):
                    raise Conflict('該日期已有營收記錄，請編輯原記錄')
            if previous and record is not None and previous['payload'] == encoded(record):
                return self.state()
            rev = self.get('revision') + 1
            if record is None:
                if not previous:
                    raise Conflict('找不到要刪除的記錄')
                self.db.execute('DELETE FROM records WHERE kind=? AND id=?', (kind, rid))
            else:
                self.db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)', (kind, rid, encoded(record), rev))
            self.db.execute('INSERT INTO audit(time,detail) VALUES (?,?)', (now(), encoded({'kind': kind, 'id': rid, 'before': json.loads(previous['payload']) if previous else None, 'after': record, 'editor': audit})))
            self.put('revision', rev)
            self.put('local_saved_at', now())
        self.wake.set()
        return self.state()

    def save_backup(self, kind='latest', day=None):
        with self.lock:
            snapshot = self.snapshot()
            # Persist each revision once; a pending upload reuses the exact bytes.
            old = self.db.execute('SELECT * FROM backups WHERE revision=? AND kind=? AND day IS ? ORDER BY created_at DESC LIMIT 1', (snapshot['revision'], kind, day)).fetchone()
            if old:
                return dict(old)
            text = encoded(snapshot)
            checksum = digest(text)
            bid = f'{kind}-{day or now()[:10]}-r{snapshot["revision"]}-{checksum[:16]}'
            filename = bid + '.json'
            atomic_write(self.directory / 'backups' / filename, text)
            with self.db:
                self.db.execute('INSERT INTO backups VALUES (?,?,?,?,?,?,?,NULL)', (bid, snapshot['revision'], kind, day, now(), checksum, filename))
                if kind == 'daily':
                    self.put('daily_day', day)
                    self.put('last_daily_backup_at', now())
            return dict(self.db.execute('SELECT * FROM backups WHERE id=?', (bid,)).fetchone())

    def daily_due(self, moment=None):
        moment = (moment or dt.datetime.now(TZ)).astimezone(TZ)
        day = (moment.date() - dt.timedelta(days=int(moment.hour < 4))).isoformat()
        with self.lock:
            if self.get('initialized') and self.get('daily_day', '') < day:
                return self.save_backup('daily', day)

    def config(self):
        return json.loads((self.directory / 'config.json').read_text())

    def cloud(self, action, **fields):
        config = self.config()
        if not config.get('backupToken') or not config.get('scriptUrl', '').startswith('https://script.google.com/macros/s/'):
            raise ValueError('雲端備份尚未設定；本機記錄已保存')
        body = {'action': action, 'token': config['backupToken'], 'sourceId': self.get('source_id'), **fields}
        request = urllib.request.Request(config['scriptUrl'], data=encoded(body).encode('utf-8'), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        if result.get('status') != 'ok':
            raise ValueError(result.get('message', '雲端未確認備份'))
        return result

    def upload(self, backup):
        text = (self.directory / 'backups' / backup['filename']).read_text()
        if digest(text) != backup['checksum']:
            raise ValueError('本機備份驗證失敗，已停止上傳')
        content = base64.b64encode(gzip.compress(text.encode('utf-8'))).decode('ascii')
        result = self.cloud('backup_snapshot', backupId=backup['id'], revision=backup['revision'], kind=backup['kind'], day=backup['day'], checksum=backup['checksum'], content=content)
        if result.get('checksum') != backup['checksum'] or result.get('backupId') != backup['id']:
            raise ValueError('雲端備份內容未核對成功')
        # Read back separately. A lost response retries the same immutable ID.
        check = self.cloud('read_backup', backupId=backup['id'])
        restored = gzip.decompress(base64.b64decode(check['content'])).decode('utf-8')
        if restored != text or digest(restored) != backup['checksum']:
            raise ValueError('雲端讀回驗證失敗，會自動重試')
        with self.lock, self.db:
            self.db.execute('UPDATE backups SET uploaded_at=? WHERE id=?', (now(), backup['id']))
            self.put('cloud_revision', max(self.get('cloud_revision'), backup['revision']))
            self.put('last_cloud_backup_at', now())
            self.put('backup_error', None)

    def run_backup(self):
        with self.lock:
            if not self.get('initialized'):
                return
            self.busy = True
        try:
            self.daily_due()
            with self.lock:
                if self.get('revision') > self.get('cloud_revision'):
                    self.save_backup()
                waiting = [dict(r) for r in self.db.execute('SELECT * FROM backups WHERE uploaded_at IS NULL ORDER BY revision DESC, created_at')]
            for backup in waiting:
                self.upload(backup)
            self.prune()
        except Exception as err:
            with self.lock, self.db:
                self.put('backup_error', str(err))
        finally:
            with self.lock:
                self.busy = False

    def prune(self):
        cutoff = (dt.datetime.now(TZ).date() - dt.timedelta(days=90)).isoformat()
        with self.lock:
            latest = self.db.execute("SELECT id FROM backups WHERE kind='latest' AND uploaded_at IS NOT NULL ORDER BY revision DESC LIMIT 1").fetchone()
            for b in [dict(r) for r in self.db.execute('SELECT * FROM backups WHERE uploaded_at IS NOT NULL')]:
                expire = (b['kind'] == 'daily' and b['day'] < cutoff) or (b['kind'] == 'latest' and latest and b['id'] != latest[0])
                if expire:
                    (self.directory / 'backups' / b['filename']).unlink(missing_ok=True)
                    with self.db:
                        self.db.execute('DELETE FROM backups WHERE id=?', (b['id'],))

    def backup_list(self):
        with self.lock:
            return [dict(r) for r in self.db.execute('SELECT * FROM backups ORDER BY created_at DESC')]

    def restore_data(self, bid):
        row = self.db.execute('SELECT * FROM backups WHERE id=?', (bid,)).fetchone()
        if not row:
            raise ValueError('找不到這份備份')
        text = (self.directory / 'backups' / row['filename']).read_text()
        if digest(text) != row['checksum']:
            raise ValueError('備份雜湊不符，已停止還原')
        snapshot = json.loads(text)
        return row['checksum'], validate_snapshot(snapshot)

    def restore_preview(self, bid):
        with self.lock:
            checksum, rows = self.restore_data(bid)
            return {'backupId': bid, 'checksum': checksum, 'expectedRevision': self.get('revision'), 'counts': {k: len(v) for k, v in rows.items()}, 'currentCounts': {k: len(self.rows(k)) for k in KINDS}}

    def restore(self, bid, checksum, expected):
        with self.lock:
            actual, rows = self.restore_data(bid)
            if actual != checksum or expected != self.get('revision'):
                raise Conflict('預覽後帳本有變更，請重新預覽再還原')
            if self.get('initialized'):
                self.save_backup('before-restore')
            with self.db:
                # Also moves forward when recovering an older cloud backup onto a new disk.
                rev = max(self.get('revision') + 1, int(time.time() * 1000))
                self.db.execute('DELETE FROM records')
                for kind in KINDS:
                    self.db.executemany('INSERT INTO records VALUES (?,?,?,?)', [(kind, str(r['id']), encoded(r), rev) for r in rows[kind]])
                self.put('revision', rev)
                self.put('initialized', True)
                self.put('local_saved_at', now())
                self.db.execute('INSERT INTO audit(time,detail) VALUES (?,?)', (now(), encoded({'action': 'explicit_restore', 'backupId': bid})))
        self.wake.set()
        return self.state()

    def fetch_cloud_backup(self, bid):
        result = self.cloud('read_backup', backupId=bid)
        text = gzip.decompress(base64.b64decode(result['content'])).decode('utf-8')
        if digest(text) != result['checksum']:
            raise ValueError('雲端備份驗證失敗')
        snapshot = json.loads(text)
        validate_snapshot(snapshot)
        # Download only. Importing it requires a separate preview and restore.
        local_id = 'download-' + digest(text)[:24]
        filename = local_id + '.json'
        atomic_write(self.directory / 'backups' / filename, text)
        with self.lock, self.db:
            self.db.execute('INSERT OR IGNORE INTO backups VALUES (?,?,?,?,?,?,?,?)', (local_id, snapshot['revision'], 'download', None, snapshot['createdAt'], digest(text), filename, now()))
        return self.restore_preview(local_id)


def make_handler(ledger, webroot, port):
    origin = f'http://127.0.0.1:{port}'
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log payloads or backup credentials.

        def response(self, value, status=200):
            data = encoded(value).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def allowed(self, write=False):
            return self.headers.get('Host') == f'127.0.0.1:{port}' and self.headers.get('Origin', origin) == origin and self.headers.get('Sec-Fetch-Site', 'same-origin') != 'cross-site' and (not write or self.headers.get('X-Ledger-Request') == 'local-app')

        def do_GET(self):
            # A link from the former Vercel site may open the static entry page.
            # Account data still requires a same-origin API request.
            if self.headers.get('Host') != f'127.0.0.1:{port}' or (self.path.startswith('/api/') and not self.allowed()):
                return self.response({'error': '此服務只供本機帳本使用'}, 403)
            try:
                if self.path == '/api/state': return self.response(ledger.state())
                if self.path == '/api/backups': return self.response({'backups': ledger.backup_list()})
                if self.path == '/api/export': return self.response(ledger.snapshot())
                target = (webroot / self.path.split('?', 1)[0].lstrip('/')).resolve()
                if not target.is_relative_to(webroot.resolve()):
                    return self.response({'error': 'Not found'}, 404)
                if target.is_dir(): target = target / 'index.html'
                if not target.is_file(): target = webroot / 'index.html'
                body = target.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(body)
            except Exception as err:
                self.response({'error': str(err)}, 500)

        def do_POST(self):
            if not self.allowed(True): return self.response({'error': '此服務只接受本機帳本操作'}, 403)
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size < 10_000_000: raise ValueError('要求大小錯誤')
                data = json.loads(self.rfile.read(size))
                if self.path == '/api/record':
                    return self.response(ledger.change(data['kind'], data['record'], expected=data.get('expectedRevision'), audit=data.get('audit')))
                if self.path == '/api/delete':
                    return self.response(ledger.change(data['kind'], rid=data['id'], expected=data['expectedRevision']))
                if self.path == '/api/backup':
                    ledger.wake.set()
                    return self.response({'status': 'queued'})
                if self.path == '/api/restore-preview': return self.response(ledger.restore_preview(data['backupId']))
                if self.path == '/api/restore':
                    return self.response(ledger.restore(data['backupId'], data['checksum'], data['expectedRevision']))
                if self.path == '/api/cloud-backups': return self.response(ledger.cloud('list_backups'))
                if self.path == '/api/download-backup': return self.response(ledger.fetch_cloud_backup(data['backupId']))
                return self.response({'error': 'Not found'}, 404)
            except Conflict as err:
                self.response({'error': str(err)}, 409)
            except (ValueError, KeyError, TypeError) as err:
                self.response({'error': str(err)}, 400)
            except Exception as err:
                self.response({'error': str(err)}, 500)
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--web-root', type=Path)
    parser.add_argument('--port', type=int, default=8769)
    parser.add_argument('--import-file', type=Path)
    parser.add_argument('--no-worker', action='store_true')
    args = parser.parse_args()
    ledger = Ledger(args.data_dir)
    if args.import_file:
        ledger.import_initial(json.loads(args.import_file.read_text()))
        print(json.dumps({'imported': {k: len(ledger.rows(k)) for k in KINDS}}))
        return
    if not args.web_root: parser.error('--web-root is required')
    def worker():
        while True:
            ledger.wake.clear()
            ledger.run_backup()
            ledger.wake.wait(300)
            # Coalesce rapid edits without delaying the local commit.
            time.sleep(2)
    if not args.no_worker:
        threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(ledger, args.web_root, args.port))
    server.serve_forever()


if __name__ == '__main__':
    os.umask(0o077)
    main()
