// The public catalog of the web shop: what customers may see and order.
// Pure functions (no DOM), so Node tests and the admin page share them. The catalog is a snapshot:
// the admin page exports it as a file the shop page loads. It never contains costs, imports or customers.
import { stockLevels, variantKey, isCombo, comboParts } from './calc.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();

export const CATALOG_VERSION = 1;
export const COMBO_LABEL = 'Combo';
export const OTHER_LABEL = 'Khác';

/** Is this category one the shop no longer sells? (a category named "Hết bán" counts until the shop picks its own) */
export const isEndedGroup = (settings, name) => (settings?.endedCategories ? settings.endedCategories.includes(name) : norm(name) === 'het ban');

/** Is the product offered on the web shop? Combos and products in a "hết bán" category follow the shop's choices. */
export function onShop(p, settings) {
  if (!p?.name) return false;
  if ((settings?.shopHidden || []).includes(p.id)) return false;
  if (!isCombo(p) && (p.group || '').trim() && isEndedGroup(settings, p.group.trim())) return false;
  return true;
}

/** Plain-words contents of a combo, so a customer knows what is inside. */
export function comboText(p, products) {
  const byId = Object.fromEntries(products.map((x) => [x.id, x]));
  return comboParts(p).map((part) => {
    const q = num(part.qty) || 1;
    if (part.pool?.length) return `${q} × một mẫu ngẫu nhiên: ${part.pool.map((id) => byId[id]?.name).filter(Boolean).join(' / ')}`;
    const pr = byId[part.productId];
    const v = pr?.variants?.find((x) => x.id === part.variantId);
    return `${q} × ${pr?.name || 'sản phẩm'}${v ? ` (${v.name})` : ''}`;
  });
}

/**
 * Build the catalog from the shop's data. `images` maps an image reference of a product or variant to the
 * picture to publish (a data URL); a reference with no entry is left without picture.
 * Stock counts what is on the shelf minus what open orders already need.
 */
export function buildCatalog(state, settings = {}, images = {}, now = new Date()) {
  const stock = stockLevels(state);
  const picked = state.products.filter((p) => onShop(p, settings));
  const label = (p) => (isCombo(p) ? COMBO_LABEL : (p.group || '').trim() || OTHER_LABEL);
  const order = [...(settings.categories || [])];
  for (const p of picked) {
    const l = label(p);
    if (l !== COMBO_LABEL && l !== OTHER_LABEL && !order.includes(l)) order.push(l);
  }
  const categories = [...order.filter((c) => picked.some((p) => label(p) === c)), ...[COMBO_LABEL, OTHER_LABEL].filter((c) => picked.some((p) => label(p) === c))];
  const img = (ref) => (ref && images[ref]) || '';
  const products = picked.map((p) => {
    const variants = (p.variants || []).map((v) => ({
      id: v.id, name: v.name, image: img(v.image), price: num(v.price) > 0 ? num(v.price) : 0,
      stock: Math.max(0, num(stock.variants[variantKey(p.id, v.id)])),
    }));
    const total = variants.length ? variants.reduce((n, v) => n + v.stock, 0) : Math.max(0, num(stock.products[p.id]));
    return {
      id: p.id, name: p.name, category: label(p), price: num(p.salePrice),
      tiers: (p.tiers || []).filter((t) => num(t.minQty) > 0 && Number.isFinite(+t.price) && t.price !== '').map((t) => ({ minQty: num(t.minQty), price: num(t.price) })),
      desc: String(settings.shopDesc?.[p.id] || '').trim(), // never the private product note
      image: img(p.image), stock: total, variants,
      ...(isCombo(p) ? { combo: comboText(p, state.products) } : {}),
    };
  });
  return {
    version: CATALOG_VERSION,
    updatedAt: now.toISOString(),
    shop: {
      name: String(settings.shopName || 'Hani').trim() || 'Hani',
      welcome: String(settings.shopWelcome || '').trim(),
      instagram: String(settings.shopInstagram || '').replace(/^@/, '').trim(),
      threads: String(settings.shopThreads || '').replace(/^@/, '').trim(),
      shipFlat: Number.isFinite(settings.shipFlat) && settings.shipFlat >= 0 ? settings.shipFlat : 15000,
    },
    categories,
    products,
  };
}

/* ---------------- sync to the shared database (Firebase) ----------------
 * The web shop reads these documents live: one `shopInfo/main` and one `shopProducts/<id>` per product.
 * Only what changed is written, so a stock change costs one small write. */

/** A short fingerprint of a JSON value, to tell whether a document changed since it was last written. */
export function fingerprint(value) {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}-${s.length}`;
}

const DOC_LIMIT = 900_000; // Firestore documents stop at 1 MiB

/** A product document that fits in the database: too many / too big pictures are dropped before the product is. */
export function fitDoc(p) {
  if (JSON.stringify(p).length <= DOC_LIMIT) return p;
  const noVariantPics = { ...p, variants: p.variants.map((v) => ({ ...v, image: '' })) };
  if (JSON.stringify(noVariantPics).length <= DOC_LIMIT) return noVariantPics;
  return { ...noVariantPics, image: '' };
}

/**
 * What to write so the shop's documents match `catalog`. `known` = { products: { id: fingerprint }, info: fingerprint }
 * of what is already stored. Returns { info (doc or null), products: [doc], remove: [id], next } where `next` is the
 * `known` to keep after the writes succeed. Each product document carries its own fingerprint in `_h`.
 */
export function diffCatalog(known, catalog) {
  const base = { ...catalog.shop, categories: catalog.categories };
  const infoH = fingerprint(base);
  const info = { ...base, updatedAt: catalog.updatedAt, _h: infoH };
  const next = { products: {}, info: infoH };
  const products = [];
  for (const p of catalog.products) {
    const doc = fitDoc(p);
    const h = fingerprint(doc);
    next.products[p.id] = h;
    if (known?.products?.[p.id] !== h) products.push({ ...doc, _h: h });
  }
  const remove = Object.keys(known?.products || {}).filter((id) => !(id in next.products));
  return { info: known?.info === infoH ? null : info, products, remove, next };
}
