import { useState, useEffect, useCallback, useRef } from "react";

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbywpj522GgduRbcprGQ0mHNTVkEmQi_uoCaBgXUS5GlvGHQsGHLHLTNTET-WojzcYEhOw/exec";
const STORAGE_KEY = "vendor_ledger_records";

const VENDORS = ["鼎耀","7-Eleven","全聯","瓦斯","垃圾清運","樂清","開元","薪資","萊爾富","雞蛋","得意百貨","其他"];

const fmt = (n) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", minimumFractionDigits: 0 }).format(n);
const today = () => new Date().toISOString().slice(0, 10);

const syncRecord = async (record) => {
  try {
    const params = new URLSearchParams({ action: "write_ledger", data: JSON.stringify(record) });
    await fetch(`${SCRIPT_URL}?${params.toString()}`, { mode: "no-cors" });
    return true;
  } catch (_) { return false; }
};

const loadFromSheet = async () => {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=read_ledger`);
    const data = await res.json();
    if (Array.isArray(data.records)) return data.records;
    return null;
  } catch (_) { return null; }
};

export default function App() {
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [filterVendor, setFilterVendor] = useState("全部");
  const [filterDate, setFilterDate] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [form, setForm] = useState({ date: today(), vendor: "鼎耀", content: "", type: "out", amount: "", receipt: false });
  const amountRef = useRef(null);

  useEffect(() => {
    (async () => {
      const sheet = await loadFromSheet();
      if (sheet && sheet.length > 0) {
        setRecords(sheet);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
      } else {
        try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setRecords(JSON.parse(raw)); } catch (_) {}
      }
      setLoaded(true);
    })();
  }, []);

  const saveLocal = useCallback((recs) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recs)); } catch (_) {}
  }, []);

  const withBalance = (recs) => {
    let bal = 0;
    return recs.map(r => {
      bal += r.type === "in" ? r.amount : -r.amount;
      return { ...r, balance: bal };
    });
  };

  const sorted = [...records].sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);
  const withBal = withBalance(sorted);

  const filtered = withBal.filter(r => {
    if (filterVendor !== "全部" && r.vendor !== filterVendor) return false;
    if (filterDate && r.date !== filterDate) return false;
    return true;
  });

  const currentBalance = withBal.length > 0 ? withBal[withBal.length - 1].balance : 0;
  const totalOut = records.filter(r => r.type === "out").reduce((a, r) => a + r.amount, 0);
  const totalIn = records.filter(r => r.type === "in").reduce((a, r) => a + r.amount, 0);

  const openForm = (rec = null) => {
    if (rec) {
      setForm({ date: rec.date, vendor: rec.vendor, content: rec.content, type: rec.type, amount: String(rec.amount), receipt: rec.receipt || false });
      setEditId(rec.id);
    } else {
      setForm({ date: today(), vendor: "鼎耀", content: "", type: "out", amount: "", receipt: false });
      setEditId(null);
    }
    setShowForm(true);
    setTimeout(() => amountRef.current?.focus(), 100);
  };

  const submit = async () => {
    const amt = parseInt(form.amount.replace(/[^0-9]/g, ""), 10);
    if (!amt || isNaN(amt) || !form.content.trim()) return;
    const rec = { id: editId || Date.now(), date: form.date, vendor: form.vendor, content: form.content.trim(), type: form.type, amount: amt, receipt: form.receipt, time: new Date().toISOString() };
    const updated = editId ? records.map(r => r.id === editId ? rec : r) : [...records, rec];
    setRecords(updated);
    saveLocal(updated);
    setShowForm(false);
    setEditId(null);
    setSyncStatus("syncing");
    const ok = await syncRecord(rec);
    setSyncStatus(ok ? "ok" : "fail");
    setTimeout(() => setSyncStatus(""), 3000);
  };

  const deleteRecord = (id) => {
    if (!confirm("確定刪除這筆記錄？")) return;
    const updated = records.filter(r => r.id !== id);
    setRecords(updated);
    saveLocal(updated);
  };

  const exportCSV = () => {
    const rows = [["日期","廠商","內容","類型","金額","剩餘貨款","收據/發票"]];
    withBal.forEach(r => rows.push([r.date, r.vendor, r.content, r.type==="in"?"收入":"支出", r.type==="in"?r.amount:-r.amount, r.balance, r.receipt?"✓":""]));
    const csv = "\uFEFF" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `vendor-ledger-${today()}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!loaded) return (
    <div style={{ background:"#0f0f0f", height:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"#3dff7e", fontFamily:"monospace", fontSize:14 }}>
      ⟳ 從 Google Sheets 載入...
    </div>
  );

  return (
    <div style={{ background:"#0f0f0f", minHeight:"100vh", color:"#e8e8e8", fontFamily:"'Courier New', monospace" }}>
      <style>{`
        * { box-sizing: border-box; }
        input, select { background: #1a1a1a; border: 1.5px solid #2a2a2a; color: #e8e8e8; font-family: 'Courier New', monospace; border-radius: 4px; padding: 7px 10px; font-size: 13px; outline: none; }
        input:focus, select:focus { border-color: #3dff7e; }
        button { cursor: pointer; font-family: 'Courier New', monospace; transition: all .15s; }
        button:active { transform: scale(.96); }
        tr:hover td { background: #161616; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom:"1px solid #1e1e1e", padding:"14px 28px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:10, color:"#555", letterSpacing:3 }}>VENDOR LEDGER</div>
          <div style={{ fontSize:15, fontWeight:700, color:"#e8e8e8", letterSpacing:1 }}>
            貨款帳本 · Razzle Dazzle
            {syncStatus && <span style={{ marginLeft:12, fontSize:11, color: syncStatus==="syncing"?"#888":syncStatus==="ok"?"#3dff7e":"#ff4444" }}>
              {syncStatus==="syncing"?"⟳ 同步中":syncStatus==="ok"?"☁ 已同步":"⚠ 同步失敗"}
            </span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={exportCSV} style={{ background:"transparent", border:"1.5px solid #333", color:"#666", padding:"7px 14px", borderRadius:4, fontSize:12 }}>匯出 CSV</button>
          <button onClick={() => openForm()} style={{ background:"#3dff7e", border:"none", color:"#0f0f0f", padding:"8px 20px", borderRadius:4, fontSize:13, fontWeight:700 }}>+ 新增記錄</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", borderBottom:"1px solid #1a1a1a" }}>
        {[
          { label:"剩餘貨款", value: fmt(currentBalance), color: currentBalance >= 0 ? "#e8e8e8" : "#ff6b6b" },
          { label:"總支出", value: fmt(totalOut), color:"#ff6b6b" },
          { label:"總收入", value: fmt(totalIn), color:"#3dff7e" },
          { label:"筆數", value: `${records.length} 筆`, color:"#888" },
        ].map((s, i) => (
          <div key={i} style={{ flex:1, padding:"14px 24px", borderRight:"1px solid #1a1a1a" }}>
            <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:4 }}>{s.label}</div>
            <div style={{ fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ padding:"12px 28px", display:"flex", gap:10, alignItems:"center", borderBottom:"1px solid #1a1a1a", flexWrap:"wrap" }}>
        <div style={{ fontSize:11, color:"#555", marginRight:4 }}>篩選：</div>
        <select value={filterVendor} onChange={e=>setFilterVendor(e.target.value)} style={{ fontSize:12 }}>
          <option value="全部">全部廠商</option>
          {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{ fontSize:12, colorScheme:"dark" }} />
        {(filterVendor !== "全部" || filterDate) && (
          <button onClick={() => { setFilterVendor("全部"); setFilterDate(""); }} style={{ background:"transparent", border:"1px solid #333", color:"#888", padding:"6px 12px", borderRadius:4, fontSize:11 }}>清除篩選</button>
        )}
        <div style={{ marginLeft:"auto", fontSize:11, color:"#555" }}>顯示 {filtered.length} / {records.length} 筆</div>
      </div>

      {/* Table */}
      <div style={{ padding:"0 28px 40px", overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", marginTop:8 }}>
          <thead>
            <tr style={{ borderBottom:"2px solid #222" }}>
              {["日期","廠商","內容","類型","金額","收據","剩餘貨款","操作"].map(h => (
                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontSize:10, color:"#555", letterSpacing:2, fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding:"40px", textAlign:"center", color:"#333", fontSize:13 }}>尚無記錄</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} style={{ borderBottom:"1px solid #181818" }}>
                <td style={{ padding:"10px 12px", fontSize:13, color:"#888", whiteSpace:"nowrap" }}>{r.date}</td>
                <td style={{ padding:"10px 12px", fontSize:13, fontWeight:600, whiteSpace:"nowrap" }}>{r.vendor}</td>
                <td style={{ padding:"10px 12px", fontSize:13, maxWidth:300 }}>{r.content}</td>
                <td style={{ padding:"10px 12px" }}>
                  <span style={{ fontSize:11, padding:"3px 8px", borderRadius:20, background: r.type==="in"?"#0a2a15":"#2a0a0a", color: r.type==="in"?"#3dff7e":"#ff6b6b", fontWeight:700 }}>
                    {r.type==="in" ? "收入" : "支出"}
                  </span>
                </td>
                <td style={{ padding:"10px 12px", fontSize:14, fontWeight:700, color: r.type==="in"?"#3dff7e":"#ff6b6b", whiteSpace:"nowrap" }}>
                  {r.type==="in" ? "+" : "-"}{fmt(r.amount)}
                </td>
                <td style={{ padding:"10px 12px", textAlign:"center" }}>
                  <span style={{ fontSize:14, color: r.receipt ? "#3dff7e" : "#333" }}>{r.receipt ? "✓" : "—"}</span>
                </td>
                <td style={{ padding:"10px 12px", fontSize:14, fontWeight:700, color: r.balance < 0 ? "#ff6b6b" : "#e8e8e8", whiteSpace:"nowrap" }}>
                  {fmt(r.balance)}
                </td>
                <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                  <button onClick={() => openForm(r)} style={{ background:"transparent", border:"none", color:"#555", fontSize:13, padding:"4px 8px", marginRight:4 }}>編輯</button>
                  <button onClick={() => deleteRecord(r.id)} style={{ background:"transparent", border:"none", color:"#333", fontSize:13, padding:"4px 8px" }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}
          onClick={e => { if(e.target===e.currentTarget) setShowForm(false); }}>
          <div style={{ background:"#141414", border:"1px solid #2a2a2a", borderRadius:10, padding:"28px 32px", width:460, maxWidth:"90vw" }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:20, letterSpacing:1 }}>{editId ? "編輯記錄" : "新增記錄"}</div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div>
                <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:5 }}>日期</div>
                <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={{ width:"100%", colorScheme:"dark" }} />
              </div>
              <div>
                <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:5 }}>廠商</div>
                <select value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} style={{ width:"100%" }}>
                  {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:5 }}>內容</div>
              <input value={form.content} onChange={e=>setForm(f=>({...f,content:e.target.value}))} placeholder="例：啤酒 x24、本月薪資、瓦斯補充..." style={{ width:"100%" }} onKeyDown={e=>e.key==="Enter"&&amountRef.current?.focus()} />
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginTop:14 }}>
              <div>
                <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:5 }}>類型</div>
                <div style={{ display:"flex", gap:8 }}>
                  {[{v:"out",label:"支出",color:"#ff6b6b"},{v:"in",label:"收入",color:"#3dff7e"}].map(t => (
                    <button key={t.v} onClick={() => setForm(f=>({...f,type:t.v}))} style={{
                      flex:1, padding:"9px 0", borderRadius:6, fontWeight:700, fontSize:13,
                      border: `2px solid ${form.type===t.v ? t.color : "#2a2a2a"}`,
                      background: form.type===t.v ? (t.v==="out"?"#2a0a0a":"#0a2a15") : "transparent",
                      color: form.type===t.v ? t.color : "#555",
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize:10, color:"#555", letterSpacing:2, marginBottom:5 }}>金額</div>
                <input ref={amountRef} type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0" style={{ width:"100%" }} onKeyDown={e=>e.key==="Enter"&&submit()} />
              </div>
            </div>

            <div style={{ display:"flex", gap:10, marginTop:22, justifyContent:"space-between", alignItems:"center" }}>
              <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                <input type="checkbox" checked={form.receipt} onChange={e=>setForm(f=>({...f,receipt:e.target.checked}))}
                  style={{ width:16, height:16, accentColor:"#3dff7e" }} />
                <span style={{ fontSize:13, color: form.receipt ? "#3dff7e" : "#666" }}>有收據 / 發票</span>
              </label>
              <div style={{ display:"flex", gap:10 }}>
                <button onClick={() => setShowForm(false)} style={{ background:"transparent", border:"1.5px solid #333", color:"#666", padding:"9px 20px", borderRadius:6, fontSize:13 }}>取消</button>
                <button onClick={submit} disabled={!form.amount || !form.content.trim()} style={{
                  background: (form.amount && form.content.trim()) ? (form.type==="in"?"#3dff7e":"#ff6b6b") : "#1a1a1a",
                  border:"none", color: (form.amount && form.content.trim()) ? "#0f0f0f" : "#333",
                  padding:"9px 24px", borderRadius:6, fontSize:13, fontWeight:700,
                }}>{editId ? "儲存" : "新增"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
