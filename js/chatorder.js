// Reads an order from a chat message the shop owner pastes: products + quantities + ship, the customer, and a
// link back to the conversation. The message is free text (no fixed template), so this is tolerant: it understands
// "Nhãn: giá trị" lines and bare lines alike, and matches product names loosely against the shop's own products.
// Pure functions (no DOM), covered by tests/chatorder.test.js.

const num = (v) => (Number.isFinite(+v) ? +v : 0);

/** lower-case, no accents, single spaces: "Móc Khoá" → "moc khoa" */
export const fold = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9@+\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Only http(s) links are ever opened; "instagram.com/x" becomes "https://instagram.com/x". Anything else gives ''. */
export function safeLink(u) {
  let s = String(u ?? '').trim();
  if (!s || /\s/.test(s)) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // javascript:, data:, mailto: …
    if (!/^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/.test(s)) return '';
    s = `https://${s}`;
  }
  try { const url = new URL(s); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
}

const LABELS = {
  name: ['khach', 'khach hang', 'ten', 'ho ten', 'ten khach', 'nguoi nhan', 'ten nguoi nhan', 'kh'],
  phone: ['sdt', 'so dien thoai', 'dien thoai', 'phone', 'sdt nguoi nhan', 'tel', 'so dt'],
  address: ['dia chi', 'dc', 'address', 'dia chi giao hang', 'dia chi nhan hang'],
  ship: ['ship', 'phi ship', 'phi van chuyen', 'van chuyen', 'shipping', 'phi giao hang', 'tien ship'],
  account: ['tai khoan', 'tk', 'account', 'id', 'user', 'username', 'nick', 'nick name'],
  ig: ['ig', 'instagram'],
  threads: ['threads', 'thread'],
  items: ['san pham', 'sp', 'don hang', 'don', 'hang', 'mon', 'order', 'noi dung', 'chi tiet don', 'thong tin don hang', 'thong tin san pham'],
  note: ['ghi chu', 'note', 'luu y', 'yeu cau'],
  link: ['link', 'tin nhan', 'link tin nhan', 'lien ket', 'url', 'link chat', 'xem tin nhan'],
  head: ['thong tin khach hang', 'thong tin khach', 'thong tin nguoi nhan', 'khach hang'],
};
const labelOf = (raw) => {
  const f = fold(raw);
  for (const [k, list] of Object.entries(LABELS)) if (list.includes(f)) return k;
  return '';
};

/** "15k" "15.000" "15,000đ" "15000" "15" → 15000 (small bare numbers in a ship line are thousands). '' if none. */
export function parseMoney(text) {
  const m = String(text ?? '').toLowerCase().match(/(\d+(?:[.,]\d+)*)\s*(k|nghìn|nghin|ngàn|ngan|tr|triệu|trieu|đ|d|vnd)?/);
  if (!m) return null;
  const unit = m[3] || '';
  const raw = m[1];
  const groups = raw.split(/[.,]/);
  const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
  let n = thousands ? +groups.join('') : +raw.replace(',', '.');
  if (/^(k|nghìn|nghin|ngàn|ngan)$/.test(unit)) n *= 1000;
  else if (/^(tr|triệu|trieu)$/.test(unit)) n *= 1000000;
  else if (!thousands && n > 0 && n < 1000) n *= 1000;
  return Math.round(n);
}

/** How the ship line reads: { fee, payer } where payer is 'shop' (freeship) or 'customer'. null when not a ship line. */
export function parseShip(text, shipFlat = 15000) {
  const f = fold(text);
  if (!/ship|van chuyen|giao hang|free|mien phi|dong gia/.test(f)) return null;
  const shopPays = /free ?ship|mien phi|shop chiu|shop tra|shop ho tro|\bfree\b/.test(f);
  const amount = parseMoney(String(text).replace(/ship|freeship|free|miễn phí|miễn|phí|vận chuyển|giao hàng|đồng giá|shop|chịu|trả|khách/gi, ' '));
  if (shopPays) return { fee: amount || shipFlat, payer: 'shop' };
  if (amount !== null) return { fee: amount, payer: /shop chiu|shop tra/.test(f) ? 'shop' : 'customer' };
  return { fee: shipFlat, payer: 'customer' }; // "ship đồng giá"
}

const STOP = new Set(['cai', 'chiec', 'cho', 'mot', 'va', 'la', 'loai', 'mau', 'con', 'bo', 'set', 'sp', 'x']);
const tokens = (s) => fold(s).split(' ').filter((t) => t && !STOP.has(t));

