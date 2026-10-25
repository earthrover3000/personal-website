// edit-mode.js — THE shelf's edit mode: how a page turns from reading into
// editing, and how its text is edited where it is read (user decision
// 2026-10-24: share the editing layer, keep each app's data its own).
// First caller: 临终规划器 Termination Planner's lists.
//
// WHAT THE USER SEES. A page reads clean. "✏ Edit" (docs.css `#edit-btn`,
// in the fixed `#toolbar` at the bottom right, as on the plan pages) turns
// it to "✏ Editing…": the page's text becomes editable IN PLACE — same
// font, same size, same spot, a faint dashed outline marking each field —
// and the editing controls (delete, add) appear. Enter commits a one-line
// field, Esc puts it back, and leaving a field commits it. Nothing pops
// up: a delete asks in its own line ("Delete this? Delete · Keep").
//
// WHERE THE LINE FALLS (plan-chrome.js's test, kept): this module knows how
// editing LOOKS and BEHAVES, never what is being edited or how it is saved.
// A field tells its page "this changed to X" (`onCommit`) and the page
// saves however it saves — the planner seals and stores it at once.
//
// HOW TO USE IT:
//
//     <link rel="stylesheet" href="…/界面 UI/styles/docs.css">
//     <div class="container"> … </div>
//     <div id="toolbar"><button id="edit-btn" hidden>✏ Edit</button></div>
//
//     import { editToggle, isEditing, editable, editableRegion,
//              stopEditing, confirmInline, keepEditFocus, openPopover,
//              closePopover }
//       from '…/界面 UI/page-widgets/edit-mode.js';
//
//     editToggle($('edit-btn'), { onChange: (on) => redraw() });
//     // while drawing a row, in edit mode:
//     const t = document.createElement('span');
//     t.dataset.field = 'title';            // keepEditFocus finds it by this
//     editable(t, { value: entry.title, placeholder: 'Title',
//                   onCommit: (v) => save(id, { title: v }) });
//     // around every redraw:
//     keepEditFocus(listRoot, () => redraw());
//
// - The mode is the `.editing` class on `.container`, the plan pages' own,
//   so docs.css's `.editing …` rules (grips, controls) mean the same thing
//   on every page.
// - `keepEditFocus` lets a page redraw while a field is being typed in — a
//   tick saved elsewhere, a field committed — without losing the caret or
//   the unsaved text: the field is found again by its row's `data-id` and
//   its own `data-field`.
// - `editable` edits ONE value as text (the planner's fields); a block that
//   holds more — the plan pages' bilingual rows, links in them — uses
//   `editableRegion`, which keeps the block's children and only reports
//   that it changed. One behaviour either way: Enter, Esc, leave to commit.
// - The look (the outline, the placeholder, the button) is docs.css's.
//
// SAVE, OR DISCARD (user decision 2026-10-24: "offer to save or click edit
// again to discard changes … and SSOT this logic"). A page that passes
// `draft` to `editToggle` edits a DRAFT: nothing is written while editing.
// The controls row shows "💾 Save (3 changes)"; Save writes the lot and
// leaves edit mode; ✏ again with changes made asks in the row — "Discard
// 3 changes? Discard · Keep editing" — and with none simply leaves. Leaving
// the page with changes gets the browser's own "leave site?". The page
// says what changed (`noteChange`, once per edit), how to write it
// (`draft.save`, which returns false on failure: edit mode stays, the
// draft kept) and how to put itself back (`draft.discard`). This module
// counts, words the buttons and asks; the page owns the data, as above.
//
//     const set = editToggle($('edit-btn'), { onChange, draft: {
//       save: async () => writeAll(),   // false: not saved
//       discard: () => redrawFromSaved(),
//     } });
//     // after each edit:  noteChange();
//
// The Save button is the page's `#save-btn` if it has one (the plan
// pages'), else made beside ✏. `saveKey` names its words in controls.js:
// `commit` ("Save") by default, `save` ("Save to file") for a download.
//
// Callers: 临终规划器 Termination Planner's lists (lists.js), and since the
// same day every plan page and the site map (plan-chrome.js) — all three
// on the draft too (lists.js, plan-renderer.js, the site map's page).

