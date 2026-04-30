import { useState, useEffect, useCallback, useRef } from "react";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywpj522GgduRbcprGQ0mHNTVkEmQi_uoCaBgXUS5GlvGHQsGHLHLTNTET-WojzcYEhOw/exec";
const STORAGE_KEY = "vendor_ledger_records";
const REVENUE_KEY = "revenue_records";

const VENDORS = ["鼎耀","7-Eleven","全聯","瓦斯","垃圾清運","樂清","開元","薪資","萊爾富","雞蛋","得意百貨","其他"];

const fmt = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", minimumFractionDigits: 0 }).format(n);
const fmtDiff = (n) => { const s = fmt(Math.abs(n)); return n >= 0 ? `+${s}` : `-${s}`; };
const today = () => new Date().toISOString().slice(0, 10);
const fmtDatetime = (iso) => { try { const d = new Date(iso); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; } catch(_){ return iso; } };

// ── Ledger API ──
const syncRecord = async (record) => {
  try { const p = new URLSearchParams({ action:"write_ledger", data:JSON.stringify(record) }); await fetch(`${SCRIPT_URL}?${p}`, {mode:"no-cors"}); return true; } catch(_){ return false; }
};
const syncEditLog = async (log) => {
  try { const p = new URLSearchParams({ action:"write_edit_log", data:JSON.stringify(log) }); await fetch(`${SCRIPT_URL}?${p}`, {mode:"no-cors"}); } catch(_){}
};
const loadFromSheet = async () => {
  try { const res = await fetch(`${SCRIPT_URL}?action=read_ledger`); const d = await res.json(); return Array.isArray(d.records) ? d.records : null; } catch(_){ return null; }
};

// ── Revenue API ──
const syncRevenue = async (rec) => {
  try { const p = new URLSearchParams({ action:"write_revenue", data:JSON.stringify(rec) }); await fetch(`${SCRIPT_URL}?${p}`, {mode:"no-cors"}); return true; } catch(_){ return false; }
};
const syncRevenueEditLog = async (log) => {
  try { const p = new URLSearchParams({ action:"write_revenue_edit_log", data:JSON.stringify(log) }); await fetch(`${SCRIPT_URL}?${p}`, {mode:"no-cors"}); } catch(_){}
};
const loadRevenueFromSheet = async () => {
  try { const res = await fetch(`${SCRIPT_URL}?action=read_revenue`); const d = await res.json(); return Array.isArray(d.records) ? d.records : null; } catch(_){ return null; }
};

const revLabel = (r) => `${r.date} | 信用卡應收${r.ccExpected} 實收${r.ccActual} | 現金應收${r.cashExpected} 實收${r.cashActual}`;

const inputStyle = { background:"#1a1a1a", border:"1.5px solid #2a2a2a", color:"#e8e8e8", fontFamily:"'Courier New', monospace", borderRadius:4, padding:"7px 10px", fontSize:13, outline:"none", width:"100%" };

const emptyRevForm = (vendorBalance = 0) => ({
  date: today(),
  ccExpected: "", ccActual: "", deliveryRevenue: "",
  cashExpected: "", cashActual: "",
  note: "",
  expectedVendorBalance: vendorBalance,
  vendorBalanceMatch: true,
  actualVendorBalance: "",
});

