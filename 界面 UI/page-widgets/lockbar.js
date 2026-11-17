// lockbar.js — the lock line of every page that opens sealed values:
// "🔒 Unlock" or "🔓 Open until 09:41 · Lock", and the passphrase form
// between them. Born 临终规划 Death Plan's (its home page, where the line
// sits under the title so everything can be unlocked from there — user
// decision 2026-10-19 — and each list); ON THE SHELF since 2026-11-15
// (user decision: "make the design SSOT"), when the Master Plan's
// Projects page dropped its own copy of the same line for this one.
//
// The unlock itself is field-cipher.js's and SHARED by every page that
// opens tokens (`keepUnlock` / `restoreUnlock` / `forgetUnlock`, user
// decision 2026-10-19: "unlock once to unlock all"): unlocking here opens
// the lists and the Projects page in this tab, and Lock here locks
// them all. A reload keeps it for 16 hours at most; a new tab is locked.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const hhmm = (ms) => {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':'
    + String(d.getMinutes()).padStart(2, '0');
};

/** Draw the lock line into `bar` and keep it current. `cipherUrl` is
 *  field-cipher.js, `paramsUrl` the cipher's parameter file (no secret),
 *  `say(text, bad)` the page's status line, `onChange(key)` called with the
 *  key on every unlock and with null on every lock. Resolves once any kept
 *  unlock has been restored, to an object whose `key` is the current key,
 *  `until` when it lapses, and `lock()` locks now (a page back in view
 *  whose timer was held back in the background). */
