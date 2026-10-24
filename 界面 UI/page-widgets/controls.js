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
};

/** The label of control `key` — "✏️ Edit"; `more` follows its words
 *  ("➕ Add entry"). */
export function label(key, more = '') {
  const c = CONTROLS[key];
  if (!c) throw new Error(`controls.js: no control "${key}"`);
  return c.glyph + ' ' + c.text + (more ? ' ' + more : '');
}

/** Write the label into every `[data-control]` under `root`. */
export function paintControls(root = document) {
  root.querySelectorAll('[data-control]').forEach((b) => {
    b.textContent = label(b.dataset.control, b.dataset.controlMore || '');
  });
}