import { label } from './controls.js';

/** The page's `.container`, which carries the mode. */
const box = () => document.querySelector('.container');

/** Whether the page is in edit mode. */
export const isEditing = () => !!(box()
  && box().classList.contains('editing'));

/** Wire `button` as the page's edit switch. `onChange(on)` after each
 *  switch. Returns `set(on)`, to switch from code, with `set.toggle()` —
 *  what a click does (with a draft, ask before discarding). `listen:
 *  false` when the page's markup already calls something on click (the
 *  plan pages' `onclick="toggleEdit()"`), which then calls `set.toggle`.
 *  `draft`: {save, discard, saveButton?, saveKey?} — see SAVE, OR
 *  DISCARD in the header. */
export function editToggle(button, { onChange = () => {}, listen = true,
                                     draft = null } = {}) {
  const set = (on) => {
    box().classList.toggle('editing', on);
    button.textContent = label(on ? 'editing' : 'edit');
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (D) {
      D.count = 0;
      D.ask.replaceChildren();
      paintSave();
    }
    onChange(on);
  };
  const toggle = () => {
    if (!isEditing()) set(true);
    else if (!D || !D.count) set(false);
    else askDiscard();
  };
  set.toggle = toggle;
  if (button.tagName === 'BUTTON') button.type = 'button';
  button.textContent = label('edit');
  button.title = 'Edit the text where it is (Esc puts a field back)';
  if (listen) button.addEventListener('click', toggle);
  if (draft) wireDraft(button, set, draft);
  return set;
}

// ---- the draft (SAVE, OR DISCARD) ----
let D = null;       // {count, set, save, discard, saveButton, saveKey, ask}

function wireDraft(button, set, draft) {
  let b = draft.saveButton || document.getElementById('save-btn');
  if (!b) {
    b = document.createElement('button');
    b.id = 'save-btn';
    button.after(b);
  }
  b.type = 'button';
  b.onclick = null;                  // the markup's onclick="saveFile()"
  b.removeAttribute('onclick');
  b.removeAttribute('data-control');  // its words are this module's now
  const ask = document.createElement('span');
  ask.className = 'edit-ask';
  ask.setAttribute('role', 'status');
  b.after(ask);
  D = { count: 0, set, save: draft.save, discard: draft.discard,
        saveButton: b, saveKey: draft.saveKey || 'commit', ask };
  b.addEventListener('click', () => { saveEdits(); });
  window.addEventListener('beforeunload', (ev) => {
    if (!pendingChanges()) return;
    ev.preventDefault();
    ev.returnValue = '';
  });
  paintSave();
}

function paintSave() {
  const b = D.saveButton;
  const on = isEditing();
  b.hidden = !on;
  // Set, not cleared: docs.css hides #save-btn until a page shows it.
  b.style.display = on ? 'inline-block' : 'none';
  b.disabled = !D.count;
  b.textContent = label(D.saveKey) + (D.count ? ' (' + D.count
    + (D.count === 1 ? ' change)' : ' changes)') : '');
}

function changesText() {
  return D.count + (D.count === 1 ? ' change' : ' changes');
}

function askDiscard() {
  confirmInline(D.ask, 'Discard ' + changesText() + '?', {
    yes: 'Discard', no: 'Keep editing',
    onYes: () => discardEdits(),
    onNo: () => D.ask.replaceChildren(),
  });
}

/** One edit made to the draft: a field left changed, a row dragged, added
 *  or deleted. Counted only in edit mode on a page with a draft. */
export function noteChange() {
  if (!D || !isEditing()) return;
  D.count += 1;
  D.ask.replaceChildren();
  paintSave();
}

