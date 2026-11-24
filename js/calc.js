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
  const product = avg('product', state.products);
  // A combo costs what its parts cost; it is never imported itself.
  for (const p of state.products || []) {
    const parts = comboParts(p);
    if (parts.length) product[p.id] = parts.reduce((n, c) => n + num(c.qty) * partUnitCost(c, product), 0);
  }
  // Products with a single type (no variants, not a combo) are costed first-in-first-out: the oldest batch sells first.
  const fifo = {}; const fifoIds = new Set();
  for (const p of state.products || []) {
    if (!isFifoProduct(p)) continue;
    fifoIds.add(p.id);
    const batches = (state.imports || []).map((imp, idx) => ({ imp, idx }))
      .filter(({ imp }) => isReceived(imp) && imp.kind !== 'packaging' && imp.itemId === p.id && num(imp.qty) > 0)
      .sort((a, b) => (importDate(a.imp) || '').localeCompare(importDate(b.imp) || '') || (a.imp.date || '').localeCompare(b.imp.date || '') || a.idx - b.idx)
      .map(({ imp }) => ({ qty: num(imp.qty), unit: (num(imp.qty) * num(imp.unitCost) + num(imp.extraFee)) / num(imp.qty) }));
    if (batches.length) fifo[p.id] = { batches, consumed: 0 };
  }
  const combos = comboMap(state.products);
  // The queue: every order that is not cancelled / returned takes its pieces from the batches in the order of the day it was
  // made (the day it is packed), combos by their parts. `before` = how many pieces of the product the orders ahead of it took.
  const running = {};
  for (const o of (state.orders || []).filter((x) => !INACTIVE_STATUSES.has(x.status)).sort(orderSeq)) {
    const per = {};
    for (const l of o.items || []) for (const part of expandLine(l, combos)) if (part.productId && fifo[part.productId]) per[part.productId] = (per[part.productId] || 0) + num(part.qty);
    for (const [pid, n] of Object.entries(per)) { (fifo[pid].before ||= new Map()).set(o.id, running[pid] || 0); running[pid] = (running[pid] || 0) + n; }
  }
  for (const pid of Object.keys(fifo)) fifo[pid].total = fifo[pid].consumed = running[pid] || 0;
  return { product, packaging: avg('packaging', state.packaging), shared, combos, fifo, fifoIds };
}

/** Order in the queue: the day the order was made, then when it was entered, then its code (numbers compared as numbers). */
export const orderSeq = (a, b) => (a.date || '').localeCompare(b.date || '')
  || (a.createdAt && b.createdAt ? a.createdAt - b.createdAt : 0)
  || (a.code || '').localeCompare(b.code || '', 'vi', { numeric: true })
  || (a.id || '').localeCompare(b.id || '');
/** Context to cost one order's lines one after another (a later line of the same product comes after the earlier ones). */
export const orderCtx = (order) => ({ orderId: order?.id || '', taken: {} });

/**
 * Every product that is bought as itself (not a combo) is costed first-in-first-out by pieces: the oldest batch is used up
 * before the next one starts. Types (colours, letters) do not matter, only the count of pieces of the product.
 */
export const isFifoProduct = (p) => !!p && !comboParts(p).length;

/** Cost of `qty` pieces taken after `start` pieces were already taken from `batches` ([{ qty, unit }], oldest first). */
export function fifoSpan(batches, start, qty) {
  let skip = start; let need = qty; let cost = 0;
  for (const b of batches) {
    if (need <= 0) break;
    if (skip >= b.qty) { skip -= b.qty; continue; }
    const take = Math.min(b.qty - skip, need);
    cost += take * b.unit; need -= take; skip = 0;
  }
  if (need > 0 && batches.length) cost += need * batches[batches.length - 1].unit; // more sold than imported: last price
  return cost;
}

/**
 * A combo is a product made of other products: `combo: [{ productId, variantId?, random?, qty }]`. A part
 * with `random` is a surprise pick among the product's variants: it needs no choice on the order. It is sold
 * like any product, but its cost and stock come from its parts. Parts must not be combos themselves.
 */
