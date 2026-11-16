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
