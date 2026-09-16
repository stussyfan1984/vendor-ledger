export async function localApi(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path.includes('cloud') || path.includes('download') ? 75000 : 15000);
  try {
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ledger-Request': 'local-app' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || '本機帳本服務無法回應');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('尚未確認本機儲存結果，請保留表單並重新連線核對，勿重複新增。');
    throw error;
  } finally { clearTimeout(timeout); }
}

export const recordKind = key => key === 'vendor_ledger_records' ? 'ledger' : 'revenue';

export async function saveRecord(key, record, audit) {
  const expectedRevision = record._revision ?? null;
  return localApi('record', { kind: recordKind(key), record, expectedRevision, audit });
}

export async function downloadCompleteBackup() {
  const snapshot = await localApi('export');
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `完整帳本-${new Date().toISOString().slice(0,10)}.json`;
  link.click(); URL.revokeObjectURL(url);
}
