import test from 'node:test';
import assert from 'node:assert/strict';
import { costTable, orderSummary, stockLevels, splitFee, variantKey, STATUSES, INACTIVE_STATUSES, OPEN_STATUSES, countByStatus, operatingCosts, lineCost, adjustForCount, stockState, orderPayment, toCollect, isReceived, importDate, allocateShipping, findDuplicateOrders, completedRevenue, stageQuantities, orderShortages, withTransit, transitHistory, comboParts, isCombo, expandLine, comboMap, isPoolPart, poolKey, parsePick } from '../js/calc.js';
import { rowsToOrders, parseNumber, mapStatus, mergeShopeeStatus } from '../js/shopee.js';

const state = {
  products: [{ id: 'p1', name: 'Móc khoá' }, { id: 'p2', name: 'Khung', baseCost: 50000 }],
  packaging: [{ id: 'box', name: 'Hộp' }, { id: 'rib', name: 'Ruy băng' }],
  imports: [
    { kind: 'product', itemId: 'p1', qty: 10, unitCost: 10000, extraFee: 10000 }, // 11.000/cái
    { kind: 'product', itemId: 'p1', qty: 10, unitCost: 12000, extraFee: 0 },     // TB 11.500
    { kind: 'packaging', itemId: 'box', qty: 100, unitCost: 3000 },
    { kind: 'packaging', itemId: 'rib', qty: 100, unitCost: 1000 },
  ],
  orders: [],
};

test('giá vốn trung bình có tính phí ship nhập, fallback giá gốc', () => {
  const c = costTable(state);
  assert.equal(c.product.p1, 11500);
  assert.equal(c.product.p2, 50000);
  assert.equal(c.packaging.box, 3000);
});

test('lợi nhuận: shop chịu ship vs khách chịu ship', () => {
  const c = costTable(state);
  const order = {
    items: [{ productId: 'p1', qty: 2, price: 45000, pack1: 'box', pack2: 'rib', pack3: '' }],
    shipFee: 30000, shipPayer: 'customer', discount: 5000, platformFee: 2000,
  };
  // 90.000 - 5.000 - 23.000 - 4.000 (đóng gói 1 lần) - 2.000
  assert.equal(orderSummary(c, order).profit, 56000);
  assert.equal(orderSummary(c, { ...order, shipPayer: 'shop' }).profit, 26000);
  // đóng gói riêng từng cái => 8.000
  assert.equal(orderSummary(c, { ...order, items: [{ ...order.items[0], packEach: true }] }).profit, 52000);
});

test('tồn kho trừ theo đơn, bỏ qua đơn huỷ', () => {
  const s = { ...state, orders: [
    { status: 'done', items: [{ productId: 'p1', qty: 3, pack1: 'box' }] },
    { status: 'cancelled', items: [{ productId: 'p1', qty: 5, pack1: 'box' }] },
  ] };
  const st = stockLevels(s);
  assert.equal(st.products.p1, 17);
  assert.equal(st.packaging.box, 99);
});

test('đọc file xuất đơn Shopee, gộp nhiều dòng cùng mã đơn', () => {
  const rows = [
    ['Mã đơn hàng', 'Ngày đặt hàng', 'Trạng Thái Đơn Hàng', 'SKU phân loại hàng', 'Tên sản phẩm', 'Số lượng', 'Tổng giá bán (sản phẩm)', 'Phí cố định', 'Phí Dịch Vụ', 'Phí thanh toán', 'Phí vận chuyển mà người mua trả'],
    ['2410A', '2024-10-01 10:00', 'Hoàn thành', 'MK-01', 'Móc khoá', 2, '90.000', 3000, 2000, 1000, 15000],
    ['2410A', '2024-10-01 10:00', 'Hoàn thành', 'KH-13', 'Khung', 1, 120000, 3000, 2000, 1000, 15000],
    ['2410B', '05/10/2024', 'Đã hủy', 'MK-01', 'Móc khoá', 1, 45000, 0, 0, 0, 0],
  ];
  const orders = rowsToOrders(rows);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].items.length, 2);
  assert.equal(orders[0].items[0].price, 45000);
  assert.equal(orders[0].platformFee, 6000);
  assert.equal(orders[0].date, '2024-10-01');
  assert.equal(orders[1].status, 'cancelled');
  assert.equal(orders[1].date, '2024-10-05');
  assert.equal(parseNumber('1.250.000'), 1250000);
  assert.equal(mapStatus('Đang giao'), 'shipping');
});

test('tồn kho theo phân loại (cúp 3 màu) và tổng sản phẩm', () => {
  const s = {
    products: [{ id: 'cup', name: 'Cúp', variants: [{ id: 'do' }, { id: 'xanh', adjust: -1 }, { id: 'vang' }] }],
    packaging: [],
    imports: [
      { kind: 'product', itemId: 'cup', variantId: 'do', qty: 10 },
      { kind: 'product', itemId: 'cup', variantId: 'xanh', qty: 5 },
      { kind: 'product', itemId: 'cup', variantId: 'vang', qty: 3 },
    ],
    orders: [{ status: 'done', items: [{ productId: 'cup', variantId: 'do', qty: 2 }] }],
  };
  const st = stockLevels(s);
  assert.equal(st.variants[variantKey('cup', 'do')], 8);
  assert.equal(st.variants[variantKey('cup', 'xanh')], 4);
  assert.equal(st.variants[variantKey('cup', 'vang')], 3);
  assert.equal(st.products.cup, 15);
});

test('chia phí ship nhập theo số lượng từng phân loại', () => {
  assert.deepEqual(splitFee(30000, [10, 5, 5]), [15000, 7500, 7500]);
  assert.deepEqual(splitFee(10000, [1, 1, 1]), [3333, 3333, 3334]);
  assert.deepEqual(splitFee(5000, [0, 0]), [0, 0]);
});

