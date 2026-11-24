import test from 'node:test';
import assert from 'node:assert/strict';
import { costTable, orderSummary, applyCostSnapshot, clearCostSnapshot, aggregate, resnapshotDone, staleDoneOrders, fifoSpan } from '../js/calc.js';

// Giá vốn: nhập trước bán trước (FIFO) theo số lượng của sản phẩm, không phân biệt loại (màu, chữ cái).
// Giá vốn được chốt vào đơn lúc hoàn thành.
const products = [
  { id: 'p', name: 'Móc khoá chữ cái', variants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
  { id: 'bn', name: 'Bình nước' },
];
const packaging = [{ id: 'k', name: 'Hộp', baseCost: 2000 }];
const imp = (itemId, qty, unitCost, date, extraFee = 0, variantId = '') => ({ kind: 'product', itemId, variantId, qty, unitCost, extraFee, date, status: 'received' });
const mkOrder = (id, productId, qty, o = {}) => ({ id, code: id, status: 'done', date: '2026-02-01', shipPayer: 'customer', shipFee: 0, items: [{ productId, variantId: productId === 'p' ? 'a' : '', qty, price: 5000 }], ...o });
const st = (orders, imports) => ({ products, packaging, imports, orders });
const prod = (c, o) => orderSummary(c, o).product;

test('fifoSpan: lấy từng đợt theo thứ tự, quá số đã nhập thì lấy giá đợt cuối', () => {
  const b = [{ qty: 3, unit: 1000 }, { qty: 2, unit: 1600 }];
  assert.equal(fifoSpan(b, 0, 2), 2000);
  assert.equal(fifoSpan(b, 2, 2), 1000 + 1600);
  assert.equal(fifoSpan(b, 3, 2), 3200);
  assert.equal(fifoSpan(b, 4, 3), 1600 + 2 * 1600);
});

test('ví dụ của bạn: đợt 1 nhập 100 giá 1.000, bán 50, nhập đợt 2 giá 1.200: đơn tiếp theo vẫn 1.000 cho tới khi hết đợt 1', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05'), imp('p', 100, 1200, '2026-03-01')];
  const a = mkOrder('a', 'p', 50, { date: '2026-02-01' });
  const afterA = [a];
  // đơn kế tiếp 50 cái: vẫn hết đợt 1 (giá 1.000)
  const b = applyCostSnapshot(mkOrder('b', 'p', 50, { date: '2026-03-05' }), (o) => costTable(st([...afterA], imports), { excludeOrderId: o.id }));
  assert.equal(prod(costTable(st([a, b], imports)), b), 50 * 1000);
  // đơn kế tiếp nữa mới sang đợt 2
  const c = applyCostSnapshot(mkOrder('c', 'p', 10, { date: '2026-03-06' }), (o) => costTable(st([a, b], imports), { excludeOrderId: o.id }));
  assert.equal(prod(costTable(st([a, b, c], imports)), c), 10 * 1200);
});
test('một đơn đi qua ranh giới hai đợt: tính từng phần; sang đợt 3 khi hết đợt 2', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05'), imp('p', 100, 1200, '2026-02-01'), imp('p', 100, 1500, '2026-03-01')];
  const a = applyCostSnapshot(mkOrder('a', 'p', 150), () => costTable(st([], imports)));
  assert.equal(prod(costTable(st([a], imports)), a), 100 * 1000 + 50 * 1200);
  const b = applyCostSnapshot(mkOrder('b', 'p', 100), (o) => costTable(st([a], imports), { excludeOrderId: o.id }));
  assert.equal(prod(costTable(st([a, b], imports)), b), 50 * 1200 + 50 * 1500);
});
test('không phân biệt loại: đơn bán loại A hay loại B đều lấy chung hàng đợt 1', () => {
  const imports = [imp('p', 10, 1000, '2026-01-05', 0, 'a'), imp('p', 10, 1600, '2026-02-01', 0, 'b')];
  const a = mkOrder('a', 'p', 10); // loại A
  const b = { ...mkOrder('b', 'p', 5), items: [{ productId: 'p', variantId: 'b', qty: 5, price: 5000 }] }; // loại B
  const c = costTable(st([a], imports));
  assert.equal(prod(c, applyCostSnapshot(a, () => costTable(st([], imports)))), 10000);
  const bb = applyCostSnapshot(b, (o) => costTable(st([a], imports), { excludeOrderId: o.id }));
  assert.equal(prod(costTable(st([a, bb], imports)), bb), 5 * 1600, 'đợt 1 đã bán hết 10 cái, loại B lấy hàng đợt 2');
  assert.ok(c.fifo.p);
});
test('ship của đợt chia vào từng cái của đợt đó', () => {
  const imports = [imp('bn', 3, 1000, '2026-01-05', 300), imp('bn', 5, 1600, '2026-05-02')];
  const c = costTable(st([], imports));
  const o = applyCostSnapshot(mkOrder('x', 'bn', 5), () => c);
  assert.equal(prod(c, o), 3 * 1100 + 2 * 1600);
});
test('nhập thêm đợt mới không đổi đơn đã hoàn thành', () => {
  const imports1 = [imp('bn', 3, 1000, '2026-01-05')];
  const a = applyCostSnapshot(mkOrder('a', 'bn', 3), () => costTable(st([], imports1)));
  const imports2 = [...imports1, imp('bn', 5, 1600, '2026-05-02')];
  const c2 = costTable(st([a], imports2));
  assert.equal(prod(c2, a), 3000);
});
test('đơn chưa hoàn thành tính theo đợt kế tiếp, không giữ hàng', () => {
  const imports = [imp('bn', 3, 1000, '2026-01-05'), imp('bn', 5, 1600, '2026-05-02')];
  const done = applyCostSnapshot(mkOrder('a', 'bn', 3), () => costTable(st([], imports)));
  const c = costTable(st([done], imports));
  assert.equal(prod(c, mkOrder('w', 'bn', 2, { status: 'packed' })), 3200);
});
test('nhiều đơn hoàn thành cùng lúc đi lần lượt từ cũ tới mới, không giẫm lên nhau', () => {
  const imports = [imp('bn', 3, 1000, '2026-01-05'), imp('bn', 5, 1600, '2026-05-02')];
  const orders = [mkOrder('a', 'bn', 2, { date: '2026-02-01' }), mkOrder('b', 'bn', 2, { date: '2026-02-02' }), mkOrder('c', 'bn', 2, { date: '2026-02-03' })];
  const out = resnapshotDone(st(orders, imports), orders, { all: true });
  const c = costTable(st(orders, imports));
  const by = Object.fromEntries(out.map((o) => [o.id, prod(c, o)]));
  assert.deepEqual(by, { a: 2000, b: 1000 + 1600, c: 3200 });
});
test('chốt lại theo thứ tự thời gian: đợt nhập sau không kéo giá đơn trước', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05'), imp('p', 100, 1200, '2026-03-01')];
  const orders = [mkOrder('a', 'p', 50, { date: '2026-02-01', doneAt: '2026-02-01' }), mkOrder('b', 'p', 70, { date: '2026-03-05', doneAt: '2026-03-05' })];
  const out = resnapshotDone(st(orders, imports), orders, { all: true });
  const c = costTable(st(orders, imports));
  const by = Object.fromEntries(out.map((o) => [o.id, prod(c, o)]));
  assert.equal(by.a, 50000);
  assert.equal(by.b, 50 * 1000 + 20 * 1200);
});
test('combo lấy hàng từ các sản phẩm thành phần: tính giá theo đợt và trừ vào đợt', () => {
  const ps = [...products, { id: 'cb', name: 'Combo', combo: [{ productId: 'bn', qty: 2 }] }];
  const imports = [imp('bn', 3, 1000, '2026-01-05'), imp('bn', 5, 1600, '2026-05-02')];
  const state = (orders) => ({ products: ps, packaging, imports, orders });
  const combo = { id: 'k1', code: 'k1', status: 'done', date: '2026-02-01', shipPayer: 'customer', shipFee: 0, items: [{ productId: 'cb', qty: 2, price: 9000 }] };
  const c = costTable(state([]));
  const o = applyCostSnapshot(combo, () => c); // 4 bình: 3 giá 1.000 + 1 giá 1.600
  assert.equal(orderSummary(costTable(state([o])), o).product, 3 * 1000 + 1600);
  const next = costTable(state([o]));
  assert.equal(next.fifo.bn.consumed, 4, 'đã dùng 4 bình');
  assert.equal(prod(next, mkOrder('w', 'bn', 1, { status: 'packed' })), 1600);
});
test('đóng gói cả đơn cũng được chốt', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const c1 = costTable(st([], imports));
  const done = applyCostSnapshot({ ...mkOrder('a', 'bn', 1), wrap1: 'k' }, () => c1);
  assert.equal(orderSummary({ ...c1, packaging: { k: 9000 } }, done).wrapping, 2000);
});
test('không chốt lại khi không đổi gì; chỉ tính giá khi cần', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const done = applyCostSnapshot(mkOrder('a', 'bn', 1), () => costTable(st([], imports)));
  let calls = 0;
  assert.equal(applyCostSnapshot(done, () => { calls++; return costTable(st([], imports)); }), done);
  assert.equal(calls, 0);
});
test('sửa số lượng đơn đã hoàn thành: dòng đó được chốt lại', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05'), imp('bn', 10, 1600, '2026-02-01')];
  const done = applyCostSnapshot(mkOrder('a', 'bn', 5), () => costTable(st([], imports)));
  const edited = applyCostSnapshot({ ...done, items: [{ ...done.items[0], qty: 12 }] }, (o) => costTable(st([done], imports), { excludeOrderId: o.id }));
  assert.equal(prod(costTable(st([edited], imports)), edited), 10 * 1000 + 2 * 1600);
});
test('snapshot hết hiệu lực nếu dòng đổi mà không qua chốt (dùng giá hiện tại)', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const done = applyCostSnapshot(mkOrder('a', 'bn', 5), () => costTable(st([], imports)));
  const tampered = { ...done, items: [{ ...done.items[0], qty: 8 }] };
  assert.equal(prod(costTable(st([], imports)), tampered), 8000);
});
test('rời Hoàn thành: bỏ giá vốn đã chốt; đơn chưa hoàn thành không bị gắn snapshot', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const done = applyCostSnapshot(mkOrder('a', 'bn', 5), () => costTable(st([], imports)));
  const back = applyCostSnapshot({ ...done, status: 'shipping' }, () => { throw new Error('không được tính'); });
  assert.ok(!back.items[0].snap && !back.snapWrap);
  const o = mkOrder('b', 'bn', 1, { status: 'packed' });
  assert.equal(applyCostSnapshot(o, () => { throw new Error('không được tính'); }), o);
});
test('"Tính lại" xoá chốt rồi chốt lại', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const done = applyCostSnapshot(mkOrder('a', 'bn', 5), () => costTable(st([], imports)));
  const again = resnapshotDone(st([done], imports), [clearCostSnapshot(done)], { all: true })[0];
  assert.equal(again.items[0].snap.product, 5000);
});
test('tổng hợp (aggregate) dùng giá vốn đã chốt', () => {
  const imports1 = [imp('bn', 10, 1000, '2026-01-05')];
  const c1 = costTable(st([], imports1));
  const done = applyCostSnapshot(mkOrder('a', 'bn', 5), () => c1);
  const c2 = costTable(st([done], [...imports1, imp('bn', 10, 1600, '2026-05-01')]));
  assert.equal(aggregate(c2, [done]).profit, aggregate(costTable(st([done], imports1)), [done]).profit);
});
test('snapshot kiểu cũ (trung bình, bình quân di động) được chốt lại một lần', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05')];
  const o = mkOrder('a', 'p', 10);
  const old = { ...o, items: [{ ...o.items[0], snap: { key: JSON.stringify(['p', 'a', 10, null, '', '', '', false]), product: 10000, packaging: 0, v: 2 } }], snapWrap: { key: JSON.stringify(['', '', '']), value: 0 } };
  assert.equal(staleDoneOrders(st([old], imports)).length, 1);
  const fixed = resnapshotDone(st([old], imports), [old]);
  assert.equal(fixed[0].items[0].snap.fifo, true);
  assert.equal(staleDoneOrders(st(fixed, imports)).length, 0);
});
