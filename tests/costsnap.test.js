import test from 'node:test';
import assert from 'node:assert/strict';
import { costTable, orderSummary, applyCostSnapshot, clearCostSnapshot, aggregate } from '../js/calc.js';

const products = [{ id: 'p', name: 'Cúp' }];
const packaging = [{ id: 'k', name: 'Hộp', baseCost: 2000 }];
const imp = (qty, unitCost, extraFee = 0) => ({ kind: 'product', itemId: 'p', qty, unitCost, extraFee, date: '2026-01-05' });
const mkOrder = (o = {}) => ({ id: 'o1', status: 'done', date: '2026-01-10', shipPayer: 'customer', shipFee: 0, wrap1: 'k', items: [{ productId: 'p', qty: 10, price: 5000, pack1: 'k' }], ...o });
const costsOf = (imports) => costTable({ products, packaging, imports });

test('đơn hoàn thành giữ giá vốn lúc hoàn thành khi nhập hàng giá khác', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  assert.equal(orderSummary(c1, done).product, 10000);
  const c2 = costsOf([imp(100, 1000), imp(100, 1600)]); // giá vốn TB mới = 1300
  assert.equal(c2.product.p, 1300);
  assert.equal(orderSummary(c2, done).product, 10000, 'đơn đã chốt không đổi');
  assert.equal(orderSummary(c2, mkOrder()).product, 13000, 'đơn chưa chốt theo giá TB hiện tại');
  assert.equal(orderSummary(c2, done).profit, orderSummary(c1, done).profit);
});
test('đóng gói cả đơn cũng được chốt', () => {
  const c1 = costsOf([imp(10, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  const c2 = { ...c1, packaging: { k: 9000 } };
  assert.equal(orderSummary(c2, done).wrapping, 2000);
});
test('không chốt lại khi không đổi gì; chỉ gọi tính giá khi cần', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  let calls = 0;
  assert.equal(applyCostSnapshot(done, () => { calls++; return c1; }), done);
  assert.equal(calls, 0);
});
test('sửa số lượng đơn đã hoàn thành: dòng đó được chốt lại theo giá hiện tại', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  const c2 = costsOf([imp(100, 1000), imp(100, 1600)]);
  const edited = applyCostSnapshot({ ...done, items: [{ ...done.items[0], qty: 20 }] }, () => c2);
  assert.equal(orderSummary(c2, edited).product, 26000);
});
test('snapshot hết hiệu lực nếu dòng đổi mà không qua chốt (dùng giá hiện tại)', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  const tampered = { ...done, items: [{ ...done.items[0], qty: 20 }] };
  assert.equal(orderSummary(c1, tampered).product, 20000);
});
test('rời Hoàn thành: bỏ giá vốn đã chốt; huỷ cũng vậy', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  const back = applyCostSnapshot({ ...done, status: 'shipping' }, () => c1);
  assert.ok(!back.items[0].snap && !back.snapWrap);
  const c2 = costsOf([imp(100, 1000), imp(100, 1600)]);
  assert.equal(orderSummary(c2, back).product, 13000);
});
test('đơn chưa hoàn thành không bị gắn snapshot', () => {
  const o = mkOrder({ status: 'packed' });
  assert.equal(applyCostSnapshot(o, () => { throw new Error('không được tính'); }), o);
});
test('"Tính lại" xoá chốt rồi chốt lại theo giá hiện tại', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  const c2 = costsOf([imp(100, 1000), imp(100, 1600)]);
  const again = applyCostSnapshot(clearCostSnapshot(done), () => c2);
  assert.equal(orderSummary(c2, again).product, 13000);
});
test('tổng hợp (aggregate) dùng giá vốn đã chốt', () => {
  const c1 = costsOf([imp(100, 1000)]);
  const done = applyCostSnapshot(mkOrder(), () => c1);
  const c2 = costsOf([imp(100, 1000), imp(100, 1600)]);
  assert.equal(aggregate(c2, [done]).profit, aggregate(c1, [done]).profit);
});
