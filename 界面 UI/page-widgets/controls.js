// controls.js — every button in a page's CONTROLS LINE, said once (user
// decisions 2026-10-24: "give every button in the controls line an emoji to
// the left of text … and of course make it SSOT").
//
// The line (index_page `controls_line` writes it, base.css `.controls-row`
// draws it) is every interface page's: the plan pages', the site map's,
// 临终规划 Death Plan's, the Master Plan's Projects page's and the
// rest — Edit, Save (a draft) or Save to file (a download), Add, the
// folds, the lock's Unlock / Lock / Change passphrase, and a page's own.
// Each one's emoji and words live HERE and nowhere else. Markup a Python builder writes names the control and
// leaves the words to this file —
//
//     <button id="edit-btn" data-control="edit">Edit</button>
//     <button id="add" data-control="add" data-control-more="entry">…</button>
//
// — and `paintControls` writes the label in (the plain word in the markup
// is only what shows before the script runs). Script that makes a button
// asks `label(key)` for its text.
//
// An interface's identity glyph is said once, in 引擎 Engines/identities/
// identities.env. Save to file's 💾 is also the Digital Estate's face;
// here it means "save", not that app, and says so on its line
// (`not-identity`, the identities check's mark for a coincidence — user
// decision 2026-10-24: "you can reuse 💾 if it's more suitable").

export const CONTROLS = {
  edit:       { glyph: '✏️', text: 'Edit' },
  editing:    { glyph: '✏️', text: 'Editing…' },
  save:       { glyph: '💾', text: 'Save to file' },  // not-identity
  commit:     { glyph: '💾', text: 'Save' },  // not-identity
  add:        { glyph: '➕', text: 'Add' },
  lock:       { glyph: '🔒', text: 'Lock' },
  unlock:     { glyph: '🔓', text: 'Unlock' },
  passphrase: { glyph: '🔑', text: 'Change passphrase' },
  // The browser key (临终规划 Death Plan's browser-key.js, 2026-11-15).
  browserKey: { glyph: '🗝️', text: 'Set up browser key' },
  browserKeyOn: { glyph: '🗝️', text: 'Browser key ✓' },
  // One button, two words (`wireFoldAll`; user decision 2026-10-25).
  expandAll:  { glyph: '🔽', text: 'Expand all' },
  collapseAll: { glyph: '🔼', text: 'Collapse all' },
  // The Master Plan's Projects page (user decision 2026-11-15): the
  // middle depth — every heading open, every project shut — and its
  // yellow top picks on a shut category's heading.
  expandProjects: { glyph: '📂', text: 'Expand projects' },
  showPicks:  { glyph: '🟡', text: 'Show picks' },
  hidePicks:  { glyph: '🟡', text: 'Hide picks' },
  // Sync with Todoist now, not at the next 5-minute tick (board_feed
  // `/todoist-reload`, user decision 2026-11-15).
  reloadTodoist: { glyph: '🔄', text: 'Reload Todoist' },
  reloadingTodoist: { glyph: '🔄', text: 'Reloading…' },
};

/** The label of control `key` — "✏️ Edit"; `more` follows its words
 *  ("➕ Add entry"). */
export function label(key, more = '') {
  const c = CONTROLS[key];
  if (!c) throw new Error(`controls.js: no control "${key}"`);
  return c.glyph + ' ' + c.text + (more ? ' ' + more : '');
}

/** A page's one EXPAND ALL / COLLAPSE ALL button (user decision
 *  2026-10-25), over `folds()` — the page's <details>, nested ones
 *  included: "Expand all" while any is closed, else "Collapse all", the
 *  rule the plan pages' TOC (plan-chrome.js `tocToggleAll`), page-nav.js
 *  and the stats tables each keep in a copy of their own. Hidden while the
 *  page has no folds. Each fold's own toggle event fires as it changes, so
 *  a page that remembers its folds remembers these too. Returns `sync`:
 *  call it after the page redraws its folds. */
//
// `apply(open)`, when given, does the opening and shutting instead — for
// a page that remembers its folds by click (the Master Plan's Projects
// page, whose Archive is drawn later and follows the last press).
export function wireFoldAll(button, folds, { apply = null } = {}) {
  const sync = () => {
    const all = folds();
    button.hidden = !all.length;
    button.textContent = label(all.some((d) => !d.open)
      ? 'expandAll' : 'collapseAll');
  };
  button.addEventListener('click', () => {
    const open = folds().some((d) => !d.open);
    if (apply) apply(open);
    else for (const d of folds()) d.open = open;
    sync();
  });
  // A fold opened or closed by hand changes which word is right.
  document.addEventListener('toggle', sync, true);
  return sync;
}

