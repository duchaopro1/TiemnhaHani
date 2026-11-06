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
  assert.equal(sheets.orders.at(-1)[17], 95000);
  assert.equal(sheets.orders[2][17], 0); // đơn huỷ vẫn liệt kê nhưng không tính
  assert.equal(sheets.lines[1][5], 'Đỏ');
  assert.equal(sheets.lines[1][10], 'Hộp');
  assert.ok(toCsv([['a,b', 'c"d']]).endsWith('"a,b","c""d"'));
});
