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
// clipboard. It never rejects.

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

  window.copyText = copyText;
})();