//
// `changeable` adds "Change passphrase" to the line (the home page's,
// user decision 2026-10-19): the form sends the current and the new
// passphrase to the local helper's /passphrase (sealed_lists.server →
// field_cipher.change_passphrase), the one place they leave this tab.
//
// `formHost`: where the passphrase forms open, when not in `bar` itself.
//
// `statusEl` — THE CONTROLS LINE (user decision 2026-10-24: "the status
// line is purely the status line"): the lock's STATE ("🔓 Open until
// 09:41", "🔒 Locked") is written there, in the status line, and `bar`
// holds only buttons — 🔒 Unlock or Lock, Change passphrase — in the row
// of controls under it, where the passphrase form opens in their place.
// Without it, the 2026-10-19 lock line: state and links together.
export async function mountLockbar({ cipherUrl, paramsUrl, bar, say,
                                     onChange = () => {},
                                     beforeLock = null,
                                     changeable = false,
                                     formHost = null,
                                     statusEl = null,
                                     controlsUrl = null }) {
  const host = formHost || bar;
  const linkCls = statusEl ? 'button' : 'linkish';
  const openHost = () => {
    host.replaceChildren();
    host.classList.add('form');
    if (statusEl && formHost) bar.hidden = true;
  };
  const closeHost = () => {
    host.classList.remove('form');
    if (formHost) formHost.replaceChildren();
    bar.hidden = false;
  };
  const showState = (text) => { if (statusEl) statusEl.textContent = text; };
  const C = await import(new URL(cipherUrl, document.baseURI).href);
  // The buttons' emoji and words: controls.js's (界面 UI/page-widgets), the
  // one list every page's controls line reads; bare words without it.
  const words = { lock: 'Lock', unlock: 'Unlock',
                  passphrase: 'Change passphrase' };
  let L = (k) => words[k];
  if (controlsUrl) {
    try {
      const m = await import(new URL(controlsUrl, document.baseURI).href);
      L = m.label;
    } catch (e) { /* the bare words stand */ }
  }
  const state = { key: null, until: 0, lock: () => lock() };
  let timer = 0;

  async function params() {
    const res = await fetch(paramsUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error('The cipher parameter file could not be read.');
    }
    return res.json();
  }

  function set(key, until) {
    state.key = key;
    state.until = until;
    clearTimeout(timer);
    if (key) timer = setTimeout(lock, Math.max(0, until - Date.now()));
    draw();
    onChange(key);
  }

  // `beforeLock` (the planner's lists: save an open draft) runs while
  // the key is still held.
  async function lock() {
    if (beforeLock) {
      try { await beforeLock(); } catch (e) { /* lock all the same */ }
    }
    C.forgetUnlock();
    say('');
    set(null, 0);
  }

  function draw() {
    if (!formHost && bar.classList.contains('form')) return;
    bar.replaceChildren();
    if (state.key) {
      const open = '🔓 Open until ' + hhmm(state.until);
      if (statusEl) showState(open);
      else bar.appendChild(el('span', null, open + ' · '));
      const b = el('button', linkCls, L('lock'));
      b.type = 'button';
      b.addEventListener('click', lock);
      bar.appendChild(b);
      addChange();
      return;
    }
    if (!C.available()) {
      // No Web Crypto at this address: the same page on https has it
      // (field-cipher.js `secureHref`, the one offer every page makes).
      if (C.onSecureAddress()) {
        const none = '🔒 This browser offers no Web Crypto here, so '
          + 'everything stays locked.';
        if (statusEl) showState(none);
        else bar.appendChild(el('span', null, none));
        return;
      }
      showState('🔒 Locked');
      const go = el('button', linkCls, L('unlock'));
      go.type = 'button';
      go.title = 'No Web Crypto at this address — continues on https';
      go.addEventListener('click', () => {
        location.href = C.secureHref();
      });
      bar.appendChild(go);
      return;
    }
    showState('🔒 Locked');
    const b = el('button', linkCls, L('unlock'));
    b.type = 'button';
    b.addEventListener('click', showForm);
    bar.appendChild(b);
    addChange();
  }

  function addChange() {
    if (!changeable) return;
    const c = el('button', linkCls, L('passphrase'));
    c.type = 'button';
    c.addEventListener('click', showChange);
    if (statusEl) bar.append(c);
    else bar.append(' · ', c);
  }

  // Current, new, new again. A new passphrase of at least 12 characters;
  // the helper refuses a shorter one too.
  function showChange() {
    openHost();
    const form = el('form', 'unlock change');
    const field = (placeholder, auto) => {
      const i = el('input');
      i.type = 'password';
      i.placeholder = placeholder;
      i.autocomplete = auto;
      return i;
    };
    const cur = field('Current passphrase', 'current-password');
    const nw = field('New passphrase (12+ characters)', 'new-password');
    const again = field('New passphrase again', 'new-password');
    const go = el('button', null, 'Change');
    go.type = 'submit';
    const cancel = el('button', 'linkish', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      closeHost();
      say('');
      draw();
    });
    form.append(cur, nw, again, go, cancel);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (nw.value.length < 12) {
        say('The new passphrase must be at least 12 characters.', true);
        return;
      }
      if (nw.value !== again.value) {
        say('The two new passphrases do not match.', true);
        return;
      }
      go.disabled = true;
      say('Changing the passphrase… (a first change re-encrypts every '
        + 'value, which can take a few seconds)');
      let res;
      let data = {};
      try {
        res = await fetch('/sealed-data/passphrase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current: cur.value, new: nw.value }),
        });
        data = await res.json().catch(() => ({}));
      } catch (e) {
        res = null;
      }
      if (!res || !res.ok) {
        say('Not changed — ' + (data.error || (res ? res.status
          : 'the local server did not answer') ), true);
        go.disabled = false;
        return;
      }
      cur.value = nw.value = again.value = '';
      closeHost();
      // The old key no longer opens anything: lock every page.
      C.forgetUnlock();
      set(null, 0);
      const n = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
      say('Passphrase changed' + (data.files
        ? ' — ' + n(data.tokens, 'value') + ' in ' + n(data.files, 'file')
          + ' re-encrypted under a new random key'
        : '') + '. Unlock with the new passphrase.');
    });
    host.appendChild(form);
    cur.focus();
  }

  function showForm() {
    openHost();
    const form = el('form', 'unlock');
    const input = el('input');
    input.type = 'password';
    input.placeholder = 'Passphrase';
    input.autocomplete = 'current-password';
    const go = el('button', null, 'Unlock');
    go.type = 'submit';
    const cancel = el('button', 'linkish', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      closeHost();
      say('');
      draw();
    });
    form.append(input, go, cancel);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      go.disabled = true;
      say('Unlocking…');
      try {
        const k = await C.unlock(input.value, await params());
        input.value = '';
        if (!k) {
          say('That passphrase does not open this key.', true);
          go.disabled = false;
          return;
        }
        const until = await C.keepUnlock(k);
        say('');
        closeHost();
        set(k, until);
      } catch (e) {
        say(e.message, true);
        go.disabled = false;
      }
    });
    host.appendChild(form);
    input.focus();
  }

  const kept = await C.restoreUnlock(params);
  if (kept) {
    try {
      // A key kept before pages could seal (2026-10-19) can only open;
      // these pages seal, so such a key counts as locked.
      await C.seal(kept.key, '');
      set(kept.key, kept.until);
    } catch (e) {
      C.forgetUnlock();
    }
  }
  if (!state.key) draw();
  // Arrived from the `.local` address to unlock: open the form at once.
  if (C.arrivedToUnlock() && !state.key && C.available()) showForm();
  return state;
}
