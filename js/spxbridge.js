// A bookmark button that looks up SPX tracking codes for the shop.
//
// Why a bookmark: the shop's page cannot ask spx.vn itself (the page is not allowed to make network calls, and SPX only
// answers browsers on its own site). A bookmarklet runs ON spx.vn, where the same lookup is allowed. The app opens
// spx.vn with the codes in the address after "#hani=" (never sent to any server), the shop presses the bookmark, it
// looks every code up and copies the ones delivered; pasting them back into the app shows the orders to tick.
//
// What was seen on the real SPX answer (one parcel, delivered):
//   GET /shipment/order/open/order/get_order_info?spx_tn=<code>&language_code=vi
//   -> { retcode: 0, data: { order_info: { tracking_code_group_name: 'Delivered' },
//        sls_tracking_info: { records: [ { tracking_code: 'F980', tracking_name: 'Delivered', description: '…', actual_time: <unix s> }, … ] } } }
// An unknown code gives data: {}. Only "Delivered" (group name, or a record F980) is acted on; every other state is
// shown as its latest description and left alone.

export const isSpx = (code) => /^SPX/i.test(String(code || '').trim());

/** The SPX page the app opens: the first code in the address (SPX shows it), all of them after "#hani=". */
export function bridgeUrl(codes) {
  const list = codes.filter(Boolean);
  if (!list.length) return '';
  return `https://spx.vn/track?${encodeURIComponent(list[0])}#hani=${list.map(encodeURIComponent).join(',')}`;
}

/** Did SPX report the parcel delivered? (the same rule the bookmark applies) */
export function spxDelivered(json) {
  const d = json?.data;
  if (json?.retcode !== 0 || !d || !d.order_info) return false;
  if (d.order_info.tracking_code_group_name === 'Delivered') return true;
  return (d.sls_tracking_info?.records || []).some((r) => r.tracking_code === 'F980');
}

/**
 * The bookmark. It is turned into text and runs on spx.vn, so it must stand alone: no outer names, no imports,
 * plain old syntax.
 */
export function bookmarklet() {
  if (!/(^|\.)spx\.vn$/i.test(location.hostname)) {
    alert('Hãy bấm nút này khi đang ở trang spx.vn (mở từ nút "Mở SPX" trong app Hani).');
    return;
  }
  var m = location.hash.match(/[#&]hani=([^&]*)/);
  var raw = m ? decodeURIComponent(m[1]) : prompt('Dán mã vận đơn SPX cần tra (cách nhau bằng dấu phẩy, dấu cách hoặc xuống dòng):') || '';
  var seen = {};
  var codes = raw.split(/[\s,;]+/).filter(function (c) {
    var k = c.toUpperCase();
    if (!c || seen[k]) return false;
    seen[k] = 1;
    return true;
  });
  if (!codes.length) return;
  var old = document.getElementById('hani-spx');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'hani-spx';
  box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:#fff;color:#1d2433;border:2px solid #1479c4;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);font:14px/1.45 system-ui,Segoe UI,sans-serif;padding:14px';
  document.body.appendChild(box);
  function el(tag, text, css) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (css) e.style.cssText = css;
    return e;
  }
  var results = [];
  var next = 0;
  var finished = 0;
  function draw() {
    box.textContent = '';
    box.appendChild(el('div', 'Tra SPX cho Hani', 'font-weight:700;font-size:16px;color:#0b5d9c;margin-bottom:6px'));
    if (finished < codes.length) {
      box.appendChild(el('div', 'Đang tra ' + finished + ' / ' + codes.length + ' mã… đừng đóng trang này.'));
      return;
    }
    var delivered = results.filter(function (r) { return r.state === 'delivered'; });
    var others = results.filter(function (r) { return r.state !== 'delivered'; });
    box.appendChild(el('div', delivered.length + ' / ' + codes.length + ' mã đã giao thành công', 'font-weight:700;margin-bottom:8px;color:' + (delivered.length ? '#2f7a1f' : '#6b7486')));
    var list = delivered.map(function (r) { return r.code; }).join('\n');
    var copy = el('button', delivered.length ? 'Sao chép ' + delivered.length + ' mã đã giao' : 'Không có mã nào đã giao', 'display:block;width:100%;padding:10px;border:0;border-radius:999px;background:' + (delivered.length ? '#f07fb6' : '#c9d3e0') + ';color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:6px');
    copy.disabled = !delivered.length;
    copy.onclick = function () {
      function ok() { copy.textContent = '✓ Đã sao chép. Quay lại app Hani và dán vào ô "Mã đã giao".'; }
      function fallback() {
        var ta = el('textarea', list, 'width:100%;height:90px;margin-top:6px');
        box.insertBefore(ta, copy.nextSibling);
        ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) { copy.textContent = 'Hãy copy tay các mã trong khung bên dưới'; }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(list).then(ok, fallback);
      else fallback();
    };
    box.appendChild(copy);
    if (delivered.length) box.appendChild(el('div', list, 'font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:#f4f8ff;border-radius:8px;padding:6px 8px;margin:6px 0'));
    if (others.length) {
      box.appendChild(el('div', 'Chưa giao hoặc không tra được (' + others.length + ')', 'font-weight:700;margin:8px 0 2px'));
      others.forEach(function (r) {
        box.appendChild(el('div', r.code + ': ' + r.text, 'font-size:12px;color:#6b7486;word-break:break-word'));
      });
    }
    var close = el('button', 'Đóng', 'margin-top:10px;padding:6px 14px;border:1px solid #c9d3e0;border-radius:999px;background:#fff;cursor:pointer');
    close.onclick = function () { box.remove(); };
    box.appendChild(close);
  }
  function look(code) {
    return fetch('/shipment/order/open/order/get_order_info?spx_tn=' + encodeURIComponent(code) + '&language_code=vi', { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var d = j && j.data;
        if (!j || j.retcode !== 0 || !d || !d.order_info) return { code: code, state: 'unknown', text: 'SPX không có mã này' };
        var recs = (d.sls_tracking_info && d.sls_tracking_info.records) || [];
        var did = d.order_info.tracking_code_group_name === 'Delivered' || recs.some(function (r) { return r.tracking_code === 'F980'; });
        var last = recs[0];
        var when = last && last.actual_time ? ' (' + new Date(last.actual_time * 1000).toLocaleString('vi-VN') + ')' : '';
        return { code: code, state: did ? 'delivered' : 'transit', text: last ? (last.description || last.tracking_name || '') + when : 'chưa có mốc nào' };
      })
      .catch(function () { return { code: code, state: 'error', text: 'không tra được (lỗi mạng)' }; });
  }
  function worker() {
    if (next >= codes.length) return Promise.resolve();
    var i = next++;
    return look(codes[i]).then(function (r) {
      results[i] = r;
      finished++;
      draw();
      return worker();
    });
  }
  draw();
  Promise.all([worker(), worker(), worker()]);
}

/** The `javascript:` link the shop drags to the bookmarks bar. */
export const bookmarkletHref = () => `javascript:${encodeURIComponent(`(${bookmarklet.toString()})()`)}`;
