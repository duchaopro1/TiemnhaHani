import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, onShop, comboText, isEndedGroup } from '../js/catalog.js';
import { priceCart, buildOrderMessage, parseOrderMessage, unitPrice } from '../js/shoporder.js';

const imp = (itemId, qty, unitCost = 1000, extra = {}) => ({ id: 'i' + itemId + qty, kind: 'product', itemId, qty, unitCost, status: 'received', date: '2026-11-01', ...extra });
const state = () => ({
  products: [
    { id: 'kc', name: 'Móc khóa chữ cái', group: 'Móc khóa', salePrice: 25000, baseCost: 13000, note: 'nhập xưởng A', tiers: [{ minQty: 10, price: 22000 }], variants: [{ id: 'a', name: 'A', price: 0, image: 'asset:a' }, { id: 'b', name: 'B', price: 0 }] },
    { id: 'cup', name: 'Cúp', group: 'Cúp', salePrice: 96000, baseCost: 61000, variants: [] },
    { id: 'old', name: 'Lego', group: 'Hết bán', salePrice: 690000, variants: [] },
    { id: 'box', name: 'Box 1', salePrice: 140000, combo: [{ productId: 'cup', qty: 1, variantId: '' }, { pool: ['kc'], qty: 1 }], variants: [] },
  ],
  packaging: [], presets: [],
  imports: [imp('kc', 5, 1000, { variantId: 'a' }), imp('cup', 3)],
  orders: [],
});
// imports with variants are keyed per variant in the app; give the variant stock through adjust for these tests
const withStock = () => { const s = state(); s.products[0].variants[0].adjust = 12; s.products[0].variants[1].adjust = 0; s.imports = [imp('cup', 3)]; s.products[1].adjust = 0; return s; };

test('catalog: chỉ có thứ khách được thấy, không lộ giá vốn / ghi chú nội bộ', () => {
  const s = withStock();
  const c = buildCatalog(s, { categories: ['Móc khóa', 'Cúp'], shopName: 'Hani', shopInstagram: '@hani.shop' }, { 'asset:a': 'data:image/jpeg;base64,AA==' }, new Date('2026-11-17T00:00:00Z'));
  assert.deepEqual(c.categories, ['Móc khóa', 'Cúp', 'Combo']); // Hết bán không có; Combo ở cuối
  assert.deepEqual(c.products.map((p) => p.name), ['Móc khóa chữ cái', 'Cúp', 'Box 1']);
  const kc = c.products[0];
  assert.equal(kc.price, 25000);
  assert.deepEqual(kc.tiers, [{ minQty: 10, price: 22000 }]);
  assert.equal(kc.variants[0].image, 'data:image/jpeg;base64,AA==');
  assert.equal(kc.variants[0].stock, 12);
  assert.equal(kc.variants[1].stock, 0);
  assert.equal(kc.stock, 12);
  assert.equal(c.shop.instagram, 'hani.shop');
  assert.equal(c.shop.shipFlat, 15000);
  const text = JSON.stringify(c);
  assert.ok(!/baseCost|unitCost|nhập xưởng|13000|61000/.test(text), 'không có giá vốn hay ghi chú riêng');
});

test('catalog: ẩn theo lựa chọn của shop, tồn trừ đơn đang mở, mô tả riêng', () => {
  const s = withStock();
  s.orders = [{ id: 'o1', status: 'pending', items: [{ productId: 'cup', variantId: '', qty: 2, price: 1 }] }];
  const c = buildCatalog(s, { shopHidden: ['kc'], shopDesc: { cup: 'Cúp vàng 20cm' } });
  assert.ok(!c.products.some((p) => p.id === 'kc'));
  const cup = c.products.find((p) => p.id === 'cup');
  assert.equal(cup.stock, 1); // 3 nhập - 2 đơn đang chờ
  assert.equal(cup.desc, 'Cúp vàng 20cm');
  assert.ok(c.products.find((p) => p.id === 'box').combo[0].includes('Cúp'));
  assert.ok(isEndedGroup({}, 'Hết bán') && !isEndedGroup({ endedCategories: ['Cúp'] }, 'Hết bán'));
  assert.equal(onShop(s.products[2], {}), false);
  assert.equal(onShop(s.products[2], { endedCategories: [] }), true);
});

test('combo hiện nội dung: món cố định và món ngẫu nhiên', () => {
  const s = state();
  const t = comboText(s.products[3], s.products);
  assert.equal(t[0], '1 × Cúp');
  assert.ok(t[1].startsWith('1 × một mẫu ngẫu nhiên: Móc khóa chữ cái'));
});

const catalog = () => buildCatalog(withStock(), { shipFlat: 15000, shopName: 'Hani' });
test('giỏ hàng: giá bậc tính theo tổng số cái của sản phẩm qua mọi phân loại, ship đồng giá', () => {
  const c = catalog();
  let r = priceCart([{ pid: 'kc', vid: 'a', qty: 4 }, { pid: 'kc', vid: 'b', qty: 5 }], c);
  assert.equal(r.lines[0].unit, 25000); // 9 cái: chưa đủ bậc
  r = priceCart([{ pid: 'kc', vid: 'a', qty: 6 }, { pid: 'kc', vid: 'b', qty: 4 }], c);
  assert.equal(r.lines[0].unit, 22000); // 10 cái: bậc 22.000
  assert.equal(r.goods, 10 * 22000);
  assert.equal(r.ship, 15000);
  assert.equal(r.total, 235000);
  assert.equal(r.pieces, 10);
  assert.equal(priceCart([], c).ship, 0); // giỏ trống không tính ship
  assert.equal(priceCart([{ pid: 'khong-co', vid: '', qty: 2 }], c).lines.length, 0);
  assert.equal(unitPrice({ price: 100, tiers: [] }, { price: 80 }, 1), 80); // phân loại có giá riêng
});

test('tin nhắn đặt hàng: đọc ngược lại đúng sản phẩm, số lượng, thông tin khách', () => {
  const c = catalog();
  const priced = priceCart([{ pid: 'kc', vid: 'a', qty: 2, note: 'khắc tên\nLinh' }, { pid: 'cup', vid: '', qty: 1 }], c);
  const msg = buildOrderMessage(priced, { name: 'Nguyễn Linh', phone: '0901234567', address: '12 Lê Lợi, Q1, TP.HCM', account: '@linh.ng', note: 'Giao giờ hành chính' }, 'Hani');
  assert.ok(msg.includes('TỔNG: 161.000đ') || msg.includes(`TỔNG: ${(2 * 25000 + 96000 + 15000).toLocaleString('vi-VN')}đ`));
  assert.ok(msg.includes('Móc khóa chữ cái · A ×2'));
  const back = parseOrderMessage(msg);
  assert.deepEqual(back.items, [{ pid: 'kc', vid: 'a', qty: 2 }, { pid: 'cup', vid: '', qty: 1 }]);
  assert.equal(back.name, 'Nguyễn Linh');
  assert.equal(back.phone, '0901234567');
  assert.equal(back.address, '12 Lê Lợi, Q1, TP.HCM');
  assert.equal(back.account, '@linh.ng');
  assert.equal(back.note, 'Giao giờ hành chính');
  assert.deepEqual(back.itemNotes, ['Móc khóa chữ cái · A: khắc tên Linh']);
  // tin không có dòng mã: không ra sản phẩm, không lỗi
  assert.deepEqual(parseOrderMessage('xin chào shop').items, []);
  assert.equal(parseOrderMessage('').name, '');
});
