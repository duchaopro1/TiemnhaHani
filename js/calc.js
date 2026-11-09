// Pure calculation helpers (no DOM) — usable in the browser and in Node tests.

export const PLATFORMS = {
  shopee: { label: 'Shopee' },
  threads: { label: 'Threads' },
  instagram: { label: 'Instagram' },
};

export const STATUSES = {
  pending: 'Chờ xử lý',
  designed: 'Đã thiết kế',
  packed: 'Đã đóng gói',
  shipping: 'Đang giao',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
  returned: 'Trả hàng',
};

// Orders in these statuses don't consume stock and don't count toward revenue/profit.
export const INACTIVE_STATUSES = new Set(['cancelled', 'returned']);

/**
 * What the customer has to pay for an order and how much of it is still to collect.
 * total     = goods after discount + shipping when the customer pays it
 * tracked   = the shop wrote down a payment (`paid` is a number, 0 included); blank means "not tracked"
 * remaining = total − paid (negative = paid too much). Deposits never change revenue or profit.
 */
export function orderPayment(costs, order) {
  const s = orderSummary(costs, order);
  const total = s.revenue + (order.shipPayer === 'shop' ? 0 : num(order.shipFee));
  const tracked = order.paid !== undefined && order.paid !== null && order.paid !== '' && Number.isFinite(+order.paid);
  const paid = tracked ? num(order.paid) : 0;
  return { total, tracked, paid, remaining: tracked ? total - paid : 0 };
}

/**
 * Money still to collect at delivery for the orders that are not finished yet. A finished order
 * counts as collected; cancelled or returned ones have nothing to collect.
 */
export function toCollect(costs, orders) {
  let amount = 0, count = 0;
  for (const o of orders) {
    if (!OPEN_STATUSES.has(o.status)) continue;
    const p = orderPayment(costs, o);
    if (p.tracked && p.remaining > 0) { amount += p.remaining; count += 1; }
  }
  return { amount, count };
}

/** Stock level: 'out' at 0 (or below), 'low' down to the warning level, otherwise 'ok'. */
export function stockState(n, low) {
  const x = Number(n) || 0;
  if (x <= 0) return 'out';
  return x <= (Number(low) || 0) ? 'low' : 'ok';
}

/** Orders that still have work left: not yet done, cancelled or returned. */
export const OPEN_STATUSES = new Set(['pending', 'designed', 'packed', 'shipping']);

/** How many orders are in each status; every status is present, even at 0. */
export function countByStatus(orders) {
  const counts = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
  for (const o of orders) if (o.status in counts) counts[o.status] += 1;
  return counts;
}

export const PACK_SLOTS = ['pack1', 'pack2', 'pack3'];
/** Packaging for the whole order (the outer box/bag that holds every product), one of each per order. */
export const WRAP_SLOTS = ['wrap1', 'wrap2', 'wrap3'];

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
    if (!isReceived(imp)) continue; // goods still on their way don't set the cost yet
    const kind = imp.kind === 'packaging' ? 'packaging' : 'product';
    const row = (table[kind][imp.itemId] ||= { qty: 0, total: 0 });
    row.qty += num(imp.qty);
    row.total += num(imp.qty) * num(imp.unitCost) + num(imp.extraFee);
  }
  // Shared supplies (tape, bubble wrap, staples) are an operating cost, never part of an order.
  const shared = {};
  for (const k of state.packaging || []) if (k.shared) shared[k.id] = true;
  const avg = (kind, list) => {
    const out = {};
    for (const item of list || []) {
      const row = table[kind][item.id];
      out[item.id] = row && row.qty > 0 ? row.total / row.qty : num(item.baseCost);
    }
    return out;
  };
  return { product: avg('product', state.products), packaging: avg('packaging', state.packaging), shared };
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
    if (line[slot] && !costs.shared?.[line[slot]]) packaging += num(costs.packaging[line[slot]]) * packUnits(line);
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
  // Outer packaging of the whole order: once per order, shared supplies are operating cost instead.
  let wrapping = 0;
  for (const slot of WRAP_SLOTS) if (order[slot] && !costs.shared?.[order[slot]]) wrapping += num(costs.packaging[order[slot]]);
  packaging += wrapping;
  const discount = num(order.discount);
  const fee = num(order.platformFee);
  const ship = order.shipPayer === 'shop' ? num(order.shipFee) : 0;
  const revenue = gross - discount;
  const cost = product + packaging + fee + ship;
  return { gross, discount, revenue, product, packaging, wrapping, fee, ship, cost, profit: revenue - cost };
}