test('trạng thái mới nằm đúng thứ tự công việc và vẫn trừ kho', () => {
  assert.deepEqual(Object.keys(STATUSES), ['pending', 'designed', 'packed', 'shipping', 'done', 'cancelled', 'returned']);
  assert.equal(STATUSES.designed, 'Đã thiết kế');
  assert.equal(STATUSES.packed, 'Đã đóng gói');
  assert.ok(!INACTIVE_STATUSES.has('designed') && !INACTIVE_STATUSES.has('packed'));
  const base = { products: [{ id: 'p' }], packaging: [], imports: [{ kind: 'product', itemId: 'p', qty: 10 }] };
  for (const status of ['designed', 'packed']) {
    const st = stockLevels({ ...base, orders: [{ status, items: [{ productId: 'p', qty: 3 }] }] });
    assert.equal(st.products.p, 7, status);
  }
});

test('nhập lại file Shopee không làm mất "Đã thiết kế / Đã đóng gói"', () => {
  assert.equal(mergeShopeeStatus('designed', 'pending'), 'designed');
  assert.equal(mergeShopeeStatus('packed', 'pending'), 'packed');
  assert.equal(mergeShopeeStatus('designed', 'shipping'), 'shipping');
  assert.equal(mergeShopeeStatus('packed', 'cancelled'), 'cancelled');
  assert.equal(mergeShopeeStatus('pending', 'done'), 'done');
  assert.equal(mergeShopeeStatus('shipping', 'pending'), 'pending');
});

test('đếm đơn theo trạng thái: đủ mọi trạng thái, kể cả 0', () => {
  const none = countByStatus([]);
  assert.deepEqual(Object.keys(none), Object.keys(STATUSES));
  assert.ok(Object.values(none).every((n) => n === 0));
  const c = countByStatus([{ status: 'pending' }, { status: 'pending' }, { status: 'packed' }, { status: 'done' }, { status: 'lạ' }]);
  assert.equal(c.pending, 2);
  assert.equal(c.packed, 1);
  assert.equal(c.done, 1);
  assert.equal(c.designed, 0);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 4); // trạng thái lạ không bị đếm
  assert.deepEqual([...OPEN_STATUSES].sort(), ['designed', 'packed', 'pending', 'shipping']);
});

test('vật tư dùng chung: nhập 5 hộp = 100.000đ chi phí vận hành, điều chỉnh tồn kho không đổi số tiền', () => {
  const state = {
    products: [],
    packaging: [{ id: 'ghim', name: 'Ghim bấm', shared: true }],
    imports: [{ kind: 'packaging', itemId: 'ghim', date: '2026-11-03', qty: 5, unitCost: 20000, extraFee: 0 }],
    orders: [],
  };
  assert.equal(operatingCosts(state, '2026-11-01', '2026-11-30').total, 100000);
  assert.equal(stockLevels(state).packaging.ghim, 5);
  // đếm lại thấy đã dùng 2 hộp
  const adjusted = { ...state, packaging: [{ id: 'ghim', name: 'Ghim bấm', shared: true, adjust: -2 }] };
  assert.equal(stockLevels(adjusted).packaging.ghim, 3);
  assert.equal(operatingCosts(adjusted, '2026-11-01', '2026-11-30').total, 100000); // vẫn 100.000đ
  assert.equal(operatingCosts(adjusted).total, 100000);
});

test('chi phí vận hành tính theo ngày nhập, gồm phí ship nhập, chỉ vật tư dùng chung', () => {
  const state = {
    packaging: [{ id: 'ghim', name: 'Ghim bấm', shared: true }, { id: 'bang', name: 'Băng keo', shared: true }, { id: 'hop', name: 'Hộp' }],
    imports: [
      { kind: 'packaging', itemId: 'ghim', date: '2026-10-31', qty: 1, unitCost: 20000 },
      { kind: 'packaging', itemId: 'ghim', date: '2026-11-03', qty: 5, unitCost: 20000, extraFee: 10000 },
      { kind: 'packaging', itemId: 'bang', date: '2026-11-30', qty: 10, unitCost: 12000 },
      { kind: 'packaging', itemId: 'hop', date: '2026-11-05', qty: 100, unitCost: 3000 }, // hộp thường: không tính
      { kind: 'product', itemId: 'ghim', date: '2026-11-05', qty: 9, unitCost: 9999 },    // không phải đóng gói
    ],
  };
  const nov = operatingCosts(state, '2026-11-01', '2026-11-30');
  assert.equal(nov.total, 110000 + 120000);
  assert.deepEqual(nov.items.map((r) => [r.name, r.qty, r.amount]), [['Băng keo', 10, 120000], ['Ghim bấm', 5, 110000]]);
  assert.equal(operatingCosts(state, '2026-10-01', '2026-10-31').total, 20000);
  assert.equal(operatingCosts(state).total, 20000 + 110000 + 120000);
});

test('vật tư dùng chung không tính vào đơn hàng và không trừ kho theo đơn', () => {
  const state = {
    products: [{ id: 'p', name: 'P', baseCost: 10000 }],
    packaging: [{ id: 'bang', name: 'Băng keo', shared: true }, { id: 'hop', name: 'Hộp' }],
    imports: [
      { kind: 'packaging', itemId: 'bang', date: '2026-11-01', qty: 10, unitCost: 12000 },
      { kind: 'packaging', itemId: 'hop', date: '2026-11-01', qty: 10, unitCost: 3000 },
    ],
    orders: [{ status: 'done', items: [{ productId: 'p', qty: 1, price: 50000, pack1: 'hop', pack2: 'bang' }] }],
  };
  const costs = costTable(state);
  assert.equal(lineCost(costs, state.orders[0].items[0]).packaging, 3000); // chỉ hộp
  const st = stockLevels(state);
  assert.equal(st.packaging.hop, 9);
  assert.equal(st.packaging.bang, 10); // đơn cũ có chọn băng keo cũng không trừ
});

