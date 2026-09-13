const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  console.log(JSON.stringify({version:"rescue-20260914-2",action:e.parameter.action || "",parameterKeys:Object.keys(e.parameter)}));
  if (e.parameter.action === "health") {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("貨款帳本");
    return ContentService.createTextOutput(JSON.stringify({status:"ok",version:"rescue-20260914-2",spreadsheetId:ss.getId(),ledgerCount:sheet.getDataRange().getValues().slice(1).filter(r=>r[0]).length})).setMimeType(ContentService.MimeType.JSON);
  }
  if (e.parameter.action === "write_ledger") return writeLedger(e);
  if (e.parameter.action === "read_ledger") return readLedger();
  if (e.parameter.action === "write_edit_log") return writeEditLog(e);
  if (e.parameter.action === "write_revenue") return writeRevenue(e);
  if (e.parameter.action === "read_revenue") return readRevenue();
  if (e.parameter.action === "write_revenue_edit_log") return writeRevenueEditLog(e);
  return ContentService.createTextOutput(JSON.stringify({status:"error",message:"Unknown action",version:"rescue-20260914-2",action:e.parameter.action || ""})).setMimeType(ContentService.MimeType.JSON);
}

function writeLedger(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const data = JSON.parse(e.parameter.data);
    if (!Number.isSafeInteger(Number(data.id)) || Number(data.id) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !["in","out"].includes(data.type) || !Number.isFinite(Number(data.amount)) || Number(data.amount) < 0 || typeof data.content !== "string" || !data.content.trim()) throw new Error("Invalid ledger record");
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName("貨款帳本");
    if (!sheet) {
      sheet = ss.insertSheet("貨款帳本");
      sheet.appendRow(["ID","日期","廠商","內容","類型","金額","收據/發票","剩餘貨款","時間"]);
      sheet.getRange(1,1,1,9).setFontWeight("bold");
    }
    const signedAmount = data.type === "out" ? -Math.abs(data.amount) : Math.abs(data.amount);
    const receipt = data.receipt ? "✓" : "";
    const rows = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i+1,1,1,7).setValues([[data.id,data.date,data.vendor,data.content,data.type==="in"?"收入":"支出",signedAmount,receipt]]);
        found = true; break;
      }
    }
    if (!found) {
      const nextRow = sheet.getLastRow() + 1;
      if (nextRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
      sheet.getRange(nextRow,1,1,9).setValues([[data.id,data.date,data.vendor,data.content,data.type==="in"?"收入":"支出",signedAmount,receipt,"",data.time]]);
    }
    const allRows = sheet.getDataRange().getValues();
    let bal = 0;
    const balances = allRows.slice(1).map(row => {
      if (!row[0]) return [row[7]];
      bal += Number(row[5]) || 0;
      return [bal];
    });
    if (balances.length) sheet.getRange(2,8,balances.length,1).setValues(balances);
    SpreadsheetApp.flush();
    const savedRows = sheet.getDataRange().getValues();
    const savedIndex = savedRows.findIndex(r => String(r[0]) === String(data.id));
    if (savedIndex < 1) throw new Error("Write verification failed: record missing");
    const saved = savedRows[savedIndex];
    if (String(saved[2]) !== String(data.vendor) || String(saved[3]) !== String(data.content) || Number(saved[5]) !== signedAmount) throw new Error("Write verification failed: contents differ");
    const result = {status:"ok",version:"rescue-20260914-2",id:data.id,spreadsheetId:ss.getId(),row:savedIndex+1,operation:found?"update":"append"};
    console.log(JSON.stringify(result));
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error",message:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function readLedger() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("貨款帳本");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({records:[]})).setMimeType(ContentService.MimeType.JSON);
    const rows = sheet.getDataRange().getValues();
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const [id,date,vendor,content,typeLabel,amount,receipt,,time] = rows[i];
      if (!id) continue;
      const dateStr = date instanceof Date
        ? date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0")
        : String(date).replace(/\//g,"-");
      records.push({id:Number(id),date:dateStr,vendor:String(vendor),content:String(content),type:typeLabel==="收入"?"in":"out",amount:Math.abs(Number(amount)),receipt:receipt==="✓",time:String(time)});
    }
    return ContentService.createTextOutput(JSON.stringify({records})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({records:[],error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function writeEditLog(e) {
  try {
    const data = JSON.parse(e.parameter.data);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName("修改紀錄");
    if (!sheet) {
      sheet = ss.insertSheet("修改紀錄");
      sheet.appendRow(["時間","修改人","修改原因","修改前","修改後"]);
      sheet.getRange(1,1,1,5).setFontWeight("bold");
    }
    const d = new Date(data.time);
    const timeStr = d.getFullYear()+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
    sheet.appendRow([timeStr,data.editor,data.reason,data.original,data.updated]);
    return ContentService.createTextOutput(JSON.stringify({status:"ok"})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error",message:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function writeRevenue(e) {
  try {
    const data = JSON.parse(e.parameter.data);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName("營收記錄");
    if (!sheet) {
      sheet = ss.insertSheet("營收記錄");
      sheet.appendRow(["ID","日期","信用卡應收","信用卡實收","外送營收","信用卡差額","現金應收","現金實收","現金差額","當日應收營收","當日實際營收","當日差額","應剩餘貨款","實際剩餘貨款","與貨款相符","備註","時間"]);
      sheet.getRange(1,1,1,17).setFontWeight("bold");
    }
    const delivery = Number(data.deliveryRevenue || 0);
    const ccDiff = (Number(data.ccActual) + delivery) - Number(data.ccExpected);
    const cashDiff = Number(data.cashActual) - Number(data.cashExpected);
    const dailyExpected = Number(data.ccExpected) + Number(data.cashExpected);
    const dailyRevenue = Number(data.ccActual) + delivery + Number(data.cashActual);
    const dailyDiff = ccDiff + cashDiff;
    const actualVB = data.vendorBalanceMatch ? data.expectedVendorBalance : data.actualVendorBalance;
    const newRow = [data.id,data.date,data.ccExpected,data.ccActual,delivery,ccDiff,data.cashExpected,data.cashActual,cashDiff,dailyExpected,dailyRevenue,dailyDiff,data.expectedVendorBalance,actualVB,data.vendorBalanceMatch?"✓":"",data.note||"",data.time];
    const rows = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(data.id)) {
        sheet.getRange(i+1,1,1,17).setValues([newRow]);
        found = true; break;
      }
    }
    if (!found) sheet.appendRow(newRow);
    return ContentService.createTextOutput(JSON.stringify({status:"ok"})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error",message:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function readRevenue() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("營收記錄");
    if (!sheet) return ContentService.createTextOutput(JSON.stringify({records:[]})).setMimeType(ContentService.MimeType.JSON);
    const rows = sheet.getDataRange().getValues();
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const [id,date,ccExpected,ccActual,deliveryRevenue,,cashExpected,cashActual,,,,,expectedVB,actualVB,match,note,time] = rows[i];
      if (!id) continue;
      const dateStr = date instanceof Date
        ? date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0")
        : String(date).replace(/\//g,"-");
      records.push({id:Number(id),date:dateStr,ccExpected:Number(ccExpected),ccActual:Number(ccActual),deliveryRevenue:Number(deliveryRevenue||0),cashExpected:Number(cashExpected),cashActual:Number(cashActual),expectedVendorBalance:Number(expectedVB||0),actualVendorBalance:Number(actualVB||0),vendorBalanceMatch:match==="✓",note:String(note||""),time:String(time)});
    }
    return ContentService.createTextOutput(JSON.stringify({records})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({records:[],error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function writeRevenueEditLog(e) {
  try {
    const data = JSON.parse(e.parameter.data);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName("營收修改紀錄");
    if (!sheet) {
      sheet = ss.insertSheet("營收修改紀錄");
      sheet.appendRow(["時間","修改人","修改原因","修改前","修改後"]);
      sheet.getRange(1,1,1,5).setFontWeight("bold");
    }
    const d = new Date(data.time);
    const timeStr = d.getFullYear()+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0")+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
    sheet.appendRow([timeStr,data.editor,data.reason,data.original,data.updated]);
    return ContentService.createTextOutput(JSON.stringify({status:"ok"})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:"error",message:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function recalcBalance() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("貨款帳本");
  if (!sheet) return;
  const allRows = sheet.getDataRange().getValues();
  let bal = 0;
  for (let i = 1; i < allRows.length; i++) {
    if (!allRows[i][0]) continue;
    bal += Number(allRows[i][5]) || 0;
    sheet.getRange(i+1,8).setValue(bal);
  }
  Logger.log("完成，最終餘額：" + bal);
}