export const comboParts = (p) => (p?.combo || []).filter((c) => (c.productId || c.pool?.length) && num(c.qty) > 0);
/** A part that is a surprise pick among several products: `{ pool: [productId…], qty }`. */
export const isPoolPart = (c) => !c.productId && (c.pool?.length || 0) > 0;
/** Stable key of a pool, whatever the order of its products. */
export const poolKey = (pool) => [...(pool || [])].sort().join(',');
/** Pick on an order for a pool part: "productId" or "productId:variantId", only if it is in the pool. */
export const parsePick = (pick, pool) => {
  if (!pick) return null;
  const [productId, variantId = ''] = String(pick).split(':');
  return (pool || []).includes(productId) ? { productId, variantId } : null;
};
/** Cost of one piece of a part: the product's cost; for a pool the average of its products. */
const partUnitCost = (c, table) => (isPoolPart(c)
  ? c.pool.reduce((n, id) => n + num(table[id]), 0) / Math.max(1, c.pool.length)
  : num(table[c.productId]));
export const isCombo = (p) => comboParts(p).length > 0;

/**
 * The stock-bearing lines a sold line stands for: itself, or the parts of the combo. A part without a
 * fixed variant takes the one chosen on the order: `line.picks[unit][part]`, one choice per combo sold,
 * so each combo can have its own colour/letter. A pool part takes the product (and variant) picked on the
 * order as "productId[:variantId]"; with no pick it stays an open pool line `{ pool, qty }`.
 * Same product and variant (or same pool) add up into one line.
 */
export function expandLine(line, combos) {
  const combo = combos?.get?.(line.productId);
  if (!combo) return line.productId ? [line] : [];
  const parts = comboParts(combo);
  const out = new Map();
  for (let u = 0; u < Math.max(0, Math.round(num(line.qty))); u++) {
    parts.forEach((c, i) => {
      let productId = c.productId, variantId = c.variantId || line.picks?.[u]?.[i] || '', row, key;
      if (isPoolPart(c)) {
        const pick = parsePick(line.picks?.[u]?.[i], c.pool);
        if (pick) ({ productId, variantId } = pick);
        else { key = `pool:${poolKey(c.pool)}`; row = out.get(key) || { pool: c.pool, productId: '', variantId: '', qty: 0 }; }
      }
      if (!row) { key = `${productId}:${variantId}`; row = out.get(key) || { productId, variantId, qty: 0 }; }
      row.qty += num(c.qty);
      out.set(key, row);
    });
  }
  return [...out.values()];
}
/** Map of combo products by id, for expandLine. */
export const comboMap = (products) => new Map((products || []).filter(isCombo).map((p) => [p.id, p]));

/** Number of packaging units a line uses: once per line, or once per product unit. */
export function packUnits(line) {
  return line.packEach ? Math.max(1, num(line.qty)) : 1;
}

/** What a line is made of for costing; a snapshot is only valid while the line still has this exact key. */
const lineKey = (l) => JSON.stringify([l.productId || '', l.variantId || '', num(l.qty), l.picks || null, l.pack1 || '', l.pack2 || '', l.pack3 || '', !!l.packEach]);
const wrapKey = (o) => JSON.stringify([o.wrap1 || '', o.wrap2 || '', o.wrap3 || '']);

/** Cost breakdown of one order line. A line of a finished order uses the cost fixed when it was completed. */
export function lineCost(costs, line, ctx) {
  const c = liveLineCost(costs, line, ctx);
  const s = line.snap;
  if (s && s.key === lineKey(line)) {
    return { ...c, product: num(s.product), packaging: num(s.packaging), total: num(s.product) + num(s.packaging), profit: c.revenue - num(s.product) - num(s.packaging) };
  }
  return c;
}

