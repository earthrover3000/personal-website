// version-check.js — "New version available" pill for the site's static
// pages, mirroring the lifespan-atlas update prompt (UpdateToast +
// useUpdatePrompt) without a service worker.
//
// SSOT: <site root>/version.json — the build-provenance sidecar build.py
// derives from deploy_state's build-state.json. Its `fp` is the deploy
// fingerprint behind the sync dot and Settings → Developer; a changed fp IS
// the definition of "a new version was deployed", so this widget compares
// nothing else. The site root is derived from this script's own src URL
// (the tag is injected per-page with a depth-correct relative path by
// site_facade.render.inject_favicons_and_badge), so the widget needs no
// per-page configuration.
//
// Mechanism (cadence copied from the atlas hook): the first successful fetch
// after load is the BASELINE — the version this tab is looking at. Polling
// runs only while the document is visible (torn down on hide, immediate
// re-check on return, so switching back to a tab picks up a new deploy right
// away). A later fetch with a different fp shows the pill; Refresh is a
// plain reload (static pages have no worker cache to rotate); ✕ hides it
// for this page-view only. Fetch failures (offline / flaky) are swallowed
// and retried next tick.
(function () {
  var CHECK_INTERVAL_MS = 60000;

  var script = document.currentScript;
  if (!script || !script.src || !window.fetch) return;
  // …/界面 UI/page-widgets/version-check.js → strip the last TWO path
  // segments' folders to land on the site root the 界面 UI folder sits in.
  var src = script.src;
  var i = src.lastIndexOf('/page-widgets/version-check.js');
  if (i < 0) return;
  var root = src.slice(0, src.lastIndexOf('/', i - 1) + 1);
  var url = root + 'version.json';

  var baseline = null;
  var shown = false;
  var timer;

  function check() {
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.fp) return;
        if (baseline === null) { baseline = v.fp; return; }
        if (v.fp !== baseline) showPill();
      })
      .catch(function () { /* offline / flaky — next tick retries */ });
  }

  function stop() { window.clearInterval(timer); timer = undefined; }
  function sync() {
    if (document.visibilityState === 'visible') {
      if (timer === undefined) {
        check();
        timer = window.setInterval(check, CHECK_INTERVAL_MS);
      }
    } else {
      stop();
    }
  }

  function showPill() {
    if (shown) return;
    shown = true;
    stop();
    document.removeEventListener('visibilitychange', sync);

    var pill = document.createElement('div');
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'z-index:2147483647;max-width:92vw;display:flex;align-items:center;' +
      'gap:10px;padding:8px 10px 8px 14px;border-radius:999px;' +
      'background:rgba(20,20,22,0.92);color:#fff;' +
      'border:1px solid var(--accent,#d4156c);' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.35);' +
      'font:13px/1.3 system-ui,sans-serif;white-space:nowrap;';

    var icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🔄';

    var label = document.createElement('span');
    label.textContent = 'New version available';

    var refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Refresh';
    refresh.style.cssText =
      'border:none;border-radius:999px;padding:5px 12px;' +
      'background:var(--accent,#d4156c);color:#fff;font:inherit;' +
      'font-weight:600;cursor:pointer;';
    refresh.addEventListener('click', function () { window.location.reload(); });

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '✕';
    dismiss.style.cssText =
      'border:none;background:none;color:rgba(255,255,255,0.6);' +
      'font:inherit;padding:5px 4px;cursor:pointer;';
    dismiss.addEventListener('click', function () { pill.remove(); });

    pill.appendChild(icon);
    pill.appendChild(label);
    pill.appendChild(refresh);
    pill.appendChild(dismiss);
    document.body.appendChild(pill);
  }

  sync();
  document.addEventListener('visibilitychange', sync);
})();
