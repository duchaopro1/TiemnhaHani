import test from 'node:test';
import assert from 'node:assert/strict';
import { costTable, orderSummary, stockLevels } from '../js/calc.js';
import { rowsToOrders, parseNumber, mapStatus } from '../js/shopee.js';

const state = {
  products: [{ id: 'p1', name: 'Móc khoá' }, { id: 'p2', name: 'Khung', baseCost: 50000 }],
  packaging: [{ id: 'box', name: 'Hộp' }, { id: 'rib', name: 'Ruy băng' }],
  imports: [
    { kind: 'product', itemId: 'p1', qty: 10, unitCost: 10000, extraFee: 10000 }, // 11.000/cái
    { kind: 'product', itemId: 'p1', qty: 10, unitCost: 12000, extraFee: 0 },     // TB 11.500
    { kind: 'packaging', itemId: 'box', qty: 100, unitCost: 3000 },
    { kind: 'packaging', itemId: 'rib', qty: 100, unitCost: 1000 },
  ],
  orders: [],
};

test('giá vốn trung bình có tính phí ship nhập, fallback giá gốc', () => {
  const c = costTable(state);
  assert.equal(c.product.p1, 11500);
  assert.equal(c.product.p2, 50000);
  assert.equal(c.packaging.box, 3000);
});

test('lợi nhuận: shop chịu ship vs khách chịu ship', () => {
  const c = costTable(state);
  const order = {
    items: [{ productId: 'p1', qty: 2, price: 45000, pack1: 'box', pack2: 'rib', pack3: '' }],
    shipFee: 30000, shipPayer: 'customer', discount: 5000, platformFee: 2000,
  };
  // 90.000 - 5.000 - 23.000 - 4.000 (đóng gói 1 lần) - 2.000
  assert.equal(orderSummary(c, order).profit, 56000);
  assert.equal(orderSummary(c, { ...order, shipPayer: 'shop' }).profit, 26000);
  // đóng gói riêng từng cái => 8.000
  assert.equal(orderSummary(c, { ...order, items: [{ ...order.items[0], packEach: true }] }).profit, 52000);
});

test('tồn kho trừ theo đơn, bỏ qua đơn huỷ', () => {
  const s = { ...state, orders: [
    { status: 'done', items: [{ productId: 'p1', qty: 3, pack1: 'box' }] },
    { status: 'cancelled', items: [{ productId: 'p1', qty: 5, pack1: 'box' }] },
  ] };
  const st = stockLevels(s);
  assert.equal(st.products.p1, 17);
  assert.equal(st.packaging.box, 99);
});

test('đọc file xuất đơn Shopee, gộp nhiều dòng cùng mã đơn', () => {
  const rows = [
    ['Mã đơn hàng', 'Ngày đặt hàng', 'Trạng Thái Đơn Hàng', 'SKU phân loại hàng', 'Tên sản phẩm', 'Số lượng', 'Tổng giá bán (sản phẩm)', 'Phí cố định', 'Phí Dịch Vụ', 'Phí thanh toán', 'Phí vận chuyển mà người mua trả'],
    ['2410A', '2024-10-01 10:00', 'Hoàn thành', 'MK-01', 'Móc khoá', 2, '90.000', 3000, 2000, 1000, 15000],
    ['2410A', '2024-10-01 10:00', 'Hoàn thành', 'KH-13', 'Khung', 1, 120000, 3000, 2000, 1000, 15000],
    ['2410B', '05/10/2024', 'Đã hủy', 'MK-01', 'Móc khoá', 1, 45000, 0, 0, 0, 0],
  ];
  const orders = rowsToOrders(rows);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].items.length, 2);
  assert.equal(orders[0].items[0].price, 45000);
  assert.equal(orders[0].platformFee, 6000);
  assert.equal(orders[0].date, '2024-10-01');
  assert.equal(orders[1].status, 'cancelled');
  assert.equal(orders[1].date, '2024-10-05');
  assert.equal(parseNumber('1.250.000'), 1250000);
  assert.equal(mapStatus('Đang giao'), 'shipping');
});
