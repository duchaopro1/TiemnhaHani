import { store, initStore, firebaseEnabled, restoreBackup, uid } from './store.js';
import {
  PLATFORMS, STATUSES, INACTIVE_STATUSES, PACK_SLOTS, WRAP_SLOTS,
  costTable, lineCost, orderSummary, stockLevels, aggregate, variantKey, splitFee, countByStatus, OPEN_STATUSES, operatingCosts, adjustForCount, completedRevenue, DEFAULT_LABOR, stockState, orderPayment, toCollect, isReceived, allocateShipping, findDuplicateOrders,
} from './calc.js';
import { rowsToOrders, listingKey, normalize, mergeShopeeStatus } from './shopee.js';
import { stable, normalizeOrder, getDraft, putDraft, deleteDraft, markDraftClosed, openDraftKeys } from './drafts.js';
import { describeError } from './errors.js';
import { exportRange, quickRanges, ordersInRange, buildSheets, toCsv, isoLocal } from './export.js';

/* ================= helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(+n || 0).toLocaleString('vi-VN')}đ`;
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const today = () => isoLocal(new Date());
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const signCls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'vi');


function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
const notify = (msg) => toast(msg, 5000);

/** Copy text to the clipboard; falls back to a hidden textarea where the clipboard API is blocked. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t);
    t.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    t.remove();
  }
  toast(`Đã sao chép ${text}`);
}

/** In-page yes/no dialog (browser confirm() is blocked inside Claude artifacts). */
function ask(message, okLabel = 'Xoá') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm';
    d.innerHTML = `<div class="modal-body"><p></p></div>
      <div class="modal-foot"><button class="btn ghost" value="no">Huỷ</button><button class="btn danger" value="yes"></button></div>`;
    $('p', d).textContent = message;
    $('[value=yes]', d).textContent = okLabel;
    d.addEventListener('click', (e) => { if (e.target.value) d.close(e.target.value); });
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); });
    document.body.append(d);
    d.showModal();
  });
}

/** In-page dialog with several buttons; resolves to the chosen value, or null when dismissed (Esc). */
function choose(message, choices) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm';
    d.innerHTML = '<div class="modal-body"><p></p></div><div class="modal-foot" style="flex-wrap:wrap"></div>';
    $('p', d).textContent = message;
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = c.cls || 'btn ghost';
      b.value = c.value;
      b.textContent = c.label;
      $('.modal-foot', d).append(b);
    }
    d.addEventListener('click', (e) => { if (e.target.value) d.close(e.target.value); });
    d.addEventListener('close', () => { resolve(d.returnValue || null); d.remove(); });
    document.body.append(d);
    d.showModal();
  });
}

const MODES = {
  firebase: { dot: '', label: () => store.user?.email || 'Online', title: 'Dữ liệu đồng bộ qua Firebase' },
  artifact: { dot: '', label: () => 'Dùng chung', title: 'Dữ liệu lưu online, dùng chung với những người được chia sẻ trang' },
  local: { dot: 'local', label: () => 'Chỉ máy này', title: 'Dữ liệu chỉ lưu trong trình duyệt này' },
};

/* ================= derived state ================= */
let S, costs, stock, settings;
function derive() {
  S = store.state;
  S.products.sort(byName);
  S.packaging.sort(byName);
  S.presets.sort(byName);
  costs = costTable(S);
  stock = stockLevels(S);
  settings = { id: 'settings', shopeeMap: {}, lowStock: 5, laborPerOrder: DEFAULT_LABOR, ...(store.get('meta', 'settings') || {}) };
}
const product = (id) => store.get('products', id);
const pack = (id) => store.get('packaging', id);
const variantOf = (pid, vid) => (vid ? product(pid)?.variants?.find((v) => v.id === vid) : undefined);
const hasVariants = (p) => Boolean(p?.variants?.length);
/** "Cúp · Đỏ", or just the product name when there is no variant. */
const itemLabel = (pid, vid, fallback = '') => {
  const p = product(pid);
  if (!p) return fallback;
  const v = variantOf(pid, vid);
  return v ? `${p.name} · ${v.name}` : p.name;
};
const vStock = (pid, vid) => num(stock.variants[variantKey(pid, vid)]);
const lowOf = (item) => num(item?.lowStock ?? settings.lowStock);
/** "Đã hết" when there is none left, "Sắp hết" while at or under the warning level, nothing otherwise. */
const stockBadge = (n, low) => {
  const st = stockState(n, low);
  return st === 'out' ? '<span class="chip out">Đã hết</span>' : st === 'low' ? '<span class="chip warn">Sắp hết</span>' : '';
};
/** Images are stored as "asset:<id>" (artifact asset store) or as a data: URL. */
const imgSrc = (ref) => (!ref ? '' : ref.startsWith('asset:') ? '/_blob/' + ref.slice(6) : ref);
const thumb = (ref, name, cls = '') =>
  ref
    ? `<img class="thumb ${cls}" src="${esc(imgSrc(ref))}" alt="" loading="lazy">`
    : `<span class="thumb ph ${cls}" aria-hidden="true">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
const presetCost = (preset) => PACK_SLOTS.reduce((s, k) => s + (preset?.[k] && !costs.shared[preset[k]] ? num(costs.packaging[preset[k]]) : 0), 0);
/** Packaging that can go into an order: everything except shared supplies (tape, staples…). */
const orderPackaging = () => S.packaging.filter((k) => !k.shared);

/* ================= routing ================= */
const TABS = {
  dashboard: 'Tổng quan',
  orders: 'Đơn hàng',
  revenue: 'Doanh thu',
  imports: 'Nhập hàng',
  products: 'Sản phẩm',
  packaging: 'Đóng gói',
  settings: 'Cài đặt',
};
const ui = {
  period: 'month', // 'month' (the month in dashMonth) or 'all'
  dashMonth: isoLocal(new Date()).slice(0, 7),
  orders: { q: '', platform: '', status: '', month: '' },
  imports: { q: '', kind: '', status: '', open: {} },
  products: { q: '' },
  export: null, // last choices in the export dialog, kept for the visit
};
const currentTab = () => (TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');

function render() {
  derive();
  const tab = currentTab();
  const pages = { dashboard: pageDashboard, orders: pageOrders, revenue: pageRevenue, imports: pageImports, products: pageProducts, packaging: pagePackaging, settings: pageSettings };
  const focused = document.activeElement?.id;
  $('#app').innerHTML = `
    <header class="topbar">
      <span class="logo">hani</span>
      <span class="tag">món quà nho nhỏ, kỉ niệm "to đùng"</span>
      <nav class="tabs">
        ${Object.entries(TABS).map(([k, v]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}
      </nav>
      <span class="sync" title="${MODES[store.mode].title}">
        <i class="dot ${MODES[store.mode].dot}"></i>${esc(MODES[store.mode].label())}
      </span>
      <button type="button" class="sync-state" id="sync-state" data-action="sync-info" hidden></button>
      <button type="button" class="live-btn" id="live-btn" data-action="refresh-now" hidden></button>
    </header>
    <main>${pages[tab]()}</main>`;
  updateSyncBadge({ pending: store.pending, error: store.lastError });
  updateLiveBadge(store.liveInfo());
  fitRevenueTable();
  if (focused && $('#' + focused)) {
    const el = $('#' + focused);
    el.focus();
    if (el.setSelectionRange && el.type === 'search') el.setSelectionRange(el.value.length, el.value.length);
  }
}

/** The revenue table gets exactly the screen height left below it, so it scrolls inside its own box. */
function fitRevenueTable() {
  const box = $('.rev-wrap');
  if (!box) return;
  const top = box.getBoundingClientRect().top + window.scrollY;
  box.style.maxHeight = `${Math.max(240, window.innerHeight - top - 84)}px`;
}
window.addEventListener('resize', fitRevenueTable);

/* ================= save status ================= */
let syncTimer = null;
let wasPending = false;
let doneUntil = 0; // "Đã lưu ✓" stays for a moment, even though the header is redrawn right after a save
function updateSyncBadge({ pending, error }) {
  const el = $('#sync-state');
  clearTimeout(syncTimer);
  let state = 'idle';
  if (pending > 0) {
    wasPending = true;
    state = 'saving';
  } else if (error) {
    wasPending = false;
    state = 'error';
  } else {
    if (wasPending) { wasPending = false; doneUntil = Date.now() + 2500; }
    if (Date.now() < doneUntil) state = 'done';
  }
  if (state === 'done') syncTimer = setTimeout(() => updateSyncBadge({ pending: store.pending, error: store.lastError }), doneUntil - Date.now() + 30);
  if (!el) return;
  if (state === 'idle') { el.hidden = true; return; }
  const text = { saving: 'Đang lưu…', error: 'Chưa lưu được', done: 'Đã lưu ✓' }[state];
  Object.assign(el, { hidden: false, className: `sync-state ${state}`, textContent: text });
  el.title = state === 'error' ? describeError(error).text : '';
}
/** "⟳ 14:05" = data last arrived at 14:05; click to refresh now. Only for the shared (online) version. */
function updateLiveBadge({ lastSync, connected, refreshing }) {
  const el = $('#live-btn');
  if (!el) return;
  if (store.mode !== 'artifact' || !lastSync) { el.hidden = true; return; }
  const at = new Date(lastSync).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const [text, cls, title] = refreshing
    ? ['Đang làm mới…', 'live-btn busy', 'Đang lấy dữ liệu mới nhất']
    : !connected
      ? ['Đang kết nối lại…', 'live-btn warn', 'Kết nối bị gián đoạn, app đang nối lại. Bấm để làm mới ngay.']
      : [`⟳ ${at}`, 'live-btn', `Dữ liệu cập nhật lần cuối lúc ${at}. Trang tự cập nhật khi có thay đổi. Bấm để làm mới ngay.`];
  Object.assign(el, { hidden: false, className: cls, textContent: text, title });
}
// Leaving while a save is still on its way would lose it: ask the browser to confirm.
window.addEventListener('beforeunload', (e) => {
  if (store?.pending > 0) { e.preventDefault(); e.returnValue = ''; }
});

/* ================= modal ================= */
const modal = $('#modal');
function openModal({ title, body, foot = '', onMount, wide = true, beforeClose }) {
  modal.style.width = wide ? '' : 'min(560px, calc(100vw - 32px))';
  modal.innerHTML = `
    <div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  modal.showModal();
  modal.requestClose = async () => { if (!beforeClose || await beforeClose()) modal.close(); };
  modal.oncancel = (e) => { e.preventDefault(); modal.requestClose(); }; // Esc
  $('[data-close]', modal).onclick = () => modal.requestClose();
  onMount?.(modal);
}
const options = (list, selected, empty) =>
  (empty !== undefined ? `<option value="">${empty}</option>` : '') +
  list.map((x) => `<option value="${esc(x.id)}" ${x.id === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
const formData = (form) => Object.fromEntries(new FormData(form).entries());

/* ================= images ================= */
async function resizeImage(file, max) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; // JPEG has no transparency
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.82));
}

/** Shrink a picked photo and store it; returns the reference to keep on the product. */
async function saveImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('File không phải hình ảnh');
  if (store.mode === 'artifact') {
    const assets = await window.claude.use('assets');
    if (assets) {
      const res = await assets.upload(await resizeImage(file, 640), { type: 'image/jpeg' });
      return 'asset:' + res.id;
    }
  }
  // Local / Firebase: keep a small copy inside the product document.
  const blob = await resizeImage(file, 320);
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/* ================= DASHBOARD ================= */
const thisMonth = () => isoLocal(new Date()).slice(0, 7);
/** 'YYYY-MM' moved by n months. */
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return isoLocal(new Date(y, m - 1 + n, 1)).slice(0, 7);
};
/** Show a month on the dashboard, never one in the future. */
const viewMonth = (ym) => Object.assign(ui, { period: 'month', dashMonth: ym > thisMonth() ? thisMonth() : ym });

/** [from, to, label] of the dashboard's selected period. */
function periodRange() {
  if (ui.period === 'all') return ['0000', '9999', 'Toàn bộ thời gian'];
  const r = exportRange({ mode: 'month', month: ui.dashMonth });
  return [r.from, r.to, r.label];
}

/** Finished orders one by one: what the customer paid, every cost taken out, and what is left. */
function pageRevenue() {
  const [from, to, periodLabel] = periodRange();
  const labor = num(settings.laborPerOrder);
  const { rows, total } = completedRevenue(costs, S.orders.filter((o) => o.date >= from && o.date <= to), labor);
  const cur = thisMonth();
  const isMonth = (ym) => ui.period === 'month' && ui.dashMonth === ym;
  const pickedOther = ui.period === 'month' && !isMonth(cur);
  const cell = (v, cls = '') => `<td class="num ${cls}">${money(v)}</td>`;
  const profitCls = (v) => (v < 0 ? 'neg' : '');
  // Shipping with a sign: + the customer pays it (adds to Tổng đơn), − the shop pays it (a cost).
  const shipCell = (v, shop, net = false) => {
    const signed = net ? v : shop ? -v : v;
    if (!signed && !v) return '<td class="num">0đ</td>';
    return `<td class="num ${signed < 0 ? 'neg' : 'pos'}">${signed < 0 ? '−' : '+'}${money(Math.abs(signed))}${net ? '' : `<br><span class="muted small">${shop ? 'Shop chịu' : 'Khách trả'}</span>`}</td>`;
  };
  const margin = total.revenue ? Math.round((total.profit / total.revenue) * 1000) / 10 : 0;

  return `
    <div class="page-head">
      <div><h1>Doanh thu</h1><p>Đang xem: <b>${esc(periodLabel)}</b> · chỉ tính đơn <b>Hoàn thành</b>. Mỗi đơn cho thấy khách trả bao nhiêu, mất những khoản phí nào và lời bao nhiêu.</p></div>
      <div class="actions period-bar">
        <button class="period-btn ${isMonth(cur) ? 'on' : ''}" data-period="this">Tháng này</button>
        <div class="month-nav ${pickedOther ? 'on' : ''}" title="Chọn các tháng trước">
          <button class="icon-btn" data-month-step="-1" title="Tháng trước đó" aria-label="Tháng trước đó">‹</button>
          <input type="month" id="dash-month" value="${esc(ui.period === 'month' ? ui.dashMonth : '')}" max="${cur}" aria-label="Chọn tháng">
          <button class="icon-btn" data-month-step="1" title="Tháng sau" aria-label="Tháng sau" ${ui.period === 'month' && ui.dashMonth >= cur ? 'disabled' : ''}>›</button>
        </div>
        <button class="period-btn ${ui.period === 'all' ? 'on' : ''}" data-period="all">Tất cả</button>
      </div>
    </div>
    <div class="grid kpi">
      <div class="card kpi-card"><div class="label">Đơn hoàn thành</div><div class="value">${total.orders}</div></div>
      <div class="card kpi-card"><div class="label">Tổng khách trả</div><div class="value">${money(total.total)}</div></div>
      <div class="card kpi-card him"><div class="label">Doanh thu (hàng − giảm giá)</div><div class="value">${money(total.revenue)}</div></div>
      <div class="card kpi-card her"><div class="label">Chi phí (gồm tiền công)</div><div class="value">${money(total.cost + total.labor)}</div></div>
      <div class="card kpi-card"><div class="label">Lợi nhuận sau công${total.revenue ? ` · ${margin}%` : ''}</div><div class="value ${profitCls(total.profit)}">${money(total.profit)}</div></div>
    </div>
    <div class="toolbar">
      <label class="field inline">Tiền công mỗi đơn <input type="number" min="0" step="1000" id="set-labor" value="${labor}" style="width:110px"> đ</label>
      <span class="muted small">Lợi nhuận = doanh thu − (giá vốn SP + đóng gói + ship shop chịu + phí sàn). Lợi nhuận sau công = lợi nhuận − tiền công. Chưa gồm chi phí vận hành (vật tư dùng chung), xem ở Tổng quan.</span>
    </div>
    <div class="card table-wrap rev-wrap">
      ${rows.length ? `<table class="rev-table">
        <thead><tr>
          <th>Ngày</th><th>Đơn</th><th class="num" title="Tiền hàng + ship khách trả − giảm giá">Tổng đơn</th><th class="num">Tiền hàng</th><th class="num">Giảm giá</th>
          <th class="num" title="Tiền hàng − giảm giá">Doanh thu</th><th class="num">Giá vốn SP</th><th class="num">Đóng gói</th><th class="num" title="+ khách trả (cộng vào Tổng đơn) · − shop chịu (tính vào Chi phí)">Phí ship</th><th class="num">Phí sàn</th>
          <th class="num" title="Giá vốn + đóng gói + ship shop chịu + phí sàn">Chi phí</th><th class="num" title="Doanh thu − chi phí">Lợi nhuận</th>
          <th class="num">Tiền công</th><th class="num" title="Lợi nhuận − tiền công">Lợi nhuận sau công</th>
        </tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${fmtDate(r.order.date)}</td>
          <td><a href="javascript:void 0" data-action="edit-order" data-id="${r.order.id}"><b>${esc(r.order.code || '—')}</b></a> <span class="chip st-done">${esc(PLATFORMS[r.order.platform]?.label || r.order.platform)}</span><br><span class="muted small">${esc(r.order.customer || '')}</span></td>
          ${cell(r.total, 'strong')}${cell(r.gross)}${cell(r.discount)}${cell(r.revenue)}${cell(r.product)}${cell(r.packaging)}${shipCell(r.shipFee, r.order.shipPayer === 'shop')}${cell(r.fee)}${cell(r.cost, 'strong')}${cell(r.before, `strong ${profitCls(r.before)}`)}${cell(r.labor)}${cell(r.profit, `strong ${profitCls(r.profit)}`)}
        </tr>`).join('')}</tbody>
        <tfoot><tr>
          <td colspan="2"><b>Tổng ${total.orders} đơn</b></td>
          ${cell(total.total, 'strong')}${cell(total.gross)}${cell(total.discount)}${cell(total.revenue)}${cell(total.product)}${cell(total.packaging)}${shipCell(total.shipFee - 2 * total.ship, false, true)}${cell(total.fee)}${cell(total.cost, 'strong')}${cell(total.before, `strong ${profitCls(total.before)}`)}${cell(total.labor)}${cell(total.profit, `strong ${profitCls(total.profit)}`)}
        </tr></tfoot>
      </table>` : '<div class="empty">Chưa có đơn hoàn thành trong thời gian này.</div>'}
    </div>`;
}

