// settings-panel.js — the ⚙️ SETTINGS panel every interface app shares
// (user decision 2026-11-08: "make sure SSOT with other interface apps").
// The button is index_page's SETTINGS_GEAR, at the trail line's right
// end, the icon alone with its name the tooltip; a click opens the panel
// over the page through edit-mode.js's popover, a second click shuts it.
// What is IN the panel is the app's own — 临终规划 Death Plan's sample
// switch and export, 生活自理 Life Skills' export — handed in as `panel`.
// Lifted out of the Death Plan's settings.js, which now mounts this.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Wire `btn` to open `panel()` (a fresh Node each time) in the shared
 *  popover. `openPopover` / `closePopover` are edit-mode.js's. */
export function mountSettings({ btn, panel, openPopover, closePopover }) {
  if (!btn) return;
  let shown = false;
  btn.addEventListener('click', () => {
    if (shown) {
      closePopover();
      return;
    }
    shown = true;
    const box = el('div', 'pop-fields');
    box.append(...[].concat(panel()));
    openPopover(btn, box, { onClose: () => { shown = false; } });
  });
}

/** An EXPORT row, ruled off from what is above it (index_page's
 *  SETTINGS_STYLE `.pop-export`): a link-like button and the note under
 *  it. Greyed out, never hidden, while `disabled`. */
export function exportRow({ label, note, disabled = false, onClick }) {
  const wrap = el('div', 'pop-field pop-export');
  const b = el('button', 'linkish', label);
  b.type = 'button';
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  wrap.append(b, el('p', 'pop-note', note));
  return wrap;
}

/** A note line in the panel, in the panel's own small grey type. */
export function panelNote(text) {
  return el('p', 'pop-note', text);
}