test('đếm lại tồn kho túi kính: chỉnh số lượng mà không đổi giá nhập hay tiền nhập', () => {
  const state = {
    products: [{ id: 'p', name: 'P', baseCost: 10000 }],
    packaging: [{ id: 'tui', name: 'Túi kính' }],
    imports: [{ kind: 'packaging', itemId: 'tui', date: '2026-11-01', qty: 500, unitCost: 400 }], // số lượng chỉ ước chừng
    orders: [{ status: 'done', items: [{ productId: 'p', qty: 30, price: 50000, pack1: 'tui', packEach: true }] }],
  };
  const stockNow = stockLevels(state).packaging.tui;
  assert.equal(stockNow, 470);
  // đếm thực tế còn 452
  const adjust = adjustForCount(0, stockNow, 452);
  assert.equal(adjust, -18);
  const fixed = { ...state, packaging: [{ id: 'tui', name: 'Túi kính', adjust }] };
  assert.equal(stockLevels(fixed).packaging.tui, 452);
  assert.equal(costTable(fixed).packaging.tui, costTable(state).packaging.tui); // giá mỗi cái giữ nguyên
  assert.equal(lineCost(costTable(fixed), state.orders[0].items[0]).packaging, lineCost(costTable(state), state.orders[0].items[0]).packaging);
  // đếm lại lần nữa (đang có điều chỉnh -18, đếm được 460)
  assert.equal(adjustForCount(adjust, 452, 460), -10);
  assert.equal(stockLevels({ ...state, packaging: [{ id: 'tui', name: 'Túi kính', adjust: -10 }] }).packaging.tui, 460);
  assert.equal(adjustForCount(undefined, 10, 10), 0);
});

test('tồn kho: bằng 0 là "đã hết", từ 1 tới mức cảnh báo là "sắp hết"', () => {
  assert.equal(stockState(0, 5), 'out');
  assert.equal(stockState(-2, 5), 'out'); // âm (bán lố) cũng là hết
  assert.equal(stockState(1, 5), 'low');
  assert.equal(stockState(5, 5), 'low');
  assert.equal(stockState(6, 5), 'ok');
  assert.equal(stockState(0, 0), 'out'); // mức cảnh báo 0: vẫn là đã hết, không phải sắp hết
  assert.equal(stockState(1, 0), 'ok');
  assert.equal(stockState('abc', 5), 'out');
  assert.equal(stockState(3, undefined), 'ok');
});

test('thanh toán: tổng khách phải trả, đã cọc và còn thu khi nhận hàng', () => {
  const costs = costTable({ products: [{ id: 'p', name: 'P', baseCost: 10000 }], packaging: [], imports: [] });
  const order = (extra) => ({ status: 'pending', shipFee: 15000, shipPayer: 'customer', discount: 0, items: [{ productId: 'p', qty: 2, price: 400000 }], ...extra });
  // 800.000 hàng + 15.000 ship khách chịu = 815.000
  assert.deepEqual(orderPayment(costs, order({ paid: 400000 })), { total: 815000, tracked: true, paid: 400000, remaining: 415000 });
  // shop chịu ship: ship không thu của khách
  assert.equal(orderPayment(costs, order({ shipPayer: 'shop', paid: 400000 })).remaining, 400000);
  // giảm giá trừ vào số phải thu
  assert.equal(orderPayment(costs, order({ discount: 15000, paid: 0 })).remaining, 800000);
  // để trống = không theo dõi; 0 = theo dõi, chưa trả gì
  assert.equal(orderPayment(costs, order({})).tracked, false);
  assert.equal(orderPayment(costs, order({ paid: null })).tracked, false);
  assert.equal(orderPayment(costs, order({ paid: '' })).tracked, false);
  assert.equal(orderPayment(costs, order({ paid: 0 })).tracked, true);
  assert.equal(orderPayment(costs, order({ paid: '815000' })).remaining, 0);
  assert.equal(orderPayment(costs, order({ paid: 900000 })).remaining, -85000); // trả dư
  // tiền cọc không đổi doanh thu hay lợi nhuận
  assert.equal(orderSummary(costs, order({ paid: 0 })).profit, orderSummary(costs, order({ paid: 815000 })).profit);
});

test('tổng tiền còn thu: chỉ tính đơn chưa xong có ghi nhận thanh toán', () => {
  const costs = costTable({ products: [{ id: 'p', name: 'P', baseCost: 1000 }], packaging: [], imports: [] });
  const o = (status, paid) => ({ status, shipFee: 0, shipPayer: 'customer', items: [{ productId: 'p', qty: 1, price: 100000 }], paid });
  const r = toCollect(costs, [
    o('pending', 50000),   // còn 50.000
    o('packed', 0),        // còn 100.000
    o('shipping', 100000), // đã đủ
    o('done', 50000),      // hoàn thành = coi như đã thu đủ
    o('cancelled', 20000), // đơn huỷ: không thu
    o('pending', undefined), // không theo dõi
    o('designed', 130000), // trả dư: không âm
  ]);
  assert.deepEqual(r, { amount: 150000, count: 2 });
  assert.deepEqual(toCollect(costs, []), { amount: 0, count: 0 });
});

