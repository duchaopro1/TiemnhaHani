// Pure calculation helpers (no DOM) — usable in the browser and in Node tests.

export const PLATFORMS = {
  shopee: { label: 'Shopee' },
  threads: { label: 'Threads' },
  instagram: { label: 'Instagram' },
};

export const STATUSES = {
  pending: 'Chờ xử lý',
  shipping: 'Đang giao',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
  returned: 'Trả hàng',
};

// Orders in these statuses don't consume stock and don't count toward revenue/profit.
export const INACTIVE_STATUSES = new Set(['cancelled', 'returned']);

export const PACK_SLOTS = ['pack1', 'pack2', 'pack3'];

const num = (v) => (Number.isFinite(+v) ? +v : 0);

/**
 * Weighted-average unit cost of every product/packaging item, from the import log.
 * Unit cost of one import row = (qty * unitCost + extraFee) / qty, so shipping paid
 * when buying stock is spread across the units.
 * Falls back to the item's manual `baseCost` when it has never been imported.
 */
export function costTable(state) {
  const table = { product: {}, packaging: {} };
  for (const imp of state.imports || []) {
    const kind = imp.kind === 'packaging' ? 'packaging' : 'product';
    const row = (table[kind][imp.itemId] ||= { qty: 0, total: 0 });
    row.qty += num(imp.qty);
    row.total += num(imp.qty) * num(imp.unitCost) + num(imp.extraFee);
  }
  const avg = (kind, list) => {
    const out = {};
    for (const item of list || []) {
      const row = table[kind][item.id];
      out[item.id] = row && row.qty > 0 ? row.total / row.qty : num(item.baseCost);
    }
    return out;
  };
  return { product: avg('product', state.products), packaging: avg('packaging', state.packaging) };
}

/** Number of packaging units a line uses: once per line, or once per product unit. */
export function packUnits(line) {
  return line.packEach ? Math.max(1, num(line.qty)) : 1;
}

/** Cost breakdown of one order line. */
export function lineCost(costs, line) {
  const qty = num(line.qty);
  const product = qty * num(costs.product[line.productId]);
  let packaging = 0;
  for (const slot of PACK_SLOTS) {
    if (line[slot]) packaging += num(costs.packaging[line[slot]]) * packUnits(line);
  }
  const revenue = qty * num(line.price);
  return { revenue, product, packaging, total: product + packaging, profit: revenue - product - packaging };
}

/**
 * Profit summary of an order.
 *   revenue  = Σ(price × qty) − discount
 *   profit   = revenue − product cost − packaging cost − platform fee − ship (only if shop pays)
 * When the customer pays shipping, it's a pass-through and is ignored.
 */
export function orderSummary(costs, order) {
  let gross = 0, product = 0, packaging = 0;
  for (const line of order.items || []) {
    const c = lineCost(costs, line);
    gross += c.revenue;
    product += c.product;
    packaging += c.packaging;
  }
  const discount = num(order.discount);
  const fee = num(order.platformFee);
  const ship = order.shipPayer === 'shop' ? num(order.shipFee) : 0;
  const revenue = gross - discount;
  const cost = product + packaging + fee + ship;
  return { gross, discount, revenue, product, packaging, fee, ship, cost, profit: revenue - cost };
}

/** Current stock = imported − used by active orders (+ manual adjustments). */
export function stockLevels(state) {
  const products = {}, packaging = {};
  for (const p of state.products || []) products[p.id] = num(p.adjust);
  for (const k of state.packaging || []) packaging[k.id] = num(k.adjust);
  for (const imp of state.imports || []) {
    const bucket = imp.kind === 'packaging' ? packaging : products;
    bucket[imp.itemId] = num(bucket[imp.itemId]) + num(imp.qty);
  }
  for (const order of state.orders || []) {
    if (INACTIVE_STATUSES.has(order.status)) continue;
    for (const line of order.items || []) {
      if (line.productId) products[line.productId] = num(products[line.productId]) - num(line.qty);
      for (const slot of PACK_SLOTS) {
        if (line[slot]) packaging[line[slot]] = num(packaging[line[slot]]) - packUnits(line);
      }
    }
  }
  return { products, packaging };
}

/** Aggregate stats for a list of orders. */
export function aggregate(costs, orders) {
  const total = { orders: 0, revenue: 0, cost: 0, profit: 0, byPlatform: {}, byProduct: {} };
  for (const order of orders) {
    if (INACTIVE_STATUSES.has(order.status)) continue;
    const s = orderSummary(costs, order);
    total.orders += 1;
    total.revenue += s.revenue;
    total.cost += s.cost;
    total.profit += s.profit;
    const pf = (total.byPlatform[order.platform] ||= { orders: 0, revenue: 0, profit: 0 });
    pf.orders += 1;
    pf.revenue += s.revenue;
    pf.profit += s.profit;
    for (const line of order.items || []) {
      if (!line.productId) continue;
      const c = lineCost(costs, line);
      const pr = (total.byProduct[line.productId] ||= { qty: 0, revenue: 0, profit: 0 });
      pr.qty += num(line.qty);
      pr.revenue += c.revenue;
      pr.profit += c.profit;
    }
  }
  return total;
}
