// copy-text.js — copy text to the clipboard from a plain-JS page, said once
// (2026-11-15). The plain-script twin of app-shell-react's clipboard.ts:
// the same two steps, for pages that are not React builds.
//
// `navigator.clipboard` exists only in a SECURE CONTEXT (https, localhost).
// The workshop pages are served over plain http — serve.py's /workshop/
// mount, the LAN copy of the site — and there the API is absent, so a
// button that only tried it never copied anything: the Death Plan's "Copy
// restart link" left the clipboard as it was, and Origin's [e] read that
// instead. So the async API goes first and the selection-based
// `execCommand('copy')` is the fallback that works on http.
//
// A plain script, so classic pages and module scripts can both use it: it
// sets `window.copyText(text)`, a Promise of true when the text was copied
// and false when both ways failed — so the caller can say so (show the text
// whole, to copy by hand) instead of flashing a tick over an empty
// clipboard. It never rejects. `window.copyButton(btn, text)` is the one
// way a copy BUTTON says it worked: on the button, never in a message.
// A module page imports this file for its effect (email-box.js does).

(function () {
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // Permission denied or a focus quirk: the fallback may still work.
    }
    const area = document.createElement('textarea');
    area.value = text;
    // Off-screen but still selectable; readOnly keeps a phone keyboard down.
    area.readOnly = true;
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(area);
    try {
      area.select();
      area.setSelectionRange(0, text.length);   // iOS ignores select() alone
      return document.execCommand('copy');
    } catch (e) {
      return false;
    } finally {
      area.remove();
    }
  }

  // A COPY IS ANSWERED ON ITS BUTTON (user decision 2026-11-25: "copied
  // notification should SSOT be just a change of button rather than an
  // additional floating window"): `copyButton(btn, text)` copies, then the
  // button itself reads "Copied ✓", or "Copy failed", for 1.5 s and
  // returns to its label. Its width is held meanwhile, so nothing beside
  // it moves. `opts.done` / `opts.failed` swap the words; `opts.onFail()`
  // takes a failure over instead (the Death Plan's ids show themselves
  // whole, to copy by hand). The same Promise as copyText.
  const FLASH_MS = 1500;
  async function copyButton(btn, text, opts) {
    const o = opts || {};
    const ok = text ? await copyText(text) : false;
    if (!ok && o.onFail) { o.onFail(); return false; }
    flash(btn, ok ? (o.done || 'Copied ✓') : (o.failed || 'Copy failed'),
          ok);
    return ok;
  }
  function flash(btn, words, ok) {
    if (!('copyLabel' in btn.dataset)) {      // a second click keeps it
      btn.dataset.copyLabel = btn.textContent;
      btn.style.minWidth = btn.offsetWidth + 'px';
    }
    btn.textContent = words;
    btn.classList.toggle('copied', ok);
    btn.classList.toggle('copy-failed', !ok);
    clearTimeout(btn.copyTimer);
    btn.copyTimer = setTimeout(() => {
      btn.textContent = btn.dataset.copyLabel;
      delete btn.dataset.copyLabel;
      btn.style.minWidth = '';
      btn.classList.remove('copied', 'copy-failed');
    }, FLASH_MS);
  }

  window.copyText = copyText;
  window.copyButton = copyButton;
})();