test('phiếu nhập: chỉ phiếu đã nhận mới vào kho, giá vốn và chi phí vận hành', () => {
  const state = {
    products: [{ id: 'cup', name: 'Cúp', baseCost: 99000, variants: [{ id: 'do' }, { id: 'xanh' }] }],
    packaging: [{ id: 'tui', name: 'Túi kính' }, { id: 'ghim', name: 'Ghim', shared: true }],
    imports: [
      { kind: 'product', itemId: 'cup', variantId: 'do', qty: 10, unitCost: 30000, date: '2026-11-01' },                              // cũ, không có status = đã nhận
      { kind: 'product', itemId: 'cup', variantId: 'do', qty: 20, unitCost: 50000, date: '2026-11-05', status: 'ordered' },         // đang về
      { kind: 'product', itemId: 'cup', variantId: 'xanh', qty: 5, unitCost: 30000, date: '2026-11-05', status: 'ordered' },
      { kind: 'packaging', itemId: 'tui', qty: 100, unitCost: 400, date: '2026-11-05', status: 'ordered' },
      { kind: 'packaging', itemId: 'ghim', qty: 5, unitCost: 20000, date: '2026-10-28', status: 'ordered' },
    ],
    orders: [],
  };
  assert.equal(isReceived(state.imports[0]), true);
  assert.equal(isReceived(state.imports[1]), false);
  const st = stockLevels(state);
  assert.equal(st.products.cup, 10);                   // chỉ 10 cái đã nhận
  assert.equal(st.variants[variantKey('cup', 'do')], 10);
  assert.equal(st.variants[variantKey('cup', 'xanh')], 0);
  assert.equal(st.packaging.tui, 0);
  assert.equal(st.incoming.products.cup, 25);          // 20 + 5 đang về
  assert.equal(st.incoming.variants[variantKey('cup', 'do')], 20);
  assert.equal(st.incoming.packaging.tui, 100);
  // giá vốn chỉ tính từ hàng đã nhận (30.000), không bị kéo bởi lô đang đặt (50.000)
  assert.equal(costTable(state).product.cup, 30000);
  assert.equal(costTable(state).packaging.tui, 0); // chưa nhận lần nào: dùng giá gốc
  // chi phí vận hành: chưa nhận thì chưa tính
  assert.equal(operatingCosts(state).total, 0);
});

test('nhận hàng: tồn kho tăng, chi phí vận hành tính theo ngày nhận', () => {
  const imp = { kind: 'packaging', itemId: 'ghim', qty: 5, unitCost: 20000, date: '2026-10-28', status: 'ordered' };
  const base = { products: [], packaging: [{ id: 'ghim', name: 'Ghim', shared: true }], orders: [] };
  assert.equal(stockLevels({ ...base, imports: [imp] }).packaging.ghim, 0);
  const got = { ...imp, status: 'received', receivedDate: '2026-11-05' };
  assert.equal(importDate(got), '2026-11-05');
  assert.equal(importDate(imp), '2026-10-28');
  const s2 = { ...base, imports: [got] };
  assert.equal(stockLevels(s2).packaging.ghim, 5);
  assert.equal(stockLevels(s2).incoming.packaging.ghim, undefined);
  assert.equal(operatingCosts(s2, '2026-11-01', '2026-11-30').total, 100000); // tháng nhận hàng
  assert.equal(operatingCosts(s2, '2026-10-01', '2026-10-31').total, 0);      // không phải tháng đặt
  // phiếu cũ đã nhận mà không có ngày nhận: tính theo ngày ghi phiếu
  assert.equal(importDate({ date: '2026-09-01' }), '2026-09-01');
});

test('chia phí ship chung của kiện: theo số lượng hoặc theo giá trị, tổng luôn khớp', () => {
  const lines = [{ qty: 10, unitCost: 10000 }, { qty: 5, unitCost: 40000 }];
  assert.deepEqual(allocateShipping(30000, lines, 'qty'), [20000, 10000]);
  assert.deepEqual(allocateShipping(30000, lines, 'value'), [10000, 20000]); // 100k vs 200k
  const odd = allocateShipping(10000, [{ qty: 1, unitCost: 1 }, { qty: 1, unitCost: 1 }, { qty: 1, unitCost: 1 }]);
  assert.equal(odd.reduce((a, b) => a + b, 0), 10000);
  assert.deepEqual(allocateShipping(5000, [{ qty: 0, unitCost: 0 }]), [0]);
});

test('Shopee: "Người mua xác nhận đã nhận được hàng… vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền" là đã nhận (hoàn thành), không phải trả hàng', () => {
  const text = 'Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày 2026-11-19.';
  assert.equal(mapStatus(text), 'done');
  assert.equal(mapStatus('Đã nhận hàng'), 'done');
  assert.equal(mapStatus('Yêu cầu Trả hàng/Hoàn tiền đang xử lý'), 'returned'); // trả hàng thật vẫn nhận ra
  assert.equal(mapStatus('Đã hủy'), 'cancelled');
});

test('cảnh báo đơn trùng: cùng tài khoản + cùng sản phẩm + đơn cũ còn chờ xử lý / đã thiết kế', () => {
  const old = (o) => ({ id: 'o1', customer: '@Khach.A', status: 'pending', date: '2026-11-01', items: [{ productId: 'p1', variantId: 'v1' }], ...o });
  const draft = { customer: ' khach.a ', items: [{ productId: 'p1', variantId: 'v1' }] };
  assert.equal(findDuplicateOrders([old()], draft).length, 1); // không phân biệt hoa thường, @ và khoảng trắng
  assert.equal(findDuplicateOrders([old({ status: 'designed' })], draft).length, 1);
  for (const status of ['packed', 'shipping', 'done', 'cancelled', 'returned']) assert.equal(findDuplicateOrders([old({ status })], draft).length, 0, status);
  assert.equal(findDuplicateOrders([old({ customer: '@khach.b' })], draft).length, 0);
  assert.equal(findDuplicateOrders([old({ items: [{ productId: 'p2' }] })], draft).length, 0);
  assert.equal(findDuplicateOrders([old({ items: [{ productId: 'p1', variantId: 'v2' }] })], draft).length, 0); // khác phân loại
  assert.equal(findDuplicateOrders([old({ items: [{ productId: 'p1' }] })], draft).length, 1); // đơn cũ chưa ghi phân loại
  assert.equal(findDuplicateOrders([old()], { ...draft, id: 'o1' }).length, 0); // không tự trùng với chính nó
  assert.equal(findDuplicateOrders([old()], { ...draft, customer: '' }).length, 0); // chưa có tên khách
  assert.equal(findDuplicateOrders([old()], { customer: 'khach.a', items: [] }).length, 0);
});