function pageDashboard() {
  const [from, to, periodLabel] = periodRange();
  const orders = S.orders.filter((o) => o.date >= from && o.date <= to);
  const agg = aggregate(costs, orders);
  const op = operatingCosts(S, from, to);
  const profit = agg.profit - op.total;
  const totalCost = agg.cost + op.total;
  const margin = agg.revenue ? (profit / agg.revenue) * 100 : 0;
  const maxRev = Math.max(1, ...Object.values(agg.byPlatform).map((p) => p.revenue));
  const top = Object.entries(agg.byProduct).sort((a, b) => b[1].profit - a[1].profit).slice(0, 8);
  // Products with variants are checked colour by colour, others by their total.
  const lowP = S.products.flatMap((p) => (hasVariants(p)
    ? p.variants.filter((v) => vStock(p.id, v.id) <= lowOf(p)).map((v) => ({ p, v, n: vStock(p.id, v.id) }))
    : num(stock.products[p.id]) <= lowOf(p) ? [{ p, n: num(stock.products[p.id]) }] : []));
  const lowK = S.packaging.filter((k) => num(stock.packaging[k.id]) <= lowOf(k));
  // Everything at or under its warning level, the ones already out of stock first.
  const shortRows = [
    ...lowP.map(({ p, v, n }) => ({ n, inc: num(v ? stock.incoming.variants[variantKey(p.id, v.id)] : stock.incoming.products[p.id]), low: lowOf(p), kind: '<span class="chip him">Sản phẩm</span>',
      name: `<span class="item">${thumb(v?.image || p.image, v?.name || p.name, 'sm')}${esc(itemLabel(p.id, v?.id))}</span>` })),
    ...lowK.map((k) => ({ n: num(stock.packaging[k.id]), inc: num(stock.incoming.packaging[k.id]), low: lowOf(k), kind: `<span class="chip ${k.shared ? 'friend' : 'backup'}">${k.shared ? 'Vật tư' : 'Đóng gói'}</span>`, name: esc(k.name) })),
  ].sort((a, b) => (a.n <= 0 ? 0 : 1) - (b.n <= 0 ? 0 : 1));
  const unmapped = S.orders.filter((o) => !INACTIVE_STATUSES.has(o.status) && o.items?.some((l) => !l.productId)).length;
  const byStatus = countByStatus(orders);
  const due = toCollect(costs, orders);
  const openNow = [...OPEN_STATUSES].reduce((n, k) => n + byStatus[k], 0);
  const openElsewhere = ui.period === 'all' ? 0 : S.orders.filter((o) => OPEN_STATUSES.has(o.status) && !(o.date >= from && o.date <= to)).length;
  const goMonth = ui.period === 'month' ? ui.dashMonth : '';
  const cur = thisMonth();
  const isMonth = (ym) => ui.period === 'month' && ui.dashMonth === ym;
  const pickedOther = ui.period === 'month' && !isMonth(cur);

  return `
    <div class="page-head">
      <div><h1>Tổng quan</h1><p>Đang xem: <b>${esc(periodLabel)}</b> · doanh thu & lợi nhuận đã trừ giá vốn, đóng gói, phí sàn, ship shop chịu và chi phí vận hành.</p></div>
      <div class="actions period-bar">
        <button class="period-btn ${isMonth(cur) ? 'on' : ''}" data-period="this">Tháng này</button>
        <div class="month-nav ${pickedOther ? 'on' : ''}" title="Chọn các tháng trước">
          <button class="icon-btn" data-month-step="-1" title="Tháng trước đó" aria-label="Tháng trước đó">‹</button>
          <input type="month" id="dash-month" value="${esc(ui.period === 'month' ? ui.dashMonth : '')}" max="${cur}" aria-label="Chọn tháng">
          <button class="icon-btn" data-month-step="1" title="Tháng sau" aria-label="Tháng sau" ${ui.period === 'month' && ui.dashMonth >= cur ? 'disabled' : ''}>›</button>
        </div>
        <button class="period-btn ${ui.period === 'all' ? 'on' : ''}" data-period="all">Tất cả</button>
      </div>
    </div>
    <div class="grid kpi">
      <div class="card kpi-card him"><div class="label">Doanh thu</div><div class="value">${money(agg.revenue)}</div></div>
      <div class="card kpi-card her"><div class="label">Tổng chi phí</div><div class="value">${money(totalCost)}</div>${op.total ? `<div class="sub">gồm vận hành ${money(op.total)}</div>` : ''}</div>
      <div class="card kpi-card backup"><div class="label">Lợi nhuận</div><div class="value ${signCls(profit)}">${money(profit)}</div>${op.total ? `<div class="sub">đã trừ chi phí vận hành</div>` : ''}</div>
      <div class="card kpi-card friend"><div class="label">Số đơn · Biên lãi</div><div class="value">${agg.orders} · ${margin.toFixed(1)}%</div></div>
    </div>
    <section class="card stboard" style="margin-top:16px" aria-labelledby="stboard-title">
      <div class="stboard-head">
        <h3 id="stboard-title">Trạng thái đơn hàng</h3>
        <span class="muted small">${orders.length} đơn · <b>${openNow}</b> đơn chưa xong${due.count ? ` · còn thu khi nhận hàng <b class="due-amt">${money(due.amount)}</b> (${due.count} đơn)` : ''}</span>
      </div>
      <div class="stbar" role="img" aria-label="Tỉ lệ đơn theo trạng thái">${orders.length
        ? Object.keys(STATUSES).filter((k) => byStatus[k]).map((k) => `<i style="width:${(byStatus[k] / orders.length) * 100}%;background:var(--st-${k}-edge)" title="${esc(STATUSES[k])}: ${byStatus[k]}"></i>`).join('')
        : ''}</div>
      <div class="stcards">
        ${Object.entries(STATUSES).map(([k, label]) => `<a class="stcard st-${k} ${byStatus[k] ? '' : 'zero'}" href="#orders" data-goto-status="${k}" data-goto-month="${esc(goMonth)}" title="Xem các đơn ${esc(label.toLowerCase())}">
          <span class="stcard-label">${esc(label)}</span>
          <b class="stcard-count">${byStatus[k]}</b>
          <span class="stcard-pct">${orders.length ? Math.round((byStatus[k] / orders.length) * 100) : 0}%</span>
        </a>`).join('')}
      </div>
      ${openElsewhere ? `<p class="small muted stboard-note">Còn <b>${openElsewhere}</b> đơn chưa xong ở thời gian khác. <a href="#dashboard" data-period="all">Xem tất cả</a></p>` : ''}
    </section>
    ${unmapped ? `<div class="card" style="margin-top:16px">⚠️ Có <b>${unmapped}</b> đơn có sản phẩm chưa gắn với kho (giá vốn = 0). Mở đơn để chọn sản phẩm.</div>` : ''}
    <div class="grid two" style="margin-top:16px">
      <div class="card">
        <h3>Theo nền tảng</h3>
        ${Object.keys(PLATFORMS).map((k) => {
          const p = agg.byPlatform[k] || { orders: 0, revenue: 0, profit: 0 };
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between"><span class="chip ${k}">${PLATFORMS[k].label}</span>
              <span class="small muted">${p.orders} đơn · DT ${money(p.revenue)} · <span class="${signCls(p.profit)}">Lãi ${money(p.profit)}</span></span></div>
            <div class="bar" style="margin-top:6px"><i style="width:${(p.revenue / maxRev) * 100}%"></i></div>
          </div>`;
        }).join('')}
      </div>
      <div class="card">
        <h3>Sản phẩm lãi nhiều nhất</h3>
        ${top.length ? `<div class="table-wrap"><table><thead><tr><th>Sản phẩm</th><th class="num">SL</th><th class="num">Doanh thu</th><th class="num">Lãi*</th></tr></thead><tbody>
          ${top.map(([id, r]) => `<tr><td>${esc(product(id)?.name || '?')}</td><td class="num">${r.qty}</td><td class="num">${money(r.revenue)}</td><td class="num ${signCls(r.profit)}">${money(r.profit)}</td></tr>`).join('')}
        </tbody></table></div><p class="small muted">*Lãi gộp: giá bán − giá vốn − đóng gói (chưa trừ phí sàn/ship).</p>` : '<div class="empty">Chưa có đơn hàng</div>'}
      </div>
      <div class="card">
        <h3>Đã hết &amp; sắp hết</h3>
        ${shortRows.length ? `<div class="table-wrap"><table><thead><tr><th>Mặt hàng</th><th>Loại</th><th class="num">Tồn</th></tr></thead><tbody>
          ${shortRows.map((r) => `<tr><td>${r.name}</td><td>${r.kind}</td><td class="num"><b class="neg">${r.n}</b> ${stockBadge(r.n, r.low)}${r.inc ? `<br><span class="small muted">đang về +${r.inc}</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Kho vẫn ổn ✨</div>'}
      </div>
      <div class="card">
        <h3>Chi phí vận hành</h3>
        ${op.items.length ? `<div class="table-wrap"><table><thead><tr><th>Vật tư dùng chung</th><th class="num">SL nhập</th><th class="num">Tiền nhập</th></tr></thead><tbody>
          ${op.items.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}
          <tr><td><b>Tổng</b></td><td></td><td class="num"><b>${money(op.total)}</b></td></tr>
        </tbody></table></div><p class="small muted">Tính theo tiền nhập của hàng đã nhận (theo ngày nhận) trong thời gian đang xem. Hàng đang về chưa tính. Điều chỉnh tồn kho không làm đổi số tiền này.</p>`
        : '<div class="empty">Chưa nhập vật tư dùng chung (băng keo, giấy chống sốc, ghim…) trong thời gian này.</div>'}
      </div>
    </div>`;
}

/* ================= ORDERS ================= */
function filteredOrders() {
  const f = ui.orders;
  const q = normalize(f.q);
  return S.orders
    .filter((o) => (!f.platform || o.platform === f.platform) && (!f.status || o.status === f.status) && (!f.month || (o.date || '').startsWith(f.month)))
    .filter((o) => !q || normalize([o.code, o.customer, o.note, o.tracking, ...(o.items || []).map((l) => itemLabel(l.productId, l.variantId, l.productName))].join(' ')).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
}

function pageOrders() {
  const f = ui.orders;
  const list = filteredOrders();
  const agg = aggregate(costs, list);
  return `
    <div class="page-head">
      <div><h1>Đơn hàng</h1><p>Đơn Shopee nhập từ file Excel của Kênh Người Bán · Đơn Threads/Instagram thêm bằng tay.</p></div>
      <div class="actions">
        <label class="btn ghost">⬆ Nhập file Shopee<input type="file" id="shopee-file" accept=".xlsx,.xls,.csv" hidden></label>
        <button class="btn ghost" data-action="export-orders">⬇ Xuất đơn hàng</button>
        <button class="btn pink" data-action="new-order">＋ Thêm đơn</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" id="order-q" placeholder="Tìm mã đơn, khách, sản phẩm…" value="${esc(f.q)}">
      <select id="order-platform"><option value="">Mọi nền tảng</option>${Object.entries(PLATFORMS).map(([k, v]) => `<option value="${k}" ${f.platform === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <select id="order-status" class="st-select ${f.status ? 'st-' + f.status : ''}"><option value="">Mọi trạng thái</option>${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input type="month" id="order-month" value="${esc(f.month)}">
      <span class="muted small" style="margin-left:auto">${list.length} đơn · DT ${money(agg.revenue)} · Lãi <b class="${signCls(agg.profit)}">${money(agg.profit)}</b></span>
    </div>
    <div class="card table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Ngày</th><th>Nền tảng</th><th>Mã đơn / Khách</th><th>Sản phẩm</th><th class="num">Giá sản phẩm</th><th class="num" title="Phí ship của đơn và ai trả">Phí ship</th><th class="num" title="Giá sản phẩm − giảm giá + phí ship khách trả">Tổng đơn</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${list.map(orderRow).join('')}</tbody>
      </table>` : '<div class="empty">Chưa có đơn nào. Bấm “＋ Thêm đơn” hoặc nhập file Shopee.</div>'}
    </div>`;
}

/* ---------- status menu ----------
   The browser's own <select> list ignores option colours on some browsers, so the status column uses
   a small list of our own, positioned with `fixed` so the scrolling table can't clip it. */
let stPop = null;
function closeStatusMenu(refocus = false) {
  if (!stPop) return;
  const btn = stPop.btn;
  stPop.el.remove();
  btn.setAttribute('aria-expanded', 'false');
  stPop = null;
  if (refocus && btn.isConnected) btn.focus();
}
function openStatusMenu(btn) {
  closeStatusMenu();
  const o = store.get('orders', btn.dataset.stmenu);
  if (!o) return;
  const el = document.createElement('div');
  el.className = 'st-pop';
  el.setAttribute('role', 'listbox');
  el.innerHTML = Object.entries(STATUSES).map(([k, v]) =>
    `<button type="button" role="option" class="st-opt st-${k}" data-status="${k}" aria-selected="${o.status === k}">${esc(v)}${o.status === k ? '<span aria-hidden="true">✓</span>' : ''}</button>`).join('');
  document.body.append(el);
  const r = btn.getBoundingClientRect();
  const h = el.offsetHeight;
  const up = r.bottom + h + 8 > innerHeight && r.top > h + 8;
  el.style.minWidth = `${Math.max(r.width, 150)}px`;
  el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${up ? r.top - h - 6 : r.bottom + 6}px`;
  btn.setAttribute('aria-expanded', 'true');
  stPop = { el, btn, orderId: o.id };
  (el.querySelector('[aria-selected="true"]') || el.firstElementChild).focus();
}
async function setOrderStatus(id, status) {
  const o = store.get('orders', id);
  if (o && o.status !== status) await store.upsert('orders', { ...o, status });
}
document.addEventListener('keydown', (e) => {
  if (!stPop) return;
  if (e.key === 'Escape') { e.preventDefault(); closeStatusMenu(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const opts = [...stPop.el.children];
    const i = opts.indexOf(document.activeElement);
    opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].focus();
  }
});
window.addEventListener('resize', () => closeStatusMenu());
window.addEventListener('scroll', () => closeStatusMenu(), true);

/** Under the revenue of an order: what the customer paid up front and what is left to collect. */
function payInfo(o) {
  const p = orderPayment(costs, o);
  if (!p.tracked) return '';
  if (INACTIVE_STATUSES.has(o.status)) return p.paid > 0 ? `<div class="pay-paid">Đã cọc ${money(p.paid)}</div>` : '';
  const ship = o.shipPayer !== 'shop' && num(o.shipFee) > 0 ? ` (gồm ship ${money(o.shipFee)})` : '';
  const title = esc(`Khách phải trả ${money(p.total)}${ship} · đã thanh toán ${money(p.paid)}`);
  if (o.status === 'done') return `<div class="pay"><span class="chip pay-ok" title="${title}">Đã thu đủ</span></div>`;
  const paidLine = `<div class="pay-paid">${p.paid > 0 ? 'Đã cọc ' + money(p.paid) : 'Chưa cọc'}</div>`;
  if (p.remaining > 0) return `${paidLine}<div class="pay"><span class="chip pay-due" title="${title}">Còn thu ${money(p.remaining)}</span></div>`;
  if (p.remaining < 0) return `<div class="pay"><span class="chip pay-ok" title="${title}">Đã trả đủ</span> <span class="small muted">dư ${money(-p.remaining)}</span></div>`;
  return `<div class="pay"><span class="chip pay-ok" title="${title}">Đã trả đủ</span></div>`;
}

function orderRow(o) {
  const s = orderSummary(costs, o);
  const inactive = INACTIVE_STATUSES.has(o.status);
  const items = (o.items || []).map((l) => {
    const p = product(l.productId);
    if (!p) return `<span class="chip warn">chưa gắn</span> ${esc(l.productName || '')} ×${l.qty}`;
    const v = variantOf(l.productId, l.variantId);
    return `<span class="item">${thumb(v?.image || p.image, v?.name || p.name, 'sm')}<span>${esc(itemLabel(l.productId, l.variantId))} <span class="muted">×${l.qty}</span>${hasVariants(p) && !v ? ' <span class="chip warn">chưa chọn phân loại</span>' : ''}</span></span>`;
  }).join('');
  return `<tr class="${inactive ? 'inactive' : ''}">
    <td>${fmtDate(o.date)}</td>
    <td><span class="chip ${o.platform}">${PLATFORMS[o.platform]?.label || o.platform}</span></td>
    <td><b>${esc(o.code || '—')}</b>${o.card ? ' <span class="chip her" title="Khách yêu cầu thiết kế thiệp">Có thiệp</span>' : ''}<br><span class="muted small">${esc(o.customer || '')}</span></td>
    <td class="small"><div class="items">${items}</div>${o.note?.trim() ? `<div class="order-note"><b>Ghi chú:</b> ${esc(o.note.trim())}</div>` : ''}</td>
    <td class="num">${money(s.gross)}${s.discount ? `<br><span class="small muted">− giảm giá ${money(s.discount)}</span>` : ''}</td>
    <td class="num small">${money(o.shipFee)}<br><span class="muted">${o.shipPayer === 'shop' ? 'Shop chịu' : 'Khách chịu'}</span>${o.tracking ? `<br><button type="button" class="track-btn" data-action="copy-tracking" data-text="${esc(o.tracking)}" title="Bấm để sao chép mã vận đơn">📦 ${esc(o.tracking)}</button>` : ''}</td>
    <td class="num"><b>${money(orderPayment(costs, o).total)}</b>${payInfo(o)}</td>
    <td class="st-cell"><button type="button" class="st-btn st-${o.status}" data-stmenu="${o.id}" aria-haspopup="listbox" aria-expanded="false" aria-label="Trạng thái đơn ${esc(o.code || '')}: ${esc(STATUSES[o.status] || '')}">${esc(STATUSES[o.status] || o.status)}<span aria-hidden="true">▾</span></button></td>
    <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-order" data-id="${o.id}" title="Sửa">✎</button><button class="icon-btn del" data-action="del-order" data-id="${o.id}" title="Xoá">🗑</button></td>
  </tr>`;
}

function blankLine() {
  return { productId: '', variantId: '', qty: 1, price: 0, pack1: '', pack2: '', pack3: '', packEach: false };
}

/**
 * Opens the order form. A draft left by an earlier, unfinished form (closed on purpose, Esc, a reload or
 * a new version of the page) is offered back first, so a half-typed order is never lost.
 */
async function openOrderForm(existing) {
  const key = existing?.id || 'new';
  const draft = getDraft(key);
  let restored = null;
  if (draft) {
    const lines = (draft.order.items || []).filter((l) => l.productId || l.productName).length;
    const when = new Date(draft.savedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    const who = draft.order.customer ? `, khách ${draft.order.customer}` : '';
    const stale = existing && draft.baseUpdatedAt && draft.baseUpdatedAt !== existing.updatedAt;
    const choice = await choose(
      `Có ${existing ? 'bản sửa đơn' : 'đơn'} nhập dở lúc ${when}${who}, ${lines} sản phẩm.${stale ? ' Đơn này đã được sửa ở nơi khác kể từ đó.' : ''} Khôi phục để nhập tiếp?`,
      [{ label: 'Khôi phục', value: 'restore', cls: 'btn' }, { label: existing ? 'Bỏ bản nháp' : 'Bỏ, nhập đơn mới', value: 'drop', cls: 'btn ghost' }],
    );
    if (choice === 'restore') restored = draft.order;
    else if (choice === 'drop') deleteDraft(key);
    else return;
  }
  openOrderFormNow(existing, restored);
}

function openOrderFormNow(existing, restored) {
  const base = existing ? structuredClone(existing) : {
    platform: 'instagram', code: '', date: today(), customer: '', status: 'pending', note: '', card: false,
    shipFee: 0, shipPayer: 'customer', tracking: '', discount: 0, platformFee: 0, paid: null, wrap1: '', wrap2: '', wrap3: '', items: [blankLine()],
  };
  if (!base.items?.length) base.items = [blankLine()];
  const o = restored ? Object.assign(structuredClone(base), structuredClone(restored)) : structuredClone(base);
  if (!o.items?.length) o.items = [blankLine()];
  const key = existing?.id || 'new';
  const baseJson = stable(normalizeOrder(base)); // what "untouched" looks like
  // Shared between the close guard below and the form code inside onMount.
  const ctl = { saving: false, timer: null, snap: null, flush: () => {} };

  const lineHtml = (l, i) => `
    <div class="line" data-line="${i}">
      <div class="field">
        <label class="field">Sản phẩm
          <select data-f="productId">${options(S.products, l.productId, l.productId ? undefined : (l.productName ? `⚠ ${esc(l.productName)}` : '— chọn sản phẩm —'))}</select>
        </label>
        ${hasVariants(product(l.productId)) ? `<select data-f="variantId" aria-label="Phân loại">
          <option value="">— chọn phân loại —</option>
          ${product(l.productId).variants.map((v) => `<option value="${esc(v.id)}" ${v.id === l.variantId ? 'selected' : ''}>${esc(v.name)} · ${money(variantPrice(product(l.productId), v))} (còn ${vStock(l.productId, v.id)})</option>`).join('')}
        </select>` : ''}
      </div>
      <label class="field">SL<input type="number" min="1" data-f="qty" value="${num(l.qty)}"></label>
      <label class="field">Giá bán / cái<input type="number" min="0" step="1000" data-f="price" value="${num(l.price)}"></label>
      <label class="field">Bộ đóng gói nhanh
        <select data-f="preset">${options(S.presets, '', '— tự chọn —')}</select>
      </label>
      ${PACK_SLOTS.map((k, j) => `<label class="field">Dụng cụ đóng gói ${j + 1}<select data-f="${k}">${options(orderPackaging(), l[k], '— không —')}</select></label>`).join('')}
      <button class="icon-btn del" data-remove-line="${i}" title="Xoá dòng" style="margin-bottom:6px">✕</button>
      <div class="meta"></div>
    </div>`;

  const body = `
    <form id="order-form">
      <div class="form-grid">
        <label class="field">Nền tảng
          <select name="platform">${Object.entries(PLATFORMS).map(([k, v]) => `<option value="${k}" ${o.platform === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        </label>
        <label class="field">Mã đơn<input name="code" value="${esc(o.code)}" placeholder="VD: IG-0012"></label>
        <label class="field">Ngày<input type="date" name="date" value="${esc(o.date)}" required></label>
        <label class="field">Khách hàng<input name="customer" value="${esc(o.customer)}" placeholder="Tên / @username"></label>
        <label class="field">Trạng thái
          <select name="status" class="st-select st-${o.status}">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
        <div class="field"><span>Thiệp</span>
          <label class="check cardcheck"><input type="checkbox" name="card" ${o.card ? 'checked' : ''}> Có thiệp cần thiết kế</label>
        </div>
      </div>
      <h3 style="margin:18px 0 8px">Sản phẩm & đóng gói</h3>
      <div id="lines"></div>
      <div id="dup-warn" role="alert" hidden></div>
      <button type="button" class="btn ghost sm" id="add-line">＋ Thêm sản phẩm</button>
      <h3 style="margin:18px 0 4px">Đóng gói cả đơn</h3>
      <p class="small muted" style="margin:0 0 8px">Hộp / túi ngoài chứa tất cả sản phẩm của đơn để ship đi. Mỗi đơn dùng 1 cái, không nhân theo số sản phẩm.</p>
      <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
        ${WRAP_SLOTS.map((k, j) => `<label class="field">Đóng gói cả đơn ${j + 1}<select name="${k}">${options(orderPackaging(), o[k], '— không —')}</select></label>`).join('')}
      </div>
      <h3 style="margin:18px 0 8px">Phí ship & phí khác</h3>
      <div class="form-grid">
        <label class="field" style="grid-column:1/-1">Mã vận đơn<input name="tracking" value="${esc(o.tracking || '')}" placeholder="VD: SPXVN0123456789 (nhập sau khi gửi hàng cũng được)" autocomplete="off"></label>
        <label class="field">Phí ship<input type="number" min="0" step="1000" name="shipFee" value="${num(o.shipFee)}"></label>
        <div class="field"><span>Ai trả ship?</span>
          <div class="seg" id="ship-payer">
            <button type="button" data-v="customer" class="${o.shipPayer !== 'shop' ? 'on' : ''}">Khách chịu</button>
            <button type="button" data-v="shop" class="${o.shipPayer === 'shop' ? 'on' : ''}">Shop chịu</button>
          </div>
        </div>
        <label class="field">Giảm giá / voucher shop<input type="number" min="0" step="1000" name="discount" value="${num(o.discount)}"></label>
        <label class="field">Phí sàn (Shopee…)<input type="number" min="0" step="100" name="platformFee" value="${num(o.platformFee)}"></label>
      </div>
      <h3 style="margin:18px 0 8px">Thanh toán của khách</h3>
      <div class="form-grid">
        <label class="field">Khách đã thanh toán / cọc
          <input type="number" min="0" step="1000" name="paid" value="${o.paid === null || o.paid === undefined || o.paid === '' ? '' : num(o.paid)}" placeholder="Để trống = không theo dõi">
        </label>
        <div class="field"><span>Nhập nhanh</span>
          <div class="chips" id="pay-quick">
            <button type="button" class="chip-btn" data-pay="0">Chưa trả, thu khi nhận</button>
            <button type="button" class="chip-btn" data-pay="50">Cọc 50%</button>
            <button type="button" class="chip-btn" data-pay="100">Đã trả đủ</button>
            <button type="button" class="chip-btn" data-pay="clear">Không theo dõi</button>
          </div>
        </div>
      </div>
      <div id="pay-box"></div>
      <label class="field" style="margin-top:12px">Ghi chú<textarea name="note" rows="2">${esc(o.note)}</textarea></label>
      <div class="summary" id="order-summary"></div>
    </form>`;

  openModal({
    title: existing ? 'Sửa đơn hàng' : 'Thêm đơn hàng',
    body,
    foot: `<span class="form-error" id="order-error" role="alert" hidden></span><button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="save-order">Lưu đơn</button>`,
    // Esc, ✕ and Huỷ all land here: never throw away an order that has been typed into.
    async beforeClose() {
      if (ctl.saving) { toast('Đang lưu đơn, chờ xong rồi đóng nhé'); return false; }
      ctl.flush();
      if (!ctl.snap || stable(ctl.snap()) === baseJson) { deleteDraft(key); return true; }
      const choice = await choose('Đơn này chưa được lưu. Bạn muốn làm gì?', [
        { label: 'Tiếp tục nhập', value: 'stay', cls: 'btn' },
        { label: 'Đóng, giữ bản nháp', value: 'keep', cls: 'btn ghost' },
        { label: 'Bỏ đơn này', value: 'drop', cls: 'btn danger' },
      ]);
      if (choice === 'keep') { markDraftClosed(key); toast('Đã giữ bản nháp. Bấm “＋ Thêm đơn” để nhập tiếp.'); return true; }
      if (choice === 'drop') { deleteDraft(key); return true; }
      return false;
    },
    onMount(m) {
      const form = $('#order-form', m);
      // ---- draft autosave: after every change, and right before the page goes away ----
      const writeDraft = () => {
        ctl.timer = null;
        if (!m.open) return;
        const now = ctl.snap();
        if (stable(now) === baseJson) deleteDraft(key);
        else putDraft(key, { order: now, baseUpdatedAt: existing?.updatedAt || 0, open: true });
      };
      const touchDraft = () => { clearTimeout(ctl.timer); ctl.timer = setTimeout(writeDraft, 300); };
      ctl.flush = () => { if (ctl.timer !== null) { clearTimeout(ctl.timer); writeDraft(); } };
      const onHide = () => { if (document.visibilityState !== 'visible' || document.hidden) ctl.flush(); };
      window.addEventListener('pagehide', ctl.flush);
      document.addEventListener('visibilitychange', onHide);
      m.addEventListener('close', () => {
        clearTimeout(ctl.timer);
        ctl.timer = null;
        window.removeEventListener('pagehide', ctl.flush);
        document.removeEventListener('visibilitychange', onHide);
      }, { once: true });
      const drawLines = () => {
        $('#lines', m).innerHTML = o.items.map(lineHtml).join('');
        o.items.forEach((_, i) => drawMeta(i));
        drawSummary();
      };
      const drawMeta = (i) => {
        const l = o.items[i];
        const c = lineCost(costs, l);
        const el = $(`[data-line="${i}"] .meta`, m);
        el.innerHTML = `
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" data-f="packEach" ${l.packEach ? 'checked' : ''} style="width:auto"> Đóng gói riêng từng cái (×${num(l.qty)})</label>
          <span>Giá vốn SP: <b>${money(c.product)}</b></span>
          <span>Đóng gói: <b>${money(c.packaging)}</b></span>
          <span>Tồn kho: <b>${!l.productId ? '—' : l.variantId ? vStock(l.productId, l.variantId) : num(stock.products[l.productId])}</b></span>
          ${hasVariants(product(l.productId)) && !l.variantId ? '<span class="neg">Chưa chọn phân loại</span>' : ''}
          <span>Lãi dòng: <b class="${signCls(c.profit)}">${money(c.profit)}</b></span>`;
      };
      const drawSummary = () => {
        Object.assign(o, readHeader());
        const s = orderSummary(costs, o);
        $('#order-summary', m).innerHTML = `
          <div><span>Tiền hàng</span><b>${money(s.gross)}</b></div>
          <div><span>Giá vốn SP</span><b>${money(s.product)}</b></div>
          <div><span>Đóng gói</span><b>${money(s.packaging)}</b></div>
          <div><span>Ship shop chịu + phí sàn + giảm giá</span><b>${money(s.ship + s.fee + s.discount)}</b></div>
          <div class="profit ${s.profit < 0 ? 'neg' : ''}"><span>Lợi nhuận</span><b>${money(s.profit)}</b></div>`;
        const pay = orderPayment(costs, o);
        $('#pay-box', m).innerHTML = pay.tracked
          ? `<div class="summary">
              <div><span>Khách phải trả (hàng − giảm giá${o.shipPayer === 'shop' ? '' : ' + ship'})</span><b>${money(pay.total)}</b></div>
              <div><span>Đã thanh toán</span><b>${money(pay.paid)}</b></div>
              <div class="due ${pay.remaining < 0 ? 'over' : pay.remaining === 0 ? 'paid' : ''}"><span>${pay.remaining < 0 ? 'Khách trả dư' : pay.remaining === 0 ? 'Đã trả đủ' : 'Còn lại, thu khi nhận hàng'}</span><b>${money(Math.abs(pay.remaining))}</b></div>
            </div>`
          : '<p class="small muted" style="margin:6px 0 0">Chưa ghi nhận thanh toán. Nhập số tiền khách đã trả (nhập 0 nếu thu hết khi nhận hàng).</p>';
        drawDup();
        touchDraft();
      };
      // New order that repeats a waiting one (same account + product): warn before it is saved twice.
      const dupes = () => (existing ? [] : findDuplicateOrders(S.orders, { ...o, items: o.items }));
      const dupText = (d) => `${d.order.code || 'đơn'} (${fmtDate(d.order.date)}, ${STATUSES[d.order.status]}): ${d.items.map((l) => itemLabel(l.productId, l.variantId, l.productName)).join(', ')}`;
      const drawDup = () => {
        const list = dupes();
        const box = $('#dup-warn', m);
        box.hidden = !list.length;
        box.innerHTML = list.length
          ? `<b>⚠ Có thể trùng đơn.</b> ${esc(o.customer)} đang có đơn chưa xử lý xong với cùng sản phẩm:<ul>${list.map((d) => `<li>${esc(dupText(d))}</li>`).join('')}</ul>`
          : '';
      };
      const readHeader = () => {
        const d = formData(form);
        return {
          platform: d.platform, code: d.code.trim(), date: d.date, customer: d.customer.trim(), status: d.status, note: d.note, card: d.card === 'on',
          wrap1: d.wrap1 || '', wrap2: d.wrap2 || '', wrap3: d.wrap3 || '',
          shipFee: num(d.shipFee), tracking: (d.tracking || '').trim(), discount: num(d.discount), platformFee: num(d.platformFee),
          paid: d.paid === '' || d.paid === undefined ? null : num(d.paid),
          shipPayer: $('#ship-payer .on', m).dataset.v,
        };
      };

      $('#lines', m).addEventListener('change', (e) => {
        const lineEl = e.target.closest('[data-line]');
        if (!lineEl) return;
        const i = +lineEl.dataset.line;
        const l = o.items[i];
        const f = e.target.dataset.f;
        if (f === 'productId') {
          l.productId = e.target.value;
          l.variantId = '';
          const p = product(l.productId);
          if (p) {
            l.price = num(p.salePrice);
            const pr = store.get('presets', p.defaultPreset);
            if (pr) PACK_SLOTS.forEach((k) => (l[k] = pr[k] || ''));
          }
          $(`[data-line="${i}"]`, m).outerHTML = lineHtml(l, i);
          drawMeta(i);
        } else if (f === 'preset') {
          const pr = store.get('presets', e.target.value);
          if (pr) PACK_SLOTS.forEach((k) => (l[k] = pr[k] || ''));
          PACK_SLOTS.forEach((k) => ($(`[data-line="${i}"] [data-f="${k}"]`, m).value = l[k]));
          drawMeta(i);
        } else if (f === 'variantId') {
          l.variantId = e.target.value;
          const p = product(l.productId);
          l.price = variantPrice(p, variantOf(l.productId, l.variantId));
          $(`[data-line="${i}"] [data-f="price"]`, m).value = l.price;
          drawMeta(i);
        } else if (f === 'packEach') {
          l.packEach = e.target.checked;
          drawMeta(i);
        } else if (f) {
          l[f] = PACK_SLOTS.includes(f) ? e.target.value : num(e.target.value);
          drawMeta(i);
        }
        drawSummary();
      });
      $('#lines', m).addEventListener('input', (e) => {
        const f = e.target.dataset.f;
        if (f !== 'qty' && f !== 'price') return;
        const i = +e.target.closest('[data-line]').dataset.line;
        o.items[i][f] = num(e.target.value);
        drawMeta(i);
        drawSummary();
      });
      $('#lines', m).addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-line]');
        if (!btn) return;
        o.items.splice(+btn.dataset.removeLine, 1);
        if (!o.items.length) o.items.push(blankLine());
        drawLines();
      });
      $('#add-line', m).onclick = () => { o.items.push(blankLine()); drawLines(); };
      $('#pay-quick', m).onclick = (e) => {
        const v = e.target.dataset.pay;
        if (v === undefined) return;
        Object.assign(o, readHeader());
        const { total } = orderPayment(costs, o);
        const half = total / 2;
        form.elements.paid.value = v === 'clear' ? '' : v === '0' ? '0' : v === '100' ? String(Math.round(total)) : String(half >= 500 ? Math.round(half / 1000) * 1000 : Math.round(half));
        drawSummary();
      };
      $('#ship-payer', m).onclick = (e) => {
        if (!e.target.dataset.v) return;
        $$('#ship-payer button', m).forEach((b) => b.classList.toggle('on', b === e.target));
        drawSummary();
      };
      form.addEventListener('input', (e) => { if (!e.target.closest('#lines')) drawSummary(); });
      form.addEventListener('change', (e) => {
        if (e.target.name === 'status') e.target.className = `st-select st-${e.target.value}`;
        if (!e.target.closest('#lines')) drawSummary();
      });
      $('[data-close2]', m).onclick = () => m.requestClose();

      const saveBtn = $('#save-order', m);
      const errEl = $('#order-error', m);
      saveBtn.onclick = async () => {
        if (ctl.saving) return;
        if (!form.reportValidity()) return;
        Object.assign(o, readHeader());
        const items = o.items.filter((l) => l.productId || l.productName).map(({ preset, ...l }) => l);
        if (!items.length) return toast('Chọn ít nhất 1 sản phẩm');
        const noVariant = items.find((l) => hasVariants(product(l.productId)) && !l.variantId);
        if (noVariant && !existing) return notify(`Chọn phân loại (màu, size…) cho "${product(noVariant.productId).name}"`);
        const dup = existing ? [] : findDuplicateOrders(S.orders, { ...o, items });
        if (dup.length) {
          const pick = await choose(`Đơn này có thể bị trùng. ${o.customer} đang có đơn chưa xử lý xong với cùng sản phẩm:\n${dup.map((d) => '• ' + dupText(d)).join('\n')}\nVẫn tạo đơn mới?`, [
            { value: 'back', label: 'Quay lại kiểm tra' },
            { value: 'save', label: 'Vẫn tạo đơn', cls: 'btn' },
          ]);
          if (pick !== 'save') return;
        }
        if (!o.code) {
          o.code = `${o.platform.slice(0, 2).toUpperCase()}-${Date.now().toString().slice(-6)}`;
          form.elements.code.value = o.code;
        }
        o.id ||= uid(); // fixed before the first try, so "Thử lại" can never create a second copy
        errEl.hidden = true;
        ctl.saving = true;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Đang lưu…';
        ctl.flush();
        writeDraft(); // the draft holds the final state while the server answers
        try {
          await store.upsert('orders', { ...o, items });
          clearTimeout(ctl.timer);
          deleteDraft(key);
          ctl.saving = false;
          m.close();
          toast('Đã lưu đơn ✨');
        } catch (err) {
          errEl.textContent = `⚠ Chưa lưu được đơn: ${describeError(err).text}. Đơn vẫn nằm trong form và đã được giữ làm bản nháp.`;
          errEl.hidden = false;
          saveBtn.textContent = 'Thử lại';
        } finally {
          ctl.saving = false;
          saveBtn.disabled = false;
        }
      };
      ctl.snap = () => { Object.assign(o, readHeader()); return normalizeOrder(o); };
      drawLines();
      if (restored) writeDraft(); // a restored draft is "on screen" again
    },
  });
}

/* ---------- Shopee import ---------- */
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được thư viện đọc Excel (kiểm tra mạng).'));
    document.head.append(s);
  });
  return window.XLSX;
}

