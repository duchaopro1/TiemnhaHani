import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStore } from '../js/store.js';

/**
 * A stand-in for the artifact database that behaves like the real one under load:
 * `maxConcurrent` writes at once, more is refused with `resource_exhausted`; `flaky` writes
 * fail once with `unavailable` before they work.
 */
function fakeDb({ maxConcurrent = 2, flaky = 0 } = {}) {
  const saved = new Map();
  let running = 0, calls = 0;
  const log = { refused: 0 };
  const db = {
    collection: (coll) => ({
      doc: (id) => ({
        set: async (body) => {
          calls += 1;
          if (calls <= flaky) throw { code: 'unavailable', message: 'x' };
          running += 1;
          try {
            if (running > maxConcurrent) { log.refused += 1; throw { code: 'resource_exhausted', message: 'too many writes' }; }
            await new Promise((r) => setTimeout(r, 5));
            saved.set(`${coll}/${id}`, body);
          } finally { running -= 1; }
        },
      }),
      onSnapshot: () => () => {},
    }),
  };
  return { db, saved, log };
}
const orders = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, code: `SP${i}`, platform: 'shopee', items: [] }));
const make = (opts) => { const f = fakeDb(opts); const s = new ArtifactStore(f.db); s.retryBase = 4; s.errors = []; s.onError = (e) => s.errors.push(e); return { s, ...f }; };

test('nhập nhiều đơn Shopee: đơn nào bị từ chối vì quá tải được thử lại, cuối cùng đủ cả', async () => {
  const { s, saved } = make({ maxConcurrent: 2 });
  await s.upsertMany('orders', orders(40));
  assert.equal(saved.size, 40);
  assert.equal(s.errors.length, 0);
  assert.equal(s.data.orders.size, 40);
});

test('một lần gián đoạn mạng không làm mất đơn', async () => {
  const { s, saved } = make({ maxConcurrent: 5, flaky: 3 });
  await s.upsertMany('orders', orders(10));
  assert.equal(saved.size, 10);
});

test('đơn không lưu được: các đơn khác vẫn lưu, báo rõ bao nhiêu đơn lỗi, đơn lỗi không nằm lại trên màn hình', async () => {
  const f = fakeDb({ maxConcurrent: 99 });
  const bad = new Set(['o3', 'o7']);
  const orig = f.db.collection;
  f.db.collection = (c) => { const x = orig(c); const d = x.doc; x.doc = (id) => bad.has(id) ? { set: async () => { throw { code: 'quota_exceeded', message: 'full' }; } } : d(id); return x; };
  const s = new ArtifactStore(f.db); s.retryBase = 4; s.errors = []; s.onError = (e) => s.errors.push(e);
  await assert.rejects(() => s.upsertMany('orders', orders(10), { quiet: true }), (e) => e.failed?.length === 2 && e.saved === 8 && e.code === 'quota_exceeded');
  assert.equal(f.saved.size, 8);
  assert.equal(s.data.orders.size, 8); // đơn lỗi bị gỡ khỏi màn hình, không giả vờ đã lưu
  assert.equal(s.errors.length, 0); // quiet: người gọi tự báo một lần
});

test('lưu lỗi mà không quiet: báo đúng một lần, không phải mỗi đơn một lần', async () => {
  const f = fakeDb({ maxConcurrent: 99 });
  f.db.collection = () => ({ doc: () => ({ set: async () => { throw { code: 'quota_exceeded', message: 'full' }; } }), onSnapshot: () => () => {} });
  const s = new ArtifactStore(f.db); s.retryBase = 4; s.errors = []; s.onError = (e) => s.errors.push(e);
  await assert.rejects(() => s.upsertMany('orders', orders(6)));
  assert.equal(s.errors.length, 1);
});