test('Shopee đọc cột Mã vận đơn / Tracking Number', () => {
  const rows = [['Mã đơn hàng', 'Trạng Thái Đơn Hàng', 'Mã vận đơn', 'Số lượng'], ['A1', 'Đang giao', 'SPXVN001', 1], ['A2', 'Đang giao', '', 1]];
  const [a, b] = rowsToOrders(rows);
  assert.equal(a.tracking, 'SPXVN001');
  assert.equal(b.tracking, '');
  assert.equal(rowsToOrders([['Order ID', 'Tracking Number*', 'Quantity'], ['B1', 'GHN55', 1]])[0].tracking, 'GHN55');
});

test('đóng gói cả đơn: tính 1 lần mỗi đơn, trừ kho, bỏ qua vật tư dùng chung, đơn huỷ không trừ', () => {
  const state = {
    products: [{ id: 'A', baseCost: 10000 }, { id: 'B', baseCost: 20000 }],
    packaging: [{ id: 'p1', baseCost: 2000 }, { id: 'p2', baseCost: 3000 }, { id: 'box', baseCost: 5000 }, { id: 'tape', baseCost: 1000, shared: true }],
    imports: [{ kind: 'packaging', itemId: 'box', qty: 10, unitCost: 5000, extraFee: 0 }],
    orders: [],
  };
  const costs = costTable(state);
  const order = { status: 'pending', items: [
    { productId: 'A', qty: 3, price: 50000, pack1: 'p1' },
    { productId: 'B', qty: 1, price: 60000, pack1: 'p2' },
  ], wrap1: 'box', wrap2: 'tape' };
  const s = orderSummary(costs, order);
  // đóng gói riêng: p1 (2.000) + p2 (3.000); cả đơn: 1 hộp 5.000; băng keo dùng chung không tính vào đơn
  assert.equal(s.wrapping, 5000);
  assert.equal(s.packaging, 2000 + 3000 + 5000);
  assert.equal(s.profit, 210000 - (30000 + 20000) - 10000);
  // không nhân theo số sản phẩm: 4 sản phẩm vẫn chỉ 1 hộp
  const st = stockLevels({ ...state, orders: [order, { ...order, status: 'cancelled' }] });
  assert.equal(st.packaging.box, 10 - 1);
  // đơn cũ không có wrap vẫn tính như trước
  assert.equal(orderSummary(costs, { items: order.items }).packaging, 5000);
});

test('trang doanh thu: chỉ đơn hoàn thành, tổng đơn / doanh thu / chi phí / lợi nhuận đúng công thức', () => {
  const state = {
    products: [{ id: 'A', baseCost: 20000 }],
    packaging: [{ id: 'box', baseCost: 5000 }, { id: 'tape', baseCost: 1000, shared: true }],
    imports: [], orders: [],
  };
  const costs = costTable(state);
  const done = {
    id: 'o1', code: 'X1', date: '2026-11-03', status: 'done', shipFee: 30000, shipPayer: 'shop', discount: 10000, platformFee: 8000,
    items: [{ productId: 'A', qty: 2, price: 100000, pack1: 'box' }], wrap1: 'tape',
  };
  const { rows, total } = completedRevenue(costs, [done, { ...done, id: 'o2', status: 'shipping' }, { ...done, id: 'o3', status: 'cancelled' }], 10000);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.gross, 200000);
  assert.equal(r.revenue, 190000); // hàng - giảm giá
  assert.equal(r.total, 190000); // shop chịu ship nên khách không trả thêm
  assert.equal(r.product, 40000);
  assert.equal(r.packaging, 5000); // băng keo dùng chung không vào đơn
  assert.equal(r.ship, 30000);
  assert.equal(r.shipFee, 30000);
  assert.equal(r.fee, 8000);
  assert.equal(r.cost, 40000 + 5000 + 30000 + 8000); // chưa gồm tiền công
  assert.equal(r.before, 190000 - r.cost); // lợi nhuận trước tiền công
  assert.equal(r.profit, r.before - 10000); // lợi nhuận sau tiền công
  assert.equal(total.profit, r.profit);
  assert.equal(total.before, r.before);
  // khách trả ship: tổng đơn = hàng + ship - giảm giá, ship không phải chi phí của shop
  const c = completedRevenue(costs, [{ ...done, shipPayer: 'customer' }], 10000).rows[0];
  assert.equal(c.total, 200000 + 30000 - 10000);
  assert.equal(c.ship, 0);
  assert.equal(c.shipFee, 30000); // phí ship vẫn hiện dù khách trả
  assert.equal(c.profit, 190000 - (40000 + 5000 + 8000 + 10000));
});

test('sản phẩm theo giai đoạn: gom số lượng theo trạng thái, tách từng phân loại, bỏ đơn huỷ / trả', () => {
  const line = (variantId, qty) => ({ productId: 'cup', variantId, qty, price: 1 });
  const orders = [
    { status: 'pending', items: [line('do', 2), line('xanh', 1)] },
    { status: 'shipping', items: [line('vang', 3)] },
    { status: 'done', items: [line('do', 4), line('xanh', 2)] },
    { status: 'designed', items: [{ productId: 'khung', qty: 1 }] },
    { status: 'cancelled', items: [line('do', 99)] },
    { status: 'returned', items: [line('do', 99)] },
    { status: 'pending', items: [{ productName: 'chưa gắn', qty: 5 }] },
  ];
  const q = stageQuantities(orders);
  assert.deepEqual(q.cup.total, { pending: 3, designed: 0, packed: 0, shipping: 3, done: 6 });
  assert.equal(q.cup.sum, 12);
  assert.deepEqual(q.cup.variants.do, { pending: 2, designed: 0, packed: 0, shipping: 0, done: 4 });
  assert.deepEqual(q.cup.variants.vang, { pending: 0, designed: 0, packed: 0, shipping: 3, done: 0 });
  assert.equal(q.khung.total.designed, 1);
  assert.deepEqual(Object.keys(q).sort(), ['cup', 'khung']); // dòng chưa gắn sản phẩm bị bỏ qua
});

