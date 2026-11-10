import test from 'node:test';
import assert from 'node:assert/strict';
import { exportRange, quickRanges, ordersInRange, buildSheets, toCsv, isoLocal } from '../js/export.js';
import { costTable } from '../js/calc.js';

test('khoảng thời gian: ngày, tháng (kể cả tháng 2), tuỳ chọn bị đảo', () => {
  assert.deepEqual(exportRange({ mode: 'day', day: '2026-11-06' }), { from: '2026-11-06', to: '2026-11-06', label: 'Ngày 06/11/2026', slug: '2026-11-06' });
  assert.equal(exportRange({ mode: 'month', month: '2026-02' }).to, '2026-02-28');
  assert.equal(exportRange({ mode: 'month', month: '2028-02' }).to, '2028-02-29');
  const r = exportRange({ mode: 'range', from: '2026-11-10', to: '2026-11-01' });
  assert.equal(r.from, '2026-11-01');
  assert.equal(r.to, '2026-11-10');
  assert.equal(exportRange({ mode: 'range', from: '2026-11-01' }), null);
});

test('nút nhanh tính theo giờ địa phương', () => {
  const q = quickRanges(new Date(2026, 0, 1, 0, 30)); // 00:30 ngày 1/1
  assert.equal(q.today.day, '2026-01-01');
  assert.equal(q.yesterday.day, '2025-12-31');
  assert.equal(q.lastMonth.month, '2025-12');
  assert.equal(q.last7.from, '2025-12-26');
  assert.equal(isoLocal(new Date(2026, 10, 1)), '2026-11-01');
});

test('lọc đơn theo khoảng, nền tảng, bỏ đơn huỷ; bảng tổng khớp', () => {
  const state = {
    products: [{ id: 'cup', name: 'Cúp', baseCost: 30000, variants: [{ id: 'do', name: 'Đỏ' }] }],
    packaging: [{ id: 'box', name: 'Hộp', baseCost: 5000 }],
    imports: [],
  };
  const costs = costTable(state);
  const orders = [
    { platform: 'shopee', code: 'A', date: '2026-10-31', status: 'done', items: [{ productId: 'cup', qty: 1, price: 90000 }] },
    { platform: 'instagram', code: 'B', date: '2026-11-02', status: 'done', shipFee: 20000, shipPayer: 'shop',
      items: [{ productId: 'cup', variantId: 'do', qty: 2, price: 90000, pack1: 'box' }] },
    { platform: 'threads', code: 'C', date: '2026-11-03', status: 'cancelled', items: [{ productId: 'cup', qty: 1, price: 90000 }] },
  ];
  const range = exportRange({ mode: 'month', month: '2026-11' });
  assert.deepEqual(ordersInRange(orders, range).map((o) => o.code), ['B']);
  assert.deepEqual(ordersInRange(orders, range, { includeInactive: true }).map((o) => o.code), ['B', 'C']);
  assert.deepEqual(ordersInRange(orders, range, { platforms: ['threads'], includeInactive: true }).map((o) => o.code), ['C']);

  const names = {
    item: (pid, vid, fb) => (pid === 'cup' ? (vid === 'do' ? 'Cúp · Đỏ' : 'Cúp') : fb),
    pack: (id) => (id === 'box' ? 'Hộp' : ''),
  };
  const sheets = buildSheets({ orders: ordersInRange(orders, range, { includeInactive: true }), costs, range, names });
  // B: 180.000 - 60.000 vốn - 5.000 hộp - 20.000 ship shop chịu = 95.000; C huỷ → 0
  assert.equal(sheets.total.orders, 1);
  assert.equal(sheets.total.profit, 95000);
  assert.equal(sheets.orders.at(-1)[19], 95000);
  assert.equal(sheets.orders[2][19], 0); // đơn huỷ vẫn liệt kê nhưng không tính
  assert.equal(sheets.lines[1][5], 'Đỏ');
  assert.equal(sheets.lines[1][10], 'Hộp');
  assert.ok(toCsv([['a,b', 'c"d']]).endsWith('"a,b","c""d"'));
});

test('cột "Có thiệp" và số đơn có thiệp trong báo cáo', () => {
  const costs = costTable({ products: [{ id: 'p', name: 'P', baseCost: 1000 }], packaging: [], imports: [] });
  const mk = (code, card, status = 'done') => ({ platform: 'instagram', code, date: '2026-11-02', status, card, items: [{ productId: 'p', qty: 1, price: 5000 }] });
  const orders = [mk('A', true, 'designed'), mk('B', false, 'packed'), mk('C', true, 'cancelled')];
  const range = exportRange({ mode: 'month', month: '2026-11' });
  const names = { item: () => 'P', pack: () => '' };
  const sheets = buildSheets({ orders, costs, range, names });
  const col = sheets.orders[0].indexOf('Có thiệp');
  assert.equal(col, 5);
  assert.deepEqual([1, 2, 3].map((i) => sheets.orders[i][col]), ['Có', '', 'Có']);
  assert.equal(sheets.orders[1][4], 'Đã thiết kế');
  assert.equal(sheets.orders[2][4], 'Đã đóng gói');
  assert.equal(sheets.total.cards, 1); // the cancelled order doesn't count
  assert.equal(sheets.orders.at(-1)[col], '1 thiệp');
  assert.deepEqual(sheets.summary.find((r) => r[0] === 'Số đơn có thiệp'), ['Số đơn có thiệp', 1]);
  assert.equal(sheets.orders[0].length, sheets.orders.at(-1).length);
});

