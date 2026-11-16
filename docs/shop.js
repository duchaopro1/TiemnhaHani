// Hani web shop (for customers): browse the catalog, fill a cart, then send the order to the shop as a chat message.
// The catalog is a file (catalog.json) the shop exports from its admin app; nothing here talks to a server.
import { priceCart, buildOrderMessage, unitPrice, money } from './lib/shoporder.js';
import { live, watchCatalog, sendOrder } from './lib/backend.js';

const CART_KEY = 'hani-shop-cart-v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (Number.isFinite(+v) ? +v : 0);

let catalog = { shop: {}, categories: [], products: [] };
let cart = [];
let view = { cat: '', q: '' };
const sheet = $('#sheet');

const load = () => { try { const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(c) ? c : []; } catch { return []; } };
const save = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode: the cart lives for this visit only */ } };
const byId = (id) => catalog.products.find((p) => p.id === id);

/** How many of a product (or one of its variants) the shelf can still give: the cap of the quantity pickers. */
const maxOf = (p, vid) => (vid ? num(p.variants.find((v) => v.id === vid)?.stock) : num(p.stock));
const soldOut = (p) => num(p.stock) <= 0;
const fromPrice = (p) => {
  const prices = [p.price, ...(p.variants || []).map((v) => (num(v.price) > 0 ? v.price : p.price))];
  return Math.min(...prices);
};
const pic = (src, alt = '') => (src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : '⭐');

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------------- list ---------------- */
function render() {
  const { shop, categories, products } = catalog;
  document.title = `Cửa hàng ${shop.name || 'Hani'}`;
  const q = view.q.trim().toLowerCase();
  const shown = products.filter((p) => (!view.cat || p.category === view.cat) && (!q || p.name.toLowerCase().includes(q)));
  const cats = view.cat ? [view.cat] : categories;
  const card = (p) => {
    const out = soldOut(p);
    const badge = out ? '<span class="badge out">Hết hàng</span>' : p.combo ? '<span class="badge combo">Combo</span>' : num(p.stock) <= 3 ? `<span class="badge low">Còn ${num(p.stock)}</span>` : '';
    const multi = (p.variants || []).some((v) => num(v.price) > 0 && num(v.price) !== num(p.price));
    return `<button type="button" class="card ${out ? 'soldout' : ''}" data-open="${esc(p.id)}">
      ${badge}<span class="pic">${pic(p.image, p.name)}</span>
      <span class="info"><span class="name">${esc(p.name)}</span><span class="price">${multi ? '<small>từ </small>' : ''}${money(fromPrice(p))}</span></span></button>`;
  };
  const body = products.length === 0
    ? `<div class="empty">${esc(shop.welcome || 'Cửa hàng đang được cập nhật, bạn quay lại sau nhé.')}</div>`
    : shown.length === 0 ? '<div class="empty">Không tìm thấy sản phẩm phù hợp.</div>'
      : `<div class="grid">${cats.map((c) => {
        const list = shown.filter((p) => p.category === c);
        return list.length ? `<h2 class="cat-title">${esc(c)}</h2>${list.map(card).join('')}` : '';
      }).join('')}</div>`;
  $('#shop').innerHTML = `
    <header class="top"><h1>${esc(shop.name || 'Hani')}</h1>${products.length && shop.welcome ? `<p>${esc(shop.welcome)}</p>` : ''}</header>
    ${products.length ? `<div class="wrap"><div class="tools">
      <div class="toolrow"><input class="search" type="search" id="q" placeholder="Tìm sản phẩm…" value="${esc(view.q)}" aria-label="Tìm sản phẩm" autocomplete="off"><button type="button" class="hcart" id="hcart" data-cart hidden></button></div>
      ${categories.length > 1 ? `<div class="chips" role="tablist"><button type="button" class="chip ${view.cat ? '' : 'on'}" data-cat="">Tất cả</button>${categories.map((c) => `<button type="button" class="chip ${view.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    </div>${body}</div>` : `<div class="wrap">${body}</div>`}
    ${catalog.updatedAt ? `<p class="fine">Số lượng còn lại cập nhật ngày ${new Date(catalog.updatedAt).toLocaleDateString('vi-VN')}. Shop sẽ xác nhận lại với bạn khi nhận đơn.</p>` : ''}
    <div class="cartbar" id="cartbar" hidden></div>`;
  drawBar();
  const q$ = $('#q');
  if (q$ && view.focusQ) { q$.focus(); q$.setSelectionRange(q$.value.length, q$.value.length); }
}

function drawBar() {
  const bar = $('#cartbar');
  if (!bar) return;
  const r = priceCart(cart, catalog);
  const h = $('#hcart');
  if (h) { h.hidden = !r.lines.length; h.innerHTML = `🛒 Giỏ hàng · ${r.pieces} · <b>${money(r.goods)}</b>`; }
  bar.hidden = !r.lines.length;
  bar.innerHTML = r.lines.length ? `<button type="button" class="btn" data-cart><span>🛒 Giỏ hàng · ${r.pieces} sản phẩm</span><span>${money(r.goods)}</span></button>` : '';
}

/* ---------------- sheet helpers ---------------- */
function openSheet(html, size = 'mid') {
  sheet.className = size; // 'wide' for a product (picture beside the choices on a big screen), 'mid' for the rest
  sheet.innerHTML = `<div class="sheet-in">${html}</div>`;
  if (!sheet.open) sheet.showModal();
}
const closeSheet = () => { if (sheet.open) sheet.close(); };
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // tap outside

const stepper = (key, value, max) => `<span class="step" data-step="${esc(key)}"><button type="button" data-d="-1" aria-label="Giảm" ${value <= 0 ? 'disabled' : ''}>−</button><input type="number" inputmode="numeric" min="0" max="${max}" value="${value}" aria-label="Số lượng"><button type="button" data-d="1" aria-label="Tăng" ${value >= max ? 'disabled' : ''}>+</button></span>`;

/* ---------------- product sheet ---------------- */
function openProduct(id) {
  const p = byId(id);
  if (!p) return;
  const picks = {}; // vid ('' = product itself) -> quantity chosen here
  const inCart = (vid) => cart.filter((l) => l.pid === id && l.vid === vid).reduce((n, l) => n + l.qty, 0);
  const room = (vid) => Math.max(0, maxOf(p, vid) - inCart(vid));
  const hasVar = (p.variants || []).length > 0;
  const tiers = [...(p.tiers || [])].sort((a, b) => a.minQty - b.minQty);
  const draw = () => {
    const total = Object.values(picks).reduce((n, x) => n + x, 0);
    $('#add', sheet).disabled = total <= 0;
    $('#add', sheet).textContent = total > 0 ? `Thêm ${total} sản phẩm vào giỏ` : 'Chọn số lượng để thêm vào giỏ';
  };
  openSheet(`
    <div class="sheet-head"><h2>${esc(p.name)}</h2><button type="button" class="x" data-close aria-label="Đóng">✕</button></div>
    <div class="sheet-body"><div class="pcols">
      <div class="hero">${pic(p.image, p.name)}</div>
      <div class="pinfo">
      <div class="big-price">${money(fromPrice(p))}${hasVar && fromPrice(p) !== p.price ? '' : ''}</div>
      ${tiers.length ? `<p class="tiers">${tiers.map((t) => `Từ ${t.minQty} cái: <b>${money(t.price)}</b>/cái`).join(' · ')}</p>` : ''}
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
      ${p.combo ? `<p><b>Combo gồm:</b></p><ul class="combo-list">${p.combo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${hasVar
        ? `<p style="margin:10px 0 0"><b>Chọn loại và số lượng</b></p><div class="variants">${p.variants.map((v) => {
          const r = room(v.id);
          return `<div class="var ${r <= 0 ? 'out' : ''}"><span class="th">${pic(v.image || p.image, v.name)}</span><span><b>${esc(v.name)}</b><small>${r <= 0 ? 'Hết hàng' : num(v.price) > 0 && num(v.price) !== num(p.price) ? money(v.price) : ''}</small></span>${r > 0 ? stepper(v.id, 0, r) : ''}</div>`;
        }).join('')}</div>`
        : `<div class="var ${room('') <= 0 ? 'out' : ''}" style="grid-template-columns:1fr auto"><span><b>Số lượng</b><small>${room('') <= 0 ? 'Hết hàng' : ''}</small></span>${room('') > 0 ? stepper('', 0, room('')) : ''}</div>`}
      <label class="f"><span>Ghi chú cho sản phẩm này <small>(không bắt buộc, vd: tên muốn khắc, màu ưu tiên)</small></span><textarea class="in" id="pnote" maxlength="300"></textarea></label>
      </div></div>
    </div>
    <div class="sheet-foot"><button type="button" class="btn pink" id="add" disabled></button></div>`, 'wide');
  draw();
  const set = (key, n, input) => {
    const cap = room(key);
    picks[key] = Math.max(0, Math.min(cap, Math.round(num(n))));
    const el = $(`[data-step="${CSS.escape(key)}"]`, sheet);
    if (el) {
      $('input', el).value = picks[key];
      $('[data-d="-1"]', el).disabled = picks[key] <= 0;
      $('[data-d="1"]', el).disabled = picks[key] >= cap;
    }
    if (input && picks[key] !== num(input.value)) input.value = picks[key];
    draw();
  };
  sheet.onclick = (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const b = e.target.closest('[data-d]');
    if (b) { const key = b.closest('[data-step]').dataset.step; set(key, (picks[key] || 0) + num(b.dataset.d)); }
    if (e.target.id === 'add') {
      const note = $('#pnote', sheet).value.trim();
      for (const [vid, qty] of Object.entries(picks)) {
        if (qty <= 0) continue;
        const line = cart.find((l) => l.pid === id && l.vid === vid);
        if (line) { line.qty += qty; if (note) line.note = [line.note, note].filter(Boolean).join('; '); } else cart.push({ pid: id, vid, qty, note });
      }
      save();
      closeSheet();
      drawBar();
      toast('Đã thêm vào giỏ hàng');
    }
  };
  sheet.onchange = (e) => { const s = e.target.closest('[data-step]'); if (s && e.target.matches('input')) set(s.dataset.step, e.target.value, e.target); };
}

/* ---------------- cart ---------------- */
function openCart() {
  const r = priceCart(cart, catalog);
  cart = cart.filter((l) => byId(l.pid)); // a product that left the catalog is dropped
  if (!r.lines.length) { closeSheet(); drawBar(); return; }
  openSheet(`
    <div class="sheet-head"><h2>Giỏ hàng</h2><button type="button" class="x" data-close aria-label="Đóng">✕</button></div>
    <div class="sheet-body">
      ${r.lines.map((l, i) => {
        const cap = maxOf(l.product, l.variant?.id || '');
        return `<div class="line" data-i="${i}">
          <span class="th">${pic(l.variant?.image || l.product.image, l.name)}</span>
          <div><b>${esc(l.name)}</b><div class="small" style="color:var(--muted)">${money(l.unit)}/cái${l.unit < unitPrice(l.product, l.variant, 1) ? ' · đã áp giá mua nhiều' : ''}</div>
            <div class="row">${stepper(String(i), l.qty, cap)}<b>${money(l.amount)}</b><button type="button" class="del" data-rm="${i}" aria-label="Xoá">Xoá</button></div>
            <input class="in note" data-note="${i}" maxlength="300" placeholder="Ghi chú (không bắt buộc)" value="${esc(l.note || '')}"></div></div>`;
      }).join('')}
      <div class="sum"><div><span>Tạm tính</span><b>${money(r.goods)}</b></div><div><span>Phí ship đồng giá</span><b>${money(r.ship)}</b></div><div class="total"><span>Tổng cộng</span><span>${money(r.total)}</span></div></div>
    </div>
    <div class="sheet-foot"><button type="button" class="btn pink" data-checkout>Điền thông tin đặt hàng</button><button type="button" class="btn ghost" data-close>Chọn thêm sản phẩm</button></div>`);
  sheet.onclick = (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const rm = e.target.closest('[data-rm]');
    if (rm) { r.lines.splice(+rm.dataset.rm, 1); syncFrom(r); return openCart(); }
    const b = e.target.closest('[data-d]');
    if (b) {
      const l = r.lines[+b.closest('[data-step]').dataset.step];
      l.qty = Math.max(0, Math.min(maxOf(l.product, l.variant?.id || ''), l.qty + num(b.dataset.d)));
      if (l.qty === 0) r.lines.splice(r.lines.indexOf(l), 1);
      syncFrom(r);
      return openCart();
    }
    if (e.target.closest('[data-checkout]')) openCheckout();
  };
  sheet.onchange = (e) => {
    const s = e.target.closest('[data-step]');
    if (s && e.target.matches('input')) {
      const l = r.lines[+s.dataset.step];
      l.qty = Math.max(0, Math.min(maxOf(l.product, l.variant?.id || ''), Math.round(num(e.target.value))));
      if (l.qty === 0) r.lines.splice(r.lines.indexOf(l), 1);
      syncFrom(r);
      return openCart();
    }
    if (e.target.matches('[data-note]')) { r.lines[+e.target.dataset.note].note = e.target.value.trim(); syncFrom(r, false); }
  };
}
/** Write the edited priced lines back as the cart. */
function syncFrom(r) {
  cart = r.lines.map((l) => ({ pid: l.pid, vid: l.vid || '', qty: l.qty, note: l.note || '' }));
  save();
  drawBar();
}

/* ---------------- checkout ---------------- */
const INFO_KEY = 'hani-shop-info-v1';
const readInfo = () => { try { return JSON.parse(localStorage.getItem(INFO_KEY) || '{}'); } catch { return {}; } };
function openCheckout() {
  const r = priceCart(cart, catalog);
  const info = readInfo();
  openSheet(`
    <div class="sheet-head"><h2>Thông tin đặt hàng</h2><button type="button" class="x" data-close aria-label="Đóng">✕</button></div>
    <form id="co" class="sheet-body" novalidate>
      <label class="f"><span>Họ tên người nhận</span><input class="in" name="name" autocomplete="name" value="${esc(info.name || '')}" required></label>
      <label class="f"><span>Số điện thoại</span><input class="in" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(info.phone || '')}" required></label>
      <label class="f"><span>Địa chỉ nhận hàng <small>(số nhà, đường, phường/xã, quận/huyện, tỉnh/thành)</small></span><textarea class="in" name="address" autocomplete="street-address" required>${esc(info.address || '')}</textarea></label>
      <label class="f"><span>Tài khoản Instagram / Threads của bạn <small>(để shop nhận ra bạn trong chat)</small></span><input class="in" name="account" placeholder="@tên_tài_khoản" value="${esc(info.account || '')}"></label>
      <label class="f"><span>Ghi chú cho shop <small>(không bắt buộc)</small></span><textarea class="in" name="note" maxlength="500"></textarea></label>
      <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
      <p class="err" id="err" role="alert"></p>
      <div class="sum"><div class="total"><span>Tổng cộng (gồm ship ${money(r.ship)})</span><span>${money(r.total)}</span></div></div>
    </form>
    <div class="sheet-foot"><button type="submit" form="co" class="btn pink" id="co-go">${live ? 'Gửi đơn cho shop' : 'Tạo tin nhắn đặt hàng'}</button><button type="button" class="btn ghost" data-back>← Quay lại giỏ hàng</button></div>`);
  const form = $('#co', sheet);
  sheet.onclick = (e) => { if (e.target.closest('[data-close]')) closeSheet(); if (e.target.closest('[data-back]')) openCart(); };
  sheet.onchange = null;
  let sending = false;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (sending) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const phone = String(d.phone || '').replace(/[\s.\-()]/g, '');
    const bad = !d.name.trim() ? 'Bạn nhập họ tên người nhận nhé.'
      : !/^(\+?84|0)\d{8,10}$/.test(phone) ? 'Số điện thoại chưa đúng, bạn kiểm tra lại nhé.'
        : d.address.trim().length < 10 ? 'Bạn nhập địa chỉ đầy đủ hơn nhé (số nhà, đường, phường/xã, quận/huyện, tỉnh/thành).' : '';
    if (bad) { $('#err', sheet).textContent = bad; return; }
    const customer = { name: d.name.trim(), phone, address: d.address.trim().replace(/\s*\n\s*/g, ', '), account: d.account.trim(), note: d.note.trim() };
    try { localStorage.setItem(INFO_KEY, JSON.stringify({ name: customer.name, phone, address: customer.address, account: customer.account })); } catch { /* optional */ }
    const priced = priceCart(cart, catalog);
    const message = buildOrderMessage(priced, customer, catalog.shop.name || 'Hani');
    if (!live) return openResult(message, 'manual');
    // the order goes straight to the shop; the message stays as a back-up the customer can still send
    sending = true;
    const go = $('#co-go', sheet);
    go.disabled = true;
    go.textContent = 'Đang gửi…';
    let state = 'sent';
    if (!d.website) { // a filled hidden box means a robot: pretend it worked, send nothing
      try {
        await sendOrder({ createdAt: Date.now(), message, total: priced.total, status: 'new', source: 'web', items: priced.lines.map((l) => ({ pid: l.pid, vid: l.vid || '', qty: l.qty })), customer: { name: customer.name, phone: customer.phone, address: customer.address, account: customer.account, note: customer.note } });
      } catch { state = 'failed'; }
    }
    if (state === 'sent') { cart = []; save(); drawBar(); }
    openResult(message, state);
  };
}

