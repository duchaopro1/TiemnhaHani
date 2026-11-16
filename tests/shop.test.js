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

import { diffCatalog, fingerprint, fitDoc } from '../js/catalog.js';
test('đồng bộ cửa hàng: chỉ ghi phần thay đổi, xoá sản phẩm đã ẩn, tồn đổi chỉ ghi 1 sản phẩm', () => {
  const s = withStock();
  const c1 = buildCatalog(s, { categories: ['Móc khóa', 'Cúp'], shopName: 'Hani' }, {}, new Date('2026-11-17T00:00:00Z'));
  const first = diffCatalog({}, c1);
  assert.equal(first.products.length, 3); // lần đầu: ghi hết
  assert.ok(first.info);
  assert.ok(first.products.every((p) => p._h));
  // không đổi gì: không ghi gì (ngày cập nhật đổi cũng không tính)
  const c1b = buildCatalog(s, { categories: ['Móc khóa', 'Cúp'], shopName: 'Hani' }, {}, new Date('2026-11-18T00:00:00Z'));
  const same = diffCatalog(first.next, c1b);
  assert.deepEqual([same.products.length, same.remove.length, same.info], [0, 0, null]);
  // bán 1 cúp: chỉ Cúp (và Box 1 là combo chứa cúp) đổi tồn
  s.orders = [{ id: 'o1', status: 'pending', items: [{ productId: 'cup', variantId: '', qty: 1, price: 1 }] }];
  const c2 = buildCatalog(s, { categories: ['Móc khóa', 'Cúp'], shopName: 'Hani' });
  const d2 = diffCatalog(first.next, c2);
  assert.ok(d2.products.some((p) => p.id === 'cup'));
  assert.ok(!d2.products.some((p) => p.id === 'kc'));
  // ẩn Cúp: bị xoá khỏi cửa hàng
  const c3 = buildCatalog(s, { shopHidden: ['cup'], categories: ['Móc khóa', 'Cúp'], shopName: 'Hani' });
  assert.ok(diffCatalog(d2.next, c3).remove.includes('cup'));
  // đổi tên shop: chỉ ghi thông tin chung
  const c4 = buildCatalog(s, { categories: ['Móc khóa', 'Cúp'], shopName: 'Hani Shop' });
  const d4 = diffCatalog(d2.next, c4);
  assert.ok(d4.info && d4.info.name === 'Hani Shop');
  assert.equal(d4.products.length, 0);
  assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test('tài liệu quá lớn: bỏ ảnh phân loại trước, rồi mới bỏ ảnh sản phẩm', () => {
  const big = 'x'.repeat(40_000);
  const p = { id: 'p', name: 'P', image: 'data:main', variants: Array.from({ length: 30 }, (_, i) => ({ id: 'v' + i, name: 'V' + i, image: big })) };
  const fit = fitDoc(p);
  assert.ok(JSON.stringify(fit).length < 900_000);
  assert.equal(fit.image, 'data:main'); // ảnh chính còn
  assert.ok(fit.variants.every((v) => v.image === ''));
  assert.equal(fitDoc({ id: 'q', name: 'Q', image: 'a', variants: [] }).image, 'a'); // nhỏ: giữ nguyên
});

import { assembleCatalog } from '../docs/lib/backend.js';
test('cửa hàng web ghép tài liệu từ cơ sở dữ liệu thành catalog: đúng thứ tự danh mục, bỏ mã băm', () => {
  const info = { name: 'Hani', categories: ['Móc khóa', 'Cúp', 'Combo'], updatedAt: '2026-11-17', _h: 'x', shipFlat: 18000, instagram: 'hani.shop' };
  const docs = [
    { id: 'b', name: 'Box 1', category: 'Combo', price: 1, _h: 'a' },
    { id: 'c', name: 'Cúp', category: 'Cúp', price: 2, _h: 'b' },
    { id: 'z', name: 'Zebra', category: 'Móc khóa', price: 3 },
    { id: 'a', name: 'Ảnh', category: 'Móc khóa', price: 4 },
  ];
  const c = assembleCatalog(info, docs);
  assert.deepEqual(c.products.map((p) => p.id), ['a', 'z', 'c', 'b']); // Móc khóa (A trước Z), Cúp, Combo
  assert.ok(c.products.every((p) => !('_h' in p)));
  assert.equal(c.shop.shipFlat, 18000);
  assert.equal(c.shop.instagram, 'hani.shop');
  assert.ok(!('_h' in c.shop) && !('categories' in c.shop));
  assert.equal(c.updatedAt, '2026-11-17');
  // chưa có thông tin gì: vẫn ra catalog rỗng hợp lệ, ship mặc định 15.000
  const empty = assembleCatalog(undefined, []);
  assert.deepEqual([empty.products.length, empty.shop.shipFlat, empty.shop.name], [0, 15000, 'Hani']);
});