/** Which product (and variant) a Shopee order line is: remembered choice, then SKU, then name. */
function matchListing(line) {
  const none = { productId: '', variantId: '' };
  const guessVariant = (p) => p.variants?.find((v) => normalize(v.name) === normalize(line.variantName))?.id || '';
  const mapped = settings.shopeeMap[listingKey(line)];
  if (mapped) {
    const [productId, variantId = ''] = mapped.split(':');
    if (product(productId) && (!variantId || variantOf(productId, variantId))) return { productId, variantId };
  }
  if (line.sku) {
    const sku = normalize(line.sku);
    for (const p of S.products) {
      const v = p.variants?.find((x) => x.sku && normalize(x.sku) === sku);
      if (v) return { productId: p.id, variantId: v.id };
    }
    const p = S.products.find((x) => x.sku && normalize(x.sku) === sku);
    if (p) return { productId: p.id, variantId: guessVariant(p) };
  }
  const names = [normalize(line.baseName), normalize(line.productName)].filter(Boolean);
  const p = S.products.find((x) => names.includes(normalize(x.name)));
  return p ? { productId: p.id, variantId: guessVariant(p) } : none;
}
const needsMapping = (line) => {
  const m = matchListing(line);
  return !m.productId || (hasVariants(product(m.productId)) && !m.variantId);
};
const listingOptions = (selected) => S.products.map((p) =>
  `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>` +
  (p.variants || []).map((v) => `<option value="${esc(p.id)}:${esc(v.id)}">　↳ ${esc(p.name)} · ${esc(v.name)}</option>`).join('')).join('');