/**
 * Match free text to one of the shop's products: { product, variant, score } or null.
 * `products` = [{ id, name, sku, variants: [{ id, name, sku }] }].
 */
export function matchProduct(text, products) {
  const seg = tokens(text);
  if (!seg.length) return null;
  const segSet = new Set(seg);
  const key = fold(text).replace(/\s/g, '');
  let best = null;
  for (const p of products || []) {
    const pt = tokens(p.name);
    if (!pt.length) continue;
    const skuHit = p.sku && key && fold(p.sku).replace(/\s/g, '') && key.includes(fold(p.sku).replace(/\s/g, ''));
    // the variant that is named in the text (most words of its name matched)
    let variant = null; let vTok = new Set();
    for (const v of p.variants || []) {
      const vt = tokens(v.name);
      if (vt.length && vt.every((t) => segSet.has(t)) && (!variant || vt.length > vTok.size)) { variant = v; vTok = new Set(vt); }
    }
    const inProduct = pt.filter((t) => segSet.has(t)).length;
    const rest = seg.filter((t) => !vTok.has(t));
    const inText = rest.filter((t) => pt.includes(t)).length;
    const covP = inProduct / pt.length;
    const covS = rest.length ? inText / rest.length : 1;
    let score = covP * 0.5 + covS * 0.5;
    const ok = (covS === 1 && inProduct >= 1) || (covP >= 0.8 && covS >= 0.6) || skuHit;
    if (skuHit) score = Math.max(score, 1);
    if (!ok) continue;
    score += Math.min(inProduct, 5) * 0.01; // more matching words = more specific
    if (!best || score > best.score) best = { product: p, variant, score };
  }
  return best;
}

/** One item segment → candidate readings [name, qty] in priority order. */
function readings(seg) {
  const s = seg.replace(/^\s*(?:\d+\s*[.)]\s+|[-•*·]\s*)/, '').trim();
  const out = [];
  let m;
  if ((m = s.match(/^(\d+)\s*[x×*]\s*(.+)$/i))) out.push([m[2], +m[1]]);
  if ((m = s.match(/^(.+?)\s*[x×*]\s*(\d+)\s*(?:cái|chiếc|c|sp)?\.?$/i))) out.push([m[1], +m[2]]);
  if ((m = s.match(/^(.+?)\s*[-–—:(]\s*(\d+)\s*(?:cái|chiếc|c|sp)?\s*\)?\.?$/i))) out.push([m[1], +m[2]]);
  if ((m = s.match(/^(.+?)\s+(?:sl|số lượng|so luong)\s*[:.]?\s*(\d+)/i))) out.push([m[1], +m[2]]);
  if ((m = s.match(/^(\d+)\s*(?:cái|chiếc|c)?\s+(.+)$/i))) out.push([m[2], +m[1]]);
  if ((m = s.match(/^(.+?)\s+(\d+)\s*(?:cái|chiếc)?$/i))) out.push([m[1], +m[2]]);
  return { whole: s, list: out };
}

const looksLikeAddress = (s) => /\b(đường|duong|phường|phuong|quận|quan|huyện|huyen|xã|xa|tp|thành phố|thanh pho|tỉnh|tinh|ngõ|ngo|hẻm|hem|số|so)\b/i.test(s) || (/\d/.test(s) && s.split(/\s+/).length >= 3);
const PHONE_RE = /(?:\+?84|0)[\s.-]?\d(?:[\s.-]?\d){8}/;
const cleanPhone = (s) => String(s).replace(/[\s.-]/g, '').replace(/^\+?84/, '0');

/**
 * Read a pasted chat message.
 * Returns { items: [{ productId, variantId, qty, name, matched }], name, phone, address, account, platform, note,
 *           link, shipFee, shipPayer, shipFound, unread: [lines] }.
 */
