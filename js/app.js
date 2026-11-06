import { store, initStore, firebaseEnabled, restoreBackup, uid } from './store.js';
import {
  PLATFORMS, STATUSES, INACTIVE_STATUSES, PACK_SLOTS,
  costTable, lineCost, orderSummary, stockLevels, aggregate, variantKey, splitFee,
} from './calc.js';
import { rowsToOrders, listingKey, normalize } from './shopee.js';
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
  settings = { id: 'settings', shopeeMap: {}, lowStock: 5, ...(store.get('meta', 'settings') || {}) };
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
/** Images are stored as "asset:<id>" (artifact asset store) or as a data: URL. */
const imgSrc = (ref) => (!ref ? '' : ref.startsWith('asset:') ? '/_blob/' + ref.slice(6) : ref);
const thumb = (ref, name, cls = '') =>
  ref
    ? `<img class="thumb ${cls}" src="${esc(imgSrc(ref))}" alt="" loading="lazy">`
    : `<span class="thumb ph ${cls}" aria-hidden="true">${esc((name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
const presetCost = (preset) => PACK_SLOTS.reduce((s, k) => s + (preset?.[k] ? num(costs.packaging[preset[k]]) : 0), 0);

/* ================= routing ================= */
const TABS = {
  dashboard: 'Tổng quan',
  orders: 'Đơn hàng',
  imports: 'Nhập hàng',
  products: 'Sản phẩm',
  packaging: 'Đóng gói',
  settings: 'Cài đặt',
};
const ui = {
  period: 'month',
  orders: { q: '', platform: '', status: '', month: '' },
  imports: { q: '', kind: '' },
  products: { q: '' },
  export: null, // last choices in the export dialog, kept for the visit
};
const currentTab = () => (TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');

function render() {
  derive();
  const tab = currentTab();
  const pages = { dashboard: pageDashboard, orders: pageOrders, imports: pageImports, products: pageProducts, packaging: pagePackaging, settings: pageSettings };
  const focused = document.activeElement?.id;
  $('#app').innerHTML = `
    <header class="topbar">
      <span class="logo">hani</span>
      <span class="tag">quà nhỏ, kỉ niệm "to đùng"</span>
      <nav class="tabs">
        ${Object.entries(TABS).map(([k, v]) => `<button class="tab ${k === tab ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}
      </nav>
      <span class="sync" title="${MODES[store.mode].title}">
        <i class="dot ${MODES[store.mode].dot}"></i>${esc(MODES[store.mode].label())}
      </span>
    </header>
    <main>${pages[tab]()}</main>`;
  if (focused && $('#' + focused)) {
    const el = $('#' + focused);
    el.focus();
    if (el.setSelectionRange && el.type === 'search') el.setSelectionRange(el.value.length, el.value.length);
  }
}

/* ================= modal ================= */
const modal = $('#modal');
function openModal({ title, body, foot = '', onMount, wide = true }) {
  modal.style.width = wide ? '' : 'min(560px, calc(100vw - 32px))';
  modal.innerHTML = `
    <div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  modal.showModal();
  $('[data-close]', modal).onclick = () => modal.close();
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
function periodRange() {
  const now = new Date();
  const iso = isoLocal;
  switch (ui.period) {
    case 'month': return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), '9999'];
    case 'lastmonth': return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    case '30d': return [iso(new Date(now - 29 * 864e5)), '9999'];
    default: return ['0000', '9999'];
  }
}

function pageDashboard() {
  const [from, to] = periodRange();
  const orders = S.orders.filter((o) => o.date >= from && o.date <= to);
  const agg = aggregate(costs, orders);
  const margin = agg.revenue ? (agg.profit / agg.revenue) * 100 : 0;
  const maxRev = Math.max(1, ...Object.values(agg.byPlatform).map((p) => p.revenue));
  const top = Object.entries(agg.byProduct).sort((a, b) => b[1].profit - a[1].profit).slice(0, 8);
  // Products with variants are checked colour by colour, others by their total.
  const lowP = S.products.flatMap((p) => (hasVariants(p)
    ? p.variants.filter((v) => vStock(p.id, v.id) <= lowOf(p)).map((v) => ({ p, v, n: vStock(p.id, v.id) }))
    : num(stock.products[p.id]) <= lowOf(p) ? [{ p, n: num(stock.products[p.id]) }] : []));
  const lowK = S.packaging.filter((k) => num(stock.packaging[k.id]) <= num(k.lowStock ?? settings.lowStock));
  const unmapped = S.orders.filter((o) => !INACTIVE_STATUSES.has(o.status) && o.items?.some((l) => !l.productId)).length;
  const pendingCount = S.orders.filter((o) => o.status === 'pending').length;
  const periods = { month: 'Tháng này', lastmonth: 'Tháng trước', '30d': '30 ngày', all: 'Tất cả' };

  return `
    <div class="page-head">
      <div><h1>Tổng quan</h1><p>Doanh thu & lợi nhuận đã trừ giá vốn, đóng gói, phí sàn và ship shop chịu.</p></div>
      <div class="actions"><div class="seg">${Object.entries(periods).map(([k, v]) => `<button data-period="${k}" class="${ui.period === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    </div>
    <div class="grid kpi">
      <div class="card kpi-card him"><div class="label">Doanh thu</div><div class="value">${money(agg.revenue)}</div></div>
      <div class="card kpi-card her"><div class="label">Tổng chi phí</div><div class="value">${money(agg.cost)}</div></div>
      <div class="card kpi-card backup"><div class="label">Lợi nhuận</div><div class="value ${signCls(agg.profit)}">${money(agg.profit)}</div></div>
      <div class="card kpi-card friend"><div class="label">Số đơn · Biên lãi</div><div class="value">${agg.orders} · ${margin.toFixed(1)}%</div></div>
    </div>
    ${unmapped || pendingCount ? `<div class="card" style="margin-top:16px">
      ${pendingCount ? `<div>📦 Có <b>${pendingCount}</b> đơn đang chờ xử lý. <a href="#orders" data-goto-status="pending">Xem</a></div>` : ''}
      ${unmapped ? `<div>⚠️ Có <b>${unmapped}</b> đơn có sản phẩm chưa gắn với kho (giá vốn = 0). Mở đơn để chọn sản phẩm.</div>` : ''}
    </div>` : ''}
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
        <h3>Sắp hết hàng</h3>
        ${lowP.length + lowK.length ? `<div class="table-wrap"><table><thead><tr><th>Mặt hàng</th><th>Loại</th><th class="num">Tồn</th></tr></thead><tbody>
          ${lowP.map(({ p, v, n }) => `<tr><td><span class="item">${thumb(v?.image || p.image, v?.name || p.name, 'sm')}${esc(itemLabel(p.id, v?.id))}</span></td><td><span class="chip him">Sản phẩm</span></td><td class="num neg">${n}</td></tr>`).join('')}
          ${lowK.map((k) => `<tr><td>${esc(k.name)}</td><td><span class="chip backup">Đóng gói</span></td><td class="num neg">${num(stock.packaging[k.id])}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">Kho vẫn ổn ✨</div>'}
      </div>
    </div>`;
}

/* ================= ORDERS ================= */
function filteredOrders() {
  const f = ui.orders;
  const q = normalize(f.q);
  return S.orders
    .filter((o) => (!f.platform || o.platform === f.platform) && (!f.status || o.status === f.status) && (!f.month || (o.date || '').startsWith(f.month)))
    .filter((o) => !q || normalize([o.code, o.customer, o.note, ...(o.items || []).map((l) => itemLabel(l.productId, l.variantId, l.productName))].join(' ')).includes(q))
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
      <select id="order-status"><option value="">Mọi trạng thái</option>${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input type="month" id="order-month" value="${esc(f.month)}">
      <span class="muted small" style="margin-left:auto">${list.length} đơn · DT ${money(agg.revenue)} · Lãi <b class="${signCls(agg.profit)}">${money(agg.profit)}</b></span>
    </div>
    <div class="card table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Ngày</th><th>Nền tảng</th><th>Mã đơn / Khách</th><th>Sản phẩm</th><th class="num">Doanh thu</th><th class="num">Chi phí</th><th class="num">Lợi nhuận</th><th>Ship</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${list.map(orderRow).join('')}</tbody>
      </table>` : '<div class="empty">Chưa có đơn nào. Bấm “＋ Thêm đơn” hoặc nhập file Shopee.</div>'}
    </div>`;
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
  return `<tr style="${inactive ? 'opacity:.55' : ''}">
    <td>${fmtDate(o.date)}</td>
    <td><span class="chip ${o.platform}">${PLATFORMS[o.platform]?.label || o.platform}</span></td>
    <td><b>${esc(o.code || '—')}</b><br><span class="muted small">${esc(o.customer || '')}</span></td>
    <td class="small"><div class="items">${items}</div></td>
    <td class="num">${money(s.revenue)}</td>
    <td class="num">${money(s.cost)}</td>
    <td class="num ${signCls(s.profit)}"><b>${money(s.profit)}</b></td>
    <td class="small">${money(o.shipFee)}<br><span class="muted">${o.shipPayer === 'shop' ? 'Shop chịu' : 'Khách chịu'}</span></td>
    <td><select data-order-status="${o.id}" class="small" style="width:auto">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-order" data-id="${o.id}" title="Sửa">✎</button><button class="icon-btn del" data-action="del-order" data-id="${o.id}" title="Xoá">🗑</button></td>
  </tr>`;
}

function blankLine() {
  return { productId: '', variantId: '', qty: 1, price: 0, pack1: '', pack2: '', pack3: '', packEach: false };
}

function openOrderForm(existing) {
  const o = existing ? structuredClone(existing) : {
    platform: 'instagram', code: '', date: today(), customer: '', status: 'pending', note: '',
    shipFee: 0, shipPayer: 'customer', discount: 0, platformFee: 0, items: [blankLine()],
  };
  if (!o.items?.length) o.items = [blankLine()];

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
      ${PACK_SLOTS.map((k, j) => `<label class="field">Dụng cụ đóng gói ${j + 1}<select data-f="${k}">${options(S.packaging, l[k], '— không —')}</select></label>`).join('')}
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
          <select name="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
      </div>
      <h3 style="margin:18px 0 8px">Sản phẩm & đóng gói</h3>
      <div id="lines"></div>
      <button type="button" class="btn ghost sm" id="add-line">＋ Thêm sản phẩm</button>
      <h3 style="margin:18px 0 8px">Phí ship & phí khác</h3>
      <div class="form-grid">
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
      <label class="field" style="margin-top:12px">Ghi chú<textarea name="note" rows="2">${esc(o.note)}</textarea></label>
      <div class="summary" id="order-summary"></div>
    </form>`;

  openModal({
    title: existing ? 'Sửa đơn hàng' : 'Thêm đơn hàng',
    body,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="save-order">Lưu đơn</button>`,
    onMount(m) {
      const form = $('#order-form', m);
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
      };
      const readHeader = () => {
        const d = formData(form);
        return {
          platform: d.platform, code: d.code.trim(), date: d.date, customer: d.customer.trim(), status: d.status, note: d.note,
          shipFee: num(d.shipFee), discount: num(d.discount), platformFee: num(d.platformFee),
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
      $('#ship-payer', m).onclick = (e) => {
        if (!e.target.dataset.v) return;
        $$('#ship-payer button', m).forEach((b) => b.classList.toggle('on', b === e.target));
        drawSummary();
      };
      form.addEventListener('input', (e) => { if (!e.target.closest('#lines')) drawSummary(); });
      form.addEventListener('change', (e) => { if (!e.target.closest('#lines')) drawSummary(); });
      $('[data-close2]', m).onclick = () => m.close();
      $('#save-order', m).onclick = async () => {
        if (!form.reportValidity()) return;
        Object.assign(o, readHeader());
        o.items = o.items.filter((l) => l.productId || l.productName).map(({ preset, ...l }) => l);
        if (!o.items.length) return toast('Chọn ít nhất 1 sản phẩm');
        const noVariant = o.items.find((l) => hasVariants(product(l.productId)) && !l.variantId);
        if (noVariant && !existing) return notify(`Chọn phân loại (màu, size…) cho "${product(noVariant.productId).name}"`);
        if (!o.code) o.code = `${o.platform.slice(0, 2).toUpperCase()}-${Date.now().toString().slice(-6)}`;
        await store.upsert('orders', o);
        m.close();
        toast('Đã lưu đơn ✨');
      };
      drawLines();
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
      return { ...old, status: o.status, platformFee: o.platformFee, discount: o.discount, shipFee: o.shipFee, items };
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

function pageImports() {
  const f = ui.imports;
  const q = normalize(f.q);
  const list = S.imports
    .filter((i) => !f.kind || i.kind === f.kind)
    .filter((i) => !q || normalize([importLabel(i), i.supplier, i.note].join(' ')).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
  const total = list.reduce((s, i) => s + num(i.qty) * num(i.unitCost) + num(i.extraFee), 0);
  return `
    <div class="page-head">
      <div><h1>Nhập hàng</h1><p>Mỗi lần nhập hàng / dụng cụ đóng gói ghi 1 phiếu. Giá vốn = trung bình có trọng số của các lần nhập (đã gồm phí ship nhập).</p></div>
      <div class="actions"><button class="btn pink" data-action="new-import">＋ Phiếu nhập</button></div>
    </div>
    <div class="toolbar">
      <input type="search" id="import-q" placeholder="Tìm mặt hàng, nhà cung cấp…" value="${esc(f.q)}">
      <div class="seg">${[['', 'Tất cả'], ['product', 'Sản phẩm'], ['packaging', 'Dụng cụ đóng gói']].map(([k, v]) => `<button data-import-kind="${k}" class="${f.kind === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <span class="muted small" style="margin-left:auto">${list.length} phiếu · Tổng chi ${money(total)}</span>
    </div>
    <div class="card table-wrap">
      ${list.length ? `<table>
        <thead><tr><th>Ngày</th><th>Mặt hàng</th><th>Loại</th><th class="num">SL</th><th class="num">Giá nhập/đv</th><th class="num">Phí ship/khác</th><th class="num">Vốn/đv</th><th class="num">Thành tiền</th><th>Nhà cung cấp</th><th></th></tr></thead>
        <tbody>${list.map((i) => {
          const item = itemOf(i);
          const totalRow = num(i.qty) * num(i.unitCost) + num(i.extraFee);
          return `<tr>
            <td>${fmtDate(i.date)}</td>
            <td><span class="item">${i.kind === 'packaging' ? '' : thumb(variantOf(i.itemId, i.variantId)?.image || item?.image, item?.name, 'sm')}<a href="javascript:void 0" data-action="edit-item" data-kind="${i.kind}" data-id="${i.itemId}">${esc(importLabel(i) || '(đã xoá)')}</a></span>${i.note ? `<br><span class="small muted">${esc(i.note)}</span>` : ''}</td>
            <td><span class="chip ${i.kind === 'packaging' ? 'backup' : 'him'}">${i.kind === 'packaging' ? 'Đóng gói' : 'Sản phẩm'}</span></td>
            <td class="num">${num(i.qty)}</td>
            <td class="num">${money(i.unitCost)}</td>
            <td class="num">${money(i.extraFee)}</td>
            <td class="num">${money(num(i.qty) ? totalRow / num(i.qty) : 0)}</td>
            <td class="num"><b>${money(totalRow)}</b></td>
            <td>${esc(i.supplier || '')}</td>
            <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-import" data-id="${i.id}" title="Sửa phiếu">✎</button><button class="icon-btn del" data-action="del-import" data-id="${i.id}" title="Xoá">🗑</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<div class="empty">Chưa có phiếu nhập nào.</div>'}
    </div>`;
}

function openImportForm(existing, preset = {}) {
  const imp = existing ? { ...existing } : {
    kind: preset.kind || ui.imports.kind || 'product', itemId: preset.itemId || '', variantId: '',
    date: today(), qty: 1, unitCost: 0, extraFee: 0, supplier: '', note: '',
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
      <label class="field">Ngày nhập<input type="date" name="date" value="${esc(imp.date)}" required></label>
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
        const common = { kind, date: d.date, unitCost: num(d.unitCost), supplier: d.supplier.trim(), note: d.note.trim() };

        if (existing) {
          await store.upsert('imports', { ...imp, ...common, variantId: d.variantId || '', qty: num(d.qty), extraFee: num(d.extraFee) });
          m.close();
          return toast('Đã cập nhật phiếu nhập');
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
          await store.upsertMany('imports', filled.map((r, i) => ({ ...common, itemId, variantId: r.variantId, qty: num(r.qty), extraFee: fees[i] })));
        } else {
          await store.upsert('imports', { ...common, itemId, variantId: '', qty: num(d.qty), extraFee: num(d.extraFee) });
        }
        m.close();
        toast(filled.length > 1 ? `Đã nhập ${filled.length} phân loại 📦` : 'Đã nhập hàng 📦');
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
const isLow = (p) => (hasVariants(p) ? p.variants.some((v) => vStock(p.id, v.id) <= lowOf(p)) : num(stock.products[p.id]) <= lowOf(p));

function pageProducts() {
  const q = normalize(ui.products.q);
  const list = S.products.filter((p) => !q || normalize([p.name, p.sku, ...(p.variants || []).flatMap((v) => [v.name, v.sku])].join(' ')).includes(q));

  const tile = (p) => `<button class="ptile tone-${toneOf(p)}" data-action="open-product" data-id="${p.id}">
      <span class="ptile-img">${thumb(p.image, p.name, 'xl')}</span>
      <span class="ptile-name">${esc(p.name)}</span>
      ${isLow(p) ? '<span class="chip warn ptile-flag">sắp hết</span>' : ''}
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
    ? p.variants.map((v) => ({ v, image: v.image, name: v.name, sku: v.sku, n: vStock(p.id, v.id), price: variantPrice(p, v) }))
    : [{ image: p.image, name: 'Tất cả', sku: p.sku, n: total, price: num(p.salePrice) }];
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
          const low = r.n <= lowOf(p);
          return `<div class="vcard ${low ? 'low' : ''}">
            ${thumb(r.image, r.name, '')}
            <div class="vcard-name"><b>${esc(r.name)}</b>${r.sku ? `<span class="muted small">${esc(r.sku)}</span>` : ''}</div>
            <div class="vcard-num"><span>Số lượng</span><b>${r.n}</b>${low ? '<span class="chip warn">sắp hết</span>' : ''}</div>
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
      ${imports.length ? `<div class="table-wrap"><table><tbody>${imports.map((i) => `<tr><td>${fmtDate(i.date)}</td><td>${esc(variantOf(p.id, i.variantId)?.name || '')}</td><td class="num">${num(i.qty)} cái</td><td class="num">${money(i.unitCost)}/cái</td><td><button class="icon-btn" data-edit-imp="${i.id}">✎</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Chưa nhập lần nào.</p>'}
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
  return `
    <div class="page-head">
      <div><h1>Đóng gói</h1><p>Dụng cụ đóng gói (hộp, túi, giấy, ruy băng…) và các “bộ đóng gói” dùng nhanh khi tạo đơn.</p></div>
      <div class="actions"><button class="btn ghost" data-action="new-pack">＋ Dụng cụ</button><button class="btn pink" data-action="new-preset">＋ Bộ đóng gói</button></div>
    </div>
    <div class="grid two">
      <div class="card table-wrap">
        <h3>Dụng cụ đóng gói</h3>
        ${S.packaging.length ? `<table><thead><tr><th>Tên</th><th class="num">Giá TB / cái</th><th class="num">Tồn</th><th></th></tr></thead><tbody>
          ${S.packaging.map((k) => {
            const st = num(stock.packaging[k.id]);
            return `<tr><td>${esc(k.name)}</td><td class="num">${money(costs.packaging[k.id])}</td><td class="num ${st <= num(k.lowStock ?? settings.lowStock) ? 'neg' : ''}"><b>${st}</b></td>
            <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-item" data-kind="packaging" data-id="${k.id}">✎</button><button class="icon-btn del" data-action="del-pack" data-id="${k.id}">🗑</button></td></tr>`;
          }).join('')}</tbody></table>` : '<div class="empty">Chưa có dụng cụ nào.</div>'}
      </div>
      <div class="card table-wrap">
        <h3>Bộ đóng gói</h3>
        ${S.presets.length ? `<table><thead><tr><th>Tên bộ</th><th>Gồm</th><th class="num">Chi phí</th><th></th></tr></thead><tbody>
          ${S.presets.map((pr) => `<tr><td><b>${esc(pr.name)}</b></td><td class="small">${PACK_SLOTS.map((k) => pack(pr[k])?.name).filter(Boolean).map(esc).join(' + ') || '—'}</td><td class="num">${money(presetCost(pr))}</td>
            <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-preset" data-id="${pr.id}">✎</button><button class="icon-btn del" data-action="del-preset" data-id="${pr.id}">🗑</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Tạo bộ đóng gói (VD: “Hộp quà cao cấp” = hộp + giấy lót + ruy băng) để chọn nhanh khi lên đơn.</div>'}
      </div>
    </div>`;
}

function openPackForm(existing) {
  const k = existing ? { ...existing } : { name: '', baseCost: 0, lowStock: '', adjust: 0 };
  openModal({
    title: existing ? 'Sửa dụng cụ đóng gói' : 'Thêm dụng cụ đóng gói',
    wide: false,
    body: `<form id="pack-form" class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field" style="grid-column:1/-1">Tên<input name="name" value="${esc(k.name)}" required placeholder="VD: Hộp carton 10x10"></label>
      <label class="field">Giá gốc (khi chưa có phiếu nhập)<input type="number" min="0" step="100" name="baseCost" value="${num(k.baseCost)}"></label>
      <label class="field">Cảnh báo khi tồn ≤<input type="number" min="0" name="lowStock" value="${esc(k.lowStock ?? '')}" placeholder="${settings.lowStock}"></label>
      <label class="field">Điều chỉnh tồn kho (±)<input type="number" name="adjust" value="${num(k.adjust)}"></label>
    </form>
    ${existing ? `<p class="small">Giá TB: <b>${money(costs.packaging[k.id])}</b> · Tồn: <b>${num(stock.packaging[k.id])}</b></p>` : ''}`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="k-save">Lưu</button>`,
    onMount(m) {
      const form = $('#pack-form', m);
      $('[data-close2]', m).onclick = () => m.close();
      $('#k-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const d = formData(form);
        await store.upsert('packaging', { ...k, name: d.name.trim(), baseCost: num(d.baseCost), lowStock: d.lowStock === '' ? null : num(d.lowStock), adjust: num(d.adjust) });
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
      ${PACK_SLOTS.map((s, i) => `<label class="field">Dụng cụ ${i + 1}<select name="${s}">${options(S.packaging, pr[s], '— không —')}</select></label>`).join('')}
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
        const sheets = buildSheets({ orders, costs, range, names });
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
  add(sheets.orders, 'Đơn hàng', [11, 10, 16, 18, 12, 40, 9, 12, 10, 12, 12, 10, 10, 10, 11, 12, 12, 12, 24]);
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
  await store.upsertMany('packaging', [box, paper, ribbon, bag, card]);
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
  ]);
  await store.upsertMany('orders', [
    { platform: 'instagram', code: 'IG-0001', date: d, customer: '@linh.ng', status: 'done', shipFee: 30000, shipPayer: 'customer', discount: 0, platformFee: 0,
      items: [{ productId: p1.id, qty: 2, price: 45000, pack1: bag.id, pack2: card.id, pack3: '', packEach: true }] },
    { platform: 'threads', code: 'TH-0001', date: d, customer: '@minh', status: 'shipping', shipFee: 25000, shipPayer: 'shop', discount: 10000, platformFee: 0,
      items: [{ productId: p3.id, qty: 1, price: 259000, pack1: box.id, pack2: paper.id, pack3: ribbon.id }] },
    { platform: 'instagram', code: 'IG-0002', date: d, customer: '@thu.ha', status: 'pending', shipFee: 30000, shipPayer: 'customer', discount: 0, platformFee: 0,
      items: [{ productId: cup.id, variantId: cup.variants[2].id, qty: 2, price: 89000, pack1: box.id, pack2: paper.id, pack3: ribbon.id }] },
  ]);
  toast('Đã nạp dữ liệu mẫu');
}

/* ================= events ================= */
document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { location.hash = tab.dataset.tab; return; }
  const period = e.target.closest('[data-period]');
  if (period) { ui.period = period.dataset.period; render(); return; }
  const kind = e.target.closest('[data-import-kind]');
  if (kind) { ui.imports.kind = kind.dataset.importKind; render(); return; }
  const goto = e.target.closest('[data-goto-status]');
  if (goto) { ui.orders.status = goto.dataset.gotoStatus; }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const confirmDel = async (coll, msg) => { if (await ask(msg)) await store.remove(coll, id); };
  switch (btn.dataset.action) {
    case 'new-order': return openOrderForm();
    case 'edit-order': return openOrderForm(store.get('orders', id));
    case 'del-order': return confirmDel('orders', 'Xoá đơn hàng này?');
    case 'new-import': return openImportForm();
    case 'edit-import': return openImportForm(store.get('imports', id));
    case 'del-import': return confirmDel('imports', 'Xoá phiếu nhập này? Tồn kho và giá vốn sẽ tính lại.');
    case 'new-product': return openProductForm();
    case 'open-product': return openProductDetail(id);
    case 'edit-item':
      e.preventDefault();
      return btn.dataset.kind === 'packaging' ? openPackForm(pack(id)) : openProductForm(product(id));
    case 'new-pack': return openPackForm();
    case 'del-pack': return confirmDel('packaging', 'Xoá dụng cụ này? (Các đơn cũ dùng dụng cụ này sẽ mất chi phí đóng gói tương ứng)');
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
  if (t.dataset.orderStatus) {
    const o = store.get('orders', t.dataset.orderStatus);
    await store.upsert('orders', { ...o, status: t.value });
  }
  if (t.id === 'set-low') await store.upsert('meta', { ...settings, lowStock: num(t.value) });
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
  if (err.code === 'invalid_argument' || err.code === 'not_granted') return notify('Không lưu được: bạn đang chỉ có quyền xem. Nhờ chủ shop chia sẻ quyền Editor.');
  if (err.code === 'quota_exceeded') return notify('Kho dữ liệu đã đầy. Hãy xuất sao lưu rồi xoá bớt đơn cũ.');
  if (err.code === 'revoked') return notify('Quyền truy cập trang đã thay đổi. Tải lại trang để tiếp tục.');
  notify('Lỗi lưu dữ liệu: ' + (err.message || err.code));
}

async function boot() {
  $('#app').innerHTML = '<div class="login"><div class="logo big">hani</div></div>';
  await initStore();
  store.onError = onStoreError;
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
}

window.addEventListener('unhandledrejection', (e) => { if (e.reason?.code) e.preventDefault(); });
boot();