/** How many edits the draft holds (0 outside edit mode). */
export const pendingChanges = () => (D && isEditing() ? D.count : 0);

/** Write the draft (`draft.save`); on success leave edit mode. Resolves
 *  to whether it was saved. The field being typed in is committed first. */
export async function saveEdits() {
  if (!D || !isEditing()) return true;
  const a = document.activeElement;
  if (a && a.isContentEditable) a.blur();
  if (!D.count) {
    D.set(false);
    return true;
  }
  D.saveButton.disabled = true;
  let ok = false;
  try {
    ok = (await D.save()) !== false;
  } catch (err) {
    console.error('edit-mode: the save failed', err);
  }
  if (ok) D.set(false);
  else paintSave();
  return ok;
}

/** Throw the draft away: leave edit mode, then `draft.discard` puts the
 *  page back as last saved. */
export function discardEdits() {
  if (!D) return;
  const was = isEditing();
  D.set(false);
  if (was) D.discard();
}

const lastCommitted = new WeakMap();   // element → its HTML when last left

/** Make `el` editable in place AS IT IS — its children kept, for text that
 *  is more than one value (a plan row's English, its Chinese twin, its
 *  links). `onCommit(el)` when it is left (or Enter, unless `multiline`)
 *  changed since it was last left; Esc puts back what it held then (or
 *  calls `restore`). Calling it again on the same element does nothing
 *  more; `stopEditing` ends it. */
export function editableRegion(el, { multiline = false, onCommit = () => {},
                                     restore = null } = {}) {
  el.classList.add('inline-edit');
  if (multiline) el.classList.add('inline-edit-multi');
  try {
    el.contentEditable = 'plaintext-only';
  } catch (err) {
    el.contentEditable = 'true';          // and paste is made plain below
  }
  el.spellcheck = true;
  el.setAttribute('role', 'textbox');
  if (multiline) el.setAttribute('aria-multiline', 'true');
  lastCommitted.set(el, el.innerHTML);
  if (el.__editRegion) {
    el.__editRegion = { multiline, onCommit, restore };
    return el;
  }
  el.__editRegion = { multiline, onCommit, restore };
  el.addEventListener('keydown', (ev) => {
    if (!el.isContentEditable) return;
    const o = el.__editRegion;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (o.restore) o.restore();
      else el.innerHTML = lastCommitted.get(el);
      el.blur();
    } else if (ev.key === 'Enter' && !o.multiline) {
      ev.preventDefault();
      el.blur();
    }
  });
  // Text edited where it is read may sit inside something a click would
  // set off — a link, a checkbox's label, a fold's summary. While it is
  // editable a click only places the caret (it lands on mousedown).
  el.addEventListener('click', (ev) => {
    if (el.isContentEditable) ev.preventDefault();
  });
  el.addEventListener('keyup', (ev) => {
    if (el.isContentEditable && ev.key === ' ') ev.preventDefault();
  });
  el.addEventListener('paste', (ev) => {
    if (!el.isContentEditable) return;
    ev.preventDefault();
    const text = (ev.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, el.__editRegion.multiline
      ? text : text.replace(/\s*\n\s*/g, ' '));
  });
  el.addEventListener('blur', () => {
    // Redrawn away mid-edit: keepEditFocus carries the text over.
    if (!el.isConnected || !el.isContentEditable) return;
    if (el.innerHTML === lastCommitted.get(el)) return;
    lastCommitted.set(el, el.innerHTML);
    el.__editRegion.onCommit(el);
  });
  return el;
}

/** End `el`'s in-place editing (edit mode left). */
export function stopEditing(el) {
  el.removeAttribute('contenteditable');
  el.classList.remove('inline-edit', 'inline-edit-multi');
  el.removeAttribute('role');
  el.removeAttribute('aria-multiline');
}

