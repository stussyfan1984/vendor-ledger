"""Install/update this user's local ledger service without replacing ledger data."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
from server import Ledger, atomic_write


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data-dir',type=Path,default=Path.home()/'Library/Application Support/RazzleDazzleLedger')
    parser.add_argument('--script-url',required=True)
    parser.add_argument('--no-start',action='store_true')
    args=parser.parse_args()
    os.umask(0o077)
    source=Path(__file__).resolve().parents[1]
    if not (source/'dist/index.html').is_file():raise SystemExit('請先執行 pnpm build')
    directory=args.data_dir
    ledger=Ledger(directory)
    runtime=directory/'runtime'
    runtime.mkdir(exist_ok=True)
    shutil.copy2(source/'local_service/server.py',runtime/'server.py')
    shutil.copytree(source/'dist',runtime/'web',dirs_exist_ok=True)
    config=directory/'config.json'
    if not config.exists():
        atomic_write(config,json.dumps({'scriptUrl':args.script_url,'backupToken':secrets.token_urlsafe(48),'sourceId':ledger.get('source_id')},indent=2))
    label='com.razzledazzle.vendor-ledger'
    agents=Path.home()/'Library/LaunchAgents'
    agents.mkdir(parents=True,exist_ok=True)
    plist=agents/(label+'.plist')
    values={'Label':label,'ProgramArguments':['/usr/bin/python3',str(runtime/'server.py'),'--data-dir',str(directory),'--web-root',str(runtime/'web')],
            'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,'ProcessType':'Background',
            'StandardOutPath':str(directory/'service.log'),'StandardErrorPath':str(directory/'service-error.log')}
    # These paths belong solely to this app; all existing DB and backups are retained.
    with open(plist,'wb') as handle:plistlib.dump(values,handle)
    plist.chmod(0o600)
    if not args.no_start:
        domain='gui/'+str(os.getuid())
        subprocess.run(['launchctl','bootout',domain+'/'+label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True)
    print(json.dumps({'dataDirectory':str(directory),'url':'http://127.0.0.1:8769/','sourceId':ledger.get('source_id'),'started':not args.no_start}))


if __name__=='__main__':main()
