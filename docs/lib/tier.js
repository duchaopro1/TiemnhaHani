// Price steps ("from N pieces the price drops"). Kept in its own small file because the web shop for customers
// carries a copy of it (docs/lib/tier.js); tests/split.test.js fails if the two copies differ.
const num = (v) => (Number.isFinite(+v) ? +v : 0);

/**
 * Price of one piece when a product has price steps: `tiers: [{ minQty, price }]`. From `minQty` pieces
 * of the product in one order (all its variants together) the price drops to `price`; below the first
 * step the normal price applies. The highest step reached wins.
 */
export function tierPrice(p, qty, basePrice) {
  const step = (p?.tiers || [])
    .filter((t) => num(t.minQty) > 0 && t.price !== '' && t.price !== null && t.price !== undefined && Number.isFinite(+t.price))
    .sort((a, b) => num(b.minQty) - num(a.minQty))
    .find((t) => num(qty) >= num(t.minQty));
  return step ? num(step.price) : num(basePrice);
}
