import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatOrder, parseShip, parseMoney, safeLink, matchProduct } from '../js/chatorder.js';

const P = [
  { id: 'moc', name: 'Móc khoá mica in ảnh', sku: 'MOC-01', variants: [] },
  { id: 'cup', name: 'Cúp pha lê mini', sku: 'CUP-01', variants: [{ id: 'do', name: 'Đỏ' }, { id: 'xanh', name: 'Xanh' }, { id: 'vang', name: 'Vàng' }] },
  { id: 'set', name: 'Set quà anni', sku: 'SET-01', variants: [] },
];

test('tiền: 15k, 15.000, 15000đ, 15', () => {
  assert.equal(parseMoney('15k'), 15000);
  assert.equal(parseMoney('15.000đ'), 15000);
  assert.equal(parseMoney('15,000'), 15000);
  assert.equal(parseMoney('15000'), 15000);
  assert.equal(parseMoney('15'), 15000);
  assert.equal(parseMoney('chưa có'), null);
});
test('ship: đồng giá, freeship, số tiền khác, shop chịu', () => {
  assert.deepEqual(parseShip('ship đồng giá', 15000), { fee: 15000, payer: 'customer' });
  assert.deepEqual(parseShip('Freeship', 15000), { fee: 15000, payer: 'shop' });
  assert.deepEqual(parseShip('ship 30k', 15000), { fee: 30000, payer: 'customer' });
  assert.deepEqual(parseShip('shop chịu ship 25.000', 15000), { fee: 25000, payer: 'shop' });
  assert.equal(parseShip('móc khoá x2', 15000), null);
});
test('link: chỉ nhận http(s)', () => {
  assert.equal(safeLink('https://ig.me/m/abc'), 'https://ig.me/m/abc');
  assert.equal(safeLink('instagram.com/direct/t/1'), 'https://instagram.com/direct/t/1');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('data:text/html,x'), '');
  assert.equal(safeLink('abc def'), '');
  assert.equal(safeLink(''), '');
});
test('ghép tên sản phẩm lỏng: bỏ dấu, viết tắt, theo loại', () => {
  assert.equal(matchProduct('moc khoa', P).product.id, 'moc');
  assert.equal(matchProduct('Cúp pha lê mini vàng', P).variant.id, 'vang');
  assert.equal(matchProduct('cup xanh', P).variant.id, 'xanh');
  assert.equal(matchProduct('SET-01', P).product.id, 'set');
  assert.equal(matchProduct('bánh kem', P), null);
});

test('tin nhắn có nhãn: sản phẩm, ship, khách, link', () => {
  const r = parseChatOrder(`Thông tin đơn hàng:
- Móc khoá mica in ảnh x2
- Cúp pha lê mini vàng x1
Ship: 15k
Thông tin khách hàng:
Tên: Nguyễn Lan
SĐT: 0912 345 678
Địa chỉ: 12 Lê Lợi, Q1, TP.HCM
IG: @lan.ng
Link tin nhắn: https://www.instagram.com/direct/t/12345/`, P);
  assert.deepEqual(r.items.map((i) => [i.productId, i.variantId, i.qty]), [['moc', '', 2], ['cup', 'vang', 1]]);
  assert.equal(r.shipFee, 15000); assert.equal(r.shipPayer, 'customer');
  assert.equal(r.name, 'Nguyễn Lan'); assert.equal(r.phone, '0912345678');
  assert.equal(r.address, '12 Lê Lợi, Q1, TP.HCM'); assert.equal(r.account, '@lan.ng');
  assert.equal(r.link, 'https://www.instagram.com/direct/t/12345/'); assert.equal(r.platform, 'instagram');
});
test('tin nhắn viết tự do, không nhãn', () => {
  const r = parseChatOrder(`2 móc khoá
1 set quà anni
freeship
Lan 0987654321
45 Trần Hưng Đạo phường 5 quận 1
https://www.threads.net/@lan/post/abc`, P);
  assert.deepEqual(r.items.map((i) => [i.productId, i.qty]), [['moc', 2], ['set', 1]]);
  assert.equal(r.shipPayer, 'shop'); assert.equal(r.shipFee, 15000);
  assert.equal(r.phone, '0987654321'); assert.equal(r.name, 'Lan');
  assert.match(r.address, /Trần Hưng Đạo/); assert.equal(r.platform, 'threads');
});
test('một dòng sản phẩm cách nhau bằng dấu phẩy; ship nằm cùng dòng', () => {
  const r = parseChatOrder('Sản phẩm: móc khoá x3, cúp đỏ x2, ship 30k', P);
  assert.deepEqual(r.items.map((i) => [i.productId, i.variantId, i.qty]), [['moc', '', 3], ['cup', 'do', 2]]);
  assert.equal(r.shipFee, 30000);
});
test('sản phẩm lạ vẫn thành dòng chưa gắn; không có gì thì trống', () => {
  const r = parseChatOrder('Sản phẩm: Gấu bông x2\nTên: Hoa', P);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].matched, false); assert.equal(r.items[0].qty, 2); assert.equal(r.items[0].name, 'Gấu bông');
  assert.deepEqual(parseChatOrder('', P).items, []);
});
test('mặc định ship đồng giá khi tin không nói', () => {
  const r = parseChatOrder('Móc khoá x1', P, { shipFlat: 20000 });
  assert.equal(r.shipFee, 20000); assert.equal(r.shipPayer, 'customer'); assert.equal(r.shipFound, false);
});
test('nhiều link: ưu tiên link tin nhắn Instagram / Threads / Facebook', () => {
  const r = parseChatOrder('Móc khoá x1\nhttps://example.com/x\nhttps://ig.me/m/abc', P);
  assert.equal(r.link, 'https://example.com/x'.length ? r.link : '');
  assert.ok(/example|ig\.me/.test(r.link));
});
