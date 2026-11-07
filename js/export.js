// Order export: pick a date range, then build spreadsheet rows (no DOM — testable in Node).
import { PLATFORMS, STATUSES, INACTIVE_STATUSES, PACK_SLOTS, orderSummary, lineCost } from './calc.js';

const pad = (n) => String(n).padStart(2, '0');
/** YYYY-MM-DD in the viewer's own time zone (toISOString would shift to UTC). */
export const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const vnDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const lastDayOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(y, m, 0).getDate())}`;
};

/**
 * Turn the dialog's choice into an inclusive date range.
 *   { mode: 'day', day } | { mode: 'month', month: 'YYYY-MM' } | { mode: 'range', from, to }
 * Returns { from, to, label, slug } or null when the input is incomplete.
 */
export function exportRange({ mode, day, month, from, to }) {
  if (mode === 'day') {
    if (!day) return null;
    return { from: day, to: day, label: `Ngày ${vnDate(day)}`, slug: day };
  }
  if (mode === 'month') {
    if (!month) return null;
    const [y, m] = month.split('-');
    return { from: `${month}-01`, to: lastDayOfMonth(month), label: `Tháng ${m}/${y}`, slug: month };
  }
  if (!from || !to) return null;
  if (from > to) [from, to] = [to, from];
  return { from, to, label: `Từ ${vnDate(from)} đến ${vnDate(to)}`, slug: `${from}_den_${to}` };
}

/** Ready-made ranges for the quick buttons, relative to `now`. */
export function quickRanges(now = new Date()) {
  const d = (offset) => isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  const ym = (offset) => isoLocal(new Date(now.getFullYear(), now.getMonth() + offset, 1)).slice(0, 7);
  return {
    today: { label: 'Hôm nay', mode: 'day', day: d(0) },
    yesterday: { label: 'Hôm qua', mode: 'day', day: d(-1) },
    last7: { label: '7 ngày qua', mode: 'range', from: d(-6), to: d(0) },
    last30: { label: '30 ngày qua', mode: 'range', from: d(-29), to: d(0) },
    thisMonth: { label: 'Tháng này', mode: 'month', month: ym(0) },
    lastMonth: { label: 'Tháng trước', mode: 'month', month: ym(-1) },
  };
}

/** Orders dated inside the range, optionally limited to some platforms and to active orders. */
export function ordersInRange(orders, range, { platforms, includeInactive = false } = {}) {
  return orders
    .filter((o) => o.date >= range.from && o.date <= range.to)
    .filter((o) => !platforms || platforms.includes(o.platform))
    .filter((o) => includeInactive || !INACTIVE_STATUSES.has(o.status))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.code || '').localeCompare(b.code || ''));
}

/**
 * Spreadsheet rows (arrays of arrays, numbers kept as numbers so Excel can sum them).
 * `names.item(productId, variantId, fallback)` and `names.pack(id)` resolve display names.
 * Cancelled/returned orders are listed but count 0 in the totals.
 */
export function buildSheets({ orders, costs, range, names, operating = null }) {
  const orderRows = [[
    'Ngày', 'Nền tảng', 'Mã đơn', 'Khách hàng', 'Trạng thái', 'Có thiệp', 'Sản phẩm', 'Số lượng',
    'Tiền hàng', 'Giảm giá', 'Doanh thu', 'Giá vốn SP', 'Đóng gói', 'Phí sàn',
    'Phí ship', 'Ai trả ship', 'Ship shop chịu', 'Tổng chi phí', 'Lợi nhuận', 'Ghi chú',
  ]];
  const lineRows = [[
    'Ngày', 'Nền tảng', 'Mã đơn', 'Trạng thái', 'Sản phẩm', 'Phân loại', 'Số lượng', 'Giá bán / cái',
    'Thành tiền', 'Giá vốn SP', 'Dụng cụ đóng gói', 'Đóng gói riêng từng cái', 'Chi phí đóng gói', 'Lãi gộp dòng',
  ]];
  const total = { orders: 0, cards: 0, qty: 0, gross: 0, discount: 0, revenue: 0, product: 0, packaging: 0, fee: 0, ship: 0, cost: 0, profit: 0 };
  const byPlatform = {};

  for (const o of orders) {
    const active = !INACTIVE_STATUSES.has(o.status);
    const s = orderSummary(costs, o);
    const qty = (o.items || []).reduce((n, l) => n + (+l.qty || 0), 0);
    const z = (v) => (active ? v : 0);
    orderRows.push([
      vnDate(o.date), PLATFORMS[o.platform]?.label || o.platform, o.code || '', o.customer || '', STATUSES[o.status] || o.status, o.card ? 'Có' : '',
      (o.items || []).map((l) => `${names.item(l.productId, l.variantId, l.productName || '?')} x${l.qty}`).join('; '), qty,
      z(s.gross), z(s.discount), z(s.revenue), z(s.product), z(s.packaging), z(s.fee),
      +o.shipFee || 0, o.shipPayer === 'shop' ? 'Shop chịu' : 'Khách chịu', z(s.ship), z(s.cost), z(s.profit), o.note || '',
    ]);
    for (const l of o.items || []) {
      const c = lineCost(costs, l);
      const full = names.item(l.productId, '', l.productName || '?');
      const withVariant = names.item(l.productId, l.variantId, '');
      lineRows.push([
        vnDate(o.date), PLATFORMS[o.platform]?.label || o.platform, o.code || '', STATUSES[o.status] || o.status,
        full, withVariant !== full ? withVariant.slice(full.length).replace(/^ · /, '') : '',
        +l.qty || 0, +l.price || 0, z(c.revenue), z(c.product),
        PACK_SLOTS.map((k) => (l[k] ? names.pack(l[k]) : '')).filter(Boolean).join(' + '),
        l.packEach ? 'Có' : '', z(c.packaging), z(c.profit),
      ]);
    }
    if (!active) continue;
    total.orders += 1;
    if (o.card) total.cards += 1;
    total.qty += qty;
    for (const k of ['gross', 'discount', 'revenue', 'product', 'packaging', 'fee', 'ship', 'cost', 'profit']) total[k] += s[k];
    const pf = (byPlatform[o.platform] ||= { orders: 0, revenue: 0, profit: 0 });
    pf.orders += 1;
    pf.revenue += s.revenue;
    pf.profit += s.profit;
  }

  orderRows.push([
    'TỔNG', '', `${total.orders} đơn`, '', '', total.cards ? `${total.cards} thiệp` : '', '', total.qty, total.gross, total.discount, total.revenue,
    total.product, total.packaging, total.fee, '', '', total.ship, total.cost, total.profit, '',
  ]);

  // With `operating` (shared supplies bought in the period) the report's cost and profit include it,
  // matching the dashboard; per-order figures stay as they are.
  const op = operating ? operating.total : 0;
  const summaryRows = [
    ['Báo cáo đơn hàng Hani'],
    ['Thời gian', range.label],
    ['Xuất lúc', new Date().toLocaleString('vi-VN')],
    [],
    ['Số đơn (không tính huỷ/trả)', total.orders],
    ['Số sản phẩm bán ra', total.qty],
    ['Số đơn có thiệp', total.cards],
    ['Tiền hàng', total.gross],
    ['Giảm giá / voucher', total.discount],
    ['Doanh thu', total.revenue],
    ['Giá vốn sản phẩm', total.product],
    ['Chi phí đóng gói', total.packaging],
    ['Phí sàn', total.fee],
    ['Ship shop chịu', total.ship],
    ...(operating ? [['Chi phí vận hành (vật tư dùng chung mua trong kỳ)', op]] : []),
    ['Tổng chi phí', total.cost + op],
    ['Lợi nhuận', total.profit - op],
    ['Biên lợi nhuận', total.revenue ? Math.round(((total.profit - op) / total.revenue) * 1000) / 10 + '%' : '0%'],
    [],
    ['Theo nền tảng', 'Số đơn', 'Doanh thu', 'Lợi nhuận'],
    ...Object.keys(PLATFORMS).map((k) => [PLATFORMS[k].label, byPlatform[k]?.orders || 0, byPlatform[k]?.revenue || 0, byPlatform[k]?.profit || 0]),
  ];

  return { summary: summaryRows, orders: orderRows, lines: lineRows, total };
}

/** CSV text (with BOM so Excel opens Vietnamese correctly). */
export function toCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n');
}