export default function App() {
  const [mainTab, setMainTab] = useState("ledger"); // ledger | revenue

  // ── Ledger state ──
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filterVendor, setFilterVendor] = useState("全部");
  const [filterDate, setFilterDate] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authRecord, setAuthRecord] = useState(null);
  const [authName, setAuthName] = useState("");
  const [authReason, setAuthReason] = useState("");
  const [authError, setAuthError] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editAuth, setEditAuth] = useState(null);
  const [form, setForm] = useState({ date:today(), vendor:"鼎耀", content:"", type:"out", amount:"", receipt:false });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ date:today(), vendor:"鼎耀", content:"", type:"out", amount:"", receipt:false });
  const amountRef = useRef(null);
  const addAmountRef = useRef(null);

  // ── Revenue state ──
  const [revenues, setRevenues] = useState([]);
  const [revLoaded, setRevLoaded] = useState(false);
  const [revSyncStatus, setRevSyncStatus] = useState("");
  const [showRevAdd, setShowRevAdd] = useState(false);
  const [revForm, setRevForm] = useState(emptyRevForm());
  const [showRevAuth, setShowRevAuth] = useState(false);
  const [revAuthRecord, setRevAuthRecord] = useState(null);
  const [revAuthName, setRevAuthName] = useState("");
  const [revAuthReason, setRevAuthReason] = useState("");
  const [revAuthError, setRevAuthError] = useState("");
  const [showRevEdit, setShowRevEdit] = useState(false);
  const [revEditId, setRevEditId] = useState(null);
  const [revEditAuth, setRevEditAuth] = useState(null);
  const [revEditForm, setRevEditForm] = useState(emptyRevForm());
  const [revFilterDate, setRevFilterDate] = useState("");

  // ── Load ──
  useEffect(() => {
    (async () => {
      const sheet = await loadFromSheet();
      if (sheet && sheet.length > 0) { setRecords(sheet); localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet)); }
      else { try { const r = localStorage.getItem(STORAGE_KEY); if(r) setRecords(JSON.parse(r)); } catch(_){} }
      setLoaded(true);
    })();
    (async () => {
      const sheet = await loadRevenueFromSheet();
      if (sheet && sheet.length > 0) { setRevenues(sheet); localStorage.setItem(REVENUE_KEY, JSON.stringify(sheet)); }
      else { try { const r = localStorage.getItem(REVENUE_KEY); if(r) setRevenues(JSON.parse(r)); } catch(_){} }
      setRevLoaded(true);
    })();
  }, []);

  const saveLocal = useCallback((recs) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recs)); } catch(_){} }, []);
  const saveRevLocal = useCallback((recs) => { try { localStorage.setItem(REVENUE_KEY, JSON.stringify(recs)); } catch(_){} }, []);

  // ── Ledger computed ──
  const withBalance = (recs) => { let b=0; return recs.map(r=>{ b += r.type==="in"?r.amount:-r.amount; return {...r,balance:b}; }); };
  const sorted = [...records].sort((a,b)=>new Date(a.date)-new Date(b.date)||a.id-b.id);
  const withBal = withBalance(sorted);
  const filtered = withBal.filter(r => (filterVendor==="全部"||r.vendor===filterVendor) && (!filterDate||r.date===filterDate));
  const currentBalance = withBal.length>0 ? withBal[withBal.length-1].balance : 0;
  const thisMonth = today().slice(0,7); // YYYY-MM
  const monthRecords = records.filter(r=>r.date.slice(0,7)===thisMonth);
  const totalOut = monthRecords.filter(r=>r.type==="out").reduce((a,r)=>a+r.amount,0);
  const totalIn = monthRecords.filter(r=>r.type==="in").reduce((a,r)=>a+r.amount,0);

  // ── Revenue computed ──
  const calcRev = (r) => {
    const delivery = Number(r.deliveryRevenue||0);
    const cc = (Number(r.ccActual||0) + delivery) - Number(r.ccExpected||0);
    const cash = Number(r.cashActual||0) - Number(r.cashExpected||0);
    const dailyExpected = Number(r.ccExpected||0) + Number(r.cashExpected||0);
    const rev = Number(r.ccActual||0) + delivery + Number(r.cashActual||0);
    const diff = cc + cash;
    return { ccDiff:cc, cashDiff:cash, dailyExpected, dailyRevenue:rev, dailyDiff:diff };
  };
  const sortedRevs = [...revenues].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const filteredRevs = sortedRevs.filter(r => !revFilterDate || r.date===revFilterDate);

  // ── Ledger actions ──
  const clickEdit = (rec) => { setAuthRecord(rec); setAuthName(""); setAuthReason(""); setAuthError(""); setShowAuthModal(true); };
  const submitAuth = () => {
    if (!authName.trim()) { setAuthError("請填寫修改人姓名"); return; }
    if (!authReason.trim()) { setAuthError("請填寫修改原因"); return; }
    setEditAuth({ name:authName.trim(), reason:authReason.trim() });
    setEditId(authRecord.id);
    setForm({ date:authRecord.date, vendor:authRecord.vendor, content:authRecord.content, type:authRecord.type, amount:String(authRecord.amount), receipt:authRecord.receipt||false });
    setShowAuthModal(false); setShowEditForm(true);
    setTimeout(()=>amountRef.current?.focus(),100);
  };
  const submitEdit = async () => {
    const amt = parseInt(form.amount.replace(/[^0-9]/g,""),10);
    if (!amt||isNaN(amt)||!form.content.trim()) return;
    const original = records.find(r=>r.id===editId);
    const updated_rec = {...original, date:form.date, vendor:form.vendor, content:form.content.trim(), type:form.type, amount:amt, receipt:form.receipt};
    const updated = records.map(r=>r.id===editId?updated_rec:r);
    setRecords(updated); saveLocal(updated); setShowEditForm(false);
    setSyncStatus("syncing");
    await syncRecord(updated_rec);
    await syncEditLog({ id:Date.now(), time:new Date().toISOString(), editor:editAuth.name, reason:editAuth.reason, original:revLabel(original)||"", updated:revLabel(updated_rec)||"" });
    setSyncStatus("ok"); setTimeout(()=>setSyncStatus(""),3000);
    setEditAuth(null); setEditId(null);
  };
  const submitAdd = async () => {
    const amt = parseInt(addForm.amount.replace(/[^0-9]/g,""),10);
    if (!amt||isNaN(amt)||!addForm.content.trim()) return;
    const rec = { id:Date.now(), date:addForm.date, vendor:addForm.vendor, content:addForm.content.trim(), type:addForm.type, amount:amt, receipt:addForm.receipt, time:new Date().toISOString() };
    const updated = [...records, rec]; setRecords(updated); saveLocal(updated);
    setShowAddForm(false); setAddForm({ date:today(), vendor:"鼎耀", content:"", type:"out", amount:"", receipt:false });
    setSyncStatus("syncing");
    const ok = await syncRecord(rec);
    setSyncStatus(ok?"ok":"fail"); setTimeout(()=>setSyncStatus(""),3000);
  };
  const deleteRecord = (id) => {
    if (!confirm("確定刪除這筆記錄？")) return;
    const updated = records.filter(r=>r.id!==id); setRecords(updated); saveLocal(updated);
  };

  // ── Revenue actions ──
  const submitRevAdd = async () => {
    const { date, ccExpected, ccActual, deliveryRevenue, cashExpected, cashActual, note, expectedVendorBalance, vendorBalanceMatch, actualVendorBalance } = revForm;
    if (!date||!ccExpected||!ccActual||!cashExpected||!cashActual) return;
    if (revenues.find(r=>r.date===date)) { alert(`${date} 已有記錄，請使用編輯功能修改`); return; }
    const actualVB = vendorBalanceMatch ? expectedVendorBalance : Number(actualVendorBalance);
    const rec = { id:Date.now(), date, ccExpected:Number(ccExpected), ccActual:Number(ccActual), deliveryRevenue:Number(deliveryRevenue||0), cashExpected:Number(cashExpected), cashActual:Number(cashActual), note:note||"", expectedVendorBalance:Number(expectedVendorBalance), vendorBalanceMatch, actualVendorBalance:actualVB, time:new Date().toISOString() };
    const updated = [...revenues, rec]; setRevenues(updated); saveRevLocal(updated);
    setShowRevAdd(false); setRevForm(emptyRevForm());
    setRevSyncStatus("syncing");
    const ok = await syncRevenue(rec);
    setRevSyncStatus(ok?"ok":"fail"); setTimeout(()=>setRevSyncStatus(""),3000);
  };
  const clickRevEdit = (rec) => { setRevAuthRecord(rec); setRevAuthName(""); setRevAuthReason(""); setRevAuthError(""); setShowRevAuth(true); };
  const submitRevAuth = () => {
    if (!revAuthName.trim()) { setRevAuthError("請填寫修改人姓名"); return; }
    if (!revAuthReason.trim()) { setRevAuthError("請填寫修改原因"); return; }
    setRevEditAuth({ name:revAuthName.trim(), reason:revAuthReason.trim() });
    setRevEditId(revAuthRecord.id);
    setRevEditForm({
      date: revAuthRecord.date,
      ccExpected: String(revAuthRecord.ccExpected),
      ccActual: String(revAuthRecord.ccActual),
      deliveryRevenue: String(revAuthRecord.deliveryRevenue||0),
      cashExpected: String(revAuthRecord.cashExpected),
      cashActual: String(revAuthRecord.cashActual),
      note: revAuthRecord.note || "",
      expectedVendorBalance: revAuthRecord.expectedVendorBalance ?? 0,
      vendorBalanceMatch: revAuthRecord.vendorBalanceMatch ?? true,
      actualVendorBalance: String(revAuthRecord.actualVendorBalance ?? ""),
    });
    setShowRevAuth(false); setShowRevEdit(true);
  };
  const submitRevEdit = async () => {
    const { date, ccExpected, ccActual, deliveryRevenue, cashExpected, cashActual, note, expectedVendorBalance, vendorBalanceMatch, actualVendorBalance } = revEditForm;
    if (!date||!ccExpected||!ccActual||!cashExpected||!cashActual) return;
    const original = revenues.find(r=>r.id===revEditId);
    const actualVB = vendorBalanceMatch ? Number(expectedVendorBalance) : Number(actualVendorBalance);
    const updated_rec = { ...original, date, ccExpected:Number(ccExpected), ccActual:Number(ccActual), deliveryRevenue:Number(deliveryRevenue||0), cashExpected:Number(cashExpected), cashActual:Number(cashActual), note:note||"", expectedVendorBalance:Number(expectedVendorBalance), vendorBalanceMatch, actualVendorBalance:actualVB };
    const updated = revenues.map(r=>r.id===revEditId?updated_rec:r);
    setRevenues(updated); saveRevLocal(updated); setShowRevEdit(false);
    setRevSyncStatus("syncing");
    await syncRevenue(updated_rec);
    await syncRevenueEditLog({ id:Date.now(), time:new Date().toISOString(), editor:revEditAuth.name, reason:revEditAuth.reason, original:revLabel(original), updated:revLabel(updated_rec) });
    setRevSyncStatus("ok"); setTimeout(()=>setRevSyncStatus(""),3000);
    setRevEditAuth(null); setRevEditId(null);
  };
  const deleteRevenue = (id) => {
    if (!confirm("確定刪除這筆記錄？")) return;
    const updated = revenues.filter(r=>r.id!==id); setRevenues(updated); saveRevLocal(updated);
  };
  const exportRevCSV = () => {
    const rows = [["日期","信用卡應收","信用卡實收","外送營收","信用卡差額","現金應收","現金實收","現金差額","當日應收營收","當日實際營收","當日差額","應剩餘貨款","實際剩餘貨款","與貨款相符","備註"]];
    sortedRevs.forEach(r=>{ const c=calcRev(r); rows.push([r.date,r.ccExpected,r.ccActual,r.deliveryRevenue||0,c.ccDiff,r.cashExpected,r.cashActual,c.cashDiff,c.dailyExpected,c.dailyRevenue,c.dailyDiff,r.expectedVendorBalance??"",(r.actualVendorBalance??""),r.vendorBalanceMatch?"✓":"",r.note||""]); });
    const csv="\uFEFF"+rows.map(r=>r.join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`revenue-${today()}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const exportCSV = () => {
    const rows=[["日期","廠商","內容","類型","金額","收據/發票","剩餘貨款"]];
    withBal.forEach(r=>rows.push([r.date,r.vendor,r.content,r.type==="in"?"收入":"支出",r.type==="in"?r.amount:-r.amount,r.receipt?"✓":"",r.balance]));
    const csv="\uFEFF"+rows.map(r=>r.join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`vendor-ledger-${today()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!loaded||!revLoaded) return (
    <div style={{background:"#0f0f0f",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#3dff7e",fontFamily:"monospace",fontSize:14}}>
      ⟳ 從 Google Sheets 載入...
    </div>
  );

  const diffColor = (n) => n > 0 ? "#3dff7e" : n < 0 ? "#ff6b6b" : "#888";

  return (
    <div style={{background:"#0f0f0f",minHeight:"100vh",color:"#e8e8e8",fontFamily:"'Courier New', monospace"}}>
      <style>{`* { box-sizing: border-box; } input:focus,select:focus{border-color:#3dff7e!important} button{cursor:pointer;font-family:'Courier New',monospace;transition:all .15s;} button:active{transform:scale(.96);} tr:hover td{background:#161616;}`}</style>

      {/* ── Header ── */}
      <div style={{borderBottom:"1px solid #1e1e1e",padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:10,color:"#555",letterSpacing:3}}>RAZZLE DAZZLE</div>
          <div style={{fontSize:15,fontWeight:700,color:"#e8e8e8",letterSpacing:1}}>
            管理系統
            {(syncStatus||revSyncStatus) && <span style={{marginLeft:12,fontSize:11,color:(syncStatus||revSyncStatus)==="syncing"?"#888":(syncStatus||revSyncStatus)==="ok"?"#3dff7e":"#ff4444"}}>
              {(syncStatus||revSyncStatus)==="syncing"?"⟳ 同步中":(syncStatus||revSyncStatus)==="ok"?"☁ 已同步":"⚠ 同步失敗"}
            </span>}
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          {mainTab==="ledger" && <>
            <button onClick={exportCSV} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"7px 14px",borderRadius:4,fontSize:12}}>匯出 CSV</button>
            <button onClick={()=>{setAddForm({date:today(),vendor:"鼎耀",content:"",type:"out",amount:"",receipt:false});setShowAddForm(true);setTimeout(()=>addAmountRef.current?.focus(),100);}} style={{background:"#3dff7e",border:"none",color:"#0f0f0f",padding:"8px 20px",borderRadius:4,fontSize:13,fontWeight:700}}>+ 新增記錄</button>
          </>}
          {mainTab==="revenue" && <>
            <button onClick={exportRevCSV} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"7px 14px",borderRadius:4,fontSize:12}}>匯出 CSV</button>
            <button onClick={()=>{setRevForm(emptyRevForm(currentBalance));setShowRevAdd(true);}} style={{background:"#f5c542",border:"none",color:"#0f0f0f",padding:"8px 20px",borderRadius:4,fontSize:13,fontWeight:700}}>+ 新增營收</button>
          </>}
        </div>
      </div>

      {/* ── Main Tabs ── */}
      <div style={{display:"flex",borderBottom:"2px solid #1a1a1a"}}>
        {[{key:"ledger",label:"貨款帳本",color:"#3dff7e"},{key:"revenue",label:"營收記錄",color:"#f5c542"}].map(t=>(
          <button key={t.key} onClick={()=>setMainTab(t.key)} style={{padding:"13px 28px",background:"transparent",border:"none",color:mainTab===t.key?t.color:"#444",borderBottom:`2.5px solid ${mainTab===t.key?t.color:"transparent"}`,fontSize:13,fontWeight:700,letterSpacing:1,marginBottom:-2}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ LEDGER TAB ══ */}
      {mainTab==="ledger" && <>
        <div style={{display:"flex",borderBottom:"1px solid #1a1a1a"}}>
          {[{label:"剩餘貨款",value:fmt(currentBalance),color:currentBalance>=0?"#e8e8e8":"#ff6b6b"},{label:"本月支出",value:fmt(totalOut),color:"#ff6b6b"},{label:"本月收入",value:fmt(totalIn),color:"#3dff7e"},{label:"筆數",value:`${records.length} 筆`,color:"#888"}].map((s,i)=>(
            <div key={i} style={{flex:1,padding:"14px 24px",borderRight:"1px solid #1a1a1a"}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"12px 28px",display:"flex",gap:10,alignItems:"center",borderBottom:"1px solid #1a1a1a",flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:"#555",marginRight:4}}>篩選：</div>
          <select value={filterVendor} onChange={e=>setFilterVendor(e.target.value)} style={{...inputStyle,width:"auto"}}>
            <option value="全部">全部廠商</option>
            {VENDORS.map(v=><option key={v} value={v}>{v}</option>)}
          </select>
          <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inputStyle,width:"auto",colorScheme:"dark"}} />
          {(filterVendor!=="全部"||filterDate)&&<button onClick={()=>{setFilterVendor("全部");setFilterDate("");}} style={{background:"transparent",border:"1px solid #333",color:"#888",padding:"6px 12px",borderRadius:4,fontSize:11}}>清除篩選</button>}
          <div style={{marginLeft:"auto",fontSize:11,color:"#555"}}>顯示 {filtered.length} / {records.length} 筆</div>
        </div>
        <div style={{padding:"0 28px 40px",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",marginTop:8}}>
            <thead><tr style={{borderBottom:"2px solid #222"}}>
              {["日期","廠商","內容","類型","金額","收據","剩餘貨款","操作"].map(h=>(
                <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:10,color:"#555",letterSpacing:2,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.length===0&&<tr><td colSpan={8} style={{padding:"40px",textAlign:"center",color:"#333",fontSize:13}}>尚無記錄</td></tr>}
              {filtered.map(r=>(
                <tr key={r.id} style={{borderBottom:"1px solid #181818"}}>
                  <td style={{padding:"10px 12px",fontSize:13,color:"#888",whiteSpace:"nowrap"}}>{r.date}</td>
                  <td style={{padding:"10px 12px",fontSize:13,fontWeight:600,whiteSpace:"nowrap"}}>{r.vendor}</td>
                  <td style={{padding:"10px 12px",fontSize:13,maxWidth:300}}>{r.content}</td>
                  <td style={{padding:"10px 12px"}}>
                    <span style={{fontSize:11,padding:"3px 8px",borderRadius:20,background:r.type==="in"?"#0a2a15":"#2a0a0a",color:r.type==="in"?"#3dff7e":"#ff6b6b",fontWeight:700}}>{r.type==="in"?"收入":"支出"}</span>
                  </td>
                  <td style={{padding:"10px 12px",fontSize:14,fontWeight:700,color:r.type==="in"?"#3dff7e":"#ff6b6b",whiteSpace:"nowrap"}}>{r.type==="in"?"+":"-"}{fmt(r.amount)}</td>
                  <td style={{padding:"10px 12px",textAlign:"center"}}><span style={{fontSize:14,color:r.receipt?"#3dff7e":"#333"}}>{r.receipt?"✓":"—"}</span></td>
                  <td style={{padding:"10px 12px",fontSize:14,fontWeight:700,color:r.balance<0?"#ff6b6b":"#e8e8e8",whiteSpace:"nowrap"}}>{fmt(r.balance)}</td>
                  <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                    <button onClick={()=>clickEdit(r)} style={{background:"transparent",border:"1px solid #333",color:"#888",fontSize:11,padding:"4px 10px",borderRadius:4,marginRight:6}}>編輯</button>
                    <button onClick={()=>deleteRecord(r.id)} style={{background:"transparent",border:"none",color:"#333",fontSize:13,padding:"4px 8px"}}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {/* ══ REVENUE TAB ══ */}
      {mainTab==="revenue" && <>
        {/* Revenue stats */}
        {(() => {
          const monthRevs = revenues.filter(r=>r.date.slice(0,7)===thisMonth);
          const totalExpected = monthRevs.reduce((a,r)=>a+calcRev(r).dailyExpected,0);
          const totalRevenue = monthRevs.reduce((a,r)=>a+calcRev(r).dailyRevenue,0);
          const totalDiff = monthRevs.reduce((a,r)=>a+calcRev(r).dailyDiff,0);
          return (
            <div style={{display:"flex",borderBottom:"1px solid #1a1a1a"}}>
              {[{label:"本月應收營收",value:fmt(totalExpected),color:"#888"},{label:"本月實際營收",value:fmt(totalRevenue),color:"#f5c542"},{label:"本月差額",value:fmtDiff(totalDiff),color:diffColor(totalDiff)},{label:"記錄天數",value:`${revenues.length} 天`,color:"#888"}].map((s,i)=>(
                <div key={i} style={{flex:1,padding:"14px 24px",borderRight:"1px solid #1a1a1a"}}>
                  <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:4}}>{s.label}</div>
                  <div style={{fontSize:22,fontWeight:700,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Revenue filter */}
        <div style={{padding:"12px 28px",display:"flex",gap:10,alignItems:"center",borderBottom:"1px solid #1a1a1a"}}>
          <div style={{fontSize:11,color:"#555",marginRight:4}}>篩選日期：</div>
          <input type="date" value={revFilterDate} onChange={e=>setRevFilterDate(e.target.value)} style={{...inputStyle,width:"auto",colorScheme:"dark"}} />
          {revFilterDate&&<button onClick={()=>setRevFilterDate("")} style={{background:"transparent",border:"1px solid #333",color:"#888",padding:"6px 12px",borderRadius:4,fontSize:11}}>清除</button>}
          <div style={{marginLeft:"auto",fontSize:11,color:"#555"}}>顯示 {filteredRevs.length} / {revenues.length} 筆</div>
        </div>

        {/* Revenue table */}
        <div style={{padding:"0 28px 40px",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",marginTop:8}}>
            <thead><tr style={{borderBottom:"2px solid #222"}}>
              {["日期","信用卡應收","信用卡實收","外送營收","信用卡差額","現金應收","現金實收","現金差額","當日應收營收","當日實際營收","當日差額","應剩餘貨款","實際剩餘貨款","備註","操作"].map(h=>(
                <th key={h} style={{padding:"10px 10px",textAlign:"right",fontSize:10,color:"#555",letterSpacing:1,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filteredRevs.length===0&&<tr><td colSpan={15} style={{padding:"40px",textAlign:"center",color:"#333",fontSize:13}}>尚無記錄</td></tr>}
              {filteredRevs.map(r=>{
                const c = calcRev(r);
                return (
                  <tr key={r.id} style={{borderBottom:"1px solid #181818"}}>
                    <td style={{padding:"10px 10px",fontSize:13,color:"#888",whiteSpace:"nowrap",textAlign:"right"}}>{r.date}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right"}}>{fmt(r.ccExpected)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",color:"#e8e8e8",fontWeight:600}}>{fmt(r.ccActual)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",color:"#60a5fa",fontWeight:600,whiteSpace:"nowrap"}}>{r.deliveryRevenue?fmt(r.deliveryRevenue):"—"}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",fontWeight:700,color:diffColor(c.ccDiff)}}>{fmtDiff(c.ccDiff)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right"}}>{fmt(r.cashExpected)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",color:"#e8e8e8",fontWeight:600}}>{fmt(r.cashActual)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",fontWeight:700,color:diffColor(c.cashDiff)}}>{fmtDiff(c.cashDiff)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",fontWeight:700,color:"#888",whiteSpace:"nowrap"}}>{fmt(c.dailyExpected)}</td>
                    <td style={{padding:"10px 10px",fontSize:14,textAlign:"right",fontWeight:700,color:"#f5c542",whiteSpace:"nowrap"}}>{fmt(c.dailyRevenue)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",fontWeight:700,color:diffColor(c.dailyDiff)}}>{fmtDiff(c.dailyDiff)}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",color:"#888",whiteSpace:"nowrap"}}>{r.expectedVendorBalance!=null?fmt(r.expectedVendorBalance):"—"}</td>
                    <td style={{padding:"10px 10px",fontSize:13,textAlign:"right",fontWeight:700,whiteSpace:"nowrap",color:r.vendorBalanceMatch?"#3dff7e":(r.actualVendorBalance!==r.expectedVendorBalance?"#ff6b6b":"#e8e8e8")}}>
                      {r.actualVendorBalance!=null?fmt(r.actualVendorBalance):"—"}
                      {r.vendorBalanceMatch&&<span style={{fontSize:10,color:"#3dff7e",marginLeft:4}}>✓</span>}
                    </td>
                    <td style={{padding:"10px 10px",fontSize:12,color:"#888",maxWidth:160}}>{r.note||"—"}</td>
                    <td style={{padding:"10px 10px",whiteSpace:"nowrap",textAlign:"right"}}>
                      <button onClick={()=>clickRevEdit(r)} style={{background:"transparent",border:"1px solid #333",color:"#888",fontSize:11,padding:"4px 10px",borderRadius:4,marginRight:6}}>編輯</button>
                      <button onClick={()=>deleteRevenue(r.id)} style={{background:"transparent",border:"none",color:"#333",fontSize:13,padding:"4px 8px"}}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}

      {/* ══ LEDGER MODALS ══ */}
      {showAuthModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}
          onClick={e=>{if(e.target===e.currentTarget){setShowAuthModal(false);setAuthRecord(null);}}}>
          <div style={{background:"#141414",border:"1.5px solid #ff6b6b",borderRadius:10,padding:"28px 32px",width:440,maxWidth:"90vw"}}>
            <div style={{fontSize:11,color:"#ff6b6b",letterSpacing:3,marginBottom:6}}>修改授權確認</div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>修改此記錄前請填寫以下資料</div>
            <div style={{fontSize:11,color:"#555",marginBottom:20,padding:"8px 12px",background:"#1a1a1a",borderRadius:4,lineHeight:1.7}}>
              {authRecord&&`${authRecord.date} | ${authRecord.vendor} | ${authRecord.content}`}
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"#888",letterSpacing:2,marginBottom:5}}>修改人姓名 <span style={{color:"#ff6b6b"}}>*</span></div>
              <input value={authName} onChange={e=>{setAuthName(e.target.value);setAuthError("");}} placeholder="請輸入您的姓名" style={inputStyle} />
            </div>
            <div style={{marginBottom:authError?10:20}}>
              <div style={{fontSize:10,color:"#888",letterSpacing:2,marginBottom:5}}>修改原因 <span style={{color:"#ff6b6b"}}>*</span></div>
              <textarea value={authReason} onChange={e=>{setAuthReason(e.target.value);setAuthError("");}} placeholder="請說明修改原因..." rows={3} style={{...inputStyle,resize:"vertical"}} />
            </div>
            {authError&&<div style={{color:"#ff6b6b",fontSize:12,marginBottom:14}}>⚠ {authError}</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>{setShowAuthModal(false);setAuthRecord(null);}} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"9px 20px",borderRadius:6,fontSize:13}}>取消</button>
              <button onClick={submitAuth} style={{background:"#ff6b6b",border:"none",color:"#fff",padding:"9px 24px",borderRadius:6,fontSize:13,fontWeight:700}}>確認，繼續修改</button>
            </div>
          </div>
        </div>
      )}
      {showEditForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
          <div style={{background:"#141414",border:"1px solid #2a2a2a",borderRadius:10,padding:"28px 32px",width:460,maxWidth:"90vw"}}>
            <div style={{fontSize:11,color:"#f5c542",letterSpacing:3,marginBottom:4}}>編輯記錄（貨款帳本）</div>
            <div style={{fontSize:11,color:"#555",marginBottom:18,padding:"6px 10px",background:"#1a1a1a",borderRadius:4}}>修改人：<span style={{color:"#f5c542"}}>{editAuth?.name}</span>　原因：{editAuth?.reason}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>日期</div><input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{...inputStyle,colorScheme:"dark"}} /></div>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>廠商</div><select value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} style={inputStyle}>{VENDORS.map(v=><option key={v} value={v}>{v}</option>)}</select></div>
            </div>
            <div style={{marginTop:14}}><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>內容</div><input value={form.content} onChange={e=>setForm(f=>({...f,content:e.target.value}))} style={inputStyle} /></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:14}}>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>類型</div>
                <div style={{display:"flex",gap:8}}>
                  {[{v:"out",label:"支出",color:"#ff6b6b"},{v:"in",label:"收入",color:"#3dff7e"}].map(t=>(
                    <button key={t.v} onClick={()=>setForm(f=>({...f,type:t.v}))} style={{flex:1,padding:"9px 0",borderRadius:6,fontWeight:700,fontSize:13,border:`2px solid ${form.type===t.v?t.color:"#2a2a2a"}`,background:form.type===t.v?(t.v==="out"?"#2a0a0a":"#0a2a15"):"transparent",color:form.type===t.v?t.color:"#555"}}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>金額</div><input ref={amountRef} type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} style={inputStyle} /></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:22,justifyContent:"space-between",alignItems:"center"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                <input type="checkbox" checked={form.receipt} onChange={e=>setForm(f=>({...f,receipt:e.target.checked}))} style={{width:16,height:16,accentColor:"#3dff7e"}} />
                <span style={{fontSize:13,color:form.receipt?"#3dff7e":"#666"}}>有收據 / 發票</span>
              </label>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>{setShowEditForm(false);setEditAuth(null);setEditId(null);}} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"9px 20px",borderRadius:6,fontSize:13}}>取消</button>
                <button onClick={submitEdit} disabled={!form.amount||!form.content.trim()} style={{background:(form.amount&&form.content.trim())?"#f5c542":"#1a1a1a",border:"none",color:(form.amount&&form.content.trim())?"#0f0f0f":"#333",padding:"9px 24px",borderRadius:6,fontSize:13,fontWeight:700}}>儲存修改</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showAddForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}} onClick={e=>{if(e.target===e.currentTarget)setShowAddForm(false);}}>
          <div style={{background:"#141414",border:"1px solid #2a2a2a",borderRadius:10,padding:"28px 32px",width:460,maxWidth:"90vw"}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:20,letterSpacing:1}}>新增記錄（貨款帳本）</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>日期</div><input type="date" value={addForm.date} onChange={e=>setAddForm(f=>({...f,date:e.target.value}))} style={{...inputStyle,colorScheme:"dark"}} /></div>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>廠商</div><select value={addForm.vendor} onChange={e=>setAddForm(f=>({...f,vendor:e.target.value}))} style={inputStyle}>{VENDORS.map(v=><option key={v} value={v}>{v}</option>)}</select></div>
            </div>
            <div style={{marginTop:14}}><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>內容</div><input value={addForm.content} onChange={e=>setAddForm(f=>({...f,content:e.target.value}))} placeholder="例：啤酒 x24、本月薪資..." style={inputStyle} onKeyDown={e=>e.key==="Enter"&&addAmountRef.current?.focus()} /></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:14}}>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>類型</div>
                <div style={{display:"flex",gap:8}}>
                  {[{v:"out",label:"支出",color:"#ff6b6b"},{v:"in",label:"收入",color:"#3dff7e"}].map(t=>(
                    <button key={t.v} onClick={()=>setAddForm(f=>({...f,type:t.v}))} style={{flex:1,padding:"9px 0",borderRadius:6,fontWeight:700,fontSize:13,border:`2px solid ${addForm.type===t.v?t.color:"#2a2a2a"}`,background:addForm.type===t.v?(t.v==="out"?"#2a0a0a":"#0a2a15"):"transparent",color:addForm.type===t.v?t.color:"#555"}}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>金額</div><input ref={addAmountRef} type="number" value={addForm.amount} onChange={e=>setAddForm(f=>({...f,amount:e.target.value}))} style={inputStyle} onKeyDown={e=>e.key==="Enter"&&submitAdd()} /></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:22,justifyContent:"space-between",alignItems:"center"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                <input type="checkbox" checked={addForm.receipt} onChange={e=>setAddForm(f=>({...f,receipt:e.target.checked}))} style={{width:16,height:16,accentColor:"#3dff7e"}} />
                <span style={{fontSize:13,color:addForm.receipt?"#3dff7e":"#666"}}>有收據 / 發票</span>
              </label>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowAddForm(false)} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"9px 20px",borderRadius:6,fontSize:13}}>取消</button>
                <button onClick={submitAdd} disabled={!addForm.amount||!addForm.content.trim()} style={{background:(addForm.amount&&addForm.content.trim())?(addForm.type==="in"?"#3dff7e":"#ff6b6b"):"#1a1a1a",border:"none",color:(addForm.amount&&addForm.content.trim())?"#0f0f0f":"#333",padding:"9px 24px",borderRadius:6,fontSize:13,fontWeight:700}}>新增</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ REVENUE MODALS ══ */}
      {showRevAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}} onClick={e=>{if(e.target===e.currentTarget)setShowRevAdd(false);}}>
          <div style={{background:"#141414",border:"1px solid #2a2a2a",borderRadius:10,padding:"28px 32px",width:520,maxWidth:"90vw"}}>
            <div style={{fontSize:14,fontWeight:700,marginBottom:6,letterSpacing:1,color:"#f5c542"}}>新增營收記錄</div>
            <div style={{fontSize:11,color:"#555",marginBottom:20}}>差額、營收、當日差額欄位由系統自動計算</div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>日期</div>
              <input type="date" value={revForm.date} onChange={e=>setRevForm(f=>({...f,date:e.target.value}))} style={{...inputStyle,width:180,colorScheme:"dark"}} />
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>信用卡應收</div>
                <input type="number" value={revForm.ccExpected} onChange={e=>setRevForm(f=>({...f,ccExpected:e.target.value}))} placeholder="0" style={inputStyle} />
              </div>
              <div>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>信用卡實收</div>
                <input type="number" value={revForm.ccActual} onChange={e=>setRevForm(f=>({...f,ccActual:e.target.value}))} placeholder="0" style={inputStyle} />
              </div>
              <div>
                <div style={{fontSize:10,color:"#60a5fa",letterSpacing:1,marginBottom:5}}>外送營收</div>
                <input type="number" value={revForm.deliveryRevenue} onChange={e=>setRevForm(f=>({...f,deliveryRevenue:e.target.value}))} placeholder="0（可留空）" style={{...inputStyle,borderColor:"#1a3a5a"}} />
              </div>
              <div>
                <div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:5}}>信用卡差額（自動）</div>
                <div style={{...inputStyle,background:"#111",border:"1.5px solid #1a1a1a",color:diffColor((Number(revForm.ccActual||0)+Number(revForm.deliveryRevenue||0))-Number(revForm.ccExpected||0)),fontWeight:700}}>
                  {(revForm.ccActual||revForm.deliveryRevenue)&&revForm.ccExpected ? fmtDiff((Number(revForm.ccActual||0)+Number(revForm.deliveryRevenue||0))-Number(revForm.ccExpected||0)) : "—"}
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>現金應收</div>
                <input type="number" value={revForm.cashExpected} onChange={e=>setRevForm(f=>({...f,cashExpected:e.target.value}))} placeholder="0" style={inputStyle} />
              </div>
              <div>
                <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>現金實收</div>
                <input type="number" value={revForm.cashActual} onChange={e=>setRevForm(f=>({...f,cashActual:e.target.value}))} placeholder="0" style={inputStyle} />
              </div>
              <div>
                <div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:5}}>現金差額（自動）</div>
                <div style={{...inputStyle,background:"#111",border:"1.5px solid #1a1a1a",color:diffColor(Number(revForm.cashActual||0)-Number(revForm.cashExpected||0)),fontWeight:700}}>
                  {revForm.cashActual&&revForm.cashExpected ? fmtDiff(Number(revForm.cashActual)-Number(revForm.cashExpected)) : "—"}
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14,padding:"12px 14px",background:"#111",borderRadius:6,border:"1px solid #1e1e1e"}}>
              <div>
                <div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:4}}>當日應收營收（自動）</div>
                <div style={{fontSize:16,fontWeight:700,color:"#888"}}>
                  {(revForm.ccExpected&&revForm.cashExpected) ? fmt(Number(revForm.ccExpected)+Number(revForm.cashExpected)) : "—"}
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:4}}>當日實際營收（自動）</div>
                <div style={{fontSize:16,fontWeight:700,color:"#f5c542"}}>
                  {(revForm.ccActual&&revForm.cashActual) ? fmt(Number(revForm.ccActual)+Number(revForm.deliveryRevenue||0)+Number(revForm.cashActual)) : "—"}
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:4}}>當日差額（自動）</div>
                <div style={{fontSize:16,fontWeight:700,color:diffColor(((Number(revForm.ccActual||0)+Number(revForm.deliveryRevenue||0))-Number(revForm.ccExpected||0))+(Number(revForm.cashActual||0)-Number(revForm.cashExpected||0)))}}>
                  {(revForm.ccActual&&revForm.ccExpected&&revForm.cashActual&&revForm.cashExpected) ? fmtDiff(((Number(revForm.ccActual||0)+Number(revForm.deliveryRevenue||0))-Number(revForm.ccExpected||0))+(Number(revForm.cashActual||0)-Number(revForm.cashExpected||0))) : "—"}
                </div>
              </div>
            </div>

            {/* Vendor Balance */}
            <div style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:6,padding:"12px 14px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:10,color:"#888",letterSpacing:2}}>貨款帳本餘額核對</div>
                <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                  <input type="checkbox" checked={revForm.vendorBalanceMatch} onChange={e=>setRevForm(f=>({...f,vendorBalanceMatch:e.target.checked,actualVendorBalance:e.target.checked?String(f.expectedVendorBalance):f.actualVendorBalance}))} style={{width:14,height:14,accentColor:"#3dff7e"}} />
                  <span style={{fontSize:12,color:revForm.vendorBalanceMatch?"#3dff7e":"#888"}}>與貨款帳本相符</span>
                </label>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>應剩餘貨款（自動帶入）</div>
                  <div style={{...inputStyle,background:"#0e0e0e",border:"1.5px solid #1a1a1a",color:"#888"}}>{fmt(revForm.expectedVendorBalance)}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>實際剩餘貨款</div>
                  {revForm.vendorBalanceMatch
                    ? <div style={{...inputStyle,background:"#0e0e0e",border:"1.5px solid #1a1a1a",color:"#3dff7e",fontWeight:700}}>{fmt(revForm.expectedVendorBalance)} ✓</div>
                    : <input type="number" value={revForm.actualVendorBalance} onChange={e=>setRevForm(f=>({...f,actualVendorBalance:e.target.value}))} placeholder="輸入實際金額" style={inputStyle} />
                  }
                </div>
              </div>
            </div>

            {/* Note */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>備註</div>
              <textarea value={revForm.note} onChange={e=>setRevForm(f=>({...f,note:e.target.value}))} placeholder="例：信用卡機器問題、現金短少原因..." rows={2} style={{...inputStyle,resize:"vertical"}} />
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowRevAdd(false)} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"9px 20px",borderRadius:6,fontSize:13}}>取消</button>
              <button onClick={submitRevAdd} disabled={!revForm.date||!revForm.ccExpected||!revForm.ccActual||!revForm.cashExpected||!revForm.cashActual} style={{background:(revForm.date&&revForm.ccExpected&&revForm.ccActual&&revForm.cashExpected&&revForm.cashActual)?"#f5c542":"#1a1a1a",border:"none",color:(revForm.date&&revForm.ccExpected&&revForm.ccActual&&revForm.cashExpected&&revForm.cashActual)?"#0f0f0f":"#333",padding:"9px 24px",borderRadius:6,fontSize:13,fontWeight:700}}>新增營收</button>
            </div>
          </div>
        </div>
      )}
      {showRevAuth&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}} onClick={e=>{if(e.target===e.currentTarget){setShowRevAuth(false);setRevAuthRecord(null);}}}>
          <div style={{background:"#141414",border:"1.5px solid #ff6b6b",borderRadius:10,padding:"28px 32px",width:440,maxWidth:"90vw"}}>
            <div style={{fontSize:11,color:"#ff6b6b",letterSpacing:3,marginBottom:6}}>修改授權確認</div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>修改此記錄前請填寫以下資料</div>
            <div style={{fontSize:11,color:"#555",marginBottom:20,padding:"8px 12px",background:"#1a1a1a",borderRadius:4,lineHeight:1.7}}>
              {revAuthRecord&&`${revAuthRecord.date} | 信用卡應收 ${fmt(revAuthRecord.ccExpected)} | 現金應收 ${fmt(revAuthRecord.cashExpected)}`}
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"#888",letterSpacing:2,marginBottom:5}}>修改人姓名 <span style={{color:"#ff6b6b"}}>*</span></div>
              <input value={revAuthName} onChange={e=>{setRevAuthName(e.target.value);setRevAuthError("");}} placeholder="請輸入您的姓名" style={inputStyle} />
            </div>
            <div style={{marginBottom:revAuthError?10:20}}>
              <div style={{fontSize:10,color:"#888",letterSpacing:2,marginBottom:5}}>修改原因 <span style={{color:"#ff6b6b"}}>*</span></div>
              <textarea value={revAuthReason} onChange={e=>{setRevAuthReason(e.target.value);setRevAuthError("");}} placeholder="請說明修改原因..." rows={3} style={{...inputStyle,resize:"vertical"}} />
            </div>
            {revAuthError&&<div style={{color:"#ff6b6b",fontSize:12,marginBottom:14}}>⚠ {revAuthError}</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>{setShowRevAuth(false);setRevAuthRecord(null);}} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"9px 20px",borderRadius:6,fontSize:13}}>取消</button>
              <button onClick={submitRevAuth} style={{background:"#ff6b6b",border:"none",color:"#fff",padding:"9px 24px",borderRadius:6,fontSize:13,fontWeight:700}}>確認，繼續修改</button>
            </div>
          </div>
        </div>
      )}
      {showRevEdit&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
          <div style={{background:"#141414",border:"1px solid #2a2a2a",borderRadius:10,padding:"28px 32px",width:520,maxWidth:"90vw"}}>
            <div style={{fontSize:11,color:"#f5c542",letterSpacing:3,marginBottom:4}}>編輯營收記錄</div>
            <div style={{fontSize:11,color:"#555",marginBottom:18,padding:"6px 10px",background:"#1a1a1a",borderRadius:4}}>修改人：<span style={{color:"#f5c542"}}>{revEditAuth?.name}</span>　原因：{revEditAuth?.reason}</div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>日期</div>
              <input type="date" value={revEditForm.date} onChange={e=>setRevEditForm(f=>({...f,date:e.target.value}))} style={{...inputStyle,width:180,colorScheme:"dark"}} />
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>信用卡應收</div><input type="number" value={revEditForm.ccExpected} onChange={e=>setRevEditForm(f=>({...f,ccExpected:e.target.value}))} style={inputStyle} /></div>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>信用卡實收</div><input type="number" value={revEditForm.ccActual} onChange={e=>setRevEditForm(f=>({...f,ccActual:e.target.value}))} style={inputStyle} /></div>
              <div><div style={{fontSize:10,color:"#60a5fa",letterSpacing:1,marginBottom:5}}>外送營收</div><input type="number" value={revEditForm.deliveryRevenue||""} onChange={e=>setRevEditForm(f=>({...f,deliveryRevenue:e.target.value}))} placeholder="0（可留空）" style={{...inputStyle,borderColor:"#1a3a5a"}} /></div>
              <div><div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:5}}>信用卡差額</div><div style={{...inputStyle,background:"#111",border:"1.5px solid #1a1a1a",color:diffColor((Number(revEditForm.ccActual||0)+Number(revEditForm.deliveryRevenue||0))-Number(revEditForm.ccExpected||0)),fontWeight:700}}>{(revEditForm.ccActual||revEditForm.deliveryRevenue)&&revEditForm.ccExpected?fmtDiff((Number(revEditForm.ccActual||0)+Number(revEditForm.deliveryRevenue||0))-Number(revEditForm.ccExpected||0)):"—"}</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>現金應收</div><input type="number" value={revEditForm.cashExpected} onChange={e=>setRevEditForm(f=>({...f,cashExpected:e.target.value}))} style={inputStyle} /></div>
              <div><div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>現金實收</div><input type="number" value={revEditForm.cashActual} onChange={e=>setRevEditForm(f=>({...f,cashActual:e.target.value}))} style={inputStyle} /></div>
              <div><div style={{fontSize:10,color:"#888",letterSpacing:1,marginBottom:5}}>現金差額</div><div style={{...inputStyle,background:"#111",border:"1.5px solid #1a1a1a",color:diffColor(Number(revEditForm.cashActual||0)-Number(revEditForm.cashExpected||0)),fontWeight:700}}>{revEditForm.cashActual&&revEditForm.cashExpected?fmtDiff(Number(revEditForm.cashActual)-Number(revEditForm.cashExpected)):"—"}</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14,padding:"12px 14px",background:"#111",borderRadius:6,border:"1px solid #1e1e1e"}}>
              <div><div style={{fontSize:10,color:"#888",marginBottom:4}}>當日應收營收</div><div style={{fontSize:16,fontWeight:700,color:"#888"}}>{(revEditForm.ccExpected&&revEditForm.cashExpected)?fmt(Number(revEditForm.ccExpected)+Number(revEditForm.cashExpected)):"—"}</div></div>
              <div><div style={{fontSize:10,color:"#888",marginBottom:4}}>當日實際營收</div><div style={{fontSize:16,fontWeight:700,color:"#f5c542"}}>{(revEditForm.ccActual&&revEditForm.cashActual)?fmt(Number(revEditForm.ccActual)+Number(revEditForm.deliveryRevenue||0)+Number(revEditForm.cashActual)):"—"}</div></div>
              <div><div style={{fontSize:10,color:"#888",marginBottom:4}}>當日差額</div><div style={{fontSize:16,fontWeight:700,color:diffColor(((Number(revEditForm.ccActual||0)+Number(revEditForm.deliveryRevenue||0))-Number(revEditForm.ccExpected||0))+(Number(revEditForm.cashActual||0)-Number(revEditForm.cashExpected||0)))}}>{(revEditForm.ccActual&&revEditForm.ccExpected&&revEditForm.cashActual&&revEditForm.cashExpected)?fmtDiff(((Number(revEditForm.ccActual||0)+Number(revEditForm.deliveryRevenue||0))-Number(revEditForm.ccExpected||0))+(Number(revEditForm.cashActual||0)-Number(revEditForm.cashExpected||0))):"—"}</div></div>
            </div>

            {/* Vendor Balance edit */}
            <div style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:6,padding:"12px 14px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <div style={{fontSize:10,color:"#888",letterSpacing:2}}>貨款帳本餘額核對</div>
                <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                  <input type="checkbox" checked={revEditForm.vendorBalanceMatch} onChange={e=>setRevEditForm(f=>({...f,vendorBalanceMatch:e.target.checked,actualVendorBalance:e.target.checked?String(f.expectedVendorBalance):f.actualVendorBalance}))} style={{width:14,height:14,accentColor:"#3dff7e"}} />
                  <span style={{fontSize:12,color:revEditForm.vendorBalanceMatch?"#3dff7e":"#888"}}>與貨款帳本相符</span>
                </label>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>應剩餘貨款</div>
                  <div style={{...inputStyle,background:"#0e0e0e",border:"1.5px solid #1a1a1a",color:"#888"}}>{fmt(revEditForm.expectedVendorBalance)}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"#555",letterSpacing:1,marginBottom:5}}>實際剩餘貨款</div>
                  {revEditForm.vendorBalanceMatch
                    ? <div style={{...inputStyle,background:"#0e0e0e",border:"1.5px solid #1a1a1a",color:"#3dff7e",fontWeight:700}}>{fmt(Number(revEditForm.expectedVendorBalance))} ✓</div>
                    : <input type="number" value={revEditForm.actualVendorBalance} onChange={e=>setRevEditForm(f=>({...f,actualVendorBalance:e.target.value}))} placeholder="輸入實際金額" style={inputStyle} />
                  }
                </div>
              </div>
            </div>

            {/* Note edit */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:10,color:"#555",letterSpacing:2,marginBottom:5}}>備註</div>
              <textarea value={revEditForm.note} onChange={e=>setRevEditForm(f=>({...f,note:e.target.value}))} placeholder="例：信用卡機器問題、現金短少原因..." rows={2} style={{...inputStyle,resize:"vertical"}} />
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>{setShowRevEdit(false);setRevEditAuth(null);setRevEditId(null);}} style={{background:"transparent",border:"1.5px solid #333",color:"#666",padding:"9px 20px",borderRadius:6,fontSize:13}}>取消</button>
              <button onClick={submitRevEdit} disabled={!revEditForm.date||!revEditForm.ccExpected||!revEditForm.ccActual||!revEditForm.cashExpected||!revEditForm.cashActual} style={{background:(revEditForm.date&&revEditForm.ccExpected&&revEditForm.ccActual&&revEditForm.cashExpected&&revEditForm.cashActual)?"#f5c542":"#1a1a1a",border:"none",color:(revEditForm.date&&revEditForm.ccExpected&&revEditForm.ccActual&&revEditForm.cashExpected&&revEditForm.cashActual)?"#0f0f0f":"#333",padding:"9px 24px",borderRadius:6,fontSize:13,fontWeight:700}}>儲存修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
