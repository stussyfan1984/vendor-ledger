import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecords, preserveSnapshot, mergeRemote, upsertLocal, acknowledge, csvText } from './ledgerStorage.mjs';
const key = 'ledger';
const memory = initial => {
  const data = new Map([[key, JSON.stringify(initial)]]);
  return { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k,v) => data.set(k,v) };
};
const old = {id:1,date:'2026-09-07',content:'old',amount:10};
const recent = {id:2,date:'2026-09-12',content:'new',amount:1};

test('an older cloud response cannot erase unsynced September records', () => {
  const storage = memory([old,recent]);
  preserveSnapshot(storage,key);
  const merged = mergeRemote([old], readRecords(storage,key));
  assert.equal(merged.length,2);
  assert.equal(merged[1]._pending,true);
  assert.equal(JSON.parse(storage.getItem(`${key}_before_sync_repair_20260914`)).length,2);
  storage.setItem(key, JSON.stringify([old]));
  preserveSnapshot(storage,key);
  assert.equal(JSON.parse(storage.getItem(`${key}_before_sync_repair_20260914`)).length,2);
});
test('load completion uses records added while the cloud request was in flight', () => {
  const storage = memory([old]);
  const cloudSnapshot = [old];
  upsertLocal(storage,key,recent);
  assert.equal(mergeRemote(cloudSnapshot,readRecords(storage,key)).length,2);
});
test('pending edits survive a reload and an older acknowledgement', () => {
  const storage = memory([old]);
  const firstEdit = {...old,amount:20};
  const secondEdit = {...old,amount:30};
  upsertLocal(storage,key,firstEdit);
  upsertLocal(storage,key,secondEdit);
  acknowledge(storage,key,firstEdit);
  const current = readRecords(storage,key);
  assert.equal(current[0]._pending,true);
  assert.equal(mergeRemote([old],current)[0].amount,30);
  acknowledge(storage,key,secondEdit);
  assert.equal(readRecords(storage,key)[0]._pending,undefined);
});
test('saving one record retains another tab’s new record', () => {
  const storage = memory([old]);
  upsertLocal(storage,key,recent);
  upsertLocal(storage,key,{...old,amount:50});
  assert.equal(readRecords(storage,key).length,2);
  assert.equal(readRecords(storage,key)[1].id,2);
});
test('corrupt local JSON is never replaced with a new partial ledger', () => {
  const storage = memory([]);
  storage.setItem(key,'damaged');
  assert.throws(() => upsertLocal(storage,key,recent));
  assert.equal(storage.getItem(key),'damaged');
});
test('CSV preserves commas, quotes, newlines, IDs and timestamps', () => {
  const csv = csvText([['內容','ID','時間'],['茶,"咖啡"\n包材',1789318406655,'2026-09-13T16:53:26.656Z']]);
  assert.ok(csv.includes('"茶,""咖啡""\n包材"'));
  assert.ok(csv.includes('"1789318406655"'));
  assert.ok(csv.includes('2026-09-13T16:53:26.656Z'));
});
