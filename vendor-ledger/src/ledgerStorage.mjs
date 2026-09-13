export function readRecords(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  const records = JSON.parse(raw);
  if (!Array.isArray(records) || records.some(r => !r || r.id == null)) {
    throw new Error('本機資料格式異常，已停止覆寫，請先匯出備份。');
  }
  return records;
}

export function preserveSnapshot(storage, key) {
  const raw = storage.getItem(key);
  const backupKey = `${key}_before_sync_repair_20260914`;
  if (raw !== null && storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
}

export function mergeRemote(remote, local) {
  const merged = new Map(remote.map(r => [String(r.id), r]));
  for (const record of local) {
    if (record._pending || !merged.has(String(record.id))) {
      merged.set(String(record.id), { ...record, _pending: true });
    }
  }
  return [...merged.values()];
}

export function upsertLocal(storage, key, record) {
  const records = readRecords(storage, key);
  const index = records.findIndex(r => String(r.id) === String(record.id));
  const pending = { ...record, _pending: true };
  if (index < 0) records.push(pending);
  else records[index] = pending;
  storage.setItem(key, JSON.stringify(records));
  return records;
}

const payload = record => Object.fromEntries(Object.entries(record).filter(([k]) => k !== '_pending'));
export function sameRecord(a, b) {
  const left = payload(a), right = payload(b);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(k => left[k] === right[k]);
}

export function acknowledge(storage, key, record) {
  const records = readRecords(storage, key).map(current =>
    String(current.id) === String(record.id) && sameRecord(current, record)
      ? payload(current) : current
  );
  storage.setItem(key, JSON.stringify(records));
  return records;
}

export function csvText(rows) {
  return '\uFEFF' + rows.map(row => row.map(value =>
    '"' + String(value ?? '').replaceAll('"', '""') + '"'
  ).join(',')).join('\r\n');
}