test('thiếu hàng: đơn cũ được ưu tiên, đơn thiếu không giữ hàng, đơn đã đóng gói đã lấy hàng, đơn huỷ bỏ qua', () => {
  const imp = (variantId, qty, status = 'received') => ({ kind: 'product', itemId: 'P', variantId, qty, unitCost: 1, extraFee: 0, status });
  const line = (variantId, qty) => ({ productId: 'P', variantId, qty, price: 1 });
  const state = {
    products: [{ id: 'P', variants: [{ id: 'a' }, { id: 'b' }] }],
    packaging: [],
    imports: [imp('a', 10), imp('b', 2), imp('a', 10, 'ordered')],
    orders: [
      { id: 'o0', code: 'O0', date: '2026-10-30', status: 'packed', items: [line('a', 2)] }, // đã lấy 2 chữ a
      { id: 'o1', code: 'O1', date: '2026-11-01', status: 'pending', items: [line('a', 5), line('b', 4)] }, // thiếu b
      { id: 'o2', code: 'O2', date: '2026-11-02', status: 'designed', items: [line('a', 6)] }, // đủ
      { id: 'o3', code: 'O3', date: '2026-11-03', status: 'pending', items: [line('a', 5)] }, // chỉ còn 2 chữ a
      { id: 'o4', code: 'O4', date: '2026-11-01', status: 'cancelled', items: [line('a', 99)] },
      { id: 'o5', code: 'O5', date: '2026-11-04', status: 'shipping', items: [line('a', 1)] },
    ],
  };
  const { short, ready } = orderShortages(state);
  assert.deepEqual(ready.map((o) => o.code), ['O2']);
  assert.deepEqual(short.map((s) => s.order.code), ['O1', 'O3']);
  // O1 thiếu đúng chữ b, không thiếu chữ a (đơn thiếu không giữ hàng của chữ a)
  assert.deepEqual(short[0].lines.map((l) => [l.variantId, l.need, l.have, l.short]), [['b', 4, 2, 2]]);
  // O3 đứng sau O2: kho 10 - 2 (O0 đã đóng) - 1 (O5 đang giao) - 6 (O2) = 1 chữ a
  assert.deepEqual(short[1].lines.map((l) => [l.variantId, l.need, l.have, l.short, l.incoming]), [['a', 5, 1, 4, 10]]);
  // đơn tạo sau cùng ngày xếp sau theo giờ tạo
  const same = orderShortages({ ...state, orders: [
    { id: 'x2', code: 'B', date: '2026-11-01', createdAt: 2, status: 'pending', items: [line('b', 2)] },
    { id: 'x1', code: 'A', date: '2026-11-01', createdAt: 1, status: 'pending', items: [line('b', 2)] },
  ] });
  assert.deepEqual(same.ready.map((o) => o.code), ['A']);
  assert.deepEqual(same.short.map((s) => s.order.code), ['B']);
});

test('giai đoạn hàng đang về: Đang ship từ TQ không ghi giờ (cùng ngày đặt), chỉ Chờ thông quan và Đã thông quan có mốc', () => {
  let s = withTransit({}, 'shipping_cn', 100);
  assert.deepEqual(s, { transit: 'shipping_cn', transitAt: {} });
  assert.deepEqual(transitHistory(s), []);
  s = withTransit(s, 'customs', 200);
  assert.deepEqual(s.transitAt, { customs: 200 });
  s = withTransit(s, 'cleared', 300);
  assert.deepEqual(s.transitAt, { customs: 200, cleared: 300 });
  assert.deepEqual(transitHistory(s).map((h) => [h.stage, h.at]), [['customs', 200], ['cleared', 300]]);
  // đặt lại cùng giai đoạn: giữ mốc cũ, không ghi đè
  assert.equal(withTransit(s, 'cleared', 999).transitAt.cleared, 300);
  // quay lại "chờ thông quan": bỏ "đã thông quan", giữ mốc của chờ thông quan
  const back = withTransit(s, 'customs', 999);
  assert.deepEqual(back.transitAt, { customs: 200 });
  assert.equal(back.transit, 'customs');
  // quay về "Đang ship từ TQ": bỏ hết các mốc sau
  assert.deepEqual(withTransit(s, 'shipping_cn', 999).transitAt, {});
  // dữ liệu cũ có mốc của "Đang ship từ TQ": không hiện nữa
  assert.deepEqual(transitHistory({ transitAt: { shipping_cn: 50, customs: 60 } }).map((h) => h.stage), ['customs']);
  // nhận hàng: bỏ giai đoạn nhưng giữ lịch sử
  assert.deepEqual(withTransit(s, ''), { transit: '', transitAt: s.transitAt });
  assert.deepEqual(withTransit({}, ''), { transit: '' });
});

