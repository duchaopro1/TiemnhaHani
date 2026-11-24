import test from 'node:test';
import assert from 'node:assert/strict';
import { costTable, orderSummary, applyCostSnapshot, clearCostSnapshot, aggregate, resnapshotDone, staleDoneOrders, fifoSpan } from '../js/calc.js';

// Giá vốn: nhập trước bán trước (FIFO) theo số lượng của sản phẩm, không phân biệt loại (màu, chữ cái).
// Thứ tự lấy hàng theo NGÀY LÊN ĐƠN (ngày đóng đơn), không theo ngày hoàn thành.
// Giá vốn được chốt vào đơn lúc hoàn thành.
const products = [
  { id: 'p', name: 'Móc khoá chữ cái', variants: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
  { id: 'bn', name: 'Bình nước' },
];
const packaging = [{ id: 'k', name: 'Hộp', baseCost: 2000 }];
const imp = (itemId, qty, unitCost, date, extraFee = 0, variantId = '') => ({ kind: 'product', itemId, variantId, qty, unitCost, extraFee, date, status: 'received' });
const mk = (id, productId, qty, date, status = 'done', o = {}) => ({ id, code: id, status, date, doneAt: status === 'done' ? date : '', shipPayer: 'customer', shipFee: 0, items: [{ productId, variantId: productId === 'p' ? 'a' : '', qty, price: 5000 }], ...o });
const st = (orders, imports, prods = products) => ({ products: prods, packaging, imports, orders });
const prod = (state, o) => orderSummary(costTable(state), o).product;
/** an order completes: its cost is fixed against the orders as they are with it done */
const complete = (others, o, imports) => applyCostSnapshot({ ...o, status: 'done' }, () => costTable(st([...others, { ...o, status: 'done' }], imports)));

test('fifoSpan: lấy từng đợt theo thứ tự, quá số đã nhập thì lấy giá đợt cuối', () => {
  const b = [{ qty: 3, unit: 1000 }, { qty: 2, unit: 1600 }];
  assert.equal(fifoSpan(b, 0, 2), 2000);
  assert.equal(fifoSpan(b, 2, 2), 1000 + 1600);
  assert.equal(fifoSpan(b, 3, 2), 3200);
  assert.equal(fifoSpan(b, 4, 3), 1600 + 2 * 1600);
});

test('ví dụ của bạn: nhập 100 giá 1.000, bán 50, nhập đợt 2 giá 1.200: đơn tiếp theo vẫn 1.000 cho tới khi hết đợt 1', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05'), imp('p', 100, 1200, '2026-03-01')];
  const a = complete([], mk('a', 'p', 50, '2026-02-01', 'packed'), imports);
  const b = complete([a], mk('b', 'p', 50, '2026-03-05', 'packed'), imports);
  assert.equal(prod(st([a, b], imports), b), 50 * 1000, 'đủ 50 cái nữa của đợt 1');
  const c = complete([a, b], mk('c', 'p', 10, '2026-03-06', 'packed'), imports);
  assert.equal(prod(st([a, b, c], imports), c), 10 * 1200, 'hết đợt 1 mới sang đợt 2');
});
test('một đơn đi qua ranh giới hai đợt: tính từng phần; sang đợt 3 khi hết đợt 2', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05'), imp('p', 100, 1200, '2026-02-01'), imp('p', 100, 1500, '2026-03-01')];
  const a = complete([], mk('a', 'p', 150, '2026-02-02', 'packed'), imports);
  assert.equal(prod(st([a], imports), a), 100 * 1000 + 50 * 1200);
  const b = complete([a], mk('b', 'p', 100, '2026-02-03', 'packed'), imports);
  assert.equal(prod(st([a, b], imports), b), 50 * 1200 + 50 * 1500);
});
test('không phân biệt loại: bán loại A hay loại B đều lấy chung hàng đợt 1', () => {
  const imports = [imp('p', 10, 1000, '2026-01-05', 0, 'a'), imp('p', 10, 1600, '2026-02-01', 0, 'b')];
  const a = complete([], mk('a', 'p', 10, '2026-02-02'), imports); // loại A, hết đợt 1
  const b = complete([a], { ...mk('b', 'p', 5, '2026-02-03'), items: [{ productId: 'p', variantId: 'b', qty: 5, price: 5000 }] }, imports);
  assert.equal(prod(st([a, b], imports), a), 10 * 1000);
  assert.equal(prod(st([a, b], imports), b), 5 * 1600, 'loại B lấy hàng đợt 2 vì đợt 1 đã hết');
});

