/* Floating map popover — single source of truth.

   A rendering-agnostic SHELL: it owns the card, label bar, dismiss modes,
   shape, placement, z-index and theming — and knows nothing about how the
   map inside is drawn. Actual drawing is done by pluggable RENDERERS
   registered by name (the classic Leaflet point preview lives in this same
   file as the 'leaflet-point' renderer; sibling map-route.js registers a
   'flight-route' renderer that draws a flight arc via the map-projection
   engine).

   Auto-injects #map-popover on DOMContentLoaded (idempotent — skips if
   the host page already provides one) and wires every .map-trigger
   element to the default 'leaflet-point' renderer centred on its
   data-lat / data-lon, with data-name shown on the bar below.

   Configuration surface (all opt-in per page, defaults baked in here):
     dismiss   — <body data-map-popover-persistent>          default: peek (fade in, hold 2s, fade out)
                                                             override: persistent (X / Esc / click outside)
     shape     — <body data-map-popover-shape="circle|square">  default: 'circle'
     placement — <body data-map-popover-placement="bottom-right">  default: centered
     radius    — <body data-map-popover-radius-km="N">       default: 17 (leaflet-point renderer)
     width     — set --map-popover-card-width CSS var        default: min(90vw, 90vh, 360px) — see map-popover.css

   Runtime API for programmatic control:
     window.mapPopover.show(lat, lon, name)      — legacy positional form:
         delegates to the default 'leaflet-point' renderer.
     window.mapPopover.show(props)               — object form:
         { renderer: 'leaflet-point'|'flight-route'|…,   which renderer draws
           label: '…',                                text on the bar below
           dismiss: 'peek'|'persistent'|'manual',     per-call override of the
                                                      page default; 'manual'
                                                      = caller hides (hover-
                                                      follow: no timer, no X,
                                                      card ignores the pointer)
           shape: 'circle'|'square',                  per-call override; the
                                                      page default is restored
                                                      implicitly on next show
           placement: 'center'|'bottom-right',        per-call override
           …renderer-specific props }                 e.g. lat/lon for
                                                      'leaflet-point',
                                                      origin/dest for
                                                      'flight-route'
     window.mapPopover.hide()
     window.mapPopover.setShape('circle'|'square')  — sets the page default
     window.mapPopover.register(name, factory)      — add a renderer

   Renderer contract:
     factory(contentEl, shellApi) → instance      called lazily on the first
                                                  show() naming this renderer.
       contentEl — the card's content region; the renderer creates its DOM
                   inside it (and may reuse it across shows — instances are
                   cached, never destroyed, so Leaflet maps / engine canvases
                   survive renderer switches).
       shellApi  — { hide }  minimal hooks back into the shell.
     instance = {
       el:       root element the renderer owns (shell toggles its display
                 when another renderer takes over the card),
       show(props): draw for these props. Return false (or a Promise
                 resolving to false) to signal "can't show" — the shell then
                 keeps/puts the popover hidden. Any other return (or resolve)
                 counts as success. Async shows are token-guarded by the
                 shell: a newer show()/hide() silently discards a stale one.
       hide():   optional — notified when the popover hides,
       refresh(): optional — notified when card geometry changed while
                 visible (shape flip) so e.g. Leaflet can invalidateSize.
     }
     Unregistered renderer at show() time → console.warn, no crash.

   Load-order handshake: renderer scripts loaded BEFORE this file push
   [name, factory] pairs onto window.__mapPopoverPending; the shell drains
   that queue when it executes. Scripts loaded after simply call
   window.mapPopover.register() (the API object exists synchronously at
   script-execute time; DOM work is deferred to DOMContentLoaded).

   The 'leaflet-point' renderer requires the global L (Leaflet) — but only
   touches it inside its own show(), so pages that never point-preview
   (e.g. the itinerary calendar) need not load Leaflet at all. */