/**
 * An import slip is either ordered (goods on their way) or received. Only received slips count as
 * stock, cost and operating cost. Slips written before this status existed have none: they are received.
 */
export const isReceived = (imp) => imp.status !== 'ordered';
/** The date a slip counts for money: when the goods arrived, else when it was written. */
export const importDate = (imp) => (isReceived(imp) && imp.receivedDate) || imp.date;

/** Key of one product variant (e.g. one colour of a trophy) in stock tables. */
export const variantKey = (productId, variantId) => `${productId}:${variantId}`;

/**
 * Current stock = imported − used by active orders (+ manual adjustments).
 * `products` holds each product's total; `variants` holds each variant's own count,
 * keyed by variantKey(). Imports/order lines without a variant only count in the total.
 */
export function stockLevels(state) {
  const products = {}, packaging = {}, variants = {};
  const incoming = { products: {}, packaging: {}, variants: {} }; // ordered, not yet received
  const addVariant = (pid, vid, n) => {
    if (!vid) return;
    const k = variantKey(pid, vid);
    variants[k] = num(variants[k]) + n;
  };
  for (const p of state.products || []) {
    products[p.id] = num(p.adjust);
    for (const v of p.variants || []) {
      variants[variantKey(p.id, v.id)] = num(v.adjust);
      products[p.id] += num(v.adjust);
    }
  }
  const sharedIds = new Set((state.packaging || []).filter((k) => k.shared).map((k) => k.id));
  for (const k of state.packaging || []) packaging[k.id] = num(k.adjust);
  for (const imp of state.imports || []) {
    if (!isReceived(imp)) {
      const n = num(imp.qty);
      if (imp.kind === 'packaging') incoming.packaging[imp.itemId] = num(incoming.packaging[imp.itemId]) + n;
      else {
        incoming.products[imp.itemId] = num(incoming.products[imp.itemId]) + n;
        if (imp.variantId) {
          const k = variantKey(imp.itemId, imp.variantId);
          incoming.variants[k] = num(incoming.variants[k]) + n;
        }
      }
      continue;
    }
    if (imp.kind === 'packaging') {
      packaging[imp.itemId] = num(packaging[imp.itemId]) + num(imp.qty);
    } else {
      products[imp.itemId] = num(products[imp.itemId]) + num(imp.qty);
      addVariant(imp.itemId, imp.variantId, num(imp.qty));
    }
  }
  for (const order of state.orders || []) {
    if (INACTIVE_STATUSES.has(order.status)) continue;
    for (const slot of WRAP_SLOTS) {
      if (order[slot] && !sharedIds.has(order[slot])) packaging[order[slot]] = num(packaging[order[slot]]) - 1;
    }
    for (const line of order.items || []) {
      if (line.productId) {
        products[line.productId] = num(products[line.productId]) - num(line.qty);
        addVariant(line.productId, line.variantId, -num(line.qty));
      }
      for (const slot of PACK_SLOTS) {
        if (line[slot] && !sharedIds.has(line[slot])) packaging[line[slot]] = num(packaging[line[slot]]) - packUnits(line);
      }
    }
  }
  return { products, packaging, variants, incoming };
}

/**
 * Operating cost of the period: everything bought of the shared supplies (packaging items marked
 * `shared`) with an import date inside [from, to]. Stock adjustments never change it: the money
 * was spent when the supplies were bought; adjusting only tells how much of them is used up.
 */