/* ---------------- result: the message to send ---------------- */
function openResult(message, state = 'manual') {
  const { instagram, threads } = catalog.shop;
  const sent = state === 'sent';
  openSheet(`
    <div class="sheet-head"><h2>${sent ? '✓ Shop đã nhận đơn của bạn' : 'Gửi đơn cho shop'}</h2><button type="button" class="x" data-close aria-label="Đóng">✕</button></div>
    <div class="sheet-body">
      ${sent ? `<p>Cảm ơn bạn! Shop sẽ liên hệ xác nhận đơn, tình trạng hàng và cách thanh toán. Bạn có thể gửi thêm tin nhắn bên dưới cho shop nếu muốn được trả lời nhanh hơn.</p>`
        : state === 'failed' ? `<p class="err" role="alert">Chưa gửi được đơn tự động (kiểm tra mạng rồi thử lại, hoặc gửi bằng tin nhắn như dưới đây).</p>` : ''}
      ${sent ? '' : `<ol class="steps"><li>Bấm <b>Sao chép tin nhắn</b>.</li><li>Mở chat với shop${instagram || threads ? ' (nút bên dưới)' : ''} rồi <b>dán</b> và gửi.</li><li>Shop sẽ xác nhận đơn, tình trạng hàng và cách thanh toán với bạn.</li></ol>`}
      <textarea class="msg" id="msg" readonly>${esc(message)}</textarea>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn ${sent ? 'ghost' : 'pink'}" id="copy">${sent ? 'Sao chép tin nhắn (dự phòng)' : 'Sao chép tin nhắn'}</button>
      ${instagram ? `<a class="btn" id="ig" href="https://ig.me/m/${encodeURIComponent(instagram)}" target="_blank" rel="noopener">Mở chat Instagram @${esc(instagram)}</a>` : ''}
      ${threads ? `<a class="btn ghost" href="https://www.threads.net/@${encodeURIComponent(threads)}" target="_blank" rel="noopener">Mở Threads @${esc(threads)}</a>` : ''}
      ${sent ? '<button type="button" class="btn ghost" data-close>Đóng</button>' : '<button type="button" class="btn ghost" id="done">Đã gửi xong, xoá giỏ hàng</button>'}
    </div>`);
  sheet.onchange = null;
  sheet.onclick = async (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.id === 'copy') {
      const ta = $('#msg', sheet);
      try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand?.('copy'); }
      e.target.textContent = '✓ Đã sao chép, giờ bạn dán vào chat nhé';
    }
    if (e.target.id === 'done') { cart = []; save(); closeSheet(); drawBar(); toast('Cảm ơn bạn đã đặt hàng!'); }
  };
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) return openProduct(open.dataset.open);
  if (e.target.closest('[data-cart]')) return openCart();
  const cat = e.target.closest('[data-cat]');
  if (cat) { view.cat = cat.dataset.cat; view.focusQ = false; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { view.q = e.target.value; view.focusQ = true; render(); }
});

/** From the file catalog.json (the shop exports it by hand). */
async function startFromFile() {
  try {
    const res = await fetch('catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    catalog = await res.json();
  } catch {
    $('#shop').innerHTML = '<p class="empty">Chưa tải được cửa hàng. Bạn thử tải lại trang nhé.</p>';
    return;
  }
  cart = load().filter((l) => l && byId(l.pid) && num(l.qty) > 0);
  render();
}

/** Live from the shared database: products and stock follow the shop's inventory as it changes. */
function startLive() {
  let first = true;
  return new Promise((resolve) => {
    watchCatalog((c) => {
      catalog = c;
      if (first) { first = false; cart = load().filter((l) => l && byId(l.pid) && num(l.qty) > 0); } else cart = cart.filter((l) => byId(l.pid));
      save();
      render();
      if (!sheet.open) drawBar();
      resolve(true);
    }, () => resolve(false)).catch(() => resolve(false));
    setTimeout(() => resolve(first ? false : true), 8000); // the database did not answer in time
  });
}

async function start() {
  if (live && (await startLive())) return;
  await startFromFile(); // no database configured, or it could not be reached
}
start();
