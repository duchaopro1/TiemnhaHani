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
  paymentFee: ['phi thanh toan', 'transaction fee'],
  customer: ['ten nguoi nhan', 'receiver name', 'nguoi mua', 'username (buyer)'],
  note: ['nhan xet tu nguoi mua', 'remark from buyer', 'ghi chu'],
};

/** Map a Shopee status text to our status key. */
export function mapStatus(text) {
  const s = normalize(text);
  if (!s) return 'pending';
  if (s.includes('huy') || s.includes('cancel')) return 'cancelled';
  if (s.includes('tra hang') || s.includes('hoan tien') || s.includes('return') || s.includes('refund')) return 'returned';
  if (s.includes('hoan thanh') || s.includes('completed') || s.includes('da giao') || s.includes('delivered')) return 'done';
  if (s.includes('dang giao') || s.includes('shipping') || s.includes('van chuyen')) return 'shipping';
  return 'pending';
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
  return new Date().toISOString().slice(0, 10);
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
 */
export function rowsToOrders(rows) {
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
        platformFee: parseNumber(get(row, 'fixedFee')) + parseNumber(get(row, 'serviceFee')) + parseNumber(get(row, 'paymentFee')),
        items: [],
      };
      orders.set(code, order);
    }
    const qty = parseNumber(get(row, 'qty')) || 1;
    const lineTotal = parseNumber(get(row, 'lineTotal'));
    const price = lineTotal ? lineTotal / qty : parseNumber(get(row, 'unitPrice'));
    const variant = String(get(row, 'variant') || '').trim();
    order.items.push({
      sku: String(get(row, 'sku') || '').trim(),
      productName: [String(get(row, 'productName') || '').trim(), variant].filter(Boolean).join(' — '),
      qty,
      price,
    });
  }
  return [...orders.values()];
}

/** Key used to remember which of our products a Shopee listing corresponds to. */
export const listingKey = (line) => normalize(line.sku || line.productName);
