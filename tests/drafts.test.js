import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOrder, isDirty, readDrafts, getDraft, putDraft, deleteDraft, markDraftClosed, openDraftKeys, pruneDrafts,
} from '../js/drafts.js';
import { describeError } from '../js/errors.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};
const blank = () => ({
  platform: 'instagram', code: '', date: '2026-11-07', customer: '', status: 'pending', note: '', card: false,
  shipFee: 0, shipPayer: 'customer', discount: 0, platformFee: 0,
  items: [{ productId: '', variantId: '', qty: 1, price: 0, pack1: '', pack2: '', pack3: '', packEach: false }],
});

test('form chưa đụng tới thì không bị coi là đã sửa (kể cả khi thiếu trường cũ)', () => {
  const base = blank();
  assert.equal(isDirty(base, structuredClone(base)), false);
  // đơn cũ thiếu card / variantId / shipPayer vẫn bằng bản đã điền mặc định
  const old = { platform: 'shopee', code: 'A', date: '2026-11-01', status: 'done', items: [{ productId: 'p', qty: 2, price: 5 }] };
  const opened = { ...old, card: false, customer: '', note: '', shipFee: 0, discount: 0, platformFee: 0, shipPayer: 'customer', items: [{ productId: 'p', variantId: '', qty: 2, price: 5, pack1: '', pack2: '', pack3: '', packEach: false }] };
  assert.equal(isDirty(old, opened), false);
  // trường phụ như preset của dòng không tính
  const withPreset = structuredClone(base);
  withPreset.items[0].preset = 'abc';
  assert.equal(isDirty(base, withPreset), false);
});

test('mọi thay đổi trong form đều được nhận ra', () => {
  const base = blank();
  const change = (fn) => { const o = structuredClone(base); fn(o); return o; };
  assert.equal(isDirty(base, change((o) => { o.customer = '@khach'; })), true);
  assert.equal(isDirty(base, change((o) => { o.card = true; })), true);
  assert.equal(isDirty(base, change((o) => { o.shipPayer = 'shop'; })), true);
  assert.equal(isDirty(base, change((o) => { o.items[0].productId = 'p1'; })), true);
  assert.equal(isDirty(base, change((o) => { o.items[0].qty = 3; })), true);
  assert.equal(isDirty(base, change((o) => { o.items.push({ productId: '', qty: 1 }); })), true);
  assert.equal(isDirty(base, change((o) => { o.customer = '   '; })), false); // chỉ có khoảng trắng
});

test('bản nháp: lưu, đọc, xoá, đánh dấu đóng', () => {
  const st = memory();
  const order = { ...blank(), customer: '@khach' };
  assert.equal(putDraft('new', { order, baseUpdatedAt: 0 }, st, 1000), true);
  assert.equal(getDraft('new', st, 2000).order.customer, '@khach');
  assert.deepEqual(openDraftKeys(st, 2000), ['new']);
  markDraftClosed('new', st);
  assert.deepEqual(openDraftKeys(st, 2000), []);
  assert.equal(getDraft('new', st, 2000).open, false); // vẫn còn nháp
  putDraft('abc123', { order, baseUpdatedAt: 55 }, st, 1500);
  assert.equal(getDraft('abc123', st, 2000).baseUpdatedAt, 55);
  deleteDraft('new', st);
  assert.equal(getDraft('new', st, 2000), null);
  assert.ok(getDraft('abc123', st, 2000)); // nháp khác không bị ảnh hưởng
  deleteDraft('khong-co', st); // không lỗi
});

test('bản nháp quá 7 ngày hoặc hỏng bị bỏ; kho trình duyệt lỗi không làm app sập', () => {
  const day = 24 * 3600 * 1000;
  const pruned = pruneDrafts({ old: { savedAt: 0, order: {} }, fresh: { savedAt: 9 * day, order: {} }, junk: null, noOrder: { savedAt: 9 * day } }, 10 * day);
  assert.deepEqual(Object.keys(pruned), ['fresh']);
  const bad = memory();
  bad.setItem('hani-drafts-v1', '{không phải json');
  assert.deepEqual(readDrafts(bad), {});
  bad.setItem('hani-drafts-v1', '[1,2]');
  assert.deepEqual(readDrafts(bad), {});
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readDrafts(throwing), {});
  assert.equal(putDraft('new', { order: blank() }, throwing), false);
  assert.equal(putDraft('new', { order: blank() }, null), false);
  assert.equal(getDraft('new', null), null);
});

test('normalizeOrder giữ các trường lạ của dòng Shopee', () => {
  const n = normalizeOrder({ items: [{ productId: 'p', qty: '2', sku: 'MK-01', productName: 'Móc khoá' }] });
  assert.equal(n.items[0].qty, 2);
  assert.equal(n.items[0].sku, 'MK-01');
  assert.equal(n.status, 'pending');
});

test('mô tả lỗi lưu bằng tiếng Việt dễ hiểu', () => {
  assert.match(describeError({ code: 'resource_exhausted' }).text, /quá nhanh/);
  assert.equal(describeError({ code: 'resource_exhausted' }).retry, true);
  assert.equal(describeError({ code: 'unavailable' }).retry, true);
  assert.match(describeError({ code: 'invalid_argument' }).text, /chỉ có quyền xem/);
  assert.equal(describeError({ code: 'not_granted' }).retry, false);
  assert.match(describeError({ code: 'quota_exceeded' }).text, /đầy/);
  assert.match(describeError({ code: 'revoked' }).text, /bản nháp/);
  assert.equal(describeError({ code: 'local', message: 'Hết chỗ' }).text, 'Hết chỗ');
  assert.ok(describeError(undefined).text.length > 0);
});

test('tiền cọc: để trống khác 0, và sửa tiền cọc thì form được coi là đã sửa', () => {
  const base = blank();
  assert.equal(normalizeOrder(base).paid, null);
  assert.equal(isDirty(base, { ...base, paid: '' }), false);
  assert.equal(isDirty(base, { ...base, paid: null }), false);
  assert.equal(isDirty(base, { ...base, paid: 0 }), true); // 0 = đã chọn "chưa trả gì"
  assert.equal(isDirty(base, { ...base, paid: 400000 }), true);
  assert.equal(normalizeOrder({ paid: '250000' }).paid, 250000);
  const st = memory();
  putDraft('new', { order: normalizeOrder({ ...base, paid: 400000 }) }, st, 1000);
  assert.equal(getDraft('new', st, 2000).order.paid, 400000);
});