/** The cost of a line at today's average prices (ignores any snapshot). */
export function liveLineCost(costs, line, ctx = orderCtx(null)) {
  const qty = num(line.qty);
  let product = qty * num(costs.product[line.productId]);
  const combo = costs.combos?.get?.(line.productId);
  // cost of `n` pieces of a product, right after the pieces its order's earlier lines and the orders ahead of it took
  const piece = (pid, n) => {
    const fi = costs.fifo?.[pid];
    if (!fi) return n * num(costs.product[pid]);
    const start = (ctx.orderId && fi.before?.has(ctx.orderId) ? fi.before.get(ctx.orderId) : fi.total) + num(ctx.taken[pid]);
    ctx.taken[pid] = num(ctx.taken[pid]) + n;
    return fifoSpan(fi.batches, start, n);
  };
  if (!combo && line.productId) product = piece(line.productId, qty);
  if (combo) {
    // a combo costs its parts, each taken from its own batches; a pool part costs the picked product (the average of the pool until picked)
    product = 0;
    for (let u = 0; u < Math.max(0, Math.round(qty)); u++) {
      comboParts(combo).forEach((c, i) => {
        const pick = isPoolPart(c) ? parsePick(line.picks?.[u]?.[i], c.pool) : null;
        if (isPoolPart(c)) product += pick ? piece(pick.productId, num(c.qty)) : num(c.qty) * partUnitCost(c, costs.product);
        else product += piece(c.productId, num(c.qty));
      });
    }
  }
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
  const ctx = orderCtx(order);
  for (const line of order.items || []) {
    const c = lineCost(costs, line, ctx);
    gross += c.revenue;
    product += c.product;
    packaging += c.packaging;
  }
  // Outer packaging of the whole order: once per order, shared supplies are operating cost instead.
  let wrapping = 0;
  for (const slot of WRAP_SLOTS) if (order[slot] && !costs.shared?.[order[slot]]) wrapping += num(costs.packaging[order[slot]]);
  if (order.snapWrap && order.snapWrap.key === wrapKey(order)) wrapping = num(order.snapWrap.value);
  packaging += wrapping;
  const discount = num(order.discount);
  // A cancelled or returned order sold nothing: no revenue, no goods cost. Only a returned order keeps the fee Shopee
  // still charges (PiShip), which is its whole loss; a cancelled order is 0.
  if (INACTIVE_STATUSES.has(order.status)) {
    const loss = returnLoss(order);
    return { gross, discount, revenue: 0, product: 0, packaging: 0, wrapping: 0, fee: loss, ship: 0, cost: loss, profit: -loss };
  }
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
  const combos = comboMap(state.products);
  const unassigned = {}; // pieces sold from a pool of products whose actual product is not picked yet
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
      for (const part of expandLine(line, combos)) {
        if (part.pool) { unassigned[poolKey(part.pool)] = num(unassigned[poolKey(part.pool)]) + num(part.qty); continue; }
        products[part.productId] = num(products[part.productId]) - num(part.qty);
        addVariant(part.productId, part.variantId, -num(part.qty));
      }
      for (const slot of PACK_SLOTS) {
        if (line[slot] && !sharedIds.has(line[slot])) packaging[line[slot]] = num(packaging[line[slot]]) - packUnits(line);
      }
    }
  }
  // A combo can be made as many times as its scarcest part allows.
  for (const p of combos.values()) {
    products[p.id] = Math.min(...comboParts(p).map((c) => {
      const have = isPoolPart(c)
        ? c.pool.reduce((n, id) => n + num(products[id]), 0) - num(unassigned[poolKey(c.pool)])
        : c.variantId ? num(variants[variantKey(c.productId, c.variantId)]) : num(products[c.productId]);
      return Math.floor(have / num(c.qty));
    }));
  }
  return { products, packaging, variants, incoming, unassigned };
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
/**
 * What a returned Shopee order still costs: the PiShip service fee stays charged although the sale is refunded (the
 * return shipping is paid back by PiShip, so it nets to zero). Only a returned order with a platform fee counts.
 */
export const returnLoss = (order) => (order.status === 'returned' ? Math.max(0, num(order.platformFee)) : 0);

