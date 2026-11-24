// Parse the order export from Shopee Seller Centre (Đơn hàng → Xuất) — .xlsx or .csv.
// Header names differ slightly between export versions, so columns are matched
// loosely (case/diacritics-insensitive) against several candidate names.

export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const COLUMNS = {
  code: ['ma don hang', 'order id'],
  date: ['ngay dat hang', 'order creation date', 'thoi gian dat hang'],
  status: ['trang thai don hang', 'order status'],
  sku: ['sku phan loai hang', 'sku san pham', 'variation sku', 'sku reference no.'],
  productName: ['ten san pham', 'product name'],
  variant: ['ten phan loai hang', 'variation name'],
  qty: ['so luong', 'quantity'],
  unitPrice: ['gia uu dai', 'deal price', 'gia goc', 'original price'],
  lineTotal: ['tong gia ban (san pham)', 'product subtotal'],
  shopVoucher: ['ma giam gia cua shop', 'seller voucher'],
  buyerShip: ['phi van chuyen ma nguoi mua tra', 'buyer paid shipping fee'],
  fixedFee: ['phi co dinh', 'commission fee'],
  serviceFee: ['phi dich vu', 'service fee'],
  // Shopee's own wording differs between exports and screens: "Phí xử lý giao dịch" (current), "Phí thanh toán" (older)
  paymentFee: ['phi xu ly giao dich', 'phi thanh toan', 'transaction fee'],
  tracking: ['ma van don', 'tracking number', 'tracking no'],
  customer: ['ten nguoi nhan', 'receiver name', 'nguoi mua', 'username (buyer)'],
  note: ['nhan xet tu nguoi mua', 'remark from buyer', 'ghi chu'],
};

/** Map a Shopee status text to our status key. */
export function mapStatus(text) {
  const s = normalize(text);
  if (!s) return 'pending';
  if (s.includes('huy') || s.includes('cancel')) return 'cancelled';
  // "Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày …"
  // The buyer has the goods: the order is done. The return words are only a deadline, not a return.
  if (s.includes('xac nhan da nhan') || s.includes('da nhan duoc hang') || s.includes('da nhan hang')) return 'done';
  if (s.includes('tra hang') || s.includes('hoan tien') || s.includes('return') || s.includes('refund')) return 'returned';
  if (s.includes('hoan thanh') || s.includes('completed') || s.includes('da giao') || s.includes('delivered')) return 'done';
  if (s.includes('dang giao') || s.includes('shipping') || s.includes('van chuyen')) return 'shipping';
  return 'pending';
}

/**
 * Status to keep when a Shopee file is imported again over an existing order.
 * Shopee knows nothing about "Đã thiết kế" / "Đã đóng gói", so while Shopee still says the order
 * is waiting, the shop's own progress stays; anything further (shipping, done, cancelled…) wins.
 */
export function mergeShopeeStatus(current, fromShopee) {
  return (current === 'designed' || current === 'packed') && fromShopee === 'pending' ? current : fromShopee;
}

export function parseNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  // Vietnamese exports use "." as thousand separator: "1.250.000" or "1,250,000".
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return +s.replace(/[.,]/g, '');
  return +s.replace(',', '.') || 0;
}