/** Make `el` editable in place, showing `value` — one value, as text.
 *  `onCommit(text)` when it is left (or Enter, on a one-line field) with
 *  text that differs from `value`; Esc restores `value`. `multiline` keeps
 *  Enter as a new line. Built on `editableRegion`. */
export function editable(el, { value = '', placeholder = '', multiline = false,
                               onCommit = () => {} } = {}) {
  el.textContent = value;
  el.dataset.placeholder = placeholder;
  if (placeholder) el.setAttribute('aria-label', placeholder);
  el.dataset.saved = value;
  return editableRegion(el, {
    multiline,
    restore: () => { el.textContent = el.dataset.saved; },
    onCommit: () => {
      const text = multiline ? el.innerText.replace(/\n$/, '')
        : el.textContent.replace(/\s+/g, ' ');
      const clean = text.trim();
      if (!clean) el.textContent = '';    // so the placeholder shows
      if (clean !== el.dataset.saved) {
        el.dataset.saved = clean;
        onCommit(clean);
      }
    },
  });
}

// THE FLOATING PANEL (user decision 2026-10-24: in edit mode nothing may
// move). What a row does not show — a field that is empty, or never shown
// — is edited in a panel floating under the button that opened it, over
// the page rather than in it, so opening it pushes nothing. One at a time;
// Esc or a click outside closes it. `place(anchor)` puts it under another
// button — the same one, redrawn.
let openPanel = null;

/** Float `content` under `anchor`; returns `{el, place, close}`. */
export function openPopover(anchor, content, { onClose = () => {} } = {}) {
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'edit-popover';
  pop.setAttribute('role', 'dialog');
  pop.append(content);
  document.body.appendChild(pop);
  let at = anchor;
  const place = (a = at) => {
    at = a;
    const r = a.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 4) + 'px';
    pop.style.left = Math.max(8, r.right + window.scrollX
                              - pop.offsetWidth) + 'px';
  };
  const outside = (ev) => {
    if (!pop.contains(ev.target) && !at.contains(ev.target)) closePopover();
  };
  const esc = (ev) => { if (ev.key === 'Escape') closePopover(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc);
  place();
  openPanel = {
    el: pop, place,
    close: () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
      pop.remove();
      onClose();
    },
  };
  return openPanel;
}

/** Close the floating panel, if one is open. */
export function closePopover() {
  if (!openPanel) return;
  const p = openPanel;
  openPanel = null;
  p.close();
}

/** Ask `question` in place of `host`'s contents: "question Delete · Keep".
 *  Restores nothing itself — `onNo` usually redraws. */
export function confirmInline(host, question, {
  yes = 'Delete', no = 'Keep', onYes = () => {}, onNo = () => {},
} = {}) {
  const button = (text, cls, act) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', act);
    return b;
  };
  host.replaceChildren(question + ' ',
    button(yes, 'linkish danger', onYes), ' · ',
    button(no, 'linkish', onNo));
  host.querySelector('button').focus();
}

/** Run `redraw()` without losing the field being typed in under `root`:
 *  it is found again by its row's `data-id` and its `data-field`, gets the
 *  unsaved text back, and keeps the caret at its end. */
export function keepEditFocus(root, redraw) {
  const a = document.activeElement;
  const row = a && a.dataset && a.dataset.field && root.contains(a)
    && a.closest('[data-id]');
  const was = row ? { id: row.dataset.id, field: a.dataset.field,
                      text: a.textContent, saved: a.dataset.saved } : null;
  redraw();
  if (!was) return;
  const item = [...root.querySelectorAll('[data-id]')]
    .find((n) => n.dataset.id === was.id);
  const f = item && [...item.querySelectorAll('[data-field]')]
    .find((n) => n.dataset.field === was.field);
  if (!f) return;
  if (f.isContentEditable && f.textContent !== was.text) {
    // Unsaved typing comes back; what counts as saved is the new draw's.
    if (f.dataset.saved === was.saved) f.textContent = was.text;
  }
  f.focus();
  if (f.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(f);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