test('báo cáo có chi phí vận hành thì trừ vào lợi nhuận, không có thì giữ nguyên', () => {
  const costs = costTable({ products: [{ id: 'p', name: 'P', baseCost: 1000 }], packaging: [], imports: [] });
  const orders = [{ platform: 'instagram', code: 'A', date: '2026-11-02', status: 'done', items: [{ productId: 'p', qty: 1, price: 5000 }] }];
  const range = exportRange({ mode: 'month', month: '2026-11' });
  const names = { item: () => 'P', pack: () => '' };
  const row = (sheets, label) => sheets.summary.find((r) => r[0] === label);
  const plain = buildSheets({ orders, costs, range, names });
  assert.equal(row(plain, 'Lợi nhuận')[1], 4000);
  assert.equal(row(plain, 'Chi phí vận hành (vật tư dùng chung mua trong kỳ)'), undefined);
  const withOp = buildSheets({ orders, costs, range, names, operating: { total: 1500 } });
  assert.equal(row(withOp, 'Chi phí vận hành (vật tư dùng chung mua trong kỳ)')[1], 1500);
  assert.equal(row(withOp, 'Tổng chi phí')[1], 1000 + 1500);
  assert.equal(row(withOp, 'Lợi nhuận')[1], 2500);
  assert.equal(withOp.total.profit, 4000); // số liệu từng đơn không đổi
});

test('báo cáo có cột tiền cọc / còn thu và tổng của chúng', () => {
  const costs = costTable({ products: [{ id: 'p', name: 'P', baseCost: 1000 }], packaging: [], imports: [] });
  const mk = (code, status, paid) => ({ platform: 'instagram', code, date: '2026-11-02', status, shipFee: 15000, shipPayer: 'customer', paid, items: [{ productId: 'p', qty: 1, price: 100000 }] });
  const orders = [mk('A', 'pending', 50000), mk('B', 'done', 50000), mk('C', 'packed', undefined), mk('D', 'cancelled', 30000)];
  const range = exportRange({ mode: 'month', month: '2026-11' });
  const sheets = buildSheets({ orders, costs, range, names: { item: () => 'P', pack: () => '' } });
  const head = sheets.orders[0];
  const paidCol = head.indexOf('Đã thanh toán (cọc)');
  const leftCol = head.indexOf('Còn thu khi nhận hàng');
  assert.equal(leftCol, paidCol + 1);
  assert.equal(head.at(-1), 'Ghi chú');
  assert.equal(sheets.orders[1][paidCol], 50000);
  assert.equal(sheets.orders[1][leftCol], 65000); // 115.000 phải trả - 50.000 cọc
  assert.equal(sheets.orders[2][paidCol], 50000);
  assert.equal(sheets.orders[2][leftCol], 0); // hoàn thành = đã thu đủ
  assert.equal(sheets.orders[3][paidCol], ''); // không theo dõi
  assert.equal(sheets.orders[3][leftCol], '');
  assert.equal(sheets.orders[4][leftCol], 0); // đơn huỷ: không thu
  assert.equal(sheets.total.paid, 100000); // đơn huỷ không tính
  assert.equal(sheets.total.remaining, 65000);
  const row = (label) => sheets.summary.find((r) => r[0] === label)[1];
  assert.equal(row('Còn phải thu khi nhận hàng (đơn chưa xong)'), 65000);
  assert.equal(row('Khách đã thanh toán trước (đơn có ghi nhận)'), 100000);
  assert.equal(sheets.orders.at(-1).length, head.length);
});

test('báo cáo có cột Mã vận đơn', () => {
  const costs = { product: { p: 0 }, packaging: {}, shared: {} };
  const o = { platform: 'instagram', code: 'A', date: '2026-11-02', status: 'shipping', tracking: 'SPX999', items: [{ productId: 'p', qty: 1, price: 5000 }] };
  const sheets = buildSheets({ orders: [o], costs, range: exportRange({ mode: 'month', month: '2026-11' }), names: { item: () => 'P', pack: () => '' } });
  const col = sheets.orders[0].indexOf('Mã vận đơn');
  assert.ok(col > 0);
  assert.equal(sheets.orders[1][col], 'SPX999');
  assert.equal(sheets.orders[0].length, sheets.orders.at(-1).length);
});