test('combo: giá vốn = tổng giá vốn thành phần, tồn = số bộ tối đa, bán combo trừ kho thành phần, thiếu hàng theo thành phần', () => {
  const imp = (itemId, qty, unitCost, variantId = '') => ({ kind: 'product', itemId, variantId, qty, unitCost, extraFee: 0 });
  const state = {
    products: [
      { id: 'p1', name: 'Cúp', variants: [{ id: 'do' }, { id: 'xanh' }] },
      { id: 'p2', name: 'Móc khóa' },
      { id: 'cb', name: 'Combo A', salePrice: 200000, combo: [{ productId: 'p1', variantId: 'do', qty: 1 }, { productId: 'p2', qty: 2 }] },
    ],
    packaging: [],
    imports: [imp('p1', 5, 50000, 'do'), imp('p1', 3, 50000, 'xanh'), imp('p2', 11, 10000)],
    orders: [],
  };
  const costs = costTable(state);
  assert.equal(costs.product.cb, 50000 + 2 * 10000); // 1 cúp + 2 móc khóa
  let st = stockLevels(state);
  assert.equal(st.products.cb, 5); // móc khóa 11 / 2 = 5 bộ, cúp đỏ 5 → 5 bộ
  // bán 2 combo: trừ 2 cúp đỏ + 4 móc khóa, không động tới cúp xanh
  const sold = { ...state, orders: [{ id: 'o1', code: 'A', date: '2026-11-01', status: 'pending', items: [{ productId: 'cb', qty: 2, price: 200000 }] }] };
  st = stockLevels(sold);
  assert.equal(st.variants['p1:do'], 3);
  assert.equal(st.variants['p1:xanh'], 3);
  assert.equal(st.products.p1, 6);
  assert.equal(st.products.p2, 7);
  assert.equal(st.products.cb, 3); // móc khóa 7 / 2 = 3 bộ
  // lợi nhuận đơn tính theo giá vốn thành phần
  const s = orderSummary(costs, sold.orders[0]);
  assert.equal(s.product, 2 * 70000);
  assert.equal(s.profit, 400000 - 140000);
  // thiếu hàng: đơn cần 4 combo, chỉ đủ cúp đỏ cho 5 nhưng móc khóa 11 chỉ đủ 5 bộ → đủ; đơn 6 combo thiếu
  const big = { ...state, orders: [{ id: 'o2', code: 'B', date: '2026-11-01', status: 'pending', items: [{ productId: 'cb', qty: 6, price: 1 }] }] };
  const { short } = orderShortages(big);
  assert.deepEqual(short[0].lines.map((l) => [l.productId, l.variantId, l.need, l.have, l.short]).sort(), [['p1', 'do', 6, 5, 1], ['p2', '', 12, 11, 1]].sort());
});

test('combo chọn loại khi lên đơn: mỗi combo một lựa chọn riêng, trừ đúng loại, thiếu hàng theo loại đã chọn', () => {
  const imp = (itemId, variantId, qty) => ({ kind: 'product', itemId, variantId, qty, unitCost: 1000, extraFee: 0 });
  const state = {
    products: [
      { id: 'anh', name: 'Móc in ảnh', variants: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'chu', name: 'Móc chữ', variants: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] },
      { id: 'cb', name: 'Combo móc', salePrice: 100000, combo: [{ productId: 'anh', variantId: '', qty: 1 }, { productId: 'chu', variantId: '', qty: 1 }] },
    ],
    packaging: [],
    imports: [imp('anh', 'a1', 3), imp('anh', 'a2', 3), imp('chu', 'A', 2), imp('chu', 'B', 1), imp('chu', 'C', 0)],
    orders: [],
  };
  // 2 combo: combo 1 = ảnh a1 + chữ A, combo 2 = ảnh a2 + chữ A
  const line = { productId: 'cb', qty: 2, price: 1, picks: [['a1', 'A'], ['a2', 'A']] };
  const lines = expandLine(line, comboMap(state.products));
  assert.deepEqual(lines.map((l) => [l.productId, l.variantId, l.qty]).sort(), [['anh', 'a1', 1], ['anh', 'a2', 1], ['chu', 'A', 2]].sort());
  const st = stockLevels({ ...state, orders: [{ id: 'o', code: 'X', date: '2026-11-01', status: 'pending', items: [line] }] });
  assert.equal(st.variants['anh:a1'], 2);
  assert.equal(st.variants['anh:a2'], 2);
  assert.equal(st.variants['chu:A'], 0);
  assert.equal(st.variants['chu:B'], 1); // chữ B không bị động tới
  // chưa chọn loại thì trừ ở mức sản phẩm (không theo loại)
  const none = expandLine({ productId: 'cb', qty: 2, price: 1 }, comboMap(state.products));
  assert.deepEqual(none.map((l) => [l.productId, l.variantId, l.qty]).sort(), [['anh', '', 2], ['chu', '', 2]].sort());
  // cùng chữ A cho 3 combo nhưng kho chỉ có 2 chữ A → thiếu 1 đúng chữ A
  const big = { ...state, orders: [{ id: 'o2', code: 'Y', date: '2026-11-01', status: 'pending', items: [{ productId: 'cb', qty: 3, price: 1, picks: [['a1', 'A'], ['a1', 'A'], ['a2', 'A']] }] }] };
  const { short } = orderShortages(big);
  assert.deepEqual(short[0].lines.map((l) => [l.productId, l.variantId, l.need, l.have, l.short]), [['chu', 'A', 3, 2, 1]]);
});

test('combo có món ngẫu nhiên: không cần chọn loại, trừ ở mức sản phẩm; nếu chọn thì trừ đúng loại', () => {
  const imp = (itemId, variantId, qty) => ({ kind: 'product', itemId, variantId, qty, unitCost: 1000, extraFee: 0 });
  const state = {
    products: [
      { id: 'cup', name: 'Cúp', variants: [{ id: 'do' }, { id: 'xanh' }] },
      { id: 'moc', name: 'Móc ngẫu nhiên', variants: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }] },
      { id: 'box', name: 'Box 1', salePrice: 1, combo: [{ productId: 'cup', variantId: '', qty: 1 }, { productId: 'moc', variantId: '', random: true, qty: 1 }] },
    ],
    packaging: [],
    imports: [imp('cup', 'do', 5), imp('cup', 'xanh', 5), imp('moc', 'm1', 3), imp('moc', 'm2', 3), imp('moc', 'm3', 3), imp('moc', 'm4', 3)],
    orders: [],
  };
  const combos = comboMap(state.products);
  assert.equal(comboParts(state.products[2])[1].random, true);
  // không chọn móc: trừ ở mức sản phẩm, cúp trừ theo loại đã chọn
  const line = { productId: 'box', qty: 2, price: 1, picks: [['do', ''], ['xanh', '']] };
  const lines = expandLine(line, combos);
  assert.deepEqual(lines.map((l) => [l.productId, l.variantId, l.qty]).sort(), [['cup', 'do', 1], ['cup', 'xanh', 1], ['moc', '', 2]].sort());
  const st = stockLevels({ ...state, orders: [{ id: 'o', code: 'A', date: '2026-11-01', status: 'pending', items: [line] }] });
  assert.equal(st.products.moc, 10); // 12 - 2
  assert.equal(st.variants['moc:m1'], 3); // chưa biết loại nào: không loại nào bị trừ
  assert.equal(st.variants['cup:do'], 4);
  // chọn thật loại móc cho 1 combo thì trừ đúng loại đó
  const picked = expandLine({ productId: 'box', qty: 2, price: 1, picks: [['do', 'm2'], ['xanh', '']] }, combos);
  assert.deepEqual(picked.map((l) => [l.productId, l.variantId, l.qty]).sort(), [['cup', 'do', 1], ['cup', 'xanh', 1], ['moc', '', 1], ['moc', 'm2', 1]].sort());
  // thiếu hàng theo tổng móc (12), không theo từng loại
  const big = { ...state, orders: [{ id: 'o2', code: 'B', date: '2026-11-01', status: 'pending', items: [{ productId: 'box', qty: 13, price: 1, picks: Array.from({ length: 13 }, () => ['do', '']) }] }] };
  const { short } = orderShortages(big);
  assert.deepEqual(short[0].lines.map((l) => [l.productId, l.variantId, l.short]).sort(), [['cup', 'do', 8], ['moc', '', 1]].sort());
});

