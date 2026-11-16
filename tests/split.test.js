import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('cửa hàng web (docs/) chạy độc lập: bản sao dùng chung luôn giống bản trong js/', () => {
  for (const f of ['tier.js', 'shoporder.js']) {
    assert.equal(read(`docs/lib/${f}`), read(`js/${f}`), `docs/lib/${f} đã lệch js/${f}: chạy "node tools/sync-shop.mjs"`);
  }
});

test('cửa hàng web không nạp file nào từ app quản lý, app quản lý không nạp file của cửa hàng', () => {
  const imports = (src) => [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const shopFiles = ['docs/shop.js', 'docs/lib/shoporder.js', 'docs/lib/tier.js'];
  for (const f of shopFiles) {
    for (const spec of imports(read(f))) assert.ok(!/(^|\/)\.\.\//.test(spec), `${f} nạp ra ngoài docs/: ${spec}`);
  }
  const html = read('docs/index.html');
  assert.ok(!/\.\.\//.test(html) && !/css\/style\.css|js\/app\.js/.test(html), 'docs/index.html không dùng css/js của app quản lý');
  assert.ok(!/\.\.\//.test(read('docs/shop.css')));
  for (const f of readdirSync(new URL('../js', import.meta.url))) {
    for (const spec of imports(read(`js/${f}`))) assert.ok(!/docs\//.test(spec), `js/${f} nạp file của cửa hàng: ${spec}`);
  }
  assert.ok(existsSync(new URL('../docs/.nojekyll', import.meta.url)));
});

test('cửa hàng web không có đường dẫn nào dẫn tới trang quản lý', () => {
  for (const f of ['docs/index.html', 'docs/shop.js']) {
    assert.ok(!/hani\.html|\.\.\/index\.html|#settings|#orders/.test(read(f)), f);
  }
});
