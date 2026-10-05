import { store, firebaseEnabled, restoreBackup, uid } from './store.js';
import {
  PLATFORMS, STATUSES, INACTIVE_STATUSES, PACK_SLOTS,
  costTable, lineCost, orderSummary, stockLevels, aggregate,
} from './calc.js';
import { rowsToOrders, listingKey, normalize } from './shopee.js';

/* ================= helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(+n || 0).toLocaleString('vi-VN')}đ`;
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const signCls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'vi');

const CATEGORIES = { her: 'for her', him: 'for him', friend: 'for friend', other: 'khác' };

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

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
      <span class="sync" title="${firebaseEnabled ? 'Dữ liệu đồng bộ qua Firebase' : 'Dữ liệu chỉ lưu trong trình duyệt này'}">
        <i class="dot ${firebaseEnabled ? '' : 'local'}"></i>${firebaseEnabled ? esc(store.user?.email || 'Online') : 'Chỉ máy này'}
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

/* ================= DASHBOARD ================= */
function periodRange() {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
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
  const lowP = S.products.filter((p) => num(stock.products[p.id]) <= num(p.lowStock ?? settings.lowStock));
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
          ${lowP.map((p) => `<tr><td>${esc(p.name)}</td><td><span class="chip ${p.category || 'other'}">Sản phẩm</span></td><td class="num neg">${num(stock.products[p.id])}</td></tr>`).join('')}
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
    .filter((o) => !q || normalize([o.code, o.customer, o.note, ...(o.items || []).map((l) => product(l.productId)?.name || l.productName)].join(' ')).includes(q))
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
    return p ? `${esc(p.name)} <span class="muted">×${l.qty}</span>` : `<span class="chip warn">chưa gắn</span> ${esc(l.productName || '')} ×${l.qty}`;
  }).join('<br>');
  return `<tr style="${inactive ? 'opacity:.55' : ''}">
    <td>${fmtDate(o.date)}</td>
    <td><span class="chip ${o.platform}">${PLATFORMS[o.platform]?.label || o.platform}</span></td>
    <td><b>${esc(o.code || '—')}</b><br><span class="muted small">${esc(o.customer || '')}</span></td>
    <td class="small">${items}</td>
    <td class="num">${money(s.revenue)}</td>
    <td class="num">${money(s.cost)}</td>
    <td class="num ${signCls(s.profit)}"><b>${money(s.profit)}</b></td>
    <td class="small">${money(o.shipFee)}<br><span class="muted">${o.shipPayer === 'shop' ? 'Shop chịu' : 'Khách chịu'}</span></td>
    <td><select data-order-status="${o.id}" class="small" style="width:auto">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-order" data-id="${o.id}" title="Sửa">✎</button><button class="icon-btn del" data-action="del-order" data-id="${o.id}" title="Xoá">🗑</button></td>
  </tr>`;
}

function blankLine() {
  return { productId: '', qty: 1, price: 0, pack1: '', pack2: '', pack3: '', packEach: false };
}