// ---- thứ tự theo ngày lên đơn
test('đơn lên trước lấy hàng trước dù hoàn thành sau', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05'), imp('bn', 10, 1600, '2026-02-01')];
  const early = mk('early', 'bn', 10, '2026-02-02', 'packed'); // lên đơn 2/2, đang đóng gói
  const late = mk('late', 'bn', 10, '2026-02-10', 'done', { doneAt: '2026-02-11' }); // lên đơn 10/2, đã hoàn thành
  const lateFixed = applyCostSnapshot(late, () => costTable(st([early, late], imports)));
  assert.equal(prod(st([early, lateFixed], imports), lateFixed), 10 * 1600, 'đơn lên sau lấy đợt 2 vì đơn lên trước (chưa hoàn thành) đã giữ 10 cái đợt 1');
  assert.equal(prod(st([early, lateFixed], imports), early), 10 * 1000, 'đơn lên trước theo đợt 1');
});
test('cùng ngày: đơn nhập vào trước lấy trước (createdAt), không có thì theo mã đơn', () => {
  const imports = [imp('bn', 5, 1000, '2026-01-05'), imp('bn', 5, 2000, '2026-01-06')];
  const x = { ...mk('x', 'bn', 5, '2026-02-01', 'packed'), createdAt: 200 };
  const y = { ...mk('y', 'bn', 5, '2026-02-01', 'packed'), createdAt: 100 };
  const c = costTable(st([x, y], imports));
  assert.equal(orderSummary(c, y).product, 5000);
  assert.equal(orderSummary(c, x).product, 10000);
  const n1 = mk('IG-0002', 'bn', 5, '2026-02-01', 'packed'); const n2 = mk('IG-0010', 'bn', 5, '2026-02-01', 'packed');
  const c2 = costTable(st([n2, n1], imports));
  assert.equal(orderSummary(c2, n1).product, 5000, 'IG-0002 trước IG-0010 (so số, không so chữ)');
});
test('đơn huỷ / trả hàng không giữ hàng; đơn chưa hoàn thành tính theo vị trí của nó trong hàng đợi', () => {
  const imports = [imp('bn', 5, 1000, '2026-01-05'), imp('bn', 5, 2000, '2026-01-06')];
  const cancelled = mk('c', 'bn', 5, '2026-02-01', 'cancelled');
  const pend = mk('w', 'bn', 5, '2026-02-02', 'packed');
  assert.equal(prod(st([cancelled, pend], imports), pend), 5000);
  assert.equal(prod(st([{ ...cancelled, status: 'packed' }, pend], imports), pend), 10000);
});
test('nhiều đơn hoàn thành cùng lúc đi lần lượt theo ngày lên đơn, không giẫm lên nhau', () => {
  const imports = [imp('bn', 3, 1000, '2026-01-05'), imp('bn', 5, 1600, '2026-05-02')];
  const orders = [mk('a', 'bn', 2, '2026-02-01'), mk('b', 'bn', 2, '2026-02-02'), mk('c', 'bn', 2, '2026-02-03')];
  const out = resnapshotDone(st(orders, imports), orders, { all: true });
  const state = st(orders, imports);
  assert.deepEqual(Object.fromEntries(out.map((o) => [o.id, prod(state, o)])), { a: 2000, b: 1000 + 1600, c: 3200 });
});
test('đơn bán trước ngày nhập bị xếp theo ngày lên đơn, không theo ngày hoàn thành', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05'), imp('p', 100, 1200, '2026-03-01')];
  const orders = [mk('a', 'p', 100, '2026-02-01', 'done', { doneAt: '2026-04-01' }), mk('b', 'p', 20, '2026-03-05', 'done', { doneAt: '2026-03-06' })];
  const out = resnapshotDone(st(orders, imports), orders, { all: true });
  const state = st(orders, imports);
  const by = Object.fromEntries(out.map((o) => [o.id, prod(state, o)]));
  assert.equal(by.a, 100 * 1000);
  assert.equal(by.b, 20 * 1200);
});