(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ---------------- Renderer registry (synchronous) ------------------- */

  var registry = {};   // name → { factory, instance }

  function register(name, factory) {
    registry[name] = { factory: factory, instance: null };
  }

  // Drain registrations queued by renderer scripts that ran before us.
  var pending = window.__mapPopoverPending;
  if (pending && pending.length) {
    for (var i = 0; i < pending.length; i++) register(pending[i][0], pending[i][1]);
  }

  /* ---------------- Public API (synchronous facade) -------------------
     The real implementations are bound at DOMContentLoaded; ready() runs
     the call immediately when the DOM is already loaded, so post-init
     calls behave exactly like direct calls (and pre-init calls queue). */

  var impl = null;
  window.mapPopover = {
    register: register,
    show: function (a, b, c) { ready(function () { impl.show(a, b, c); }); },
    hide: function () { ready(function () { impl.hide(); }); },
    setShape: function (s) { ready(function () { impl.setShape(s); }); }
  };

  /* ---------------- Built-in 'leaflet-point' renderer -----------------
     The original popover body, extracted verbatim: a Leaflet preview
     centred on props.lat / props.lon, ground span normalised per latitude.
     Registered here (same file) so existing pages pay zero extra HTTP
     requests. Default renderer for the .map-trigger auto-wiring and the
     legacy positional show(lat, lon, name). */

  register('leaflet-point', function (contentEl /*, shellApi */) {
    var mapEl = document.createElement('div');
    mapEl.id = 'map-popover-map';   // id kept — map-popover.css styles it
    contentEl.appendChild(mapEl);

    var lmap = null;

    // Default geographic radius shown around the centre point, in km.
    // Same value applied at every city — zoom is computed per latitude
    // and container width so the visible ground span stays uniform,
    // instead of using a fixed numeric zoom (which would make HK at lat
    // 22° show ~50% more area than Dublin at lat 53° due to Mercator).
    // Override per-page with <body data-map-popover-radius-km="...">.
    var DEFAULT_RADIUS_KM = 17;
    var pageRadius = parseFloat(document.body.dataset.mapPopoverRadiusKm);
    var RADIUS_KM = (isFinite(pageRadius) && pageRadius > 0) ? pageRadius : DEFAULT_RADIUS_KM;

    function computeZoom(lat, widthPx) {
      // Web Mercator: meters_per_pixel = 156543.03392 × cos(lat) / 2^zoom.
      // Want widthPx pixels to span 2 × RADIUS_KM × 1000 metres.
      // → 2^zoom = 156543.03392 × cos(lat) × widthPx / (2000 × RADIUS_KM)
      var latRad = lat * Math.PI / 180;
      return Math.log2(156543.03392 * Math.cos(latRad) * widthPx / (2000 * RADIUS_KM));
    }

    function ensureMap() {
      if (lmap) return;
      lmap = L.map(mapEl, {
        // zoomSnap: 0 lets us pass a fractional zoom (the computed value
        // from computeZoom is rarely an integer). Without this, Leaflet
        // would round to the nearest integer zoom and the per-city
        // normalisation would collapse.
        zoomSnap: 0,
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        touchZoom: false, boxZoom: false, keyboard: false
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(lmap);
    }

    return {
      el: mapEl,
      show: function (props) {
        ensureMap();
        // Zoom must be set after invalidateSize — the map container's
        // pixel width is only known once the popover is laid out (display
        // was 'none' before this show). Doing it inside the same timeout
        // avoids a flash of the wrong zoom.
        setTimeout(function () {
          lmap.invalidateSize();
          var widthPx = mapEl.clientWidth;
          lmap.setView([props.lat, props.lon], computeZoom(props.lat, widthPx));
        }, 50);
      },
      refresh: function () {
        if (lmap) requestAnimationFrame(function () { lmap.invalidateSize(); });
      }
    };
  });

  /* ---------------- Shell (DOM work, bound at ready) ------------------ */

  ready(function () {
    var pageDismiss = document.body.dataset.mapPopoverPersistent !== undefined ? 'persistent' : 'peek';
    var pageShape = document.body.dataset.mapPopoverShape || 'circle';
    var pagePlacement = document.body.dataset.mapPopoverPlacement || 'center';

    var pop = document.getElementById('map-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'map-popover';
      pop.innerHTML =
        '<div class="map-popover-card">' +
          '<button type="button" class="map-popover-close" aria-label="Close">×</button>' +
          '<div class="map-popover-content"></div>' +
          '<div id="map-popover-label"></div>' +
        '</div>';
      document.body.appendChild(pop);
    }

    var card = pop.querySelector('.map-popover-card');
    var contentEl = pop.querySelector('.map-popover-content');
    var labelEl = document.getElementById('map-popover-label');
    var closeBtn = pop.querySelector('.map-popover-close');
    var fadeOutT = null, hideT = null;

    var activeEntry = null;      // registry entry whose renderer owns the card
    var currentDismiss = pageDismiss;
    var showToken = 0;           // bumps on every show()/hide(); stale async
                                 // renderer results check it and bow out

    var shellApi = { hide: hide };

    function applyShape(shape) {
      // Two modes — either is opt-in-able from any host page:
      //   'circle' (default) — map clipped to a circle
      //   'square'           — rounded-square card (10 px corners from
      //                        .map-popover-card; no clip on the map div)
      pop.classList.toggle('shape-square', shape === 'square');
      pop.classList.toggle('shape-circle', shape !== 'square');
    }

    function setShape(shape) {
      // Legacy API: sets the page-wide default AND applies immediately
      // (the test-page size tester drives this live).
      pageShape = shape;
      applyShape(shape);
      if (activeEntry && activeEntry.instance && activeEntry.instance.refresh) {
        activeEntry.instance.refresh();
      }
    }
    applyShape(pageShape);

    function applyPlacement(placement) {
      // Default: centered (the original design — untouched for existing
      // pages). 'bottom-right' parks the card in the lower-right corner
      // (the itinerary calendar's hover mini-map placement).
      pop.classList.toggle('place-bottom-right', placement === 'bottom-right');
    }
    applyPlacement(pagePlacement);

    function applyDismiss(dismiss) {
      currentDismiss = dismiss;
      // 'persistent' shows the X (CSS keys off is-persistent); 'manual'
      // makes the card pointer-transparent so a hover-follow popover never
      // steals the mouse from the element being hovered (which would fire
      // mouseleave → hide → mouseenter → flicker).
      pop.classList.toggle('is-persistent', dismiss === 'persistent');
      pop.classList.toggle('dismiss-manual', dismiss === 'manual');
    }
    applyDismiss(pageDismiss);

    function activate(entry) {
      // Only ONE renderer's DOM is visible in the card at a time. Others
      // are display:none-d, not destroyed — their instances (Leaflet map,
      // engine canvas) stay warm for reuse.
      for (var name in registry) {
        var e = registry[name];
        if (e.instance && e.instance.el) {
          e.instance.el.style.display = (e === entry) ? '' : 'none';
        }
      }
      activeEntry = entry;
    }

    function hide() {
      showToken++;               // cancels any in-flight async show
      clearTimeout(fadeOutT);
      clearTimeout(hideT);
      pop.style.opacity = '0';
      hideT = setTimeout(function () { pop.style.display = 'none'; }, 400);
      if (activeEntry && activeEntry.instance && activeEntry.instance.hide) {
        activeEntry.instance.hide();
      }
    }

    function show(a, b, c) {
      // Legacy positional form show(lat, lon, name) → default renderer.
      var props = (a !== null && typeof a === 'object')
        ? a
        : { renderer: 'leaflet-point', lat: a, lon: b, label: c };
      var name = props.renderer || 'leaflet-point';

      var entry = registry[name];
      if (!entry) {
        // Fail soft: a page asked for a renderer whose script isn't
        // loaded. Warn once per attempt, never crash the host page.
        console.warn('[map-popover] unknown renderer "' + name + '" — not registered');
        return;
      }
      if (!entry.instance) {
        entry.instance = entry.factory(contentEl, shellApi);
        // Forgiving: append the renderer's root if it didn't already.
        if (entry.instance.el && entry.instance.el.parentNode !== contentEl) {
          contentEl.appendChild(entry.instance.el);
        }
      }

      var mine = ++showToken;

      // Per-call overrides, falling back to the page defaults. Applying
      // on EVERY show is what restores the page default after an override
      // (no explicit restore-on-hide needed).
      applyShape(props.shape || pageShape);
      applyPlacement(props.placement || pagePlacement);
      applyDismiss(props.dismiss || pageDismiss);

      activate(entry);
      labelEl.textContent = props.label != null ? props.label
        : (props.name != null ? props.name : '');
      clearTimeout(fadeOutT);
      clearTimeout(hideT);

      // Lay the popover out BEFORE the renderer draws (opacity is still 0,
      // so nothing flashes): renderers measure their container (Leaflet
      // invalidateSize, engine canvas sizing) and display:none would give
      // them a 0-width box.
      pop.style.display = 'flex';

      var result;
      try {
        result = entry.instance.show(props);
      } catch (err) {
        console.warn('[map-popover] renderer "' + name + '" failed:', err);
        hide();
        return;
      }

      Promise.resolve(result).then(function (ok) {
        if (mine !== showToken) return;   // superseded by a newer show/hide
        if (ok === false) { hide(); return; }   // renderer says: can't show
        requestAnimationFrame(function () { pop.style.opacity = '1'; });
        if (currentDismiss === 'peek') {
          fadeOutT = setTimeout(function () {
            pop.style.opacity = '0';
            hideT = setTimeout(function () { pop.style.display = 'none'; }, 400);
          }, 2000);
        }
      }, function (err) {
        console.warn('[map-popover] renderer "' + name + '" failed:', err);
        if (mine === showToken) hide();
      });
    }

    document.querySelectorAll('.map-trigger').forEach(function (el) {
      el.addEventListener('click', function () {
        var lat = parseFloat(el.dataset.lat), lon = parseFloat(el.dataset.lon);
        if (!isFinite(lat) || !isFinite(lon)) return;
        show({ renderer: 'leaflet-point', lat: lat, lon: lon, label: el.dataset.name || '' });
      });
    });

    // Dismissal listeners are attached unconditionally but gated on the
    // CURRENT dismiss mode, so a per-call dismiss:'persistent' works even
    // on a page whose default is peek (and vice versa).
    closeBtn.addEventListener('click', hide);
    // Outside-click detection runs at document level (the container has
    // pointer-events: none so clicks on other .map-trigger coords still
    // reach them while the popover is open). Click inside the card or
    // on another .map-trigger is excluded — the latter so the popover
    // can switch coordinates without first being dismissed.
    document.addEventListener('click', function (e) {
      if (currentDismiss !== 'persistent') return;
      if (pop.style.display === 'none' || pop.style.display === '') return;
      if (card.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.map-trigger')) return;
      hide();
    });
    document.addEventListener('keydown', function (e) {
      if (currentDismiss !== 'persistent') return;
      if (e.key === 'Escape' && pop.style.display !== 'none' && pop.style.display !== '') {
        hide();
      }
    });

    // Bind the real implementations behind the synchronous facade.
    impl = { show: show, hide: hide, setShape: setShape };
  });
})();