function openOrderForm(existing) {
  const o = existing ? structuredClone(existing) : {
    platform: 'instagram', code: '', date: today(), customer: '', status: 'pending', note: '',
    shipFee: 0, shipPayer: 'customer', discount: 0, platformFee: 0, items: [blankLine()],
  };
  if (!o.items?.length) o.items = [blankLine()];

  const lineHtml = (l, i) => `
    <div class="line" data-line="${i}">
      <label class="field">Sản phẩm
        <select data-f="productId">${options(S.products, l.productId, l.productId ? undefined : (l.productName ? `⚠ ${esc(l.productName)}` : '— chọn sản phẩm —'))}</select>
      </label>
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
          <span>Tồn kho: <b>${l.productId ? num(stock.products[l.productId]) : '—'}</b></span>
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

function matchProduct(line) {
  const key = listingKey(line);
  const mapped = settings.shopeeMap[key];
  if (mapped && product(mapped)) return mapped;
  if (line.sku) {
    const bySku = S.products.find((p) => p.sku && normalize(p.sku) === normalize(line.sku));
    if (bySku) return bySku.id;
  }
  const byName = S.products.find((p) => normalize(p.name) === normalize(line.productName));
  return byName?.id || '';
}

async function importShopeeFile(file) {
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    const parsed = rowsToOrders(rows);
    if (!parsed.length) return toast('File không có đơn hàng nào');

    const unmatched = new Map();
    for (const o of parsed) for (const l of o.items) if (!matchProduct(l)) unmatched.set(listingKey(l), l);
    if (unmatched.size) openMappingDialog(parsed, [...unmatched.entries()]);
    else await commitShopee(parsed);
  } catch (e) {
    console.error(e);
    alert('Lỗi đọc file: ' + e.message);
  }
}

function openMappingDialog(parsed, unmatched) {
  openModal({
    title: 'Gắn sản phẩm Shopee với kho',
    body: `<p class="muted">Có ${unmatched.length} sản phẩm trong file chưa biết là hàng nào trong kho. Chọn một lần, lần sau app tự nhớ.</p>
      <div class="table-wrap"><table><thead><tr><th>Sản phẩm trên Shopee</th><th>SKU</th><th>Hàng trong kho</th></tr></thead><tbody>
      ${unmatched.map(([key, l], i) => `<tr><td>${esc(l.productName)}</td><td class="muted">${esc(l.sku)}</td>
        <td><select data-map="${i}"><option value="">— bỏ qua (gắn sau) —</option><option value="__new">＋ Tạo sản phẩm mới</option>${options(S.products, '')}</select></td></tr>`).join('')}
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
      const items = old.items?.length ? old.items.map((l) => (l.productId ? l : { ...l, productId: matchProduct(l) })) : o.items;
      return { ...old, status: o.status, platformFee: o.platformFee, discount: o.discount, shipFee: o.shipFee, items };
    }
    added++;
    o.items = o.items.map((l) => {
      const productId = matchProduct(l);
      const pr = store.get('presets', product(productId)?.defaultPreset);
      return { ...l, productId, pack1: pr?.pack1 || '', pack2: pr?.pack2 || '', pack3: pr?.pack3 || '', packEach: false };
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

function pageImports() {
  const f = ui.imports;
  const q = normalize(f.q);
  const list = S.imports
    .filter((i) => !f.kind || i.kind === f.kind)
    .filter((i) => !q || normalize([itemOf(i)?.name, i.supplier, i.note].join(' ')).includes(q))
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
            <td><a href="javascript:void 0" data-action="edit-item" data-kind="${i.kind}" data-id="${i.itemId}">${esc(item?.name || '(đã xoá)')}</a>${i.note ? `<br><span class="small muted">${esc(i.note)}</span>` : ''}</td>
            <td><span class="chip ${i.kind === 'packaging' ? 'backup' : item?.category || 'him'}">${i.kind === 'packaging' ? 'Đóng gói' : 'Sản phẩm'}</span></td>
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

function openImportForm(existing) {
  const imp = existing ? { ...existing } : { kind: ui.imports.kind || 'product', itemId: '', date: today(), qty: 1, unitCost: 0, extraFee: 0, supplier: '', note: '' };
  const itemOptions = (kind, sel) => options(kind === 'packaging' ? S.packaging : S.products, sel, '— chọn —') + '<option value="__new">＋ Mặt hàng mới…</option>';
  openModal({
    title: existing ? 'Sửa phiếu nhập' : 'Phiếu nhập hàng',
    wide: false,
    body: `<form id="import-form" class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field">Loại<select name="kind"><option value="product" ${imp.kind !== 'packaging' ? 'selected' : ''}>Sản phẩm</option><option value="packaging" ${imp.kind === 'packaging' ? 'selected' : ''}>Dụng cụ đóng gói</option></select></label>
      <label class="field">Ngày nhập<input type="date" name="date" value="${esc(imp.date)}" required></label>
      <label class="field" style="grid-column:1/-1">Mặt hàng<select name="itemId" required>${itemOptions(imp.kind, imp.itemId)}</select></label>
      <label class="field" style="grid-column:1/-1;display:none" id="new-item-wrap">Tên mặt hàng mới<input name="newName" placeholder="VD: Móc khoá mica 5cm"></label>
      <label class="field">Số lượng<input type="number" min="0" name="qty" value="${num(imp.qty)}" required></label>
      <label class="field">Giá nhập / đơn vị<input type="number" min="0" step="100" name="unitCost" value="${num(imp.unitCost)}" required></label>
      <label class="field">Phí ship / phí khác (cả lô)<input type="number" min="0" step="1000" name="extraFee" value="${num(imp.extraFee)}"></label>
      <label class="field">Nhà cung cấp<input name="supplier" value="${esc(imp.supplier)}"></label>
      <label class="field" style="grid-column:1/-1">Ghi chú<input name="note" value="${esc(imp.note)}"></label>
      <div class="summary" style="grid-column:1/-1" id="imp-sum"></div>
    </form>`,
    foot: `${existing ? '<button class="btn danger" id="imp-del" style="margin-right:auto">Xoá phiếu</button>' : ''}<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="imp-save">Lưu</button>`,
    onMount(m) {
      const form = $('#import-form', m);
      const sync = () => {
        const d = formData(form);
        $('#new-item-wrap', m).style.display = d.itemId === '__new' ? '' : 'none';
        const total = num(d.qty) * num(d.unitCost) + num(d.extraFee);
        $('#imp-sum', m).innerHTML = `<div><span>Thành tiền</span><b>${money(total)}</b></div><div><span>Vốn / đơn vị</span><b>${money(num(d.qty) ? total / num(d.qty) : 0)}</b></div>`;
      };
      form.kind.onchange = () => { form.itemId.innerHTML = itemOptions(form.kind.value, ''); sync(); };
      form.addEventListener('input', sync);
      form.addEventListener('change', sync);
      sync();
      $('[data-close2]', m).onclick = () => m.close();
      if (existing) $('#imp-del', m).onclick = async () => { if (confirm('Xoá phiếu nhập này?')) { await store.remove('imports', existing.id); m.close(); } };
      $('#imp-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const d = formData(form);
        let itemId = d.itemId;
        if (itemId === '__new') {
          if (!d.newName.trim()) return toast('Nhập tên mặt hàng mới');
          const coll = d.kind === 'packaging' ? 'packaging' : 'products';
          const item = await store.upsert(coll, { name: d.newName.trim(), ...(coll === 'products' ? { category: 'other', salePrice: 0 } : {}) });
          itemId = item.id;
        }
        await store.upsert('imports', {
          ...imp, kind: d.kind, itemId, date: d.date, qty: num(d.qty), unitCost: num(d.unitCost), extraFee: num(d.extraFee),
          supplier: d.supplier.trim(), note: d.note.trim(),
        });
        m.close();
        toast(existing ? 'Đã cập nhật phiếu nhập' : 'Đã nhập hàng 📦');
      };
    },
  });
}

/* ================= PRODUCTS ================= */
function pageProducts() {
  const fullCost = (p) => num(costs.product[p.id]) + presetCost(store.get('presets', p.defaultPreset));
  return `
    <div class="page-head">
      <div><h1>Sản phẩm</h1><p>Giá thành đầy đủ = giá vốn SP + bộ đóng gói mặc định. Gắn SKU trùng với Shopee để nhập đơn tự khớp.</p></div>
      <div class="actions"><button class="btn pink" data-action="new-product">＋ Sản phẩm</button></div>
    </div>
    <div class="card table-wrap">
      ${S.products.length ? `<table>
        <thead><tr><th>Sản phẩm</th><th>Nhóm</th><th>SKU</th><th class="num">Giá bán</th><th class="num">Giá vốn TB</th><th>Bộ đóng gói mặc định</th><th class="num">Giá thành đủ</th><th class="num">Lãi / cái</th><th class="num">Tồn</th><th></th></tr></thead>
        <tbody>${S.products.map((p) => {
          const fc = fullCost(p);
          const profit = num(p.salePrice) - fc;
          const st = num(stock.products[p.id]);
          return `<tr>
            <td><b>${esc(p.name)}</b></td>
            <td><span class="chip ${p.category || 'other'}">${CATEGORIES[p.category] || 'khác'}</span></td>
            <td class="muted small">${esc(p.sku || '')}</td>
            <td class="num">${money(p.salePrice)}</td>
            <td class="num">${money(costs.product[p.id])}</td>
            <td class="small">${esc(store.get('presets', p.defaultPreset)?.name || '—')}</td>
            <td class="num">${money(fc)}</td>
            <td class="num ${signCls(profit)}">${money(profit)} <span class="small muted">${num(p.salePrice) ? Math.round((profit / num(p.salePrice)) * 100) + '%' : ''}</span></td>
            <td class="num ${st <= num(p.lowStock ?? settings.lowStock) ? 'neg' : ''}"><b>${st}</b></td>
            <td style="white-space:nowrap"><button class="icon-btn" data-action="edit-item" data-kind="product" data-id="${p.id}">✎</button><button class="icon-btn del" data-action="del-product" data-id="${p.id}">🗑</button></td>
          </tr>`;
        }).join('')}</tbody></table>` : '<div class="empty">Chưa có sản phẩm. Thêm sản phẩm hoặc tạo phiếu nhập.</div>'}
    </div>
    ${S.products.length && S.presets.length ? `
    <div class="card" style="margin-top:16px">
      <h3>Bảng giá thành theo cách đóng gói</h3>
      <p class="small muted" style="margin-top:-6px">Giá vốn SP + chi phí bộ đóng gói (1 cái). Dùng để chọn giá bán cho từng kiểu gói quà.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Sản phẩm</th><th class="num">Không gói</th>${S.presets.map((pr) => `<th class="num">${esc(pr.name)}<br><span class="small muted">+${money(presetCost(pr))}</span></th>`).join('')}</tr></thead>
        <tbody>${S.products.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${money(costs.product[p.id])}</td>${S.presets.map((pr) => {
          const c = num(costs.product[p.id]) + presetCost(pr);
          return `<td class="num" ${pr.id === p.defaultPreset ? 'style="background:var(--blue-soft);font-weight:700"' : ''}>${money(c)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}`;
}

function openProductForm(existing) {
  const p = existing ? { ...existing } : { name: '', sku: '', category: 'her', salePrice: 0, baseCost: 0, defaultPreset: '', lowStock: '', adjust: 0, note: '' };
  const imports = existing ? S.imports.filter((i) => i.kind !== 'packaging' && i.itemId === p.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];
  openModal({
    title: existing ? 'Sửa sản phẩm' : 'Thêm sản phẩm',
    wide: false,
    body: `<form id="product-form" class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field" style="grid-column:1/-1">Tên sản phẩm<input name="name" value="${esc(p.name)}" required></label>
      <label class="field">Nhóm<select name="category">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${p.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">SKU (trùng SKU trên Shopee)<input name="sku" value="${esc(p.sku)}"></label>
      <label class="field">Giá bán<input type="number" min="0" step="1000" name="salePrice" value="${num(p.salePrice)}"></label>
      <label class="field">Giá gốc (khi chưa có phiếu nhập)<input type="number" min="0" step="100" name="baseCost" value="${num(p.baseCost)}"></label>
      <label class="field" style="grid-column:1/-1">Bộ đóng gói mặc định<select name="defaultPreset">${options(S.presets, p.defaultPreset, '— không —')}</select></label>
      <label class="field">Cảnh báo khi tồn ≤<input type="number" min="0" name="lowStock" value="${esc(p.lowStock ?? '')}" placeholder="${settings.lowStock}"></label>
      <label class="field">Điều chỉnh tồn kho (±)<input type="number" name="adjust" value="${num(p.adjust)}" title="Dùng cho hàng hỏng, kiểm kê lệch…"></label>
      <label class="field" style="grid-column:1/-1">Ghi chú<input name="note" value="${esc(p.note)}"></label>
    </form>
    ${existing ? `<h3 style="margin:16px 0 8px">Lịch sử nhập (${imports.length})</h3>
      ${imports.length ? `<table><tbody>${imports.map((i) => `<tr><td>${fmtDate(i.date)}</td><td class="num">${num(i.qty)} cái</td><td class="num">${money(i.unitCost)}/cái</td><td><button class="icon-btn" data-edit-imp="${i.id}">✎</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Chưa nhập lần nào.</p>'}
      <p class="small">Giá vốn TB: <b>${money(costs.product[p.id])}</b> · Tồn: <b>${num(stock.products[p.id])}</b></p>` : ''}`,
    foot: `<button class="btn ghost" data-close2>Huỷ</button><button class="btn" id="p-save">Lưu</button>`,
    onMount(m) {
      const form = $('#product-form', m);
      $('[data-close2]', m).onclick = () => m.close();
      $$('[data-edit-imp]', m).forEach((b) => (b.onclick = () => openImportForm(store.get('imports', b.dataset.editImp))));
      $('#p-save', m).onclick = async () => {
        if (!form.reportValidity()) return;
        const d = formData(form);
        await store.upsert('products', {
          ...p, name: d.name.trim(), category: d.category, sku: d.sku.trim(), salePrice: num(d.salePrice), baseCost: num(d.baseCost),
          defaultPreset: d.defaultPreset, lowStock: d.lowStock === '' ? null : num(d.lowStock), adjust: num(d.adjust), note: d.note.trim(),
        });
        m.close();
        toast('Đã lưu sản phẩm');
      };
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
        ${firebaseEnabled ? `
          <p>✅ Đang đồng bộ online qua Firebase. Mọi thay đổi hiện ngay trên máy đồng nghiệp.</p>
          <p class="small muted">Đăng nhập: <b>${esc(store.user?.email || '')}</b></p>
          <div class="toolbar"><button class="btn" data-action="copy-link">Sao chép link gửi đồng nghiệp</button><button class="btn ghost" data-action="sign-out">Đăng xuất</button></div>
          <p class="small muted">Đồng nghiệp cần đăng nhập Google bằng email đã được thêm vào <code>firestore.rules</code>.</p>`
        : `
          <p>⚠️ Đang ở chế độ <b>chỉ máy này</b>: dữ liệu lưu trong trình duyệt, đồng nghiệp chưa xem được.</p>
          <p class="small muted">Để dùng chung: tạo project Firebase (miễn phí), dán cấu hình vào <code>js/firebase-config.js</code> rồi deploy — xem hướng dẫn trong README. Dữ liệu hiện có có thể chuyển sang bằng nút Sao lưu/Khôi phục.</p>`}
      </div>
      <div class="card">
        <h3>Sao lưu</h3>
        <div class="toolbar">
          <button class="btn" data-action="backup">⬇ Tải bản sao lưu (.json)</button>
          <label class="btn ghost">⬆ Khôi phục<input type="file" id="restore-file" accept=".json" hidden></label>
          <button class="btn ghost" data-action="export-orders">⬇ Xuất đơn hàng (.csv)</button>
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

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportOrdersCsv() {
  const head = ['Ngày', 'Nền tảng', 'Mã đơn', 'Khách', 'Trạng thái', 'Sản phẩm', 'Doanh thu', 'Giá vốn SP', 'Đóng gói', 'Phí sàn', 'Ship shop chịu', 'Lợi nhuận'];
  const rows = [...S.orders].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((o) => {
    const s = orderSummary(costs, o);
    return [o.date, PLATFORMS[o.platform]?.label, o.code, o.customer, STATUSES[o.status],
      (o.items || []).map((l) => `${product(l.productId)?.name || l.productName || '?'} x${l.qty}`).join('; '),
      s.revenue, s.product, s.packaging, s.fee, s.ship, s.profit].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  });
  download(`hani-don-hang-${today()}.csv`, '﻿' + [head.join(','), ...rows].join('\n'), 'text/csv');
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
  await store.upsertMany('products', [p1, p2, p3]);
  const d = today();
  await store.upsertMany('imports', [
    { kind: 'product', itemId: p1.id, date: d, qty: 100, unitCost: 15000, extraFee: 50000, supplier: 'Xưởng in A' },
    { kind: 'product', itemId: p2.id, date: d, qty: 30, unitCost: 55000, extraFee: 30000, supplier: 'Xưởng gỗ B' },
    { kind: 'product', itemId: p3.id, date: d, qty: 20, unitCost: 140000, extraFee: 0, supplier: '' },
    ...[box, paper, ribbon, bag, card].map((x) => ({ kind: 'packaging', itemId: x.id, date: d, qty: 200, unitCost: x.baseCost, extraFee: 0 })),
  ]);
  await store.upsertMany('orders', [
    { platform: 'instagram', code: 'IG-0001', date: d, customer: '@linh.ng', status: 'done', shipFee: 30000, shipPayer: 'customer', discount: 0, platformFee: 0,
      items: [{ productId: p1.id, qty: 2, price: 45000, pack1: bag.id, pack2: card.id, pack3: '', packEach: true }] },
    { platform: 'threads', code: 'TH-0001', date: d, customer: '@minh', status: 'shipping', shipFee: 25000, shipPayer: 'shop', discount: 10000, platformFee: 0,
      items: [{ productId: p3.id, qty: 1, price: 259000, pack1: box.id, pack2: paper.id, pack3: ribbon.id }] },
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
  const confirmDel = async (coll, msg) => { if (confirm(msg)) await store.remove(coll, id); };
  switch (btn.dataset.action) {
    case 'new-order': return openOrderForm();
    case 'edit-order': return openOrderForm(store.get('orders', id));
    case 'del-order': return confirmDel('orders', 'Xoá đơn hàng này?');
    case 'new-import': return openImportForm();
    case 'edit-import': return openImportForm(store.get('imports', id));
    case 'del-import': return confirmDel('imports', 'Xoá phiếu nhập này? Tồn kho và giá vốn sẽ tính lại.');
    case 'new-product': return openProductForm();
    case 'edit-item':
      e.preventDefault();
      return btn.dataset.kind === 'packaging' ? openPackForm(pack(id)) : openProductForm(product(id));
    case 'del-product':
      if (S.orders.some((o) => o.items?.some((l) => l.productId === id))) return alert('Sản phẩm đã có trong đơn hàng, không xoá được.');
      return confirmDel('products', 'Xoá sản phẩm này?');
    case 'new-pack': return openPackForm();
    case 'del-pack': return confirmDel('packaging', 'Xoá dụng cụ này? (Các đơn cũ dùng dụng cụ này sẽ mất chi phí đóng gói tương ứng)');
    case 'new-preset': return openPresetForm();
    case 'edit-preset': return openPresetForm(store.get('presets', id));
    case 'del-preset': return confirmDel('presets', 'Xoá bộ đóng gói này?');
    case 'copy-link':
      await navigator.clipboard.writeText(location.origin + location.pathname);
      return toast('Đã sao chép link');
    case 'sign-out': return store.signOut();
    case 'backup': return download(`hani-backup-${today()}.json`, JSON.stringify(store.state, null, 2), 'application/json');
    case 'export-orders': return exportOrdersCsv();
    case 'clear-map': return store.upsert('meta', { ...settings, shopeeMap: {} });
    case 'demo': return loadDemo();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'order-q') { ui.orders.q = t.value; render(); }
  if (t.id === 'import-q') { ui.imports.q = t.value; render(); }
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
      if (confirm('Thay toàn bộ dữ liệu hiện tại bằng bản sao lưu này?')) { await restoreBackup(backup); toast('Đã khôi phục'); }
    } catch (err) { alert('File sao lưu không hợp lệ: ' + err.message); }
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

let renderQueued = false;
store.onChange(() => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; if (!firebaseEnabled || store.user) render(); });
});

if (firebaseEnabled) {
  $('#app').innerHTML = '<div class="login"><div class="logo big">hani</div></div>';
  store.onError = (err) => {
    if (err.code === 'permission-denied') renderLogin(`Email ${store.user?.email} chưa được cấp quyền. Nhờ chủ shop thêm email vào firestore.rules.`);
  };
  store.init((user) => (user ? render() : renderLogin())).catch((err) => renderLogin('Không kết nối được Firebase: ' + err.message));
} else {
  store.init().then(render);
}
