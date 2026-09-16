const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), crypto=require('node:crypto'), zlib=require('node:zlib');
function fixture(){
  const rows=[['header']],props={LOCAL_BACKUP_TOKEN:'test-secret',LOCAL_PRIMARY_SOURCE:'test-source'};
  const range=(row,col,height,width)=>({setNumberFormat(){return this},setValues(values){values.forEach((v,i)=>{rows[row+i-1]=v.slice()});return this},getValues(){return Array.from({length:height},(_,i)=>(rows[row+i-1]||Array(width).fill('')).slice(col-1,col-1+width))}});
  const sheet={getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),getRange:range,getLastRow:()=>rows.length,getMaxRows:()=>10000,deleteRow:n=>rows.splice(n-1,1)};
  const context={SHEET_ID:'fixture',PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){}},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,text)=>Array.from(crypto.createHash('sha256').update(text).digest()),base64Decode:s=>Buffer.from(s,'base64'),newBlob:b=>b,ungzip:b=>({getDataAsString:()=>zlib.gunzipSync(b).toString('utf8')}),formatDate:d=>d.toISOString().slice(0,10)}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/LocalBackups.gs','utf8'),context);
  const call=data=>context.doPost({postData:{contents:JSON.stringify({token:'test-secret',sourceId:'test-source',...data})}});
  const snapshot={format:'razzle-ledger-v1',sourceId:'test-source',revision:1,records:{ledger:[{id:1,content:'測試'}],revenue:[]}};
  const text=JSON.stringify(snapshot), checksum=crypto.createHash('sha256').update(text).digest('hex');
  const request={action:'backup_snapshot',backupId:'latest-test-r1-abcdefgh',revision:1,kind:'latest',checksum,content:zlib.gzipSync(text).toString('base64')};
  return {call,request,rows,text};
}
test('snapshot round-trips exactly and retries are idempotent',()=>{
 const f=fixture();assert.equal(f.call(f.request).status,'ok');const count=f.rows.length;assert.equal(f.call(f.request).status,'ok');assert.equal(f.rows.length,count);
 const read=f.call({action:'read_backup',backupId:f.request.backupId});assert.equal(zlib.gunzipSync(Buffer.from(read.content,'base64')).toString(),f.text);
 assert.equal(f.call({action:'list_backups'}).backups.length,1);
});
test('unauthorized source cannot read or write snapshots',()=>{
 const f=fixture();assert.equal(f.call({...f.request,token:'wrong'}).status,'error');assert.equal(f.rows.length,1);
 assert.equal(f.call({...f.request,sourceId:'different'}).status,'error');
});
test('hash mismatch is rejected without a completed backup',()=>{
 const f=fixture();assert.equal(f.call({...f.request,checksum:'0'.repeat(64)}).status,'error');assert.equal(f.rows.length,1);
});
test('incomplete upload is not listed and retry repairs only its own partial rows',()=>{
 const f=fixture();f.call(f.request);f.rows.pop();assert.equal(f.call({action:'list_backups'}).backups.length,0);
 assert.equal(f.call({action:'read_backup',backupId:f.request.backupId}).status,'error');
 assert.equal(f.call(f.request).status,'ok');assert.equal(f.rows.length,3);
});
test('completed backup corruption is detected on read',()=>{
 const f=fixture();f.call(f.request);f.rows[1][9]='bad';assert.equal(f.call({action:'read_backup',backupId:f.request.backupId}).status,'error');
});