test('ship của đợt chia vào từng cái của đợt đó', () => {
  const imports = [imp('bn', 3, 1000, '2026-01-05', 300), imp('bn', 5, 1600, '2026-05-02')];
  const o = mk('x', 'bn', 5, '2026-06-01');
  const fixed = applyCostSnapshot(o, () => costTable(st([o], imports)));
  assert.equal(prod(st([fixed], imports), fixed), 3 * 1100 + 2 * 1600);
});
test('nhập thêm đợt mới không đổi đơn đã hoàn thành', () => {
  const imports1 = [imp('bn', 3, 1000, '2026-01-05')];
  const a = complete([], mk('a', 'bn', 3, '2026-02-01', 'packed'), imports1);
  const imports2 = [...imports1, imp('bn', 5, 1600, '2026-05-02')];
  assert.equal(prod(st([a], imports2), a), 3000);
});
test('đơn đã chốt không đổi dù có đơn lên sớm hơn được tạo thêm sau đó (cho tới khi bấm Tính lại)', () => {
  const imports = [imp('bn', 5, 1000, '2026-01-05'), imp('bn', 5, 2000, '2026-01-06')];
  const a = complete([], mk('a', 'bn', 5, '2026-03-01', 'packed'), imports);
  assert.equal(prod(st([a], imports), a), 5000);
  const early = mk('e', 'bn', 5, '2026-02-01', 'packed'); // đơn lên sớm hơn, tạo bổ sung
  assert.equal(prod(st([early, a], imports), a), 5000, 'đã chốt nên giữ nguyên');
  const again = resnapshotDone(st([early, a], imports), [a], { all: true })[0];
  assert.equal(prod(st([early, again], imports), again), 10000, 'Tính lại: nay đứng sau đơn e');
});
test('combo lấy hàng từ các sản phẩm thành phần: tính giá theo đợt và giữ chỗ trong hàng đợi', () => {
  const ps = [...products, { id: 'cb', name: 'Combo', combo: [{ productId: 'bn', qty: 2 }] }];
  const imports = [imp('bn', 3, 1000, '2026-01-05'), imp('bn', 5, 1600, '2026-05-02')];
  const combo = { id: 'k1', code: 'k1', status: 'done', date: '2026-02-01', shipPayer: 'customer', shipFee: 0, items: [{ productId: 'cb', qty: 2, price: 9000 }] };
  const o = applyCostSnapshot(combo, () => costTable(st([combo], imports, ps))); // 4 bình: 3 giá 1.000 + 1 giá 1.600
  assert.equal(orderSummary(costTable(st([o], imports, ps)), o).product, 3 * 1000 + 1600);
  const next = mk('w', 'bn', 1, '2026-02-02', 'packed');
  assert.equal(prod(st([o, next], imports, ps), next), 1600);
});
test('đóng gói cả đơn cũng được chốt', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const o = { ...mk('a', 'bn', 1, '2026-02-01'), wrap1: 'k' };
  const done = applyCostSnapshot(o, () => costTable(st([o], imports)));
  assert.equal(orderSummary({ ...costTable(st([done], imports)), packaging: { k: 9000 } }, done).wrapping, 2000);
});
test('không chốt lại khi không đổi gì; chỉ tính giá khi cần', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const o = mk('a', 'bn', 1, '2026-02-01');
  const done = applyCostSnapshot(o, () => costTable(st([o], imports)));
  let calls = 0;
  assert.equal(applyCostSnapshot(done, () => { calls++; return costTable(st([done], imports)); }), done);
  assert.equal(calls, 0);
});
test('sửa số lượng đơn đã hoàn thành: dòng đó được chốt lại', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05'), imp('bn', 10, 1600, '2026-02-01')];
  const o = mk('a', 'bn', 5, '2026-03-01');
  const done = applyCostSnapshot(o, () => costTable(st([o], imports)));
  const edited0 = { ...done, items: [{ ...done.items[0], qty: 12 }] };
  const edited = applyCostSnapshot(edited0, () => costTable(st([edited0], imports)));
  assert.equal(prod(st([edited], imports), edited), 10 * 1000 + 2 * 1600);
});
test('snapshot hết hiệu lực nếu dòng đổi mà không qua chốt (dùng giá hiện tại)', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const o = mk('a', 'bn', 5, '2026-03-01');
  const done = applyCostSnapshot(o, () => costTable(st([o], imports)));
  const tampered = { ...done, items: [{ ...done.items[0], qty: 8 }] };
  assert.equal(prod(st([tampered], imports), tampered), 8000);
});
test('rời Hoàn thành: bỏ giá vốn đã chốt; đơn chưa hoàn thành không bị gắn snapshot', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const o = mk('a', 'bn', 5, '2026-03-01');
  const done = applyCostSnapshot(o, () => costTable(st([o], imports)));
  const back = applyCostSnapshot({ ...done, status: 'shipping' }, () => { throw new Error('không được tính'); });
  assert.ok(!back.items[0].snap && !back.snapWrap);
  const w = mk('b', 'bn', 1, '2026-03-02', 'packed');
  assert.equal(applyCostSnapshot(w, () => { throw new Error('không được tính'); }), w);
});
test('"Tính lại" xoá chốt rồi chốt lại', () => {
  const imports = [imp('bn', 10, 1000, '2026-01-05')];
  const o = mk('a', 'bn', 5, '2026-03-01');
  const done = applyCostSnapshot(o, () => costTable(st([o], imports)));
  const again = resnapshotDone(st([done], imports), [done], { all: true })[0];
  assert.equal(again.items[0].snap.product, 5000);
});
test('tổng hợp (aggregate) dùng giá vốn đã chốt', () => {
  const imports1 = [imp('bn', 10, 1000, '2026-01-05')];
  const o = mk('a', 'bn', 5, '2026-03-01');
  const done = applyCostSnapshot(o, () => costTable(st([o], imports1)));
  const later = [...imports1, imp('bn', 10, 1600, '2026-05-01')];
  assert.equal(aggregate(costTable(st([done], later)), [done]).profit, aggregate(costTable(st([done], imports1)), [done]).profit);
});
test('snapshot kiểu cũ (trung bình, bình quân di động, xếp theo ngày hoàn thành) được chốt lại một lần', () => {
  const imports = [imp('p', 100, 1000, '2026-01-05')];
  const o = mk('a', 'p', 10, '2026-02-01');
  const old = { ...o, items: [{ ...o.items[0], snap: { key: JSON.stringify(['p', 'a', 10, null, '', '', '', false]), product: 10000, packaging: 0, fifo: true } }], snapWrap: { key: JSON.stringify(['', '', '']), value: 0 } };
  assert.equal(staleDoneOrders(st([old], imports)).length, 1);
  const fixed = resnapshotDone(st([old], imports), [old]);
  assert.equal(fixed[0].items[0].snap.ord, 1);
  assert.equal(staleDoneOrders(st(fixed, imports)).length, 0);
});
