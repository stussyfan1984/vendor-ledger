// Private backup credentials live in Script Properties, never in this repository.
// Required properties: LOCAL_BACKUP_TOKEN, LOCAL_PRIMARY_SOURCE.
// Uses the existing spreadsheet scope; does not request Drive-wide access.
function backupReply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function backupHash(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function backupSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('本機帳本備份');
  if (!sheet) {
    sheet = ss.insertSheet('本機帳本備份');
    sheet.appendRow(['備份ID','來源','版本','種類','備份日期','建立時間','SHA256','分段','總分段','內容']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function backupRead(rows, id, source) {
  const parts = rows.filter(function(r) { return r[0] === id && r[1] === source && Number(r[7]) >= 0; });
  const complete = rows.find(function(r) { return r[0] === id && r[1] === source && Number(r[7]) === -1; });
  if (!complete) throw new Error('備份尚未完整寫入');
  const count = Number(complete[8]);
  if (parts.length !== count || new Set(parts.map(function(r) { return Number(r[7]); })).size !== count) throw new Error('備份分段不完整');
  parts.sort(function(a,b) { return Number(a[7]) - Number(b[7]); });
  if (parts.some(function(r,i) { return Number(r[7]) !== i || r[6] !== complete[6]; })) throw new Error('備份分段驗證失敗');
  const content = parts.map(function(r) { return r[9]; }).join('');
  const text = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(content), 'application/gzip')).getDataAsString('UTF-8');
  if (backupHash(text) !== complete[6]) throw new Error('備份 SHA256 驗證失敗');
  return {backupId:id,checksum:complete[6],content:content,revision:Number(complete[2]),kind:complete[3],createdAt:String(complete[5])};
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const input = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('LOCAL_BACKUP_TOKEN');
    const source = props.getProperty('LOCAL_PRIMARY_SOURCE');
    if (!token || !source || input.token !== token || input.sourceId !== source) throw new Error('備份來源未授權');
    lock.waitLock(30000);
    const sheet = backupSheet();
    let rows = sheet.getDataRange().getValues().slice(1);
    if (input.action === 'list_backups') {
      const backups = rows.filter(function(r) { return r[1] === source && Number(r[7]) === -1; }).map(function(r) {
        return {backupId:r[0],revision:Number(r[2]),kind:r[3],day:String(r[4]),createdAt:String(r[5]),checksum:r[6]};
      }).sort(function(a,b) { return b.createdAt.localeCompare(a.createdAt); });
      return backupReply({status:'ok',backups:backups});
    }
    if (input.action === 'read_backup') return backupReply(Object.assign({status:'ok'},backupRead(rows,input.backupId,source)));
    if (input.action !== 'backup_snapshot') throw new Error('不支援的備份操作');
    if (!/^[a-z0-9-]{10,120}$/.test(input.backupId) || !/^[a-f0-9]{64}$/.test(input.checksum)) throw new Error('備份識別碼格式錯誤');
    if (!['latest','daily','migration','before-restore'].includes(input.kind) || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('備份版本錯誤');
    if (input.kind === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(input.day || '')) throw new Error('每日備份日期錯誤');
    if (typeof input.content !== 'string' || input.content.length > 8000000) throw new Error('備份太大或格式錯誤');
    const text = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(input.content), 'application/gzip')).getDataAsString('UTF-8');
    if (backupHash(text) !== input.checksum) throw new Error('上傳內容驗證失敗');
    const snapshot = JSON.parse(text);
    if (snapshot.format !== 'razzle-ledger-v1' || snapshot.sourceId !== source || snapshot.revision !== input.revision || !snapshot.records) throw new Error('完整帳本格式錯誤');
    ['ledger','revenue'].forEach(function(kind) {
      const records = snapshot.records[kind];
      if (!Array.isArray(records) || records.some(function(r) { return !r || !Number.isSafeInteger(r.id); }) || new Set(records.map(function(r) { return String(r.id); })).size !== records.length) throw new Error('帳本記錄格式錯誤');
    });
    const existing = rows.filter(function(r) { return r[0] === input.backupId && r[1] === source; });
    if (existing.some(function(r) { return r[6] !== input.checksum; })) throw new Error('備份 ID 已存在且內容不同');
    if (existing.some(function(r) { return Number(r[7]) === -1; })) return backupReply(Object.assign({status:'ok'},backupRead(rows,input.backupId,source)));
    // Remove only incomplete rows of this exact retry. Completed backups are immutable.
    for (let i=rows.length-1;i>=0;i--) if(rows[i][0]===input.backupId && rows[i][1]===source) sheet.deleteRow(i+2);
    const chunks = input.content.match(/.{1,18000}/g) || [];
    const stamp = new Date().toISOString();
    const prefix = [input.backupId,source,input.revision,input.kind,input.day || '',stamp,input.checksum];
    const write = chunks.map(function(chunk,index) { return prefix.concat([index,chunks.length,chunk]); });
    const first = sheet.getLastRow()+1;
    const required = first+write.length;
    if(required>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),required-sheet.getMaxRows());
    sheet.getRange(first,1,write.length+1,10).setNumberFormat('@');
    sheet.getRange(first,1,write.length,10).setValues(write);
    SpreadsheetApp.flush();
    const written = sheet.getRange(first,1,write.length,10).getValues();
    if (written.map(function(r) { return r[9]; }).join('') !== input.content) throw new Error('分段寫入確認失敗');
    sheet.getRange(first+write.length,1,1,10).setValues([prefix.concat([-1,chunks.length,'COMPLETE'])]);
    SpreadsheetApp.flush();
    rows = sheet.getDataRange().getValues().slice(1);
    const saved = backupRead(rows,input.backupId,source);
    // Keep 90 days of daily versions and the highest confirmed latest revision.
    const latestRevision = Math.max.apply(null, rows.filter(function(r) { return r[1]===source && r[3]==='latest' && Number(r[7])===-1; }).map(function(r) { return Number(r[2]); }).concat([0]));
    const cutoff = Utilities.formatDate(new Date(Date.now()-90*86400000),'Asia/Taipei','yyyy-MM-dd');
    for(let i=rows.length-1;i>=0;i--) {
      const r=rows[i];
      if(r[1]!==source || r[0]===input.backupId) continue;
      if((r[3]==='daily' && String(r[4])<cutoff) || (r[3]==='latest' && Number(r[2])<latestRevision)) sheet.deleteRow(i+2);
    }
    return backupReply({status:'ok',backupId:saved.backupId,checksum:saved.checksum,revision:saved.revision});
  } catch(error) {
    return backupReply({status:'error',message:String(error.message || error)});
  } finally {
    if(lock.hasLock()) lock.releaseLock();
  }
}