async function importShopeeFile(file) {
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    const parsed = rowsToOrders(rows);
    if (!parsed.length) return toast('File không có đơn hàng nào');

    const unmatched = new Map();
    for (const o of parsed) for (const l of o.items) if (needsMapping(l)) unmatched.set(listingKey(l), l);
    if (unmatched.size) openMappingDialog(parsed, [...unmatched.entries()]);
    else await commitShopee(parsed);
  } catch (e) {
    console.error(e);
    notify('Lỗi đọc file: ' + e.message);
  }
}

function openMappingDialog(parsed, unmatched) {
  openModal({
    title: 'Gắn sản phẩm Shopee với kho',
    body: `<p class="muted">Có ${unmatched.length} sản phẩm trong file chưa biết là hàng nào trong kho. Chọn một lần, lần sau app tự nhớ.</p>
      <div class="table-wrap"><table><thead><tr><th>Sản phẩm trên Shopee</th><th>SKU</th><th>Hàng trong kho</th></tr></thead><tbody>
      ${unmatched.map(([key, l], i) => `<tr><td>${esc(l.productName)}</td><td class="muted">${esc(l.sku)}</td>
        <td><select data-map="${i}"><option value="">— bỏ qua (gắn sau) —</option><option value="__new">＋ Tạo sản phẩm mới</option>${listingOptions(matchListing(l).productId)}</select></td></tr>`).join('')}
      </tbody></table></div>`,
    foot: `<button class="btn" id="map-ok">Tiếp tục nhập ${parsed.length} đơn</button>`,
    onMount(m) {
      $('#map-ok', m).onclick = async () => {
        const map = { ...settings.shopeeMap };
        const newProducts = [];
        $$('[data-map]', m).forEach((sel) => {
          const [key, l] = unmatched[+sel.dataset.map];
          if (sel.value === '__new') {
            const p = { id: uid(), name: l.productName, sku: l.sku, category: 'other', salePrice: Math.round(l.price), baseCost: 0 };
            newProducts.push(p);
            map[key] = p.id;
          } else if (sel.value) map[key] = sel.value;
        });
        if (newProducts.length) await store.upsertMany('products', newProducts);
        await store.upsert('meta', { ...settings, shopeeMap: map });
        derive();
        m.close();
        await commitShopee(parsed);
      };
    },
  });
}

async function commitShopee(parsed) {
  derive();
  const existing = new Map(S.orders.filter((o) => o.platform === 'shopee').map((o) => [o.code, o]));
  let added = 0, updated = 0;
  const docs = parsed.map((o) => {
    const old = existing.get(o.code);
    if (old) {
      updated++;
      // Keep packaging/product choices the shop already made; refresh Shopee-side numbers.
      const fill = (l) => {
        if (l.productId && (l.variantId || !hasVariants(product(l.productId)))) return l;
        const m = matchListing(l);
        return { ...l, productId: l.productId || m.productId, variantId: l.variantId || (l.productId && l.productId !== m.productId ? '' : m.variantId) };
      };
      const items = old.items?.length ? old.items.map(fill) : o.items;
      return { ...old, status: mergeShopeeStatus(old.status, o.status), platformFee: o.platformFee, discount: o.discount, shipFee: o.shipFee, tracking: o.tracking || old.tracking || '', items };
    }
    added++;
    o.items = o.items.map((l) => {
      const { productId, variantId } = matchListing(l);
      const pr = store.get('presets', product(productId)?.defaultPreset);
      return { ...l, productId, variantId, pack1: pr?.pack1 || '', pack2: pr?.pack2 || '', pack3: pr?.pack3 || '', packEach: false };
    });
    return o;
  });
  await store.upsertMany('orders', docs);
  toast(`Shopee: thêm ${added} đơn, cập nhật ${updated} đơn`);
}

/* ================= IMPORTS (nhập hàng) ================= */
function itemOf(imp) {
  return imp.kind === 'packaging' ? pack(imp.itemId) : product(imp.itemId);
}
const importLabel = (imp) => (imp.kind === 'packaging' ? pack(imp.itemId)?.name : itemLabel(imp.itemId, imp.variantId));

const importAmount = (i) => num(i.qty) * num(i.unitCost) + num(i.extraFee);

/** Slips of one product written together (same order/day, status, supplier) show as one row. */
function rowsOf(list) {
  const groups = new Map();
  for (const i of list) {
    const key = [i.kind, i.itemId, i.batchId || '', i.date, i.status || 'received', i.receivedDate || '', i.supplier || ''].join('|');
    if (!groups.has(key)) groups.set(key, { key, rows: [] });
    groups.get(key).rows.push(i);
  }
  return [...groups.values()];
}

function importRow(i, child = false) {
  const item = itemOf(i);
  const totalRow = importAmount(i);
  const got = isReceived(i);
  const v = i.kind === 'packaging' ? null : variantOf(i.itemId, i.variantId);
  return `<tr${child ? ' class="sub-row"' : ''}>
    <td>${child ? '' : `${fmtDate(i.date)}<br>`}${child ? '' : got ? `<span class="chip pay-ok">Đã nhận${i.receivedDate ? ' ' + fmtDate(i.receivedDate).slice(0, 5) : ''}</span>` : '<span class="chip pay-due">Đang về</span>'}</td>
    <td>${child ? `<span class="item sub">${thumb(v?.image || item?.image, v?.name, 'sm')}${esc(v?.name || importLabel(i) || '(đã xoá)')}</span>` : `<span class="item">${i.kind === 'packaging' ? '' : thumb(v?.image || item?.image, item?.name, 'sm')}<a href="javascript:void 0" data-action="edit-item" data-kind="${i.kind}" data-id="${i.itemId}">${esc(importLabel(i) || '(đã xoá)')}</a></span>`}${i.note && !child ? `<br><span class="small muted">${esc(i.note)}</span>` : ''}</td>
    <td>${child ? '' : `<span class="chip ${i.kind === 'packaging' ? (pack(i.itemId)?.shared ? 'friend' : 'backup') : 'him'}">${i.kind === 'packaging' ? (pack(i.itemId)?.shared ? 'Vận hành' : 'Đóng gói') : 'Sản phẩm'}</span>`}</td>
    <td class="num">${num(i.qty)}</td>
    <td class="num">${money(i.unitCost)}</td>
    <td class="num">${money(i.extraFee)}</td>
    <td class="num">${money(num(i.qty) ? totalRow / num(i.qty) : 0)}</td>
    <td class="num"><b>${money(totalRow)}</b></td>
    <td>${child ? '' : esc(i.supplier || '')}</td>
    <td style="white-space:nowrap">${got ? '' : `<button class="btn ghost sm" data-action="receive-import" data-id="${i.id}">Đã nhận</button> `}<button class="icon-btn" data-action="edit-import" data-id="${i.id}" title="Sửa phiếu">✎</button><button class="icon-btn del" data-action="del-import" data-id="${i.id}" title="Xoá">🗑</button></td>
  </tr>`;
}

/** One summary row (product, number of variants, totals) that opens into one row per variant. */
function groupRows(g) {
  const rows = g.rows, first = rows[0], item = itemOf(first);
  const open = !!ui.imports.open[g.key];
  const qty = rows.reduce((n, i) => n + num(i.qty), 0);
  const amount = rows.reduce((n, i) => n + importAmount(i), 0);
  const fee = rows.reduce((n, i) => n + num(i.extraFee), 0);
  const costs = new Set(rows.map((i) => num(i.unitCost)));
  const got = isReceived(first);
  const head = `<tr class="group-row">
    <td>${fmtDate(first.date)}<br>${got ? `<span class="chip pay-ok">Đã nhận${first.receivedDate ? ' ' + fmtDate(first.receivedDate).slice(0, 5) : ''}</span>` : '<span class="chip pay-due">Đang về</span>'}</td>
    <td><span class="item">${first.kind === 'packaging' ? '' : thumb(item?.image, item?.name, 'sm')}<span><a href="javascript:void 0" data-action="edit-item" data-kind="${first.kind}" data-id="${first.itemId}">${esc(item?.name || '(đã xoá)')}</a><br><button class="link-btn" data-action="toggle-import-group" data-key="${esc(g.key)}" aria-expanded="${open}">${open ? '▾ Ẩn chi tiết' : '▸ Xem chi tiết'} · ${rows.length} phân loại</button></span></span></td>
    <td><span class="chip ${first.kind === 'packaging' ? (pack(first.itemId)?.shared ? 'friend' : 'backup') : 'him'}">${first.kind === 'packaging' ? (pack(first.itemId)?.shared ? 'Vận hành' : 'Đóng gói') : 'Sản phẩm'}</span></td>
    <td class="num"><b>${qty}</b></td>
    <td class="num">${costs.size === 1 ? money(first.unitCost) : '—'}</td>
    <td class="num">${money(fee)}</td>
    <td class="num">${money(qty ? amount / qty : 0)}</td>
    <td class="num"><b>${money(amount)}</b></td>
    <td>${esc(first.supplier || '')}</td>
    <td style="white-space:nowrap">${got ? '' : `<button class="btn ghost sm" data-action="receive-group" data-ids="${rows.map((i) => i.id).join(',')}">Đã nhận</button> `}<button class="icon-btn" data-action="edit-group" data-ids="${rows.map((i) => i.id).join(',')}" title="Sửa cả nhóm">✎</button><button class="icon-btn del" data-action="del-import-group" data-ids="${rows.map((i) => i.id).join(',')}" title="Xoá cả nhóm">🗑</button></td>
  </tr>`;
  return head + (open ? rows.map((i) => importRow(i, true)).join('') : '');
}