export function parseChatOrder(text, products = [], { shipFlat = 15000 } = {}) {
  const urls = [...String(text || '').matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0].replace(/[).,;!?]+$/, ''));
  const urlRank = (u) => (/instagram\.com|threads\.(net|com)|facebook\.com|fb\.com|m\.me|messenger\.com|zalo\.me|chat\.zalo|shopee\.vn/i.test(u) ? 0 : 1);
  const link = [...urls].sort((a, b) => urlRank(a) - urlRank(b))[0] || '';
  const body = String(text || '').replace(/https?:\/\/[^\s<>"']+/gi, ' ');
  const res = { items: [], name: '', phone: '', address: '', account: '', platform: '', note: '', link, shipFee: shipFlat, shipPayer: 'customer', shipFound: false, unread: [] };
  if (/threads\.(net|com)/i.test(link)) res.platform = 'threads';
  else if (/instagram\.com/i.test(link)) res.platform = 'instagram';

  const itemSegs = [];
  const notes = [];
  let mode = ''; // after a bare heading such as "Thông tin đơn hàng:" the lines below belong to it

  const addItemText = (t) => t.split(/[\n;+]|,(?!\d{3}\b)/).map((x) => x.trim()).filter(Boolean).forEach((x) => {
    const sh = parseShip(x, shipFlat);
    if (sh && !matchProduct(readings(x).whole, products)) Object.assign(res, { shipFee: sh.fee, shipPayer: sh.payer, shipFound: true });
    else itemSegs.push(x);
  });

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s*•\-–—·>]+/, '').replace(/[\s]+$/, '').trim();
    if (!line || /^[━─=_.\s-]+$/.test(line)) continue;
    const lm = line.match(/^([^:：]{1,28})[:：]\s*(.*)$/);
    const kind = lm ? labelOf(lm[1]) : '';
    const value = lm ? lm[2].trim() : '';
    if (lm && kind) {
      if (!value) { mode = kind === 'head' ? 'customer' : kind; continue; } // a heading line
      switch (kind) {
        case 'name': res.name = value; break;
        case 'phone': res.phone = cleanPhone(value); break;
        case 'address': res.address = value; break;
        case 'account': res.account = value; break;
        case 'ig': res.account = value; res.platform = res.platform || 'instagram'; break;
        case 'threads': res.account = value; res.platform = res.platform || 'threads'; break;
        case 'note': notes.push(value); break;
        case 'link': break;
        case 'ship': { const s = parseShip(`ship ${value}`, shipFlat); if (s) Object.assign(res, { shipFee: s.fee, shipPayer: s.payer, shipFound: true }); break; }
        case 'items': addItemText(value); mode = 'items'; break;
        default: res.unread.push(line);
      }
      if (kind !== 'items') mode = '';
      continue;
    }
    // a line without a label
    if (mode === 'items') { addItemText(line); continue; }
    const phone = line.match(PHONE_RE);
    if (phone) { res.phone = res.phone || cleanPhone(phone[0]); const rest = line.replace(PHONE_RE, '').replace(/[-–,:\s]+$/, '').replace(/^[-–,:\s]+/, '').trim(); if (rest && !res.name && !/\d/.test(rest)) res.name = rest; continue; }
    if (/^@[\w.]+$/.test(line)) { res.account = res.account || line; continue; }
    const ship = parseShip(line, shipFlat);
    if (ship && /ship|van chuyen|free|mien phi/.test(fold(line)) && !matchProduct(readings(line).whole, products)) { Object.assign(res, { shipFee: ship.fee, shipPayer: ship.payer, shipFound: true }); continue; }
    const r = readings(line);
    if (matchProduct(r.whole, products) || r.list.some(([n]) => matchProduct(n, products))) { itemSegs.push(line); continue; }
    if (mode === 'customer' || mode === '') {
      if (looksLikeAddress(line) && !res.address) { res.address = line; continue; }
      if (!res.name && line.length <= 40 && !/\d/.test(line)) { res.name = line; continue; }
    }
    if (r.list.length) { itemSegs.push(line); continue; } // looks like "something ×2" though the product is unknown
    res.unread.push(line);
  }

  // items: first reading whose name is a known product, else the first reading with a quantity, else the whole text once
  for (const seg of itemSegs) {
    const { whole, list } = readings(seg);
    let hit = null;
    const whole1 = matchProduct(whole, products);
    if (whole1 && !list.some(([n]) => matchProduct(n, products))) hit = { m: whole1, qty: 1, name: whole };
    for (const [n, q] of list) { const m = matchProduct(n, products); if (m && (!hit || m.score > hit.m.score)) { hit = { m, qty: q, name: n }; } }
    if (!hit && whole1) hit = { m: whole1, qty: 1, name: whole };
    if (hit) res.items.push({ productId: hit.m.product.id, variantId: hit.m.variant?.id || '', qty: Math.max(1, hit.qty), name: hit.name.trim(), matched: true, fuzzy: hit.m.score < 0.9 });
    else if (list.length) res.items.push({ productId: '', variantId: '', qty: Math.max(1, list[0][1]), name: list[0][0].trim(), matched: false });
    else res.unread.push(seg);
  }
  res.note = notes.join('. ');
  res.phone = res.phone && /^0\d{9,10}$/.test(res.phone) ? res.phone : res.phone;
  return res;
}