export function operatingCosts(state, from = '0000', to = '9999') {
  const shared = new Map((state.packaging || []).filter((k) => k.shared).map((k) => [k.id, k]));
  const rows = {};
  let total = 0;
  for (const imp of state.imports || []) {
    if (imp.kind !== 'packaging' || !shared.has(imp.itemId) || !isReceived(imp)) continue;
    const when = importDate(imp);
    if (when < from || when > to) continue;
    const amount = num(imp.qty) * num(imp.unitCost) + num(imp.extraFee);
    const row = (rows[imp.itemId] ||= { id: imp.itemId, name: shared.get(imp.itemId).name, qty: 0, amount: 0 });
    row.qty += num(imp.qty);
    row.amount += amount;
    total += amount;
  }
  return { total, items: Object.values(rows).sort((a, b) => b.amount - a.amount) };
}

/**
 * New stock adjustment so the book stock matches a physical count.
 * Only the adjustment changes: import slips, unit costs and operating costs are untouched.
 */
export function adjustForCount(currentAdjust, stockNow, counted) {
  return (Number(currentAdjust) || 0) + (Number(counted) || 0) - (Number(stockNow) || 0);
}

/** Split a batch fee across rows in proportion to their quantity (shares sum to the fee). */
export function splitFee(fee, qtys) {
  const total = qtys.reduce((s, q) => s + num(q), 0);
  if (!total) return qtys.map(() => 0);
  let left = num(fee);
  return qtys.map((q, i) => {
    if (i === qtys.length - 1) return left;
    const share = Math.round((num(fee) * num(q)) / total);
    left -= share;
    return share;
  });
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

/**
 * Share a parcel's shipping fee across its lines. `mode` 'qty' splits by number of pieces,
 * 'value' by goods value (qty x unit price). Shares are whole dong and always sum to the fee.
 */
export function allocateShipping(fee, lines, mode = 'qty') {
  const weights = lines.map((l) => (mode === 'value' ? num(l.qty) * num(l.unitCost) : num(l.qty)));
  return splitFee(fee, weights);
}

/** Customer account compared loosely: no case, no spaces, no leading "@". */
const accountKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, '').replace(/^@+/, '');

/**
 * Orders that look like the one being created: same customer account, still waiting (chờ xử lý /
 * đã thiết kế), and at least one product in common (same variant when both name one).
 * Returns [{ order, items: [matching lines of the existing order] }], newest first.
 */
export function findDuplicateOrders(orders, draft) {
  const who = accountKey(draft.customer);
  if (!who) return [];
  const mine = (draft.items || []).filter((l) => l.productId);
  if (!mine.length) return [];
  const same = (a, b) => a.productId === b.productId && (!a.variantId || !b.variantId || a.variantId === b.variantId);
  const out = [];
  for (const o of orders) {
    if (o.id && o.id === draft.id) continue;
    if (o.status !== 'pending' && o.status !== 'designed') continue;
    if (accountKey(o.customer) !== who) continue;
    const items = (o.items || []).filter((l) => l.productId && mine.some((m) => same(m, l)));
    if (items.length) out.push({ order: o, items });
  }
  return out.sort((a, b) => (b.order.date || '').localeCompare(a.order.date || ''));
}

/** Fixed pay for packing one order, in dong; the shop can change it on the revenue page. */
export const DEFAULT_LABOR = 10000;

/**
 * One row per finished order (status 'done') with where its money goes.
 *   total    = goods + shipping the customer pays - discount   (what the customer pays)
 *   revenue  = goods - discount
 *   shipFee  = the order's shipping fee, whoever pays it; `ship` is only the part the shop pays
 *   cost     = product cost + packaging + shipping the shop pays + platform fee
 *   before   = revenue - cost                (profit before labor)
 *   profit   = before - labor                (profit after labor)
 * Operating costs (shared supplies) are not per order and are not in these rows.
 */
