// entry-ids.js — an entry's UUID in the browser, said once (user decisions
// 2026-10-25: a UUID for every plan entry, SSOT, enforced). The Python half,
// and the why, is 引擎 Engines/entry_ids: the same key (`uuid`), the same
// short form (the first 8 hex digits).
//
// A plain script, so the classic plan pages (plan-chrome.js) and the
// Death Plan's module scripts can both use it: it sets
// `window.EntryIds`. It also fits the row grid's NUMBER COLUMN, the label
// the uuid lines up beside (`fitNumbers`, at the end).
//
// Minted from crypto.getRandomValues, not crypto.randomUUID: the plan pages
// are served over plain http on the LAN, where randomUUID does not exist.

(function () {
  const KEY = 'uuid';
  const SHORT = 8;

  /** A fresh RFC 4122 version-4 UUID. */
  function newId() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16)
      + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /** The short form of `id` — its first 8 hex digits. */
  const short = (id) => String(id || '').slice(0, SHORT);

  /** The id label: the short form, the whole uuid on hover. */
  function idLabel(id, cls = 'uid') {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = short(id);
    s.title = id;
    s.setAttribute('contenteditable', 'false');
    return s;
  }

  // ONE NUMBER COLUMN PER PAGE (user decision 2026-10-25): an entry row's
  // first line is number · grip · uuid · chips (docs.css, the row grid).
  // A uuid is always one width, so once the number column is too, every
  // uuid, chip and text starts on one vertical line down the page. The
  // column is the page's WIDEST number: `--entry-num-col` on each
  // `.container` (the page; a page without one uses the root). Kept here,
  // with the label it lines up, because every page drawing those rows
  // already loads this file — and it fits itself: any change to a number,
  // anywhere, refits its page, so no page has to remember to call it.
  //
  // Measured off-layout, with each number's own computed font (0.85em of
  // its row, tabular figures) plus its margin and a pixel of slack, so a
  // number inside a closed fold — which has no layout box — still counts.
  const NUMS = 'li[data-entry] > .num, li.entry-grid > .entry-num';
  let gauge = null;

  function widthOf(n) {
    if (!gauge) {
      gauge = document.createElement('span');
      gauge.setAttribute('aria-hidden', 'true');
      gauge.style.cssText = 'position:absolute;left:-9999px;top:0;'
        + 'visibility:hidden;white-space:nowrap;';
      document.body.appendChild(gauge);
    }
    const c = getComputedStyle(n);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
                     'fontVariantNumeric', 'letterSpacing']) {
      gauge.style[p] = c[p];
    }
    gauge.textContent = n.textContent;
    return gauge.getBoundingClientRect().width
      + (parseFloat(c.marginRight) || 0) + 1;
  }

  /** Set every page container's number column to its widest number. */
  function fitNumbers() {
    const widest = new Map();
    for (const n of document.querySelectorAll(NUMS)) {
      const box = n.closest('.container') || document.documentElement;
      widest.set(box, Math.max(widest.get(box) || 0, widthOf(n)));
    }
    for (const [box, w] of widest) {
      box.style.setProperty('--entry-num-col', Math.ceil(w) + 'px');
    }
  }

  // Refit once per burst of changes, ignoring the gauge's own.
  let queued = false;
  function refit(records) {
    if (records && records.every((r) => gauge
        && (r.target === gauge || gauge.contains(r.target)))) return;
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; fitNumbers(); }, 0);
  }
  function start() {
    new MutationObserver(refit).observe(document.body,
      { childList: true, subtree: true, characterData: true });
    refit();
    if (document.fonts) document.fonts.ready.then(() => refit());
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  window.EntryIds = { KEY, SHORT, newId, short, idLabel, fitNumbers };
})();