/** Write the label into every `[data-control]` under `root`. */
export function paintControls(root = document) {
  root.querySelectorAll('[data-control]').forEach((b) => {
    b.textContent = label(b.dataset.control, b.dataset.controlMore || '');
  });
}

/** THE HEADING FOLD — the plan pages' (docs.css "Collapsible sections"):
 *  a chevron hanging in the margin left of a heading opens and shuts the
 *  `details.section-collapse` right after it, whose <summary> stays,
 *  hidden, for find-in-page. The pages outside the plan pages fold this
 *  way too (user decision 2026-11-14: Intentions, Gatherings and the
 *  Death Plan each drew a fold of their own, until base.css's
 *  `details.fold` turned theirs into boxes). plan-chrome.js keeps its own
 *  wiring for the plan pages, whose page headings fold flat siblings.
 *
 *      <h2 class="section-title">${CHEVRON}Title</h2>
 *      <details class="section-collapse" open><summary></summary>…</details>
 *
 *  `wireChevrons()` once, and `syncChevrons()` after a page draws its
 *  folds (a fold opened before it was in the document told no listener). */
export const CHEVRON = '<button type="button" class="section-chevron" '
  + 'aria-expanded="true" aria-label="Hide" title="Hide"></button>';
const FOLD_BOX = 'details.section-collapse';

function paintChevron(btn, open) {
  btn.setAttribute('aria-expanded', String(open));
  btn.title = open ? 'Hide' : 'Show';
  btn.setAttribute('aria-label', btn.title);
}

/** The fold a chevron opens: the box right after its heading. */
export function chevronFold(btn) {
  const d = btn.parentElement && btn.parentElement.nextElementSibling;
  return d && d.matches(FOLD_BOX) ? d : null;
}

/** A heading's chevron, as an element. */
export function chevron() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'section-chevron';
  paintChevron(b, true);
  return b;
}

/** The box a heading folds, `open` or shut, holding `body`. */
export function foldBox(open, ...body) {
  const d = document.createElement('details');
  d.className = 'section-collapse';
  d.open = !!open;
  d.append(document.createElement('summary'), ...body);
  return d;
}

const chevronOf = (d) => {
  const head = d.previousElementSibling;
  return head && head.querySelector(':scope > .section-chevron');
};

/** Each chevron under `root` says whether its fold is open. */
export function syncChevrons(root = document) {
  root.querySelectorAll(FOLD_BOX).forEach((d) => {
    const btn = chevronOf(d);
    if (btn) paintChevron(btn, d.open);
  });
}

let chevronsWired = false;
/** One delegated listener for every chevron on the page, now and later
 *  (idempotent). */
export function wireChevrons() {
  if (chevronsWired) return;
  chevronsWired = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.section-chevron');
    const d = btn && chevronFold(btn);
    if (!d) return;
    e.preventDefault();
    d.open = !d.open;
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.matches || !d.matches(FOLD_BOX)) return;
    const btn = chevronOf(d);
    if (btn) paintChevron(btn, d.open);
  }, true);
}

/** Folds that REMEMBER whether they were open (a display preference, in
 *  this browser), under `key`: each `details[data-fold]` in `folds()` is
 *  set as it was left, and saved as it changes. Inner Healing's
 *  `rememberFolds`, lifted onto the shelf (2026-11-08) for every page
 *  that folds. Call it after the page draws its folds. */
export function rememberFolds(key, folds) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; }
  catch (e) { saved = {}; }
  for (const d of folds()) {
    const id = d.dataset.fold;
    if (!id) continue;
    if (Object.prototype.hasOwnProperty.call(saved, id)) d.open = !!saved[id];
    d.addEventListener('toggle', () => {
      saved[id] = d.open;
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) {}
    });
  }
}

/** A REFRESH COMES BACK TO THE SAME PLACE (user decision 2026-11-15:
 *  "refresh in the same page position"). The browser's own restore fails
 *  on a page drawn after a fetch — at load the page is still short — so
 *  the position is kept here: saved per `key` in sessionStorage as the
 *  page scrolls, and put back by the function this returns, which the
 *  page calls once its content is drawn. Call keepScroll once, early. */
export function keepScroll(key) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let t = null;
  const save = () => {
    try { sessionStorage.setItem(key, String(Math.round(window.scrollY))); }
    catch (e) { /* private window */ }
  };
  window.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(save, 150);
  }, { passive: true });
  window.addEventListener('pagehide', save);
  let done = false;
  return () => {
    if (done) return;              // only the first draw; later redraws stay put
    done = true;
    let y = 0;
    try { y = Number(sessionStorage.getItem(key)) || 0; } catch (e) { y = 0; }
    if (y) window.scrollTo(0, y);
  };
}
