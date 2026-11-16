// The web shop (docs/) must run on its own, so it carries copies of the two small files it shares with the admin
// app. Run `node tools/sync-shop.mjs` after changing js/tier.js or js/shoporder.js; tests/split.test.js fails if
// the copies are out of date.
import { copyFileSync } from 'node:fs';

export const SHARED = ['tier.js', 'shoporder.js'];
for (const f of SHARED) copyFileSync(new URL(`../js/${f}`, import.meta.url), new URL(`../docs/lib/${f}`, import.meta.url));
console.log('docs/lib is in sync with js/:', SHARED.join(', '));
