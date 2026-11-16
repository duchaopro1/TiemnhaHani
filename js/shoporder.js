// The cart of the web shop and the order message a customer sends to the shop.
// The message is for people (the shop reads it in a chat) and carries one machine line so the admin page can
// turn it into an order in one paste. Pure functions, shared by the shop page, the admin page and the tests.
import { tierPrice } from './calc.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
export const money = (n) => `${Math.round(num(n)).toLocaleString('vi-VN')}đ`;
const MARK = '#HANI';

/** Price of one piece of a catalog product: the variant's own price, else the product's, lowered by price steps. */
export function unitPrice(product, variant, qtyOfProduct) {
  const base = num(variant?.price) > 0 ? num(variant.price) : num(product.price);
  return tierPrice(product, qtyOfProduct, base);
}

/**
 * Price a cart: `cart` = [{ pid, vid, qty, note }]. Price steps ("from N pieces") count the pieces of a product
 * over all its variants. Lines whose product is gone from the catalog are dropped.
 */
export function priceCart(cart, catalog) {
  const byId = Object.fromEntries((catalog?.products || []).map((p) => [p.id, p]));
  const qtyOf = {};
  for (const l of cart) if (byId[l.pid]) qtyOf[l.pid] = (qtyOf[l.pid] || 0) + num(l.qty);
  const lines = cart.filter((l) => byId[l.pid] && num(l.qty) > 0).map((l) => {
    const product = byId[l.pid];
    const variant = product.variants?.find((v) => v.id === l.vid) || null;
    const unit = unitPrice(product, variant, qtyOf[l.pid]);
    return { ...l, qty: num(l.qty), product, variant, unit, amount: unit * num(l.qty), name: variant ? `${product.name} · ${variant.name}` : product.name };
  });
  const goods = lines.reduce((n, l) => n + l.amount, 0);
  const ship = lines.length ? num(catalog?.shop?.shipFlat) : 0;
  return { lines, goods, ship, total: goods + ship, pieces: lines.reduce((n, l) => n + l.qty, 0) };
}

/** What the customer pastes into the chat with the shop. */
export function buildOrderMessage(priced, customer, shopName = 'Hani') {
  const out = [`🛍 ĐƠN ĐẶT HÀNG — ${shopName}`, '━━━━━━━━━━'];
  priced.lines.forEach((l, i) => {
    out.push(`${i + 1}) ${l.name} ×${l.qty} = ${money(l.amount)}`);
    if (String(l.note || '').trim()) out.push(`   Ghi chú: ${String(l.note).trim().replace(/\s*\n\s*/g, ' ')}`);
  });
  out.push('━━━━━━━━━━', `Tạm tính: ${money(priced.goods)}`, `Phí ship: ${money(priced.ship)}`, `TỔNG: ${money(priced.total)}`, '━━━━━━━━━━');
  out.push(`Họ tên: ${customer.name || ''}`, `SĐT: ${customer.phone || ''}`, `Địa chỉ: ${customer.address || ''}`);
  if (customer.account) out.push(`Tài khoản IG/Threads: ${customer.account}`);
  if (String(customer.note || '').trim()) out.push(`Ghi chú: ${String(customer.note).trim().replace(/\s*\n\s*/g, ' ')}`);
  out.push(`${MARK} ${priced.lines.map((l) => `${l.pid}~${l.vid || ''}~${l.qty}`).join('|')}`);
  return out.join('\n');
}

/**
 * Read an order message back: { items: [{ pid, vid, qty }], name, phone, address, account, note, itemNotes: [string] }.
 * Anything missing is empty; a message without the machine line gives no items.
 */
export function parseOrderMessage(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const field = (label) => {
    const re = new RegExp(`^${label}\\s*:\\s*(.*)$`, 'i');
    const hit = lines.find((l) => re.test(l));
    return hit ? hit.match(re)[1].trim() : '';
  };
  const mark = lines.find((l) => l.startsWith(MARK));
  const items = mark
    ? mark.slice(MARK.length).trim().split('|').map((x) => x.split('~')).filter((x) => x[0]).map(([pid, vid, qty]) => ({ pid, vid: vid || '', qty: Math.max(1, Math.round(num(qty)) || 1) }))
    : [];
  // notes written under an item line: "1) Name ×2 = 30.000đ" then "   Ghi chú: ..."
  const itemNotes = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\d+\)\s*(.+?)\s*×\d+\s*=/);
    if (m && /^ghi chú\s*:/i.test(lines[i + 1] || '')) itemNotes.push(`${m[1]}: ${lines[i + 1].replace(/^ghi chú\s*:\s*/i, '')}`);
  });
  // the order-level "Ghi chú" is the last one, after the address block
  const addr = lines.findIndex((l) => /^địa chỉ\s*:/i.test(l));
  const noteLine = lines.slice(addr >= 0 ? addr : 0).find((l) => /^ghi chú\s*:/i.test(l));
  return {
    items, itemNotes,
    name: field('Họ tên'), phone: field('SĐT'), address: field('Địa chỉ'), account: field('Tài khoản IG/Threads'),
    note: noteLine ? noteLine.replace(/^ghi chú\s*:\s*/i, '').trim() : '',
  };
}