export function aggregate(costs, orders) {
  const total = { orders: 0, revenue: 0, cost: 0, profit: 0, returnLoss: 0, byPlatform: {}, byProduct: {} };
  for (const order of orders) {
    const loss = returnLoss(order);
    if (loss) {
      total.returnLoss += loss; total.cost += loss; total.profit -= loss;
      (total.byPlatform[order.platform] ||= { orders: 0, revenue: 0, profit: 0 }).profit -= loss;
    }
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
    const lctx = orderCtx(order);
    for (const line of order.items || []) {
      if (!line.productId) continue;
      const c = lineCost(costs, line, lctx);
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

/** The shop's flat shipping fee, in dong, until the shop sets its own in the settings. Most orders use it, so the order form offers it as a choice instead of a number to type. */
export const SHIP_FLAT = 15000;
/**
 * Which shipping choice an order is: 'flat' (the flat fee, the customer pays), 'free' (the flat fee, the shop pays:
 * freeship) or 'other' (any other fee, typed in). An order with no fee at all is 'other'.
 */
export function shipModeOf(order, flat = SHIP_FLAT) {
  if (num(order?.shipFee) !== flat) return 'other';
  return order.shipPayer === 'shop' ? 'free' : 'flat';
}

/** Pay for packing one product (one piece sold), in dong; the shop can change it on the revenue page. */
export const DEFAULT_LABOR = 10000;

/**
 * One row per finished order (status 'done') with where its money goes.
 *   total    = goods + shipping the customer pays - discount   (what the customer pays)
 *   revenue  = goods - discount
 *   shipFee  = the order's shipping fee, whoever pays it; `ship` is only the part the shop pays
 *   cost     = product cost + packaging + shipping the shop pays + platform fee
 *   labor    = pay per product x pieces in the order (a combo counts as the pieces sold, not its parts)
 *   before   = revenue - cost                (profit before labor)
 *   profit   = before - labor                (profit after labor)
 * Operating costs (shared supplies) are not per order and are not in these rows.
 */
/** The day an order counts in the revenue page: when it was completed (orders from before that was recorded: the day they were made). */
export const doneDay = (o) => o.doneAt || o.date || '';

export function completedRevenue(costs, orders, laborPerItem = DEFAULT_LABOR) {
  const rows = [];
  const total = { orders: 0, total: 0, gross: 0, discount: 0, revenue: 0, product: 0, packaging: 0, shipFee: 0, ship: 0, fee: 0, cost: 0, before: 0, labor: 0, profit: 0, pieces: 0 };
  for (const order of orders) {
    const loss = returnLoss(order);
    if (loss) { // a returned order: no sale, only the fee Shopee keeps
      const row = { order, returned: true, pieces: 0, total: 0, gross: 0, discount: 0, revenue: 0, product: 0, packaging: 0, shipFee: 0, ship: 0, fee: loss, labor: 0, cost: loss, before: -loss, profit: -loss };
      rows.push(row);
      for (const k of Object.keys(total)) if (k !== 'orders') total[k] += row[k];
      continue;
    }
    if (order.status !== 'done') continue;
    const s = orderSummary(costs, order);
    const pieces = (order.items || []).reduce((n, l) => n + num(l.qty), 0);
    const row = {
      order, pieces,
      total: orderPayment(costs, order).total,
      gross: s.gross, discount: s.discount, revenue: s.revenue,
      product: s.product, packaging: s.packaging, shipFee: num(order.shipFee), ship: s.ship, fee: s.fee, labor: num(laborPerItem) * pieces,
    };
    row.cost = row.product + row.packaging + row.ship + row.fee;
    row.before = row.revenue - row.cost;
    row.profit = row.before - row.labor;
    rows.push(row);
    total.orders += 1;
    for (const k of Object.keys(total)) if (k !== 'orders') total[k] += row[k];
  }
  rows.sort((a, b) => doneDay(b.order).localeCompare(doneDay(a.order)) || (b.order.code || '').localeCompare(a.order.code || ''));
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
  const combos = comboMap(state.products);
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
    const poolNeed = new Map(); // open pools: the actual product is not picked yet
    for (const l of (order.items || []).flatMap((x) => expandLine(x, combos))) {
      if (l.pool) {
        const k = poolKey(l.pool);
        const row = poolNeed.get(k) || { pool: l.pool, need: 0 };
        row.need += num(l.qty);
        poolNeed.set(k, row);
        continue;
      }
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
    for (const row of poolNeed.values()) {
      const have = row.pool.reduce((n, id) => n + Math.max(0, num(avail.products[id])), 0);
      if (have < row.need) {
        lacking.push({ productId: '', variantId: '', pool: row.pool, need: row.need, have, short: row.need - have, incoming: row.pool.reduce((n, id) => n + num(incoming.products[id]), 0) });
      }
    }
    if (lacking.length) { short.push({ order, lines: lacking }); continue; }
    ready.push(order);
    for (const row of poolNeed.values()) {
      let left = row.need; // take them from the products of the pool, one after the other
      for (const id of row.pool) {
        const take = Math.min(left, Math.max(0, num(avail.products[id])));
        avail.products[id] = num(avail.products[id]) - take;
        left -= take;
      }
    }
    for (const row of need.values()) {
      avail.products[row.productId] = num(avail.products[row.productId]) - row.need;
      if (row.variantId) avail.variants[variantKey(row.productId, row.variantId)] = num(avail.variants[variantKey(row.productId, row.variantId)]) - row.need;
    }
  }
  return { short, ready };
}

/**
 * Where goods that are ordered (not yet received) are on their way from China. Only a label for the
 * shop: stock, cost and operating cost still count the goods when the slip is received.
 */
export const TRANSIT_STAGES = {
  shipping_cn: 'Đang ship từ TQ',
  customs: 'Chờ thông quan',
  cleared: 'Đã thông quan',
  shipping_vn: 'Đang ship về', // goods ordered in Vietnam have this single stage
};
/** The stages of a slip, by where the goods were ordered: China goes through customs, Vietnam only ships. */
export const TRANSIT_BY_ORIGIN = {
  cn: ['shipping_cn', 'customs', 'cleared'],
  vn: ['shipping_vn'],
};
/** Where a slip was ordered. Slips from before this option were all from China. */
export const originOf = (slip) => (slip?.origin === 'vn' || slip?.transit === 'shipping_vn' ? 'vn' : 'cn');

/**
 * "Đang ship từ TQ" starts the day the goods are ordered, so only the stages after it get a time.
 */
export const TIMED_STAGES = ['customs', 'cleared'];

/**
 * Move a slip to another stage on the way and remember when it got there: { transit, transitAt }.
 * `transitAt` maps each timed stage reached (not "Đang ship từ TQ") to a time (ms). Going back drops
 * the stages after the new one; a stage reached before keeps its time. An empty stage (received, or
 * none) leaves the history alone.
 */
export function withTransit(slip, stage, now = Date.now()) {
  const keys = TRANSIT_BY_ORIGIN[stage === 'shipping_vn' ? 'vn' : 'cn'];
  const old = slip?.transitAt || {};
  if (!stage || !(stage in TRANSIT_STAGES)) return { transit: '', ...(slip?.transitAt ? { transitAt: old } : {}) };
  const at = {};
  for (const k of keys.slice(0, keys.indexOf(stage) + 1)) if (TIMED_STAGES.includes(k) && old[k] !== undefined) at[k] = old[k];
  if (TIMED_STAGES.includes(stage)) at[stage] = old[stage] !== undefined ? old[stage] : now;
  return { transit: stage, transitAt: at };
}

/** The stages a slip has been through, in order: [{ stage, label, at }]. */
export function transitHistory(slip) {
  return Object.entries(TRANSIT_STAGES)
    .filter(([k]) => TIMED_STAGES.includes(k) && slip?.transitAt?.[k] !== undefined)
    .map(([k, label]) => ({ stage: k, label, at: slip.transitAt[k] }));
}

export { tierPrice } from './tier.js';

/**
 * Dates a status change leaves on an order: `shippedAt` (started shipping) and `doneAt` (completed), both YYYY-MM-DD.
 * Only a real change of status writes them, and a date the person typed in the same save is left alone.
 * Going back before "Đang giao" clears the shipping date; leaving "Hoàn thành" clears the completion date.
 * A brand-new document (no `prev`) is never stamped, so restoring a backup does not invent dates.
 */
export function stampStatusDates(prev, next, today) {
  if (!prev || !next || prev.status === next.status) return next;
  const out = { ...next };
  const kept = (k) => (next[k] || '') !== (prev[k] || ''); // typed by hand in this save
  if (next.status === 'shipping' && !kept('shippedAt')) out.shippedAt = today;
  if (next.status === 'done' && !kept('doneAt')) out.doneAt = today;
  if (['pending', 'designed', 'packed'].includes(next.status) && !kept('shippedAt')) out.shippedAt = '';
  if (next.status !== 'done' && !kept('doneAt')) out.doneAt = '';
  return out;
}

/**
 * Fix an order's costs at the moment it is completed, so a later import at another price does not rewrite its profit.
 *  - status "Hoàn thành": every line (and the outer wrapping) keeps the cost of today; lines that already hold a valid
 *    snapshot are left alone, a line whose product / quantity / packaging changed gets a new one.
 *  - any other status: snapshots are removed (the order is costed at the live average again).
 * `getCosts` is only called when something needs fixing. Returns the same object when nothing changes.
 */
export function applyCostSnapshot(order, getCosts) {
  if (!order) return order;
  const hasSnap = (order.items || []).some((l) => l.snap) || order.snapWrap;
  if (order.status !== 'done') {
    if (!hasSnap) return order;
    const { snapWrap, ...rest } = order;
    return { ...rest, items: (order.items || []).map(({ snap, ...l }) => l) };
  }
  const lineStale = (l) => snapStale(l);
  const wrapStale = !(order.snapWrap && order.snapWrap.key === wrapKey(order));
  if (!(order.items || []).some(lineStale) && !wrapStale) return order;
  const costs = getCosts(order);
  const ctx = orderCtx(order);
  const items = (order.items || []).map((l) => {
    const { snap, ...rest } = l;
    const c = liveLineCost(costs, rest, ctx); // every line is walked so the next line of the same product starts after this one
    if (!lineStale(l)) return l;
    return { ...rest, snap: { key: lineKey(rest), product: c.product, packaging: c.packaging, fifo: true, ord: 1 } };
  });
  let wrapping = 0;
  for (const slot of WRAP_SLOTS) if (order[slot] && !costs.shared?.[order[slot]]) wrapping += num(costs.packaging[order[slot]]);
  return { ...order, items, snapWrap: { key: wrapKey(order), value: wrapping } };
}

/** Throw the fixed costs away so the next save fixes them again at today's prices. */
export const clearCostSnapshot = (order) => {
  const { snapWrap, ...rest } = order;
  return { ...rest, items: (order.items || []).map(({ snap, ...l }) => l) };
};

/**
 * Finished orders whose fixed costs are missing or out of date: no snapshot, a snapshot of another line, or an
 * average-based snapshot on a product that is now costed first-in-first-out.
 */
/** A line's fixed cost is out of date: none, for another line, or made by an older way of costing (all-import average, moving average). */
const snapStale = (l) => !!l.productId && !(l.snap && l.snap.key === lineKey(l) && l.snap.fifo && l.snap.ord === 1);

export function staleDoneOrders(state) {
  const stale = snapStale;
  return (state.orders || []).filter((o) => o.status === 'done' && ((o.items || []).some(stale) || !(o.snapWrap && o.snapWrap.key === wrapKey(o))));
}

/**
 * Fix the costs of finished orders again. A product's batches are used in the order the orders were made, so each
 * order's place in the queue does not depend on when it was completed and one pass over all orders is enough.
 * `all` throws every old snapshot away; otherwise only lines that are missing or out of date are redone.
 * Returns the orders with their costs fixed (ready to save).
 */
export function resnapshotDone(state, targets, { all = false } = {}) {
  const costs = costTable(state);
  return targets.map((o) => {
    const base = all ? clearCostSnapshot(o) : { ...o, items: (o.items || []).map((l) => (l.snap && snapStale(l) ? (({ snap, ...x }) => x)(l) : l)) };
    return applyCostSnapshot(base, () => costs);
  });
}
