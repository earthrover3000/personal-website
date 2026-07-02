/* Site-wide theme control — the single source of truth for manual dark/light.

   Loaded as a BLOCKING <script> (no defer/async) early in every page's and
   every app's <head>, so it runs before first paint: reading the stored
   choice and stamping <html data-theme> synchronously means navigating
   between pages never flashes the wrong theme.

   Modes (localStorage['site-theme']):
     'auto'  (default) — no attribute; CSS `color-scheme: dark light` follows
                         the OS (see 界面 UI/styles/base.css).
     'dark' / 'light'  — sets <html data-theme>, forcing color-scheme.

   Public API (used by the Settings page toggle):
     window.setSiteTheme(mode)  — persist + apply immediately.
     window.getSiteTheme()      — current stored mode ('auto' if unset).
     window.onSiteThemeChange(cb)— subscribe (fires cross-tab too). */
(function () {
  var KEY = 'site-theme';
  var listeners = [];

  function normalize(mode) {
    return (mode === 'dark' || mode === 'light') ? mode : 'auto';
  }

  function apply(mode) {
    var el = document.documentElement;
    if (mode === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', mode);
  }

  function read() {
    try { return normalize(localStorage.getItem(KEY)); } catch (e) { return 'auto'; }
  }

  // Apply immediately (this is the pre-paint work).
  apply(read());

  window.setSiteTheme = function (mode) {
    mode = normalize(mode);
    try {
      if (mode === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) {}
    apply(mode);
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](mode); } catch (e) {} }
  };

  window.getSiteTheme = function () { return read(); };

  window.onSiteThemeChange = function (cb) {
    if (typeof cb === 'function') listeners.push(cb);
  };

  // Keep other open tabs/pages in sync when the choice changes elsewhere.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var mode = read();
    apply(mode);
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](mode); } catch (err) {} }
  });
})();
