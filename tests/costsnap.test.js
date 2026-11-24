import test from 'node:test';
import assert from 'node:assert/strict';
import { costTable, orderSummary, applyCostSnapshot, clearCostSnapshot, aggregate, resnapshotDone, staleDoneOrders, fifoSpan } from '../js/calc.js';

// sản phẩm có nhiều loại: tính trung bình rồi chốt (cách 1)
const products = [{ id: 'p', name: 'Cúp', variants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }];
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

// ---- sản phẩm chỉ một loại: nhập trước bán trước (cách 2)
const bn = [{ id: 'bn', name: 'Bình nước' }];
const bimp = (qty, unitCost, date, extraFee = 0) => ({ kind: 'product', itemId: 'bn', qty, unitCost, extraFee, date, status: 'received' });
const line = (qty) => ({ productId: 'bn', qty, price: 400000 });
const bo = (id, qty, o = {}) => ({ id, code: id, status: 'done', date: '2026-02-01', shipPayer: 'customer', shipFee: 0, items: [line(qty)], ...o });
const bstate = (orders, imports) => ({ products: bn, packaging: [], imports, orders });

test('fifoSpan: lấy từng đợt theo thứ tự, quá số đã nhập thì lấy giá đợt cuối', () => {
  const b = [{ qty: 3, unit: 1000 }, { qty: 2, unit: 1600 }];
  assert.equal(fifoSpan(b, 0, 2), 2000);
  assert.equal(fifoSpan(b, 2, 2), 1000 + 1600);
  assert.equal(fifoSpan(b, 3, 2), 3200);
  assert.equal(fifoSpan(b, 4, 3), 1600 + 2 * 1600);
});
test('FIFO: đơn lấy hết đợt cũ rồi mới sang đợt mới, ship của đợt chia vào từng cái', () => {
  const imports = [bimp(3, 1000, '2026-01-05', 300), bimp(5, 1600, '2026-05-02')]; // đợt 1: 1.100/cái
  const c = costTable(bstate([], imports));
  const o = applyCostSnapshot(bo('x', 5), () => c);
  assert.equal(orderSummary(c, o).product, 3 * 1100 + 2 * 1600);
});
test('FIFO: nhập thêm đợt mới không đổi đơn đã hoàn thành; đơn sau lấy tiếp đợt kế', () => {
  const imports1 = [bimp(3, 1000, '2026-01-05')];
  const a = applyCostSnapshot(bo('a', 3), () => costTable(bstate([], imports1)));
  assert.equal(orderSummary(costTable(bstate([a], imports1)), a).product, 3000);
  const imports2 = [...imports1, bimp(5, 1600, '2026-05-02')];
  const c2 = costTable(bstate([a], imports2));
  assert.equal(orderSummary(c2, a).product, 3000, 'đơn cũ đứng yên');
  const b = applyCostSnapshot(bo('b', 2), (o) => costTable(bstate([a], imports2), { excludeOrderId: o.id }));
  assert.equal(orderSummary(c2, b).product, 3200, 'đơn sau lấy đợt 1.600');
});
test('FIFO: đơn chưa hoàn thành tính theo đợt kế tiếp', () => {
  const imports = [bimp(3, 1000, '2026-01-05'), bimp(5, 1600, '2026-05-02')];
  const done = applyCostSnapshot(bo('a', 3), () => costTable(bstate([], imports)));
  const c = costTable(bstate([done], imports));
  assert.equal(orderSummary(c, bo('w', 2, { status: 'packed' })).product, 3200);
});
test('FIFO: nhiều đơn hoàn thành cùng lúc đi lần lượt từ cũ tới mới, không giẫm lên nhau', () => {
  const imports = [bimp(3, 1000, '2026-01-05'), bimp(5, 1600, '2026-05-02')];
  const orders = [bo('a', 2, { date: '2026-02-01' }), bo('b', 2, { date: '2026-02-02' }), bo('c', 2, { date: '2026-02-03' })];
  const out = resnapshotDone(bstate(orders, imports), orders, { all: true });
  const c = costTable(bstate(orders, imports));
  const by = Object.fromEntries(out.map((o) => [o.id, orderSummary(c, o).product]));
  assert.deepEqual(by, { a: 2000, b: 1000 + 1600, c: 3200 });
});
test('đơn đã chốt theo trung bình (bản cũ) được xếp vào danh sách chốt lại cho sản phẩm một loại', () => {
  const imports = [bimp(3, 1000, '2026-01-05')];
  const o = bo('a', 3, { items: [{ ...line(3), snap: { key: JSON.stringify(['bn', '', 3, null, '', '', '', false]), product: 3000, packaging: 0 } }], snapWrap: { key: JSON.stringify(['', '', '']), value: 0 } });
  assert.equal(staleDoneOrders(bstate([o], imports)).length, 1);
  const fixed = resnapshotDone(bstate([o], imports), [o]);
  assert.equal(fixed[0].items[0].snap.fifo, true);
  assert.equal(staleDoneOrders(bstate(fixed, imports)).length, 0);
});
test('sản phẩm nhiều loại vẫn trung bình kể cả khi chốt lại hàng loạt', () => {
  const c = costsOf([imp(100, 1000), imp(100, 1600)]);
  assert.equal(c.product.p, 1300);
  assert.ok(!c.fifo.p);
});