function pageImports() {
  const f = ui.imports;
  const q = normalize(f.q);
  const amountOf = (i) => num(i.qty) * num(i.unitCost) + num(i.extraFee);
  const list = S.imports
    .filter((i) => !f.kind || i.kind === f.kind)
    .filter((i) => !f.status || (f.status === 'ordered') === !isReceived(i))
    .filter((i) => !q || normalize([importLabel(i), i.supplier, i.note].join(' ')).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
  const gotTotal = list.filter(isReceived).reduce((n, i) => n + amountOf(i), 0);
  const comingRows = list.filter((i) => !isReceived(i));
  const comingTotal = comingRows.reduce((n, i) => n + amountOf(i), 0);
  // Ordered goods are shown by order (batch): slips written together are received together.
  const batches = new Map();
  for (const i of comingRows) {
    const key = i.batchId || i.id;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(i);
  }
  const batchList = [...batches.entries()].sort((a, b) => (a[1][0].date || '').localeCompare(b[1][0].date || ''));

  return `
    <div class="page-head">
      <div><h1>Nhập hàng</h1><p>Đặt hàng xong thì ghi phiếu <b>Đang đặt</b>. Khi hàng về, bấm <b>Đã nhận hàng</b> thì mới cộng vào kho. Giá vốn = trung bình có trọng số của hàng đã nhận (đã gồm phí ship nhập).</p></div>
      <div class="actions"><button class="btn" data-action="new-parcel" title="Một kiện gồm nhiều mặt hàng, chia phí ship chung">📦 Kiện nhiều mặt hàng</button><button class="btn pink" data-action="new-import">＋ Phiếu nhập</button></div>
    </div>
    <div class="toolbar">
      <input type="search" id="import-q" placeholder="Tìm mặt hàng, nhà cung cấp…" value="${esc(f.q)}">
      <div class="seg">${[['', 'Tất cả'], ['product', 'Sản phẩm'], ['packaging', 'Dụng cụ đóng gói']].map(([k, v]) => `<button data-import-kind="${k}" class="${f.kind === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="seg">${[['', 'Mọi tình trạng'], ['ordered', 'Đang về'], ['received', 'Đã nhận']].map(([k, v]) => `<button data-import-status="${k}" class="${f.status === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="muted small" style="margin-left:auto">${list.length} phiếu · Đã nhận ${money(gotTotal)}${comingTotal ? ` · Đang về ${money(comingTotal)}` : ''}</span>
    </div>
    ${batchList.length ? `<section class="card inbound-card" aria-labelledby="inbound-title">
      <div class="inbound-title"><h3 id="inbound-title">Hàng đang về</h3><span class="muted small">${batchList.length} lô · tiền đã đặt ${money(comingTotal)} · chưa tính vào kho, giá vốn và chi phí</span></div>
      <div class="inbound-list">${batchList.map(([key, rows]) => {
        const first = rows[0];
        return `<div class="inbound">
          <div class="inbound-head">
            <div><b>Đặt ngày ${fmtDate(first.date)}</b>${first.supplier ? ` · ${esc(first.supplier)}` : ''}<br><span class="small muted">${rows.length} mặt hàng · ${money(rows.reduce((n, i) => n + amountOf(i), 0))}</span></div>
            <button class="btn sm" data-action="receive-batch" data-batch="${esc(key)}">Đã nhận hàng</button>
          </div>
          <ul class="inbound-items">${rowsOf(rows).map((g) => {
            const f = g.rows[0], it = itemOf(f), q = g.rows.reduce((n, i) => n + num(i.qty), 0);
            const label = `<span class="item">${f.kind === 'packaging' ? '' : thumb(it?.image, it?.name, 'sm')}${esc(it?.name || '(đã xoá)')}</span><b>×${q}</b>`;
            if (g.rows.length === 1) return `<li>${f.variantId ? `<span class="item">${thumb(variantOf(f.itemId, f.variantId)?.image || it?.image, it?.name, 'sm')}${esc(importLabel(f))}</span><b>×${q}</b>` : label}</li>`;
            return `<li class="has-sub"><details><summary>${label}<span class="small muted">${g.rows.length} phân loại</span></summary><ul>${g.rows.map((i) => `<li><span>${esc(variantOf(i.itemId, i.variantId)?.name || importLabel(i))}</span><b>×${num(i.qty)}</b></li>`).join('')}</ul></details></li>`;
          }).join('')}</ul>
          ${first.note ? `<div class="small muted">${esc(first.note)}</div>` : ''}
        </div>`;
      }).join('')}</div>
    </section>` : ''}
    <div class="card table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Ngày đặt</th><th>Mặt hàng</th><th>Loại</th><th class="num">SL</th><th class="num">Giá nhập/đv</th><th class="num">Phí ship/khác</th><th class="num">Vốn/đv</th><th class="num">Thành tiền</th><th>Nhà cung cấp</th><th></th></tr></thead>
        <tbody>${rowsOf(list).map((g) => g.rows.length === 1 ? importRow(g.rows[0]) : groupRows(g)).join('')}</tbody>
      </table>` : '<div class="empty">Chưa có phiếu nhập nào.</div>'}
    </div>`;
}

/**
 * Goods arrived: mark the given ordered slips as received, with the date and the quantity that really came.
 * A line left at 0 stays on its way. Only now does the stock grow.
 */
function openReceiveDialog(ids) {
  const rows = ids.map((id) => store.get('imports', id)).filter((i) => i && !isReceived(i));
  if (!rows.length) return;
  openModal({
    title: rows.length > 1 ? `Nhận hàng: lô ${rows.length} mặt hàng` : 'Nhận hàng',
    wide: false,
    body: `<form id="recv-form" class="form-grid" style="grid-template-columns:1fr" onsubmit="return false">
      <label class="field">Ngày nhận hàng<input type="date" name="date" value="${today()}" required></label>
      <div class="vqty">
        <div class="vqty-head"><span>Mặt hàng</span><span>Đặt</span><span>Thực nhận</span></div>
        ${rows.map((i, k) => `<div class="vqty-row">
          <span class="item">${i.kind === 'packaging' ? '' : thumb(variantOf(i.itemId, i.variantId)?.image || itemOf(i)?.image, itemOf(i)?.name, 'sm')}<b>${esc(importLabel(i) || '(đã xoá)')}</b></span>
          <span class="muted">${num(i.qty)}</span>
          <span class="vqty-in"><input type="number" min="0" step="any" data-rq="${k}" value="${num(i.qty)}" aria-label="Thực nhận ${esc(importLabel(i))}"></span>
        </div>`).join('')}
      </div>
      <label class="check" id="rest-wrap" hidden><input type="checkbox" id="keep-rest"> Phần chưa về vẫn đang chờ (giữ phiếu đang về cho số còn thiếu)</label>
      <div class="summary" id="recv-sum"></div>
      <p class="small muted">Dòng nhập 0 vẫn ở trạng thái đang về. Hàng nhận xong mới cộng vào tồn kho, giá vốn và chi phí. Số lượng ghi là số thực nhận, giá mỗi cái giữ nguyên.</p>
    </form>`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="recv-save">Nhập kho</button>`,
    onMount(m) {
      const qtys = () => $$('[data-rq]', m).map((el) => num(el.value));
      const sync = () => {
        const got = qtys();
        $('#rest-wrap', m).hidden = !rows.some((i, k) => got[k] > 0 && got[k] < num(i.qty));
        const lines = got.filter((n) => n > 0).length;
        const money$ = rows.reduce((n, i, k) => n + (got[k] > 0 ? got[k] * num(i.unitCost) + num(i.extraFee) : 0), 0);
        $('#recv-sum', m).innerHTML = `<div><span>Nhập kho</span><b>${lines} / ${rows.length} mặt hàng</b></div><div><span>Tiền nhập (đã nhận)</span><b>${money(money$)}</b></div>`;
      };
      m.addEventListener('input', sync);
      sync();
      $('[data-close2]', m).onclick = () => m.close();
      $('#recv-save', m).onclick = async () => {
        const date = $('#recv-form', m).elements.date.value || today();
        const got = qtys();
        const keep = $('#keep-rest', m).checked;
        const docs = [];
        let received = 0;
        rows.forEach((i, k) => {
          const n = got[k];
          if (!(n > 0)) return;
          received += 1;
          docs.push({ ...i, status: 'received', receivedDate: date, qty: n });
          if (keep && n < num(i.qty)) {
            docs.push({ kind: i.kind, itemId: i.itemId, variantId: i.variantId || '', date: i.date, qty: num(i.qty) - n, unitCost: i.unitCost, extraFee: 0, supplier: i.supplier || '', note: i.note || '', status: 'ordered', batchId: i.batchId || i.id });
          }
        });
        if (!received) return toast('Nhập số lượng thực nhận cho ít nhất 1 dòng');
        await store.upsertMany('imports', docs);
        m.close();
        toast(`Đã nhập kho ${received} mặt hàng ✓`);
      };
    },
  });
}

/**
 * One parcel with several products/supplies and one shared shipping fee: the fee is split across the
 * lines (by quantity or by goods value) and saved as one import slip per line, in one order (batch).
 */
function openParcelForm() {
  const blank = () => ({ ref: '', variantId: '', qty: 1, unitCost: 0 });
  const lines = [blank(), blank()];
  const st = { status: 'ordered', mode: 'qty' };
  const refOptions = (sel) => `<option value="">— chọn mặt hàng —</option>
    <optgroup label="Sản phẩm">${S.products.map((p) => `<option value="product:${esc(p.id)}" ${sel === 'product:' + p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>
    <optgroup label="Dụng cụ đóng gói">${S.packaging.map((k) => `<option value="packaging:${esc(k.id)}" ${sel === 'packaging:' + k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</optgroup>`;
  const prodOf = (l) => (l.ref.startsWith('product:') ? product(l.ref.slice(8)) : null);

  openModal({
    title: 'Kiện nhiều mặt hàng · chia phí ship chung',
    wide: false,
    body: `<form id="parcel-form" class="form-grid" style="grid-template-columns:1fr 1fr" onsubmit="return false">
      <label class="field">Ngày đặt hàng<input type="date" name="date" value="${today()}" required></label>
      <label class="field">Nhà cung cấp<input name="supplier"></label>
      <div class="field" style="grid-column:1/-1"><span>Tình trạng hàng</span>
        <div class="seg" id="pc-status" style="justify-self:start"><button type="button" data-v="ordered">Đang đặt, chờ hàng về</button><button type="button" data-v="received">Đã nhận, nhập kho</button></div>
      </div>
      <label class="field" id="pc-recv" style="grid-column:1/-1" hidden>Ngày nhận hàng<input type="date" name="receivedDate" value="${today()}"></label>
      <div id="pc-lines" style="grid-column:1/-1"></div>
      <button type="button" class="btn ghost sm" id="pc-add" style="justify-self:start">＋ Thêm mặt hàng</button><span></span>
      <label class="field">Tổng phí ship cả kiện<input type="number" min="0" step="1000" name="fee" value="0"></label>
      <div class="field"><span>Chia phí ship theo</span><div class="seg" id="pc-mode" style="justify-self:start"><button type="button" data-v="qty">Số lượng</button><button type="button" data-v="value">Giá trị hàng</button></div></div>
      <label class="field" style="grid-column:1/-1">Ghi chú<input name="note" placeholder="VD: gộp kiện nặng"></label>
      <div class="summary" style="grid-column:1/-1" id="pc-sum"></div>
    </form>`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="pc-save">Lưu kiện</button>`,
    onMount(m) {
      const form = $('#parcel-form', m);
      const shares = () => allocateShipping(num(form.fee.value), lines, st.mode);
      const drawLines = () => {
        $('#pc-lines', m).innerHTML = `<div class="parcel-lines">${lines.map((l, i) => {
          const p = prodOf(l);
          return `<div class="parcel-line" data-i="${i}">
            <select data-f="ref" aria-label="Mặt hàng">${refOptions(l.ref)}</select>
            ${p && hasVariants(p) ? `<select data-f="variantId" aria-label="Phân loại"><option value="">— phân loại —</option>${p.variants.map((v) => `<option value="${esc(v.id)}" ${v.id === l.variantId ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>` : '<span></span>'}
            <input type="number" min="0" step="any" data-f="qty" value="${num(l.qty)}" aria-label="Số lượng" placeholder="SL">
            <input type="number" min="0" step="100" data-f="unitCost" value="${num(l.unitCost)}" aria-label="Giá nhập" placeholder="Giá nhập">
            <button type="button" class="icon-btn del" data-rm="${i}" title="Bỏ dòng">✕</button>
            <span class="small muted parcel-share" data-share="${i}"></span>
          </div>`;
        }).join('')}</div>`;
      };
      const sync = () => {
        $$('#pc-status button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === st.status));
        $$('#pc-mode button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === st.mode));
        $('#pc-recv', m).hidden = st.status !== 'received';
        const sh = shares();
        let goods = 0, qty = 0;
        lines.forEach((l, i) => {
          goods += num(l.qty) * num(l.unitCost);
          qty += num(l.qty);
          const el = $(`[data-share="${i}"]`, m);
          if (el) el.textContent = num(l.qty) ? `Ship ${money(sh[i])} → vốn ${money(num(l.unitCost) + sh[i] / num(l.qty))}/cái` : '';
        });
        const fee = num(form.fee.value);
        $('#pc-sum', m).innerHTML = `<div><span>Tổng số lượng</span><b>${qty}</b></div><div><span>Tiền hàng</span><b>${money(goods)}</b></div><div><span>Phí ship</span><b>${money(fee)}</b></div><div><span>Tổng tiền</span><b>${money(goods + fee)}</b></div>`;
      };
      drawLines();
      sync();
      m.addEventListener('click', (e) => {
        const seg = e.target.closest('#pc-status [data-v], #pc-mode [data-v]');
        if (seg) { st[seg.parentElement.id === 'pc-mode' ? 'mode' : 'status'] = seg.dataset.v; sync(); }
        if (e.target.id === 'pc-add') { lines.push(blank()); drawLines(); sync(); }
        const rm = e.target.closest('[data-rm]');
        if (rm && lines.length > 1) { lines.splice(+rm.dataset.rm, 1); drawLines(); sync(); }
      });
      m.addEventListener('input', (e) => {
        const row = e.target.closest('.parcel-line');
        if (row) {
          const l = lines[+row.dataset.i], f = e.target.dataset.f;
          l[f] = e.target.value;
          if (f === 'ref') {
            l.variantId = '';
            const p = prodOf(l);
            if (!num(l.unitCost)) l.unitCost = p ? num(costs.product[p.id]) : num(costs.packaging[l.ref.slice(10)]);
            drawLines();
          }
        }
        sync();
      });
      $('[data-close2]', m).onclick = () => m.close();
      $('#pc-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        if (lines.some((l) => !l.ref)) return toast('Chọn mặt hàng cho mọi dòng (hoặc bỏ dòng trống)');
        if (lines.some((l) => !(num(l.qty) > 0))) return toast('Số lượng phải lớn hơn 0');
        if (lines.some((l) => { const p = prodOf(l); return p && hasVariants(p) && !l.variantId; })) return toast('Chọn phân loại cho sản phẩm có phân loại');
        const d = formData(form);
        const sh = shares();
        const batchId = uid();
        const docs = lines.map((l, i) => {
          const at = l.ref.indexOf(':');
          const kind = l.ref.slice(0, at), itemId = l.ref.slice(at + 1);
          return {
            kind, itemId, variantId: kind === 'product' ? l.variantId || '' : '', date: d.date, qty: num(l.qty), unitCost: num(l.unitCost),
            extraFee: sh[i], supplier: (d.supplier || '').trim(), note: (d.note || '').trim(), batchId,
            status: st.status, receivedDate: st.status === 'received' ? (d.receivedDate || today()) : '',
          };
        });
        await store.upsertMany('imports', docs);
        m.close();
        toast(st.status === 'received' ? `Đã nhập kho ${docs.length} dòng, phí ship đã chia 📦` : `Đã ghi kiện ${docs.length} dòng. Hàng về thì bấm “Đã nhận hàng”`);
      };
    },
  });
}

/**
 * Edit all the slips of one product written together (its variants) in one form, like when importing:
 * one quantity per variant, shared date/status/price/supplier, and the shipping fee re-split by quantity.
 */
function openGroupEdit(ids) {
  const slips = ids.map((id) => store.get('imports', id)).filter(Boolean);
  if (!slips.length) return;
  const first = slips[0];
  const p = first.kind === 'packaging' ? null : product(first.itemId);
  const label = (first.kind === 'packaging' ? pack(first.itemId)?.name : p?.name) || '(đã xoá)';
  // one row per variant of the product (also those not in this order yet), plus unclassified slips if any
  const rows = (p && hasVariants(p) ? p.variants.map((v) => ({ variantId: v.id, name: v.name, image: v.image })) : []);
  if (slips.some((i) => !i.variantId) || !rows.length) rows.unshift({ variantId: '', name: rows.length ? 'Chưa phân loại' : 'Tất cả', image: p?.image });
  for (const r of rows) {
    r.slips = slips.filter((i) => (i.variantId || '') === r.variantId);
    r.qty = r.slips.reduce((n, i) => n + num(i.qty), 0);
  }
  const costs0 = new Set(slips.map((i) => num(i.unitCost)));
  const st = { status: first.status || 'received' };
  const feeNow = slips.reduce((n, i) => n + num(i.extraFee), 0);

  openModal({
    title: `Sửa cả nhóm · ${esc(label)}`,
    wide: false,
    body: `<form id="ge-form" class="form-grid" style="grid-template-columns:1fr 1fr" onsubmit="return false">
      <label class="field">Ngày đặt hàng<input type="date" name="date" value="${esc(first.date)}" required></label>
      <label class="field">Nhà cung cấp<input name="supplier" value="${esc(first.supplier || '')}"></label>
      <div class="field" style="grid-column:1/-1"><span>Tình trạng hàng</span>
        <div class="seg" id="ge-status" style="justify-self:start"><button type="button" data-v="ordered">Đang đặt, chờ hàng về</button><button type="button" data-v="received">Đã nhận, nhập kho</button></div>
      </div>
      <label class="field" id="ge-recv" style="grid-column:1/-1">Ngày nhận hàng<input type="date" name="receivedDate" value="${esc(first.receivedDate || today())}"></label>
      <div class="vqty" style="grid-column:1/-1">
        <div class="vqty-head"><span>Phân loại</span><span>Đang có</span><span>Số lượng</span></div>
        ${rows.map((r, i) => `<div class="vqty-row">
          <span class="item">${p ? thumb(r.image, r.name, 'sm') : ''}<b>${esc(r.name)}</b></span>
          <span class="muted">${r.variantId ? vStock(first.itemId, r.variantId) : ''}</span>
          <span class="vqty-in"><input type="number" min="0" step="any" data-gq="${i}" value="${r.qty}" aria-label="Số lượng ${esc(r.name)}"></span>
        </div>`).join('')}
      </div>
      <label class="field">Giá nhập / đơn vị${costs0.size > 1 ? ' (đang khác nhau)' : ''}<input type="number" min="0" step="100" name="unitCost" value="${costs0.size === 1 ? num(first.unitCost) : ''}" placeholder="Giữ giá từng dòng"></label>
      <label class="field">Phí ship / khác (cả nhóm)<input type="number" min="0" step="1000" name="extraFee" value="${feeNow}"></label>
      <label class="field" style="grid-column:1/-1">Ghi chú<input name="note" value="${esc(first.note || '')}"></label>
      <div class="summary" style="grid-column:1/-1" id="ge-sum"></div>
      <p class="small muted" style="grid-column:1/-1;margin:0">Phí ship được chia lại theo số lượng. Đặt số lượng 0 để bỏ phân loại đó khỏi nhóm.</p>
    </form>`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="ge-save">Lưu</button>`,
    onMount(m) {
      const form = $('#ge-form', m);
      const qtys = () => $$('[data-gq]', m).map((el) => num(el.value));
      const sync = () => {
        $$('#ge-status button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === st.status));
        $('#ge-recv', m).hidden = st.status !== 'received';
        const q = qtys();
        const total = q.reduce((a, b) => a + b, 0);
        const goods = form.unitCost.value === ''
          ? rows.reduce((n, r, i) => n + q[i] * num(r.slips[0] ? r.slips[0].unitCost : first.unitCost), 0)
          : total * num(form.unitCost.value);
        const fee = num(form.extraFee.value);
        $('#ge-sum', m).innerHTML = `<div><span>Tổng số lượng</span><b>${total}</b></div><div><span>Thành tiền</span><b>${money(goods + fee)}</b></div><div><span>Vốn / đơn vị</span><b>${money(total ? (goods + fee) / total : 0)}</b></div>`;
      };
      sync();
      m.addEventListener('input', sync);
      $('#ge-status', m).onclick = (e) => { if (e.target.dataset.v) { st.status = e.target.dataset.v; sync(); } };
      $('[data-close2]', m).onclick = () => m.close();
      $('#ge-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const q = qtys();
        if (!q.some((n) => n > 0)) return toast('Cần ít nhất 1 phân loại có số lượng, hoặc xoá cả nhóm');
        const d = formData(form);
        const fees = splitFee(num(d.extraFee), q);
        const common = {
          date: d.date, supplier: (d.supplier || '').trim(), note: (d.note || '').trim(),
          status: st.status, receivedDate: st.status === 'received' ? (d.receivedDate || today()) : '',
        };
        const save = [], drop = [];
        rows.forEach((r, i) => {
          const keep = r.slips[0];
          r.slips.slice(1).forEach((x) => drop.push(x.id)); // duplicates of the same variant merge into one
          if (!(q[i] > 0)) { if (keep) drop.push(keep.id); return; }
          const unitCost = d.unitCost === '' ? num(keep ? keep.unitCost : first.unitCost) : num(d.unitCost);
          if (keep) save.push({ ...keep, ...common, unitCost, qty: q[i], extraFee: fees[i] });
          else save.push({ kind: first.kind, itemId: first.itemId, variantId: r.variantId, batchId: first.batchId, ...common, unitCost, qty: q[i], extraFee: fees[i] });
        });
        await store.upsertMany('imports', save);
        for (const id of drop) await store.remove('imports', id);
        m.close();
        toast('Đã cập nhật cả nhóm ✓');
      };
    },
  });
}

function openImportForm(existing, preset = {}) {
  const imp = existing ? { ...existing, status: existing.status || 'received' } : {
    kind: preset.kind || ui.imports.kind || 'product', itemId: preset.itemId || '', variantId: '',
    date: today(), qty: 1, unitCost: 0, extraFee: 0, supplier: '', note: '', status: 'ordered',
  };
  // New import of a product: one quantity per variant (e.g. each colour of a trophy).
  // rows: [{ variantId, name, image, qty, isNew }]
  let rows = [];
  const loadRows = () => {
    const p = product(imp.itemId);
    rows = imp.kind === 'product' && hasVariants(p)
      ? p.variants.map((v) => ({ variantId: v.id, name: v.name, image: v.image, qty: 0 }))
      : [];
  };
  if (!existing) loadRows();
  const itemOptions = (kind, sel) => options(kind === 'packaging' ? S.packaging : S.products, sel, '— chọn —') + '<option value="__new">＋ Mặt hàng mới…</option>';

  openModal({
    title: existing ? 'Sửa phiếu nhập' : 'Phiếu nhập hàng',
    wide: false,
    body: `<form id="import-form" class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field">Loại<select name="kind" ${existing ? 'disabled' : ''}><option value="product" ${imp.kind !== 'packaging' ? 'selected' : ''}>Sản phẩm</option><option value="packaging" ${imp.kind === 'packaging' ? 'selected' : ''}>Dụng cụ đóng gói</option></select></label>
      <label class="field">Ngày đặt hàng<input type="date" name="date" value="${esc(imp.date)}" required></label>
      <div class="field" style="grid-column:1/-1"><span>Tình trạng hàng</span>
        <div class="seg" id="imp-status" style="justify-self:start">
          <button type="button" data-v="ordered">Đang đặt, chờ hàng về</button>
          <button type="button" data-v="received">Đã nhận, nhập kho</button>
        </div>
        <span class="small muted" id="imp-status-note"></span>
      </div>
      <label class="field" id="recv-wrap" style="grid-column:1/-1">Ngày nhận hàng<input type="date" name="receivedDate" value="${esc(imp.receivedDate || (imp.status === 'received' ? imp.date : today()))}"></label>
      <label class="field" style="grid-column:1/-1">Mặt hàng<select name="itemId" required>${itemOptions(imp.kind, imp.itemId)}</select></label>
      <label class="field" style="grid-column:1/-1" id="new-item-wrap" hidden>Tên mặt hàng mới<input name="newName" placeholder="VD: Cúp pha lê mini"></label>
      <div id="qty-area" style="grid-column:1/-1"></div>
      <label class="field">Giá nhập / đơn vị<input type="number" min="0" step="100" name="unitCost" value="${num(imp.unitCost)}" required></label>
      <label class="field">Phí ship / phí khác (cả lô)<input type="number" min="0" step="1000" name="extraFee" value="${num(imp.extraFee)}"></label>
      <label class="field">Nhà cung cấp<input name="supplier" value="${esc(imp.supplier)}"></label>
      <label class="field">Ghi chú<input name="note" value="${esc(imp.note)}"></label>
      <div class="summary" style="grid-column:1/-1" id="imp-sum"></div>
    </form>`,
    foot: `${existing ? '<button class="btn danger" id="imp-del" style="margin-right:auto">Xoá phiếu</button>' : ''}<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="imp-save">Lưu</button>`,
    onMount(m) {
      const form = $('#import-form', m);
      const stt = { status: imp.status };
      const drawStatus = () => {
        $$('#imp-status button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === stt.status));
        $('#recv-wrap', m).hidden = stt.status !== 'received';
        $('#imp-status-note', m).textContent = stt.status === 'received'
          ? 'Cộng vào tồn kho, giá vốn và chi phí ngay.'
          : 'Chưa tính vào tồn kho, giá vốn và chi phí. Khi hàng về, bấm “Đã nhận hàng” ở trang Nhập hàng.';
      };
      $('#imp-status', m).onclick = (e) => { if (e.target.dataset.v) { stt.status = e.target.dataset.v; drawStatus(); } };
      drawStatus();
      const totalQty = () => (rows.length ? rows.reduce((s, r) => s + num(r.qty), 0) : num(form.qty?.value));

      const drawQty = () => {
        const p = product(imp.itemId);
        const area = $('#qty-area', m);
        if (existing) {
          // Editing one saved row: its quantity, plus which variant it belongs to.
          area.innerHTML = `<div class="form-grid" style="grid-template-columns:1fr 1fr">
            ${imp.kind === 'product' && hasVariants(p) ? `<label class="field">Phân loại<select name="variantId">
              <option value="">— chưa phân loại —</option>${p.variants.map((v) => `<option value="${esc(v.id)}" ${v.id === imp.variantId ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
            </select></label>` : ''}
            <label class="field">Số lượng<input type="number" min="0" name="qty" value="${num(imp.qty)}" required></label>
          </div>`;
          return;
        }
        if (imp.kind === 'packaging' || !rows.length) {
          area.innerHTML = `<div class="form-grid" style="grid-template-columns:1fr 1fr;align-items:end">
            <label class="field">Số lượng<input type="number" min="0" name="qty" value="${num(imp.qty)}" required></label>
            ${imp.kind === 'product' ? '<button type="button" class="btn ghost sm" id="split-variants" style="justify-self:start">＋ Chia theo phân loại (màu, size…)</button>' : ''}
          </div>`;
          return;
        }
        area.innerHTML = `<div class="vqty">
          <div class="vqty-head"><span>Phân loại</span><span>Đang có</span><span>Số lượng nhập</span></div>
          ${rows.map((r, i) => `<div class="vqty-row" data-row="${i}">
            <span class="item">${thumb(r.image, r.isNew ? '+' : r.name, 'sm')}${r.isNew
              ? `<input data-rf="name" value="${esc(r.name)}" placeholder="VD: Màu đỏ" aria-label="Tên phân loại" required>`
              : `<b>${esc(r.name)}</b>`}</span>
            <span class="muted">${r.isNew ? 'mới' : vStock(imp.itemId, r.variantId)}</span>
            <span class="vqty-in"><input type="number" min="0" data-rf="qty" value="${num(r.qty)}" aria-label="Số lượng ${esc(r.name)}">
              ${r.isNew ? `<button type="button" class="icon-btn del" data-rm="${i}" title="Bỏ phân loại này">✕</button>` : ''}</span>
          </div>`).join('')}
          <button type="button" class="btn ghost sm" id="add-variant-row">＋ Thêm phân loại mới</button>
        </div>`;
      };

      const sync = () => {
        const d = formData(form);
        $('#new-item-wrap', m).hidden = d.itemId !== '__new';
        const qty = totalQty();
        const total = qty * num(d.unitCost) + num(d.extraFee);
        $('#imp-sum', m).innerHTML = `<div><span>Tổng số lượng</span><b>${qty}</b></div><div><span>Thành tiền</span><b>${money(total)}</b></div><div><span>Vốn / đơn vị</span><b>${money(qty ? total / qty : 0)}</b></div>`;
      };
      const redraw = () => { drawQty(); sync(); };

      form.kind.onchange = () => {
        imp.kind = form.kind.value;
        imp.itemId = '';
        rows = [];
        form.itemId.innerHTML = itemOptions(imp.kind, '');
        redraw();
      };
      form.itemId.onchange = () => {
        imp.itemId = form.itemId.value === '__new' ? '' : form.itemId.value;
        if (!existing) loadRows();
        redraw();
      };
      $('#qty-area', m).addEventListener('input', (e) => {
        const rowEl = e.target.closest('[data-row]');
        if (rowEl) rows[+rowEl.dataset.row][e.target.dataset.rf] = e.target.dataset.rf === 'qty' ? num(e.target.value) : e.target.value;
        if (e.target.name === 'qty') imp.qty = num(e.target.value);
        sync();
      });
      $('#qty-area', m).addEventListener('click', (e) => {
        if (e.target.id === 'split-variants' || e.target.id === 'add-variant-row') {
          rows.push({ name: '', qty: 0, isNew: true });
          redraw();
          $(`[data-row="${rows.length - 1}"] [data-rf="name"]`, m)?.focus();
        }
        const rm = e.target.closest('[data-rm]');
        if (rm) { rows.splice(+rm.dataset.rm, 1); redraw(); }
      });
      form.addEventListener('input', (e) => { if (!e.target.closest('#qty-area')) sync(); });
      form.addEventListener('change', sync);
      redraw();
      $('[data-close2]', m).onclick = () => m.close();
      if (existing) $('#imp-del', m).onclick = async () => { if (await ask('Xoá phiếu nhập này?')) { await store.remove('imports', existing.id); m.close(); } };

      $('#imp-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const d = formData(form);
        const kind = existing ? imp.kind : d.kind;
        const common = {
          kind, date: d.date, unitCost: num(d.unitCost), supplier: d.supplier.trim(), note: d.note.trim(),
          status: stt.status, receivedDate: stt.status === 'received' ? (d.receivedDate || today()) : '',
        };

        if (existing) {
          await store.upsert('imports', { ...imp, ...common, variantId: d.variantId || '', qty: num(d.qty), extraFee: num(d.extraFee) });
          m.close();
          return toast(stt.status === 'received' ? 'Đã cập nhật phiếu nhập' : 'Đã cập nhật phiếu (đang chờ hàng về)');
        }

        const filled = rows.filter((r) => num(r.qty) > 0);
        if (rows.length && !filled.length) return toast('Nhập số lượng cho ít nhất 1 phân loại');
        if (rows.some((r) => r.isNew && !r.name.trim())) return toast('Đặt tên cho phân loại mới');

        // Create the product, or add the new variants to it.
        let itemId = d.itemId;
        const coll = kind === 'packaging' ? 'packaging' : 'products';
        const newVariants = rows.filter((r) => r.isNew).map((r) => {
          r.variantId = uid();
          return { id: r.variantId, name: r.name.trim(), sku: '', image: '', adjust: 0 };
        });
        if (itemId === '__new') {
          if (!d.newName.trim()) return toast('Nhập tên mặt hàng mới');
          const item = await store.upsert(coll, {
            name: d.newName.trim(),
            ...(coll === 'products' ? { category: 'other', salePrice: 0, variants: newVariants } : {}),
          });
          itemId = item.id;
        } else if (newVariants.length) {
          const p = product(itemId);
          await store.upsert('products', { ...p, variants: [...(p.variants || []), ...newVariants] });
        }

        if (filled.length) {
          const fees = splitFee(num(d.extraFee), filled.map((r) => r.qty));
          const batchId = uid(); // one order: its lines are received together
          await store.upsertMany('imports', filled.map((r, i) => ({ ...common, batchId, itemId, variantId: r.variantId, qty: num(r.qty), extraFee: fees[i] })));
        } else {
          await store.upsert('imports', { ...common, batchId: uid(), itemId, variantId: '', qty: num(d.qty), extraFee: num(d.extraFee) });
        }
        m.close();
        toast(stt.status === 'ordered' ? 'Đã ghi phiếu đặt hàng. Hàng về thì bấm “Đã nhận hàng”.' : (filled.length > 1 ? `Đã nhập kho ${filled.length} phân loại 📦` : 'Đã nhập kho 📦'));
      };
    },
  });
}

/* ================= PRODUCTS ================= */
/** Pastel tile colour for a product without a photo, stable per product. */
const TILE_TONES = ['her', 'him', 'friend', 'backup'];
const toneOf = (p) => TILE_TONES[[...(p.id || p.name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE_TONES.length];
/** Sale price of one variant: its own price, or the product's when not set. */
const variantPrice = (p, v) => (v && num(v.price) > 0 ? num(v.price) : num(p.salePrice));
/** Flag on a product tile: "Đã hết" when nothing is left, "Hết N loại" when only some variants are out, "Sắp hết" when low. */
function tileFlag(p) {
  const low = lowOf(p);
  if (!hasVariants(p)) {
    const st = stockState(stock.products[p.id], low);
    return st === 'out' ? '<span class="chip out ptile-flag">Đã hết</span>' : st === 'low' ? '<span class="chip warn ptile-flag">Sắp hết</span>' : '';
  }
  const ns = p.variants.map((v) => vStock(p.id, v.id));
  const out = ns.filter((n) => stockState(n, low) === 'out').length;
  if (out === ns.length) return '<span class="chip out ptile-flag">Đã hết</span>';
  if (out) return `<span class="chip out ptile-flag">Hết ${out} loại</span>`;
  return ns.some((n) => stockState(n, low) === 'low') ? '<span class="chip warn ptile-flag">Sắp hết</span>' : '';
}

function pageProducts() {
  const q = normalize(ui.products.q);
  const list = S.products.filter((p) => !q || normalize([p.name, p.sku, ...(p.variants || []).flatMap((v) => [v.name, v.sku])].join(' ')).includes(q));

  const tile = (p) => `<button class="ptile tone-${toneOf(p)}" data-action="open-product" data-id="${p.id}">
      <span class="ptile-img">${thumb(p.image, p.name, 'xl')}</span>
      <span class="ptile-name">${esc(p.name)}</span>
      ${tileFlag(p)}
    </button>`;

  return `
    <div class="page-head">
      <div><h1>Sản phẩm</h1><p>Bấm vào sản phẩm để xem các phân loại, số lượng tồn và giá bán.</p></div>
      <div class="actions"><button class="btn pink" data-action="new-product">＋ Sản phẩm</button></div>
    </div>
    <div class="toolbar">
      <input type="search" id="product-q" placeholder="Tìm tên, SKU, màu…" value="${esc(ui.products.q)}">
      <span class="muted small" style="margin-left:auto">${list.length} sản phẩm</span>
    </div>
    ${list.length ? `<div class="ptiles">${list.map(tile).join('')}</div>`
      : `<div class="card empty">${S.products.length ? 'Không có sản phẩm khớp tìm kiếm.' : 'Chưa có sản phẩm. Bấm “＋ Sản phẩm” để thêm, kèm ảnh và các phân loại.'}</div>`}
    ${S.products.length && S.presets.length ? `
    <div class="card" style="margin-top:20px">
      <h3>Bảng giá thành theo cách đóng gói</h3>
      <p class="small muted" style="margin-top:-6px">Giá vốn SP + chi phí bộ đóng gói (1 cái). Dùng để chọn giá bán cho từng kiểu gói quà.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Sản phẩm</th><th class="num">Không gói</th>${S.presets.map((pr) => `<th class="num">${esc(pr.name)}<br><span class="small muted">+${money(presetCost(pr))}</span></th>`).join('')}</tr></thead>
        <tbody>${S.products.map((p) => `<tr><td><span class="item">${thumb(p.image, p.name, 'sm')}${esc(p.name)}</span></td><td class="num">${money(costs.product[p.id])}</td>${S.presets.map((pr) => {
          const c = num(costs.product[p.id]) + presetCost(pr);
          return `<td class="num" ${pr.id === p.defaultPreset ? 'style="background:var(--blue-soft);font-weight:700"' : ''}>${money(c)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}`;
}

/** Product detail: its variants with stock and sale price, plus actions. */
function openProductDetail(id) {
  const p = product(id);
  if (!p) return;
  const fullCost = num(costs.product[p.id]) + presetCost(store.get('presets', p.defaultPreset));
  const total = num(stock.products[p.id]);
  const rows = hasVariants(p)
    ? p.variants.map((v) => ({ v, image: v.image, name: v.name, sku: v.sku, n: vStock(p.id, v.id), inc: num(stock.incoming.variants[variantKey(p.id, v.id)]), price: variantPrice(p, v) }))
    : [{ image: p.image, name: 'Tất cả', sku: p.sku, n: total, inc: num(stock.incoming.products[p.id]), price: num(p.salePrice) }];
  const unassigned = hasVariants(p) ? total - rows.reduce((s, r) => s + r.n, 0) : 0;

  openModal({
    title: esc(p.name),
    wide: false,
    body: `<div class="pdetail">
      <div class="pdetail-head">
        <span class="pdetail-img tone-${toneOf(p)}">${thumb(p.image, p.name, 'xl')}</span>
        <dl class="pdetail-facts">
          <div><dt>Tổng tồn kho</dt><dd>${total}</dd></div>
          <div><dt>Giá thành / cái</dt><dd>${money(fullCost)}</dd></div>
          ${p.sku ? `<div><dt>SKU</dt><dd class="small">${esc(p.sku)}</dd></div>` : ''}
        </dl>
      </div>
      <div class="vcards">
        ${rows.map((r) => {
          const profit = r.price - fullCost;
          const state = stockState(r.n, lowOf(p));
          return `<div class="vcard ${state !== 'ok' ? 'low' : ''}">
            ${thumb(r.image, r.name, '')}
            <div class="vcard-name"><b>${esc(r.name)}</b>${r.sku ? `<span class="muted small">${esc(r.sku)}</span>` : ''}</div>
            <div class="vcard-num"><span>Số lượng</span><b>${r.n}</b>${stockBadge(r.n, lowOf(p))}${r.inc ? `<span class="small muted">đang về +${r.inc}</span>` : ''}</div>
            <div class="vcard-num"><span>Giá bán</span><b>${money(r.price)}</b><span class="small ${signCls(profit)}">lãi ${money(profit)}</span></div>
          </div>`;
        }).join('')}
        ${unassigned ? `<p class="small muted">Còn ${unassigned} cái nhập trước khi chia phân loại (chưa gắn màu). Sửa phiếu nhập để gắn màu.</p>` : ''}
      </div>
      ${p.note ? `<p class="small muted">${esc(p.note)}</p>` : ''}
    </div>`,
    foot: `<button class="btn danger" id="pd-del" style="margin-right:auto">Xoá</button>
      <button class="btn ghost" id="pd-edit">✎ Sửa</button>
      <button class="btn" id="pd-import">＋ Nhập hàng</button>`,
    onMount(m) {
      $('#pd-edit', m).onclick = () => openProductForm(p);
      $('#pd-import', m).onclick = () => openImportForm(undefined, { kind: 'product', itemId: p.id });
      $('#pd-del', m).onclick = async () => {
        if (S.orders.some((o) => o.items?.some((l) => l.productId === p.id))) return notify('Sản phẩm đã có trong đơn hàng, không xoá được.');
        if (await ask(`Xoá sản phẩm "${p.name}"?`)) { await store.remove('products', p.id); m.close(); }
      };
    },
  });
}

function openProductForm(existing) {
  const p = existing ? structuredClone(existing) : { name: '', sku: '', category: 'her', salePrice: 0, baseCost: 0, defaultPreset: '', lowStock: '', adjust: 0, note: '', image: '', variants: [] };
  p.variants ||= [];
  const imports = existing ? S.imports.filter((i) => i.kind !== 'packaging' && i.itemId === p.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];
  // A variant that already has imports or orders keeps its stock history, so it can be renamed but not removed.
  const used = (vid) => S.imports.some((i) => i.itemId === p.id && i.variantId === vid)
    || S.orders.some((o) => o.items?.some((l) => l.productId === p.id && l.variantId === vid));

  openModal({
    title: existing ? 'Sửa sản phẩm' : 'Thêm sản phẩm',
    body: `<form id="product-form">
      <div class="pform">
        <div class="pform-img">
          <label class="imgpick" id="p-img-pick" title="Chọn ảnh sản phẩm">
            <span id="p-img-preview">${thumb(p.image, p.name || '+', 'xl')}</span>
            <input type="file" accept="image/*" id="p-img" hidden>
          </label>
          <div class="imgpick-actions">
            <label class="btn ghost sm" for="p-img">${p.image ? 'Đổi ảnh' : 'Thêm ảnh'}</label>
            <button type="button" class="btn ghost sm" id="p-img-clear" ${p.image ? '' : 'hidden'}>Bỏ ảnh</button>
          </div>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <label class="field" style="grid-column:1/-1">Tên sản phẩm<input name="name" value="${esc(p.name)}" required placeholder="VD: Cúp pha lê mini"></label>
          <label class="field" style="grid-column:1/-1">SKU (trùng SKU trên Shopee)<input name="sku" value="${esc(p.sku)}"></label>
          <label class="field">Giá bán<input type="number" min="0" step="1000" name="salePrice" value="${num(p.salePrice)}" title="Giá chung; mỗi phân loại có thể đặt giá riêng bên dưới"></label>
          <label class="field">Giá gốc (khi chưa có phiếu nhập)<input type="number" min="0" step="100" name="baseCost" value="${num(p.baseCost)}"></label>
          <label class="field" style="grid-column:1/-1">Bộ đóng gói mặc định<select name="defaultPreset">${options(S.presets, p.defaultPreset, '— không —')}</select></label>
          <label class="field">Cảnh báo khi tồn ≤<input type="number" min="0" name="lowStock" value="${esc(p.lowStock ?? '')}" placeholder="${settings.lowStock}"></label>
          <label class="field" id="adjust-wrap">Điều chỉnh tồn kho (±)<input type="number" name="adjust" value="${num(p.adjust)}" title="Dùng cho hàng hỏng, kiểm kê lệch…"></label>
        </div>
      </div>

      <div class="vsection">
        <div class="vsection-head">
          <h3>Phân loại</h3>
          <span class="muted small">Màu, size, mẫu… Mỗi phân loại có ảnh, giá bán và tồn kho riêng. VD: Cúp → Đỏ, Xanh, Vàng. Để trống giá bán thì dùng giá chung.</span>
        </div>
        <div id="variants"></div>
        <button type="button" class="btn ghost sm" id="add-variant">＋ Thêm phân loại</button>
      </div>

      <label class="field" style="margin-top:14px">Ghi chú<input name="note" value="${esc(p.note)}"></label>
    </form>
    ${existing ? `<h3 style="margin:16px 0 8px">Lịch sử nhập (${imports.length})</h3>
      ${imports.length ? `<div class="table-wrap"><table><tbody>${imports.map((i) => `<tr><td>${fmtDate(i.date)}${isReceived(i) ? '' : ' <span class="chip pay-due">đang về</span>'}</td><td>${esc(variantOf(p.id, i.variantId)?.name || '')}</td><td class="num">${num(i.qty)} cái</td><td class="num">${money(i.unitCost)}/cái</td><td><button class="icon-btn" data-edit-imp="${i.id}">✎</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Chưa nhập lần nào.</p>'}
      <p class="small">Giá vốn TB: <b>${money(costs.product[p.id])}</b> · Tồn: <b>${num(stock.products[p.id])}</b></p>` : ''}`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="p-save">Lưu</button>`,
    onMount(m) {
      const form = $('#product-form', m);
      let busy = 0;

      const drawVariants = () => {
        $('#adjust-wrap', m).hidden = p.variants.length > 0;
        $('#variants', m).innerHTML = p.variants.length ? `<div class="vedit">
          <div class="vedit-head"><span>Ảnh</span><span>Tên phân loại</span><span>SKU</span><span>Giá bán</span><span>Tồn</span><span title="Điều chỉnh tồn kho (±)">Chỉnh ±</span><span></span></div>
          ${p.variants.map((v, i) => `<div class="vedit-row" data-v="${i}">
            <label class="imgpick sm" title="Chọn ảnh cho ${esc(v.name || 'phân loại')}">${thumb(v.image, v.name || '+', 'sm')}<input type="file" accept="image/*" data-vimg="${i}" hidden></label>
            <input data-vf="name" value="${esc(v.name)}" placeholder="VD: Đỏ" aria-label="Tên phân loại" required>
            <input data-vf="sku" value="${esc(v.sku || '')}" placeholder="SKU Shopee" aria-label="SKU">
            <input type="number" min="0" step="1000" data-vf="price" value="${num(v.price) || ''}" placeholder="${num(form.salePrice.value) || 'giá chung'}" aria-label="Giá bán ${esc(v.name)}">
            <b class="vstock">${existing ? vStock(p.id, v.id) : 0}</b>
            <input type="number" data-vf="adjust" value="${num(v.adjust)}" aria-label="Điều chỉnh tồn">
            <button type="button" class="icon-btn del" data-vdel="${i}" title="${used(v.id) ? 'Đã có nhập/đơn — không xoá được' : 'Xoá phân loại'}">✕</button>
          </div>`).join('')}
        </div>` : '<p class="muted small">Chưa có phân loại. Sản phẩm sẽ tính tồn kho chung.</p>';
      };
      const setImage = (ref) => {
        p.image = ref;
        $('#p-img-preview', m).innerHTML = thumb(ref, form.name.value || '+', 'xl');
        $('#p-img-clear', m).hidden = !ref;
      };
      const upload = async (file, done) => {
        busy++;
        $('#p-save', m).disabled = true;
        try {
          done(await saveImage(file));
        } catch (err) {
          notify('Không tải được ảnh: ' + (err.message || err.code));
        } finally {
          busy--;
          $('#p-save', m).disabled = busy > 0;
        }
      };

      $('#p-img', m).onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f, setImage); };
      $('#p-img-clear', m).onclick = () => setImage('');
      $('#variants', m).addEventListener('input', (e) => {
        const row = e.target.closest('[data-v]');
        if (!row || !e.target.dataset.vf) return;
        const v = p.variants[+row.dataset.v];
        const f = e.target.dataset.vf;
        v[f] = f === 'adjust' || f === 'price' ? num(e.target.value) : e.target.value;
      });
      $('#variants', m).addEventListener('change', (e) => {
        const i = e.target.dataset.vimg;
        if (i === undefined || !e.target.files[0]) return;
        const file = e.target.files[0];
        upload(file, (ref) => { p.variants[+i].image = ref; drawVariants(); });
      });
      $('#variants', m).addEventListener('click', (e) => {
        const del = e.target.closest('[data-vdel]');
        if (!del) return;
        const v = p.variants[+del.dataset.vdel];
        if (used(v.id)) return notify(`"${v.name}" đã có phiếu nhập hoặc đơn hàng nên không xoá được. Bạn có thể đổi tên.`);
        p.variants.splice(+del.dataset.vdel, 1);
        drawVariants();
      });
      $('#add-variant', m).onclick = () => {
        p.variants.push({ id: uid(), name: '', sku: '', image: '', adjust: 0, price: 0 });
        drawVariants();
        $(`[data-v="${p.variants.length - 1}"] [data-vf="name"]`, m).focus();
      };
      $('[data-close2]', m).onclick = () => m.close();
      $$('[data-edit-imp]', m).forEach((b) => (b.onclick = () => openImportForm(store.get('imports', b.dataset.editImp))));
      $('#p-save', m).onclick = async () => {
        if (busy) return toast('Đang tải ảnh, chờ chút…');
        if (!form.reportValidity()) return;
        const d = formData(form);
        await store.upsert('products', {
          ...p, name: d.name.trim(), category: p.category || 'other', sku: d.sku.trim(), salePrice: num(d.salePrice), baseCost: num(d.baseCost),
          defaultPreset: d.defaultPreset, lowStock: d.lowStock === '' ? null : num(d.lowStock),
          adjust: p.variants.length ? num(p.adjust) : num(d.adjust), note: d.note.trim(),
          variants: p.variants.map((v) => ({ ...v, name: v.name.trim(), sku: (v.sku || '').trim(), price: num(v.price) })),
        });
        m.close();
        toast('Đã lưu sản phẩm');
      };
      drawVariants();
    },
  });
}

/* ================= PACKAGING ================= */
function pagePackaging() {
  const parts = S.packaging.filter((k) => !k.shared);
  const supplies = S.packaging.filter((k) => k.shared);
  const spent = (id) => S.imports.filter((x) => x.kind === 'packaging' && x.itemId === id && isReceived(x)).reduce((n, x) => n + num(x.qty) * num(x.unitCost) + num(x.extraFee), 0);
  const bought = (id) => S.imports.filter((x) => x.kind === 'packaging' && x.itemId === id && isReceived(x)).reduce((n, x) => n + num(x.qty), 0);
  return `
    <div class="page-head">
      <div><h1>Đóng gói</h1><p>Dụng cụ đóng gói chọn trong đơn (hộp, túi, ruy băng…), bộ đóng gói dùng nhanh, và vật tư dùng chung không chọn trong đơn (băng keo, giấy chống sốc, ghim…).</p></div>
      <div class="actions"><button class="btn ghost" data-action="new-pack">＋ Dụng cụ</button><button class="btn ghost" data-action="new-shared">＋ Vật tư dùng chung</button><button class="btn pink" data-action="new-preset">＋ Bộ đóng gói</button></div>
    </div>
    <div class="grid two">
      <div class="card table-wrap pk-parts">
        <h3>Dụng cụ đóng gói</h3>
        <p class="small muted" style="margin-top:-6px">Nhập số lượng ước chừng cũng được. Bấm <b>Chỉnh tồn</b> để sửa lại cho khớp thực tế. Giá nhập và tiền nhập hàng không đổi.</p>
        ${parts.length ? `<table><thead><tr><th>Tên</th><th class="num">Giá TB / cái</th><th class="num">Tồn</th><th></th></tr></thead><tbody>
          ${parts.map((k) => {
            const st = num(stock.packaging[k.id]);
            const adj = num(k.adjust);
            return `<tr><td>${esc(k.name)}</td><td class="num">${money(costs.packaging[k.id])}</td><td class="num ${st <= lowOf(k) ? 'neg' : ''}"><b>${st}</b> ${stockBadge(st, lowOf(k))}${stock.incoming.packaging[k.id] ? `<br><span class="small muted">đang về +${num(stock.incoming.packaging[k.id])}</span>` : ''}${adj ? `<br><span class="small muted" title="Đã chỉnh tay so với sổ nhập và đơn hàng">đã chỉnh ${adj > 0 ? '+' : ''}${adj}</span>` : ''}</td>
            <td style="white-space:nowrap"><button class="btn ghost sm" data-action="adjust-pack" data-id="${k.id}">Chỉnh tồn</button> <button class="icon-btn" data-action="edit-item" data-kind="packaging" data-id="${k.id}">✎</button><button class="icon-btn del" data-action="del-pack" data-id="${k.id}">🗑</button></td></tr>`;
          }).join('')}</tbody></table>` : '<div class="empty">Chưa có dụng cụ nào.</div>'}
      </div>
      <div class="card table-wrap">
        <h3>Bộ đóng gói</h3>
        ${S.presets.length ? `<table><thead><tr><th>Tên bộ</th><th>Gồm</th><th class="num">Chi phí</th><th></th></tr></thead><tbody>
          ${S.presets.map((pr) => `<tr><td><b>${esc(pr.name)}</b></td><td class="small">${PACK_SLOTS.map((k) => pack(pr[k])).filter((x) => x && !x.shared).map((x) => esc(x.name)).join(' + ') || '—'}</td><td class="num">${money(presetCost(pr))}</td>
            <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-preset" data-id="${pr.id}">✎</button><button class="icon-btn del" data-action="del-preset" data-id="${pr.id}">🗑</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Tạo bộ đóng gói (VD: “Hộp quà cao cấp” = hộp + giấy lót + ruy băng) để chọn nhanh khi lên đơn.</div>'}
      </div>
      <div class="card" style="grid-column:1/-1">
        <h3>Vật tư dùng chung</h3>
        <p class="small muted" style="margin-top:-6px">Tiền nhập tính hết vào <b>chi phí vận hành</b>. Không chọn trong đơn. Bấm <b>Ghi đã dùng</b> (hoặc sửa ô điều chỉnh tồn kho) để biết đã xài bao nhiêu, số tiền chi phí không đổi.</p>
        ${supplies.length ? `<div class="table-wrap"><table><thead><tr><th>Vật tư</th><th class="num">Đã nhập</th><th class="num">Đã dùng</th><th class="num">Còn</th><th class="num">Tiền đã nhập</th><th></th></tr></thead><tbody>
          ${supplies.map((k) => {
            const st = num(stock.packaging[k.id]);
            const used = Math.max(0, -num(k.adjust));
            return `<tr><td><b>${esc(k.name)}</b></td><td class="num">${bought(k.id)}</td><td class="num">${used}</td>
              <td class="num ${st <= lowOf(k) ? 'neg' : ''}"><b>${st}</b> ${stockBadge(st, lowOf(k))}${stock.incoming.packaging[k.id] ? `<br><span class="small muted">đang về +${num(stock.incoming.packaging[k.id])}</span>` : ''}</td><td class="num">${money(spent(k.id))}</td>
              <td style="white-space:nowrap"><button class="btn ghost sm" data-action="use-pack" data-id="${k.id}">Ghi đã dùng</button>
                <button class="icon-btn" data-action="edit-item" data-kind="packaging" data-id="${k.id}" title="Sửa">✎</button><button class="icon-btn del" data-action="del-pack" data-id="${k.id}" title="Xoá">🗑</button></td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">Chưa có vật tư dùng chung. Bấm “＋ Vật tư dùng chung” để thêm băng keo, giấy chống sốc, ghim bấm…</div>'}
      </div>
    </div>`;
}

/**
 * Fix the stock of a packaging item (tape, glass bags…): count what is really left, or note what was
 * used up. Only the stock adjustment changes; import slips, prices and operating cost never do, so an
 * estimated quantity on a slip can be corrected here without touching any money figure.
 */
function openStockDialog(k, mode = 'count') {
  const stockNow = num(stock.packaging[k.id]);
  const usedNow = Math.max(0, -num(k.adjust));
  const st = { mode, n: mode === 'count' ? stockNow : 1 };
  openModal({
    title: `Chỉnh tồn kho: ${esc(k.name)}`,
    wide: false,
    body: `<form id="stock-form" class="form-grid" style="grid-template-columns:1fr" onsubmit="return false">
      <div class="seg" id="st-mode" style="justify-self:start">
        <button type="button" data-v="count">Đếm lại số còn</button>
        <button type="button" data-v="used">Ghi đã dùng / hao</button>
      </div>
      <label class="field"><span id="st-label"></span><input type="number" id="st-n" min="0" step="any" required></label>
      <div class="summary" id="st-sum"></div>
      <p class="small muted">Chỉ sửa số lượng tồn kho. Giá nhập, giá trung bình mỗi cái và tiền nhập hàng giữ nguyên.</p>
    </form>`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="st-save">Lưu</button>`,
    onMount(m) {
      const result = () => (st.mode === 'count' ? num(st.n) : stockNow - num(st.n));
      const draw = () => {
        $$('#st-mode button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === st.mode));
        $('#st-label', m).textContent = st.mode === 'count' ? 'Số còn thực tế (đếm được)' : 'Đã dùng / hao thêm bao nhiêu?';
        const diff = result() - stockNow;
        $('#st-sum', m).innerHTML = `<div><span>Tồn kho</span><b>${stockNow} → ${result()}</b></div>`
          + `<div><span>Chênh lệch</span><b class="${signCls(diff)}">${diff > 0 ? '+' : ''}${diff}</b></div>`
          + (k.shared ? `<div><span>Đã dùng</span><b>${usedNow} → ${Math.max(0, usedNow - diff)}</b></div>` : '');
      };
      $('#st-n', m).value = st.n;
      $('#st-n', m).addEventListener('input', (e) => { st.n = e.target.value; draw(); });
      $('#st-mode', m).onclick = (e) => {
        const v = e.target.dataset.v;
        if (!v || v === st.mode) return;
        st.mode = v;
        st.n = v === 'count' ? stockNow : 1;
        $('#st-n', m).value = st.n;
        draw();
      };
      draw();
      $('[data-close2]', m).onclick = () => m.close();
      $('#st-save', m).onclick = async () => {
        if (!$('#stock-form', m).reportValidity()) return;
        const diff = result() - stockNow;
        if (!diff) return toast('Số lượng không đổi');
        await store.upsert('packaging', { ...k, adjust: adjustForCount(k.adjust, stockNow, result()) });
        m.close();
        toast(`Tồn ${esc(k.name)}: ${stockNow} → ${result()}`);
      };
    },
  });
}

function openPackForm(existing, init = {}) {
  const k = existing ? { ...existing } : { name: '', baseCost: 0, lowStock: '', adjust: 0, shared: false, ...init };
  openModal({
    title: existing ? (k.shared ? 'Sửa vật tư dùng chung' : 'Sửa dụng cụ đóng gói') : (k.shared ? 'Thêm vật tư dùng chung' : 'Thêm dụng cụ đóng gói'),
    wide: false,
    body: `<form id="pack-form" class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field" style="grid-column:1/-1">Tên<input name="name" value="${esc(k.name)}" required placeholder="VD: Hộp carton 10x10"></label>
      <label class="field">Giá gốc (khi chưa có phiếu nhập)<input type="number" min="0" step="100" name="baseCost" value="${num(k.baseCost)}"></label>
      <label class="field">Cảnh báo khi tồn ≤<input type="number" min="0" name="lowStock" value="${esc(k.lowStock ?? '')}" placeholder="${settings.lowStock}"></label>
      <label class="field">Điều chỉnh tồn kho (±)<input type="number" step="any" name="adjust" value="${num(k.adjust)}" title="Số âm = đã dùng hoặc hao, số dương = đếm thấy thêm"></label>
      <label class="check sharedcheck" style="grid-column:1/-1"><input type="checkbox" name="shared" ${k.shared ? 'checked' : ''}> <span><b>Vật tư dùng chung</b> (băng keo, giấy chống sốc, ghim…): tiền nhập tính vào chi phí vận hành, không chọn trong đơn hàng.</span></label>
      <p class="small muted" style="grid-column:1/-1;margin:0">Điều chỉnh tồn kho: số <b>âm</b> = đã dùng hoặc hao, số <b>dương</b> = đếm thấy thêm. Việc này không làm đổi số tiền chi phí.</p>
    </form>
    ${existing ? `<p class="small">Giá TB: <b>${money(costs.packaging[k.id])}</b> · Tồn: <b>${num(stock.packaging[k.id])}</b></p>` : ''}`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="k-save">Lưu</button>`,
    onMount(m) {
      const form = $('#pack-form', m);
      $('[data-close2]', m).onclick = () => m.close();
      $('#k-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const d = formData(form);
        await store.upsert('packaging', { ...k, name: d.name.trim(), baseCost: num(d.baseCost), lowStock: d.lowStock === '' ? null : num(d.lowStock), adjust: num(d.adjust), shared: d.shared === 'on' });
        m.close();
      };
    },
  });
}

function openPresetForm(existing) {
  const pr = existing ? { ...existing } : { name: '', pack1: '', pack2: '', pack3: '' };
  openModal({
    title: existing ? 'Sửa bộ đóng gói' : 'Thêm bộ đóng gói',
    wide: false,
    body: `<form id="preset-form" class="form-grid" style="grid-template-columns:1fr">
      <label class="field">Tên bộ<input name="name" value="${esc(pr.name)}" required placeholder="VD: Gói quà for her"></label>
      ${PACK_SLOTS.map((s, i) => `<label class="field">Dụng cụ ${i + 1}<select name="${s}">${options(orderPackaging(), pr[s], '— không —')}</select></label>`).join('')}
      <div class="summary"><div><span>Chi phí bộ</span><b id="pr-cost"></b></div></div>
    </form>`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="pr-save">Lưu</button>`,
    onMount(m) {
      const form = $('#preset-form', m);
      const sync = () => ($('#pr-cost', m).textContent = money(presetCost(formData(form))));
      form.addEventListener('change', sync);
      sync();
      $('[data-close2]', m).onclick = () => m.close();
      $('#pr-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const d = formData(form);
        await store.upsert('presets', { ...pr, name: d.name.trim(), pack1: d.pack1, pack2: d.pack2, pack3: d.pack3 });
        m.close();
      };
    },
  });
}

/* ================= SETTINGS ================= */
function pageSettings() {
  const mapCount = Object.keys(settings.shopeeMap || {}).length;
  return `
    <div class="page-head"><div><h1>Cài đặt</h1><p>Lưu trữ, chia sẻ và sao lưu dữ liệu.</p></div></div>
    <div class="grid two">
      <div class="card">
        <h3>Lưu trữ & chia sẻ</h3>
        ${store.mode === 'firebase' ? `
          <p>✅ Đang đồng bộ online qua Firebase. Mọi thay đổi hiện ngay trên máy đồng nghiệp.</p>
          <p class="small muted">Đăng nhập: <b>${esc(store.user?.email || '')}</b></p>
          <div class="toolbar"><button class="btn" data-action="copy-link">Sao chép link gửi đồng nghiệp</button><button class="btn ghost" data-action="sign-out">Đăng xuất</button></div>
          <p class="small muted">Đồng nghiệp cần đăng nhập Google bằng email đã được thêm vào <code>firestore.rules</code>.</p>`
        : store.mode === 'artifact' ? `
          <p>✅ Dữ liệu lưu online và dùng chung. Ai được chia sẻ trang này đều thấy cùng một dữ liệu, cập nhật ngay khi có người sửa.</p>
          <p class="small muted">Để thêm đồng nghiệp: bấm <b>Share</b> ở góc trên trang, mời bằng email với quyền <b>Editor</b> (hoặc Contributor nếu cùng team). Người chỉ có quyền xem sẽ không lưu được thay đổi.</p>`
        : `
          <p>⚠️ Đang ở chế độ <b>chỉ máy này</b>: dữ liệu lưu trong trình duyệt, đồng nghiệp chưa xem được.</p>
          <p class="small muted">Để dùng chung: dùng link trang Hani trên Claude, hoặc tự cấu hình Firebase theo README. Dữ liệu hiện có chuyển sang bằng nút Sao lưu rồi Khôi phục.</p>`}
      </div>
      <div class="card">
        <h3>Sao lưu</h3>
        <div class="toolbar">
          <button class="btn" data-action="backup">⬇ Tải bản sao lưu (.json)</button>
          <label class="btn ghost">⬆ Khôi phục<input type="file" id="restore-file" accept=".json" hidden></label>
          <button class="btn ghost" data-action="export-orders">⬇ Xuất đơn hàng (Excel / CSV)</button>
        </div>
        <p class="small muted">Nên tải bản sao lưu định kỳ. Khôi phục sẽ <b>thay toàn bộ</b> dữ liệu hiện tại.</p>
      </div>
      <div class="card">
        <h3>Thiết lập</h3>
        <label class="field">Mức cảnh báo tồn kho mặc định<input type="number" min="0" id="set-low" value="${num(settings.lowStock)}"></label>
        <p class="small muted" style="margin-top:12px">Shopee: đã ghi nhớ ${mapCount} sản phẩm được gắn. ${mapCount ? '<button class="btn ghost sm" data-action="clear-map">Xoá ghi nhớ</button>' : ''}</p>
        ${!S.products.length && !S.orders.length ? '<button class="btn pink" data-action="demo">Nạp dữ liệu mẫu để thử</button>' : ''}
      </div>
    </div>`;
}

async function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const downloads = store.mode === 'artifact' ? await window.claude.use('downloads') : null;
  if (downloads) {
    try { await downloads.save({ filename: name, data: blob }); } catch { /* viewer declined */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- export orders ---------- */
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function openExportDialog() {
  const q = quickRanges();
  const st = ui.export ||= {
    mode: 'month', day: q.today.day, month: q.thisMonth.month, from: q.last7.from, to: q.today.day,
    platforms: Object.keys(PLATFORMS), includeInactive: false, format: 'xlsx',
  };
  const names = { item: itemLabel, pack: (id) => pack(id)?.name || '' };
  const selection = () => {
    const range = exportRange(st);
    const orders = range ? ordersInRange(S.orders, range, { platforms: st.platforms, includeInactive: st.includeInactive }) : [];
    return { range, orders };
  };

  openModal({
    title: 'Xuất đơn hàng',
    wide: false,
    body: `<form id="export-form" class="export">
      <div class="field"><span>Chọn nhanh</span>
        <div class="chips">${Object.entries(q).map(([k, r]) => `<button type="button" class="chip-btn" data-quick="${k}">${r.label}</button>`).join('')}</div>
      </div>
      <div class="field"><span>Xuất theo</span>
        <div class="seg" id="ex-mode">
          <button type="button" data-v="day">Theo ngày</button>
          <button type="button" data-v="month">Theo tháng</button>
          <button type="button" data-v="range">Khoảng tuỳ chọn</button>
        </div>
      </div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <label class="field" data-show="day">Ngày<input type="date" id="ex-day"></label>
        <label class="field" data-show="month">Tháng<input type="month" id="ex-month"></label>
        <label class="field" data-show="range">Từ ngày<input type="date" id="ex-from"></label>
        <label class="field" data-show="range">Đến ngày<input type="date" id="ex-to"></label>
      </div>
      <div class="field"><span>Nền tảng</span>
        <div class="chips">${Object.entries(PLATFORMS).map(([k, v]) => `<label class="check"><input type="checkbox" data-pf="${k}"> <span class="chip ${k}">${v.label}</span></label>`).join('')}</div>
      </div>
      <label class="check"><input type="checkbox" id="ex-inactive"> Gồm cả đơn đã huỷ / trả hàng (liệt kê nhưng không cộng vào tổng)</label>
      <div class="field"><span>Định dạng file</span>
        <div class="seg" id="ex-format">
          <button type="button" data-v="xlsx">Excel (.xlsx)</button>
          <button type="button" data-v="csv">CSV</button>
        </div>
        <span class="small muted" id="ex-format-note"></span>
      </div>
      <div class="summary" id="ex-sum"></div>
    </form>`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="ex-go">⬇ Tải file</button>`,
    onMount(m) {
      const form = $('#export-form', m);
      const sync = () => {
        $$('#ex-mode button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === st.mode));
        $$('#ex-format button', m).forEach((b) => b.classList.toggle('on', b.dataset.v === st.format));
        $$('[data-show]', m).forEach((el) => (el.hidden = el.dataset.show !== st.mode));
        $('#ex-day', m).value = st.day || '';
        $('#ex-month', m).value = st.month || '';
        $('#ex-from', m).value = st.from || '';
        $('#ex-to', m).value = st.to || '';
        $$('[data-pf]', m).forEach((c) => (c.checked = st.platforms.includes(c.dataset.pf)));
        $('#ex-inactive', m).checked = st.includeInactive;
        $('#ex-format-note', m).textContent = st.format === 'xlsx'
          ? '3 sheet: Tổng hợp · Đơn hàng · Chi tiết sản phẩm'
          : '1 bảng: mỗi dòng một đơn hàng';
        const { range, orders } = selection();
        const total = range ? buildSheets({ orders, costs, range, names }).total : null;
        $('#ex-sum', m).innerHTML = range
          ? `<div><span>Thời gian</span><b>${esc(range.label)}</b></div>
             <div><span>Số đơn</span><b>${orders.length}</b></div>
             <div><span>Doanh thu</span><b>${money(total.revenue)}</b></div>
             <div class="profit ${total.profit < 0 ? 'neg' : ''}"><span>Lợi nhuận</span><b>${money(total.profit)}</b></div>`
          : '<div><span>Thời gian</span><b>Chọn đủ ngày</b></div>';
        const go = $('#ex-go', m);
        go.disabled = !range || !orders.length;
        go.textContent = !range ? '⬇ Tải file' : orders.length ? `⬇ Tải ${orders.length} đơn` : 'Không có đơn nào';
      };
      form.addEventListener('click', (e) => {
        const quick = e.target.closest('[data-quick]');
        if (quick) Object.assign(st, q[quick.dataset.quick]);
        const mode = e.target.closest('#ex-mode [data-v]');
        if (mode) st.mode = mode.dataset.v;
        const fmt = e.target.closest('#ex-format [data-v]');
        if (fmt) st.format = fmt.dataset.v;
        if (quick || mode || fmt) sync();
      });
      form.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'ex-day') st.day = t.value;
        if (t.id === 'ex-month') st.month = t.value;
        if (t.id === 'ex-from') st.from = t.value;
        if (t.id === 'ex-to') st.to = t.value;
        if (t.id === 'ex-inactive') st.includeInactive = t.checked;
        if (t.dataset.pf) st.platforms = $$('[data-pf]', m).filter((c) => c.checked).map((c) => c.dataset.pf);
        sync();
      });
      $('[data-close2]', m).onclick = () => m.close();
      $('#ex-go', m).onclick = async () => {
        const { range, orders } = selection();
        if (!range || !orders.length) return;
        const allPlatforms = Object.keys(PLATFORMS).every((k) => st.platforms.includes(k));
        const sheets = buildSheets({ orders, costs, range, names, operating: allPlatforms ? operatingCosts(S, range.from, range.to) : null });
        const name = `hani-don-hang_${range.slug}`;
        $('#ex-go', m).disabled = true;
        try {
          if (st.format === 'csv') {
            await download(`${name}.csv`, toCsv(sheets.orders), 'text/csv');
          } else {
            await download(`${name}.xlsx`, await toXlsx(sheets), XLSX_TYPE);
          }
          m.close();
        } catch (err) {
          notify('Không tạo được file: ' + (err.message || err.code));
          $('#ex-go', m).disabled = false;
        }
      };
      sync();
    },
  });
}

/** Build the .xlsx workbook: numbers formatted with thousand separators, sensible column widths. */
async function toXlsx(sheets) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const add = (rows, title, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    for (const ref of Object.keys(ws)) {
      if (ref[0] !== '!' && ws[ref].t === 'n') ws[ref].z = '#,##0';
    }
    ws['!cols'] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, title);
  };
  add(sheets.summary, 'Tổng hợp', [30, 28, 14, 14]);
  add(sheets.orders, 'Đơn hàng', [11, 10, 16, 18, 13, 9, 40, 9, 12, 10, 12, 12, 10, 10, 10, 11, 12, 12, 12, 14, 14, 24]);
  add(sheets.lines, 'Chi tiết sản phẩm', [11, 10, 16, 12, 28, 14, 9, 12, 12, 12, 30, 10, 12, 12]);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: XLSX_TYPE });
}

async function loadDemo() {
  const k = (name, baseCost) => ({ id: uid(), name, baseCost });
  const box = k('Hộp carton nhỏ', 3500), paper = k('Giấy rơm lót', 800), ribbon = k('Ruy băng hồng', 1200), bag = k('Túi zip', 500), card = k('Thiệp cảm ơn', 1500);
  const presets = [
    { id: uid(), name: 'Gói cơ bản', pack1: bag.id, pack2: card.id, pack3: '' },
    { id: uid(), name: 'Hộp quà', pack1: box.id, pack2: paper.id, pack3: ribbon.id },
  ];
  const p1 = { id: uid(), name: 'Móc khoá mica in ảnh', sku: 'MK-01', category: 'her', salePrice: 45000, defaultPreset: presets[0].id };
  const p2 = { id: uid(), name: 'Khung ảnh gỗ 13x18', sku: 'KH-13', category: 'him', salePrice: 120000, defaultPreset: presets[1].id };
  const p3 = { id: uid(), name: 'Set quà anni', sku: 'SET-AN', category: 'friend', salePrice: 259000, defaultPreset: presets[1].id };
  const tape = { ...k('Băng keo trong', 12000), shared: true };
  const wrap = { ...k('Giấy chống sốc', 150000), shared: true };
  const staples = { ...k('Ghim bấm (hộp)', 8000), shared: true, adjust: -2 };
  await store.upsertMany('packaging', [box, paper, ribbon, bag, card, tape, wrap, staples]);
  await store.upsertMany('presets', presets);
  const cup = { id: uid(), name: 'Cúp pha lê mini', sku: 'CUP-01', category: 'friend', salePrice: 89000, defaultPreset: presets[1].id,
    variants: [{ id: uid(), name: 'Đỏ', sku: 'CUP-01-DO' }, { id: uid(), name: 'Xanh', sku: 'CUP-01-XANH' }, { id: uid(), name: 'Vàng', sku: 'CUP-01-VANG', price: 99000 }] };
  await store.upsertMany('products', [p1, p2, p3, cup]);
  const d = today();
  await store.upsertMany('imports', [
    { kind: 'product', itemId: p1.id, date: d, qty: 100, unitCost: 15000, extraFee: 50000, supplier: 'Xưởng in A' },
    { kind: 'product', itemId: p2.id, date: d, qty: 30, unitCost: 55000, extraFee: 30000, supplier: 'Xưởng gỗ B' },
    { kind: 'product', itemId: p3.id, date: d, qty: 20, unitCost: 140000, extraFee: 0, supplier: '' },
    ...cup.variants.map((v, i) => ({ kind: 'product', itemId: cup.id, variantId: v.id, date: d, qty: [12, 8, 4][i], unitCost: 32000, extraFee: [12000, 8000, 4000][i], supplier: 'Xưởng pha lê C' })),
    ...[box, paper, ribbon, bag, card].map((x) => ({ kind: 'packaging', itemId: x.id, date: d, qty: 200, unitCost: x.baseCost, extraFee: 0 })),
    ...[[cup.variants[2], 20], [cup.variants[0], 10]].map(([v, qty]) => ({ kind: 'product', itemId: cup.id, variantId: v.id, date: d, qty, unitCost: 32000, extraFee: 0, supplier: 'Xưởng pha lê C', status: 'ordered', batchId: 'demo-dang-ve' })),
    { kind: 'packaging', itemId: tape.id, date: d, qty: 2, unitCost: 12000, extraFee: 0, supplier: 'Tạp hoá' },
    { kind: 'packaging', itemId: wrap.id, date: d, qty: 1, unitCost: 60000, extraFee: 15000, supplier: 'Shopee' },
    { kind: 'packaging', itemId: staples.id, date: d, qty: 5, unitCost: 8000, extraFee: 0, supplier: 'Tạp hoá' },
  ]);
  await store.upsertMany('orders', [
    { platform: 'instagram', code: 'IG-0001', date: d, customer: '@linh.ng', status: 'done', shipFee: 30000, shipPayer: 'customer', discount: 0, platformFee: 0,
      items: [{ productId: p1.id, qty: 2, price: 45000, pack1: bag.id, pack2: card.id, pack3: '', packEach: true }] },
    { platform: 'threads', code: 'TH-0001', date: d, customer: '@minh', status: 'shipping', tracking: 'SPXVN04812345678', shipFee: 25000, shipPayer: 'shop', discount: 10000, platformFee: 0,
      items: [{ productId: p3.id, qty: 1, price: 259000, pack1: box.id, pack2: paper.id, pack3: ribbon.id }] },
    { platform: 'instagram', code: 'IG-0002', date: d, customer: '@thu.ha', status: 'designed', card: true, shipFee: 30000, shipPayer: 'customer', discount: 0, platformFee: 0,
      items: [{ productId: cup.id, variantId: cup.variants[2].id, qty: 2, price: 89000, pack1: box.id, pack2: paper.id, pack3: ribbon.id }] },
  ]);
  toast('Đã nạp dữ liệu mẫu');
}

/* ================= events ================= */
document.addEventListener('click', async (e) => {
  const stOpt = e.target.closest('.st-pop [data-status]');
  if (stOpt) {
    const { orderId } = stPop;
    closeStatusMenu(true);
    await setOrderStatus(orderId, stOpt.dataset.status);
    return;
  }
  const stBtn = e.target.closest('[data-stmenu]');
  if (stBtn) {
    if (stPop?.btn === stBtn) closeStatusMenu(); else openStatusMenu(stBtn);
    return;
  }
  if (stPop) closeStatusMenu();
  const tab = e.target.closest('[data-tab]');
  if (tab) { location.hash = tab.dataset.tab; return; }
  const period = e.target.closest('[data-period]');
  if (period) {
    const k = period.dataset.period;
    if (k === 'this') viewMonth(thisMonth());
    else ui.period = 'all';
    render();
    return;
  }
  const step = e.target.closest('[data-month-step]');
  if (step && !step.disabled) {
    // From "Tất cả" the arrows start at the current month.
    viewMonth(ui.period === 'month' ? shiftMonth(ui.dashMonth, +step.dataset.monthStep) : thisMonth());
    render();
    return;
  }
  const impStatus = e.target.closest('[data-import-status]');
  if (impStatus) { ui.imports.status = impStatus.dataset.importStatus; render(); return; }
  const kind = e.target.closest('[data-import-kind]');
  if (kind) { ui.imports.kind = kind.dataset.importKind; render(); return; }
  const goto = e.target.closest('[data-goto-status]');
  if (goto) Object.assign(ui.orders, { status: goto.dataset.gotoStatus, month: goto.dataset.gotoMonth || '', platform: '', q: '' });

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const confirmDel = async (coll, msg) => { if (await ask(msg)) await store.remove(coll, id); };
  switch (btn.dataset.action) {
    case 'refresh-now': {
      const ok = await store.refresh?.({ manual: true });
      return toast(ok ? 'Đã làm mới dữ liệu' : store.pending > 0 ? 'Đang lưu, thử làm mới lại sau ít giây' : 'Chưa làm mới được, thử lại sau');
    }
    case 'sync-info': return notify(store.lastError ? 'Chưa lưu được: ' + describeError(store.lastError).text : 'Mọi thay đổi đã được lưu.');
    case 'new-order': return openOrderForm();
    case 'edit-order': return openOrderForm(store.get('orders', id));
    case 'del-order': return confirmDel('orders', 'Xoá đơn hàng này?');
    case 'new-import': return openImportForm();
    case 'edit-import': return openImportForm(store.get('imports', id));
    case 'copy-tracking': return copyText(btn.dataset.text);
    case 'new-parcel': return openParcelForm();
    case 'edit-group': return openGroupEdit(btn.dataset.ids.split(','));
    case 'receive-import': return openReceiveDialog([id]);
    case 'receive-group': return openReceiveDialog(btn.dataset.ids.split(','));
    case 'toggle-import-group': ui.imports.open[btn.dataset.key] = !ui.imports.open[btn.dataset.key]; return render();
    case 'del-import-group': {
      const ids = btn.dataset.ids.split(',');
      if (!(await ask(`Xoá ${ids.length} phiếu nhập của mặt hàng này? Tồn kho và giá vốn sẽ tính lại.`))) return;
      for (const x of ids) await store.remove('imports', x);
      return toast('Đã xoá nhóm phiếu nhập');
    }
    case 'receive-batch': return openReceiveDialog(S.imports.filter((i) => !isReceived(i) && (i.batchId || i.id) === btn.dataset.batch).map((i) => i.id));
    case 'del-import': return confirmDel('imports', 'Xoá phiếu nhập này? Tồn kho và giá vốn sẽ tính lại.');
    case 'new-product': return openProductForm();
    case 'open-product': return openProductDetail(id);
    case 'edit-item':
      e.preventDefault();
      return btn.dataset.kind === 'packaging' ? openPackForm(pack(id)) : openProductForm(product(id));
    case 'new-pack': return openPackForm();
    case 'new-shared': return openPackForm(undefined, { shared: true });
    case 'use-pack': return openStockDialog(pack(id), 'used');
    case 'adjust-pack': return openStockDialog(pack(id), 'count');
    case 'del-pack': return confirmDel('packaging', pack(id)?.shared ? 'Xoá vật tư này? Tiền nhập của nó sẽ không còn nằm trong chi phí vận hành.' : 'Xoá dụng cụ này? (Các đơn cũ dùng dụng cụ này sẽ mất chi phí đóng gói tương ứng)');
    case 'new-preset': return openPresetForm();
    case 'edit-preset': return openPresetForm(store.get('presets', id));
    case 'del-preset': return confirmDel('presets', 'Xoá bộ đóng gói này?');
    case 'copy-link':
      try {
        await navigator.clipboard.writeText(location.origin + location.pathname);
        return toast('Đã sao chép link');
      } catch {
        return notify('Không sao chép được. Hãy copy link trên thanh địa chỉ.');
      }
    case 'sign-out': return store.signOut();
    case 'backup': return download(`hani-backup-${today()}.json`, JSON.stringify(store.state, null, 2), 'application/json');
    case 'export-orders': return openExportDialog();
    case 'clear-map': return store.upsert('meta', { ...settings, shopeeMap: {} });
    case 'demo': return loadDemo();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'order-q') { ui.orders.q = t.value; render(); }
  if (t.id === 'import-q') { ui.imports.q = t.value; render(); }
  if (t.id === 'product-q') { ui.products.q = t.value; render(); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'order-platform') { ui.orders.platform = t.value; render(); }
  if (t.id === 'order-status') { ui.orders.status = t.value; render(); }
  if (t.id === 'order-month') { ui.orders.month = t.value; render(); }
  if (t.id === 'dash-month' && t.value) { viewMonth(t.value); render(); }
  if (t.id === 'set-low') await store.upsert('meta', { ...settings, lowStock: num(t.value) });
  if (t.id === 'set-labor') await store.upsert('meta', { ...settings, laborPerOrder: Math.max(0, num(t.value)) });
  if (t.id === 'shopee-file' && t.files[0]) { await importShopeeFile(t.files[0]); t.value = ''; }
  if (t.id === 'restore-file' && t.files[0]) {
    try {
      const backup = JSON.parse(await t.files[0].text());
      if (await ask('Thay toàn bộ dữ liệu hiện tại bằng bản sao lưu này?', 'Khôi phục')) { await restoreBackup(backup); toast('Đã khôi phục'); }
    } catch (err) { notify('File sao lưu không hợp lệ: ' + err.message); }
    t.value = '';
  }
});

window.addEventListener('hashchange', render);

/* ================= boot ================= */
function renderLogin(message = '') {
  $('#app').innerHTML = `
    <div class="login"><div class="card">
      <div class="logo big">hani</div>
      <h2 style="margin-top:18px">Quản lý cửa hàng</h2>
      <p>Đăng nhập bằng tài khoản Google đã được cấp quyền để dùng chung dữ liệu với team.</p>
      ${message ? `<p class="neg small">${esc(message)}</p>` : ''}
      <button class="btn" id="login-btn">Đăng nhập với Google</button>
    </div></div>`;
  $('#login-btn').onclick = () => store.signIn().catch((err) => renderLogin(err.message));
}

function onStoreError(err) {
  if (err.code === 'permission-denied') return renderLogin(`Email ${store.user?.email} chưa được cấp quyền. Nhờ chủ shop thêm email vào firestore.rules.`);
  notify('Chưa lưu được: ' + describeError(err).text);
}

async function boot() {
  $('#app').innerHTML = '<div class="login"><div class="logo big">hani</div></div>';
  await initStore();
  store.onError = onStoreError;
  store.onStatus(updateSyncBadge);
  store.onLive(updateLiveBadge);
  // Someone else added an order: say so, so a live page doesn't look frozen.
  store.onRemote = (coll, docs) => {
    if (coll !== 'orders') return;
    const codes = docs.map((o) => o.code).filter(Boolean);
    toast(docs.length === 1 ? `Có đơn mới${codes[0] ? ': ' + codes[0] : ''}` : `Có ${docs.length} đơn mới`, 4500);
  };
  store.onLiveError = () => notify('Quyền truy cập trang đã thay đổi. Hãy tải lại trang để tiếp tục.');
  let renderQueued = false;
  store.onChange(() => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; if (!firebaseEnabled || store.user) render(); });
  });
  if (firebaseEnabled) {
    store.init((user) => (user ? render() : renderLogin())).catch((err) => renderLogin('Không kết nối được Firebase: ' + err.message));
  } else {
    await store.init();
    render();
  }
  store.whenReady().then(resumeDraft);
}

/** After a reload (or a new version of the page) with an order form open: offer that order back. */
async function resumeDraft() {
  if (firebaseEnabled && !store.user) return;
  const keys = openDraftKeys();
  if (!keys.length) return;
  keys.forEach((k) => markDraftClosed(k)); // ask once, not on every later reload
  const existing = keys[0] === 'new' ? undefined : store.get('orders', keys[0]);
  if (keys[0] === 'new' || existing) openOrderForm(existing);
}

window.addEventListener('unhandledrejection', (e) => { if (e.reason?.code) e.preventDefault(); });
boot();
