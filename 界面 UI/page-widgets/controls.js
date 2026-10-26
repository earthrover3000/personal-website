// controls.js — every button in a page's CONTROLS ROW, said once (user
// decisions 2026-10-24: "give every button in the controls line an emoji to
// the left of text … and of course make it SSOT").
//
// The row (base.css `.controls-row`) is the plan pages', the site map's and
// 临终规划器 Termination Planner's: Edit, Save (a draft) or Save to file
// (a download), Add, and the lock's
// Unlock / Lock / Change passphrase. Each one's emoji and words live HERE
// and nowhere else. Markup a Python builder writes names the control and
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
// identities.env. Save to file's 💾 is also the Digital Inventory's face;
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
  // One button, two words (`wireFoldAll`; user decision 2026-10-25).
  expandAll:  { glyph: '🔽', text: 'Expand all' },
  collapseAll: { glyph: '🔼', text: 'Collapse all' },
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
export function wireFoldAll(button, folds) {
  const sync = () => {
    const all = folds();
    button.hidden = !all.length;
    button.textContent = label(all.some((d) => !d.open)
      ? 'expandAll' : 'collapseAll');
  };
  button.addEventListener('click', () => {
    const open = folds().some((d) => !d.open);
    for (const d of folds()) d.open = open;
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