export function completedRevenue(costs, orders, labor = DEFAULT_LABOR) {
  const rows = [];
  const total = { orders: 0, total: 0, gross: 0, discount: 0, revenue: 0, product: 0, packaging: 0, shipFee: 0, ship: 0, fee: 0, cost: 0, before: 0, labor: 0, profit: 0 };
  for (const order of orders) {
    if (order.status !== 'done') continue;
    const s = orderSummary(costs, order);
    const row = {
      order,
      total: orderPayment(costs, order).total,
      gross: s.gross, discount: s.discount, revenue: s.revenue,
      product: s.product, packaging: s.packaging, shipFee: num(order.shipFee), ship: s.ship, fee: s.fee, labor: num(labor),
    };
    row.cost = row.product + row.packaging + row.ship + row.fee;
    row.before = row.revenue - row.cost;
    row.profit = row.before - row.labor;
    rows.push(row);
    total.orders += 1;
    for (const k of Object.keys(total)) if (k !== 'orders') total[k] += row[k];
  }
  rows.sort((a, b) => (b.order.date || '').localeCompare(a.order.date || '') || (b.order.code || '').localeCompare(a.order.code || ''));
  return { rows, total };
}

/** The stages a product's pieces can be in, in order of the order's life. */
export const STAGE_KEYS = ['pending', 'designed', 'packed', 'shipping', 'done'];

/**
 * How many pieces of each product (and of each variant) are at each stage: waiting, designed, packed,
 * shipping, done. Cancelled and returned orders are not counted. Lines without a product are skipped.
 * Returns { [productId]: { total: {stage: n}, sum, variants: { [variantId or '']: {stage: n} } } }.
 */
export function stageQuantities(orders) {
  const out = {};
  const blank = () => Object.fromEntries(STAGE_KEYS.map((k) => [k, 0]));
  for (const o of orders) {
    if (!STAGE_KEYS.includes(o.status)) continue;
    for (const l of o.items || []) {
      if (!l.productId) continue;
      const row = (out[l.productId] ||= { total: blank(), sum: 0, variants: {} });
      const v = (row.variants[l.variantId || ''] ||= blank());
      const n = num(l.qty);
      row.total[o.status] += n;
      v[o.status] += n;
      row.sum += n;
    }
  }
  return out;
}

/** Orders still waiting for work: their goods have not been packed yet. */
export const WAITING_STATUSES = ['pending', 'designed'];

/**
 * Which waiting orders cannot be filled from the goods on the shelf, and what they lack.
 * The shelf = received stock minus what packed / shipping / done orders already took. Waiting orders
 * are served oldest first (order date, then creation time). An order that can be filled in full takes
 * its goods; one that cannot takes nothing, so what is left over still serves the orders behind it.
 * Returns { short: [{ order, lines: [{ productId, variantId, need, have, short, incoming }] }], ready: [order] }.
 */
export function orderShortages(state) {
  const orders = state.orders || [];
  const taken = orders.filter((o) => ['packed', 'shipping', 'done'].includes(o.status));
  const base = stockLevels({ ...state, orders: taken });
  const avail = { products: { ...base.products }, variants: { ...base.variants } };
  const incoming = stockLevels(state).incoming;
  const waiting = orders
    .filter((o) => WAITING_STATUSES.includes(o.status))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || num(a.createdAt) - num(b.createdAt) || (a.code || '').localeCompare(b.code || ''));
  const short = [], ready = [];
  for (const order of waiting) {
    // what the order needs, per variant (or per product when no variant is chosen)
    const need = new Map();
    for (const l of order.items || []) {
      if (!l.productId || !(num(l.qty) > 0)) continue;
      const key = l.variantId ? variantKey(l.productId, l.variantId) : l.productId;
      const row = need.get(key) || { productId: l.productId, variantId: l.variantId || '', need: 0 };
      row.need += num(l.qty);
      need.set(key, row);
    }
    const lacking = [];
    for (const [key, row] of need) {
      const have = row.variantId ? num(avail.variants[key]) : num(avail.products[key]);
      if (have < row.need) {
        lacking.push({
          ...row, have: Math.max(0, have), short: row.need - Math.max(0, have),
          incoming: row.variantId ? num(incoming.variants[key]) : num(incoming.products[row.productId]),
        });
      }
    }
    if (lacking.length) { short.push({ order, lines: lacking }); continue; }
    ready.push(order);
    for (const row of need.values()) {
      avail.products[row.productId] = num(avail.products[row.productId]) - row.need;
      if (row.variantId) avail.variants[variantKey(row.productId, row.variantId)] = num(avail.variants[variantKey(row.productId, row.variantId)]) - row.need;
    }
  }
  return { short, ready };
}
