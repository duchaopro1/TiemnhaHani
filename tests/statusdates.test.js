import test from 'node:test';
import assert from 'node:assert/strict';
import { stampStatusDates } from '../js/calc.js';

const T = '2026-11-22';
test('sang Đang giao: ghi ngày bắt đầu giao', () => {
  const r = stampStatusDates({ id: 1, status: 'packed' }, { id: 1, status: 'shipping' }, T);
  assert.equal(r.shippedAt, T); assert.equal(r.doneAt, '');
});
test('sang Hoàn thành: ghi ngày hoàn thành, giữ ngày giao', () => {
  const r = stampStatusDates({ id: 1, status: 'shipping', shippedAt: '2026-11-20' }, { id: 1, status: 'done', shippedAt: '2026-11-20' }, T);
  assert.equal(r.shippedAt, '2026-11-20'); assert.equal(r.doneAt, T);
});
test('rời Hoàn thành: xoá ngày hoàn thành; lùi trước Đang giao: xoá ngày giao', () => {
  assert.equal(stampStatusDates({ status: 'done', doneAt: T }, { status: 'shipping', doneAt: T }, '2026-12-01').doneAt, '');
  const b = stampStatusDates({ status: 'shipping', shippedAt: T }, { status: 'packed', shippedAt: T }, T);
  assert.equal(b.shippedAt, '');
});
test('không đổi trạng thái: không đụng tới ngày; đơn mới không bị ghi ngày', () => {
  const n = { status: 'done' };
  assert.equal(stampStatusDates({ status: 'done' }, n, T), n);
  assert.equal(stampStatusDates(undefined, n, T), n);
});
test('ngày gõ tay trong lần lưu đó được giữ', () => {
  const r = stampStatusDates({ status: 'shipping', shippedAt: '2026-11-01' }, { status: 'done', shippedAt: '2026-11-03', doneAt: '2026-11-09' }, T);
  assert.equal(r.shippedAt, '2026-11-03'); assert.equal(r.doneAt, '2026-11-09');
});
test('huỷ / trả hàng giữ ngày giao', () => {
  const r = stampStatusDates({ status: 'shipping', shippedAt: T }, { status: 'returned', shippedAt: T }, '2026-12-01');
  assert.equal(r.shippedAt, T);
});

import { doneDay, completedRevenue } from '../js/calc.js';
test('doanh thu theo ngày hoàn thành; đơn cũ rơi về ngày tạo', () => {
  assert.equal(doneDay({ date: '2026-10-30', doneAt: '2026-11-02' }), '2026-11-02');
  assert.equal(doneDay({ date: '2026-10-30' }), '2026-10-30');
  assert.equal(typeof completedRevenue, 'function');
});
