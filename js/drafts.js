// Autosaved drafts of the order form, kept in this browser so a half-typed order survives
// Esc, a reload, or a new version of the page being delivered. Pure helpers: the storage is
// passed in, so they run in Node tests too.
const KEY = 'hani-drafts-v1';
const MAX_AGE = 7 * 24 * 3600 * 1000;

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const str = (v) => (v == null ? '' : String(v));

/** JSON with sorted keys, so two equal orders always compare equal. */
export const stable = (v) =>
  JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : val));

/** The parts of an order the form edits, with defaults filled in (undefined === '' === 0). */
export function normalizeOrder(o) {
  return {
    platform: str(o.platform),
    code: str(o.code).trim(),
    date: str(o.date),
    customer: str(o.customer).trim(),
    status: str(o.status) || 'pending',
    note: str(o.note),
    card: Boolean(o.card),
    wrap1: str(o.wrap1),
    wrap2: str(o.wrap2),
    wrap3: str(o.wrap3),
    shipFee: num(o.shipFee),
    tracking: str(o.tracking).trim(),
    shipPayer: o.shipPayer === 'shop' ? 'shop' : 'customer',
    discount: num(o.discount),
    platformFee: num(o.platformFee),
    paid: o.paid === undefined || o.paid === null || o.paid === '' ? null : num(o.paid), // blank = not tracked
    items: (o.items || []).map(({ preset, cat, ...l }) => ({
      ...l,
      productId: str(l.productId),
      variantId: str(l.variantId),
      qty: num(l.qty),
      price: num(l.price),
      pack1: str(l.pack1),
      pack2: str(l.pack2),
      pack3: str(l.pack3),
      packEach: Boolean(l.packEach),
    })),
  };
}

/** Has the form been changed from where it started? */
export const isDirty = (base, current) => stable(normalizeOrder(base)) !== stable(normalizeOrder(current));

const getStorage = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};

export function readDrafts(storage = getStorage()) {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

const writeDrafts = (map, storage) => {
  try { storage?.setItem(KEY, JSON.stringify(map)); return Boolean(storage); } catch { return false; }
};

/** Drop drafts that are malformed or older than a week. */
export const pruneDrafts = (map, now = Date.now()) =>
  Object.fromEntries(Object.entries(map).filter(([, d]) => d && d.order && now - num(d.savedAt) < MAX_AGE));

export const getDraft = (key, storage = getStorage(), now = Date.now()) => pruneDrafts(readDrafts(storage), now)[key] || null;

/** Save the draft for `key` ('new' or an order id). `open` marks a form that is still on screen. */
export function putDraft(key, { order, baseUpdatedAt = 0, open = true }, storage = getStorage(), now = Date.now()) {
  const map = pruneDrafts(readDrafts(storage), now);
  map[key] = { savedAt: now, baseUpdatedAt, open, order };
  return writeDrafts(map, storage);
}

export function deleteDraft(key, storage = getStorage()) {
  const map = readDrafts(storage);
  if (!(key in map)) return;
  delete map[key];
  writeDrafts(map, storage);
}

/** The form was closed on purpose: keep the draft but it is no longer "on screen". */
export function markDraftClosed(key, storage = getStorage()) {
  const map = readDrafts(storage);
  if (!map[key]) return;
  map[key].open = false;
  writeDrafts(map, storage);
}

/** Keys of drafts whose form was still open when the page went away (reload, new version). */
export const openDraftKeys = (storage = getStorage(), now = Date.now()) =>
  Object.entries(pruneDrafts(readDrafts(storage), now)).filter(([, d]) => d.open).map(([k]) => k);
