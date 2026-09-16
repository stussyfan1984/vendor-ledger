import { useState } from 'react';
import { localApi, downloadCompleteBackup } from './localClient';

const when = value => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '尚無成功紀錄';
const button = { background:'#202020', color:'#ddd', border:'1px solid #555', borderRadius:4, padding:'7px 12px', cursor:'pointer' };

export default function BackupPanel({ status, onRestored }) {
  const [open, setOpen] = useState(false), [backups, setBackups] = useState([]), [cloud, setCloud] = useState([]);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async action => { setBusy(true); setError(''); try { await action(); } catch(e) { setError(e.message); } finally { setBusy(false); } };
  const current = status.cloudRevision >= status.revision;
  const title = !status.initialized ? '本機帳本尚未移轉' : current ? '本機已儲存・雲端已核對' : '本機已儲存・等待雲端備份';
  return <section aria-label="帳本備份狀態" style={{padding:'12px 28px',background:'#161c18',borderBottom:'1px solid #333',fontSize:12,lineHeight:1.8}}>
    <strong style={{color:current?'#3dff7e':'#f5c542'}}>{title}</strong>
    <span style={{marginLeft:20,color:'#bbb'}}>最後成功雲端備份：{when(status.lastCloudBackupAt)}</span>
    <span style={{marginLeft:20,color:'#aaa'}}>每日 04:00 完整備份・保留 90 天</span>
    <div style={{display:'flex',gap:8,marginTop:7,flexWrap:'wrap'}}>
      <button style={button} disabled={busy || status.backupRunning} onClick={()=>run(()=>localApi('backup',{}))}>{status.backupRunning?'雲端備份核對中…':'立即備份／重試'}</button>
      <button style={button} disabled={busy} onClick={()=>run(downloadCompleteBackup)}>下載完整備份</button>
      <button style={button} disabled={busy} onClick={()=>run(async()=>{setBackups((await localApi('backups')).backups);setOpen(!open);setPreview(null);})}>查看備份／還原</button>
    </div>
    {status.lastBackupError && <div style={{color:'#f5c542'}}>雲端備份未完成，會自動重試：{status.lastBackupError}</div>}
    {error && <div role="alert" style={{color:'#ff8a8a'}}>{error}</div>}
    {open && <div style={{padding:12,marginTop:10,border:'1px solid #444'}}>
      <div>還原會替換目前帳本；系統會先保存還原前的完整副本。</div>
      <div style={{margin:'8px 0'}}>本機備份：</div>
      <select aria-label="選擇本機備份" defaultValue="" disabled={busy} onChange={e=>{const id=e.target.value; if(id)run(async()=>setPreview(await localApi('restore-preview',{backupId:id})));}} style={{...button,maxWidth:'100%'}}>
        <option value="">請選擇備份</option>
        {backups.map(b=><option key={b.id} value={b.id}>{when(b.created_at)}・{b.kind==='daily'?'每日':b.kind==='before-restore'?'還原前':b.kind==='migration'?'移轉時':'完整'}備份・版本 {b.revision}</option>)}
      </select>
      <button style={{...button,marginLeft:8}} disabled={busy} onClick={()=>run(async()=>setCloud((await localApi('cloud-backups',{})).backups))}>查看雲端備份</button>
      {cloud.length>0 && <select aria-label="選擇雲端備份" defaultValue="" disabled={busy} onChange={e=>{const id=e.target.value;if(id)run(async()=>setPreview(await localApi('download-backup',{backupId:id})));}} style={{...button,display:'block',marginTop:8,maxWidth:'100%'}}>
        <option value="">選擇雲端備份以下載並預覽</option>
        {cloud.map(b=><option key={b.backupId} value={b.backupId}>{when(b.createdAt)}・{b.kind}・版本 {b.revision}</option>)}
      </select>}
      {preview && <div style={{marginTop:12,color:'#f5c542'}}>
        <div>還原預覽：貨款 {preview.currentCounts.ledger} → {preview.counts.ledger} 筆；營收 {preview.currentCounts.revenue} → {preview.counts.revenue} 筆。</div>
        <button style={{...button,marginTop:8,borderColor:'#f5c542'}} disabled={busy} onClick={()=>{
          if(!window.confirm('確定使用這份備份替換本機帳本？系統會先保存目前版本。'))return;
          run(async()=>{const next=await localApi('restore',preview);onRestored(next);setPreview(null);setOpen(false);});
        }}>確認還原這份備份</button>
      </div>}
    </div>}
  </section>;
}