export function parseDate(v) {
  if (typeof v === 'number') {
    // Excel serial date.
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const now = new Date(); // today in local time, not UTC
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function findColumns(headers) {
  const norm = headers.map(normalize);
  const idx = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    for (const name of names) {
      const exact = norm.indexOf(name);
      const i = exact >= 0 ? exact : norm.findIndex((h) => h.startsWith(name));
      if (i >= 0) { idx[key] = i; break; }
    }
  }
  return idx;
}

/**
 * Turn sheet rows (array of arrays, first row = headers) into orders grouped by order code.
 * Each line carries `sku`/`productName` so the caller can map it to a product.
 * Order-level money fields appear on every row of the same order in Shopee's export,
 * so they're taken from the first row only.
 * `taxRate` (0.015 = 1,5%): Shopee withholds VAT + personal income tax, which the export has no column for; it is added to
 * the platform fee as rate × (goods − shop voucher). Orders Shopee charged no fee for (cancelled, not settled) get none.
 */
export function rowsToOrders(rows, { taxRate = 0 } = {}) {
  const headerRow = rows.findIndex((r) => r.some((c) => normalize(c) === 'ma don hang' || normalize(c) === 'order id'));
  if (headerRow < 0) throw new Error('Không tìm thấy cột "Mã đơn hàng" — có phải file xuất đơn hàng từ Shopee không?');
  const idx = findColumns(rows[headerRow]);
  const get = (row, key) => (idx[key] === undefined ? '' : row[idx[key]]);
  const orders = new Map();
  for (const row of rows.slice(headerRow + 1)) {
    const code = String(get(row, 'code') ?? '').trim();
    if (!code) continue;
    let order = orders.get(code);
    if (!order) {
      order = {
        platform: 'shopee',
        code,
        date: parseDate(get(row, 'date')),
        status: mapStatus(get(row, 'status')),
        customer: String(get(row, 'customer') || ''),
        note: String(get(row, 'note') || ''),
        discount: parseNumber(get(row, 'shopVoucher')),
        shipFee: parseNumber(get(row, 'buyerShip')),
        shipPayer: 'customer',
        tracking: String(get(row, 'tracking') || '').trim(),
        platformFee: parseNumber(get(row, 'fixedFee')) + parseNumber(get(row, 'serviceFee')) + parseNumber(get(row, 'paymentFee')),
        items: [],
      };
      orders.set(code, order);
    }
    const qty = parseNumber(get(row, 'qty')) || 1;
    const lineTotal = parseNumber(get(row, 'lineTotal'));
    const price = lineTotal ? lineTotal / qty : parseNumber(get(row, 'unitPrice'));
    const variant = String(get(row, 'variant') || '').trim();
    const baseName = String(get(row, 'productName') || '').trim();
    order.items.push({
      sku: String(get(row, 'sku') || '').trim(),
      baseName,
      variantName: variant,
      productName: [baseName, variant].filter(Boolean).join(' — '),
      qty,
      price,
    });
  }
  if (taxRate > 0) {
    for (const o of orders.values()) {
      if (o.platformFee <= 0 || o.status === 'cancelled' || o.status === 'returned') continue;
      const goods = o.items.reduce((n, l) => n + l.price * l.qty, 0) - o.discount;
      o.tax = Math.max(0, Math.round(goods * taxRate));
      o.platformFee += o.tax;
    }
  }
  return [...orders.values()];
}

/** Key used to remember which of our products a Shopee listing corresponds to. */
export const listingKey = (line) => normalize(line.sku || line.productName);

/* ---------------- check the orders on their way against a fresh Shopee export ---------------- */

const codeKey = (s) => String(s ?? '').trim().toUpperCase();

/** The order codes in pasted text: separated by lines, spaces, commas or semicolons; repeats dropped, order kept. */
export function parseCodes(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[\s,;|]+/)) {
    const t = raw.trim();
    if (!t || seen.has(codeKey(t))) continue;
    seen.add(codeKey(t));
    out.push(t);
  }
  return out;
}

/**
 * Compare orders with what Shopee says now.
 *   orders = the shop's orders · shopee = rowsToOrders() of a fresh export · codes = pasted (an order code or a tracking code);
 *   no codes: every Shopee order that is "shipping" in the shop.
 * Sorted into: complete (Shopee says done, the shop still has it shipping: these are the ones to move to done),
 * stillShipping, waiting (Shopee has not shipped it), cancelled, returned, doneButApp (Shopee says done but the shop has
 * it at another stage: left for the shop to decide), already (done on both sides), missing (not in the file),
 * and notFound (pasted codes that are no order of the shop).
 */
export function reviewDelivery({ orders, shopee, codes = [] }) {
  const theirs = new Map();
  for (const s of shopee) theirs.set(codeKey(s.code), s);
  for (const s of shopee) if (s.tracking && !theirs.has(codeKey(s.tracking))) theirs.set(codeKey(s.tracking), s);
  const ours = new Map();
  for (const o of orders) if (o.code) ours.set(codeKey(o.code), o);
  for (const o of orders) if (o.tracking && !ours.has(codeKey(o.tracking))) ours.set(codeKey(o.tracking), o);

  const targets = [];
  const notFound = [];
  if (codes.length) {
    const seen = new Set();
    for (const c of codes) {
      const o = ours.get(codeKey(c));
      if (!o) notFound.push(c);
      else if (!seen.has(o.id)) { seen.add(o.id); targets.push(o); }
    }
  } else {
    for (const o of orders) if (o.status === 'shipping' && o.platform === 'shopee') targets.push(o);
  }

  const out = { checked: targets.length, complete: [], stillShipping: [], waiting: [], cancelled: [], returned: [], doneButApp: [], already: [], missing: [], notFound };
  for (const order of targets) {
    const s = theirs.get(codeKey(order.code)) || (order.tracking ? theirs.get(codeKey(order.tracking)) : undefined);
    if (!s) { out.missing.push({ order }); continue; }
    const item = { order, shopeeStatus: s.status };
    if (s.status === 'done') (order.status === 'done' ? out.already : order.status === 'shipping' ? out.complete : out.doneButApp).push(item);
    else if (s.status === 'shipping') out.stillShipping.push(item);
    else if (s.status === 'cancelled') out.cancelled.push(item);
    else if (s.status === 'returned') out.returned.push(item);
    else out.waiting.push(item);
  }
  return out;
}