test('combo ngẫu nhiên giữa nhiều sản phẩm: giá vốn trung bình, chưa chọn thì chưa trừ sản phẩm nào, chọn rồi thì trừ đúng sản phẩm và loại', () => {
  const imp = (itemId, variantId, qty, unitCost) => ({ kind: 'product', itemId, variantId, qty, unitCost, extraFee: 0 });
  const state = {
    products: [
      { id: 'cup', name: 'Cúp' },
      { id: 'anh', name: 'Móc in ảnh' },
      { id: 'chu', name: 'Móc chữ', variants: [{ id: 'A' }, { id: 'B' }] },
      { id: 'cau', name: 'Móc cầu lông' },
      { id: 'box', name: 'Box 1', salePrice: 1, combo: [{ productId: 'cup', qty: 1 }, { pool: ['anh', 'chu', 'cau'], qty: 1 }] },
    ],
    packaging: [],
    imports: [imp('cup', '', 10, 50000), imp('anh', '', 4, 6000), imp('chu', 'A', 2, 9000), imp('chu', 'B', 2, 9000), imp('cau', '', 2, 9000)],
    orders: [],
  };
  assert.equal(isPoolPart(state.products[4].combo[1]), true);
  assert.equal(poolKey(['b', 'a']), 'a,b');
  assert.deepEqual(parsePick('chu:A', ['anh', 'chu']), { productId: 'chu', variantId: 'A' });
  assert.equal(parsePick('khac', ['anh', 'chu']), null);
  const costs = costTable(state);
  assert.equal(costs.product.box, 50000 + (6000 + 9000 + 9000) / 3); // móc tính trung bình khi chưa chọn
  // 3 box, chưa chọn móc nào
  const open = { productId: 'box', qty: 3, price: 100000, picks: [['', ''], ['', ''], ['', '']] };
  let st = stockLevels({ ...state, orders: [{ id: 'o', code: 'A', date: '2026-11-01', status: 'pending', items: [open] }] });
  assert.equal(st.products.cup, 7);
  assert.equal(st.products.anh, 4); // chưa trừ sản phẩm nào trong nhóm
  assert.equal(st.unassigned['anh,cau,chu'], 3);
  assert.equal(st.products.box, Math.min(7, 10 - 3)); // nhóm móc có 4 + 4 + 2 = 10, trừ 3 chưa gán = 7 bộ; cúp còn 7
  // chọn: box 1 = móc ảnh, box 2 = móc chữ A, box 3 chưa chọn
  const picked = { productId: 'box', qty: 3, price: 100000, picks: [['', 'anh'], ['', 'chu:A'], ['', '']] };
  st = stockLevels({ ...state, orders: [{ id: 'o', code: 'A', date: '2026-11-01', status: 'pending', items: [picked] }] });
  assert.equal(st.products.anh, 3);
  assert.equal(st.variants['chu:A'], 1);
  assert.equal(st.unassigned['anh,cau,chu'], 1);
  // giá vốn theo sản phẩm đã chọn: 3 cúp + 6000 (ảnh) + 9000 (chữ) + 8000 (chưa chọn: trung bình 8000)
  const s = orderSummary(costs, { items: [picked] });
  assert.equal(s.product, 3 * 50000 + 6000 + 9000 + 8000);
  // thiếu hàng: đơn 11 box cần 11 cúp (có 10) và 11 móc (nhóm có 10)
  const big = { ...state, orders: [{ id: 'o2', code: 'B', date: '2026-11-01', status: 'pending', items: [{ productId: 'box', qty: 11, price: 1, picks: [] }] }] };
  const { short } = orderShortages(big);
  assert.deepEqual(short[0].lines.map((l) => [l.productId, l.pool?.length || 0, l.need, l.have, l.short]), [['cup', 0, 11, 10, 1], ['', 3, 11, 10, 1]]);
  // hai đơn: đơn cũ giữ 8 móc, đơn mới chỉ còn 2
  const two = { ...state, orders: [
    { id: 'a', code: 'A', date: '2026-11-01', status: 'pending', items: [{ productId: 'box', qty: 8, price: 1, picks: [] }] },
    { id: 'b', code: 'B', date: '2026-11-02', status: 'pending', items: [{ productId: 'box', qty: 3, price: 1, picks: [] }] },
  ] };
  const r = orderShortages(two);
  assert.deepEqual(r.ready.map((o) => o.code), ['A']);
  assert.deepEqual(r.short[0].lines.filter((l) => l.pool).map((l) => [l.need, l.have, l.short]), [[3, 2, 1]]);
});
