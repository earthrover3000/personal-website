/* Floating map popover — single source of truth.

   Auto-injects #map-popover on DOMContentLoaded (idempotent — skips if
   the host page already provides one) and wires every .map-trigger
   element to a Leaflet preview centred on its data-lat / data-lon, with
   data-name shown on the bar below.

   Configuration surface (all opt-in per page, defaults baked in here):
     dismiss  — <body data-map-popover-persistent>          default: peek (fade in, hold 2s, fade out)
                                                            override: persistent (X / Esc / click outside)
     shape    — <body data-map-popover-shape="circle|square">  default: 'circle'
     radius   — <body data-map-popover-radius-km="N">       default: 17 (DEFAULT_RADIUS_KM constant below)
     width    — set --map-popover-card-width CSS var        default: min(90vw, 90vh, 360px) — see map-popover.css

   Runtime API for programmatic control:
     window.mapPopover.show(lat, lon, name)
     window.mapPopover.hide()
     window.mapPopover.setShape('circle'|'square')

   Requires the global L (Leaflet) to be loaded before this script. */

(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var persistent = document.body.dataset.mapPopoverPersistent !== undefined;
    var initialShape = document.body.dataset.mapPopoverShape || 'circle';

    var pop = document.getElementById('map-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'map-popover';
      pop.innerHTML =
        '<div class="map-popover-card">' +
          '<button type="button" class="map-popover-close" aria-label="Close">×</button>' +
          '<div id="map-popover-map"></div>' +
          '<div id="map-popover-label"></div>' +
        '</div>';
      document.body.appendChild(pop);
    }
    if (persistent) pop.classList.add('is-persistent');

    function setShape(shape) {
      // Two modes — either is opt-in-able from any host page:
      //   'circle' (default) — map clipped to a circle
      //   'square'           — rounded-square card (10 px corners from
      //                        .map-popover-card; no clip on the map div)
      pop.classList.toggle('shape-square', shape === 'square');
      pop.classList.toggle('shape-circle', shape !== 'square');
      if (lmap) requestAnimationFrame(function () { lmap.invalidateSize(); });
    }
    setShape(initialShape);

    var card = pop.querySelector('.map-popover-card');
    var mapEl = document.getElementById('map-popover-map');
    var labelEl = document.getElementById('map-popover-label');
    var closeBtn = pop.querySelector('.map-popover-close');
    var lmap = null, fadeOutT = null, hideT = null;

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

    function hide() {
      clearTimeout(fadeOutT);
      clearTimeout(hideT);
      pop.style.opacity = '0';
      hideT = setTimeout(function () { pop.style.display = 'none'; }, 400);
    }

    function show(lat, lon, name) {
      ensureMap();
      labelEl.textContent = name || '';
      clearTimeout(fadeOutT);
      clearTimeout(hideT);
      pop.style.display = 'flex';
      // Zoom must be set after invalidateSize — the map container's
      // pixel width is only known once the popover is laid out (display
      // was 'none' before this call). Doing it inside the same timeout
      // avoids a flash of the wrong zoom.
      setTimeout(function () {
        lmap.invalidateSize();
        var widthPx = mapEl.clientWidth;
        lmap.setView([lat, lon], computeZoom(lat, widthPx));
      }, 50);
      requestAnimationFrame(function () { pop.style.opacity = '1'; });
      if (!persistent) {
        fadeOutT = setTimeout(function () {
          pop.style.opacity = '0';
          hideT = setTimeout(function () { pop.style.display = 'none'; }, 400);
        }, 2000);
      }
    }

    document.querySelectorAll('.map-trigger').forEach(function (el) {
      el.addEventListener('click', function () {
        var lat = parseFloat(el.dataset.lat), lon = parseFloat(el.dataset.lon);
        if (!isFinite(lat) || !isFinite(lon)) return;
        show(lat, lon, el.dataset.name || '');
      });
    });

    if (persistent) {
      closeBtn.addEventListener('click', hide);
      // Outside-click detection runs at document level (the container has
      // pointer-events: none so clicks on other .map-trigger coords still
      // reach them while the popover is open). Click inside the card or
      // on another .map-trigger is excluded — the latter so the popover
      // can switch coordinates without first being dismissed.
      document.addEventListener('click', function (e) {
        if (pop.style.display === 'none' || pop.style.display === '') return;
        if (card.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.map-trigger')) return;
        hide();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && pop.style.display !== 'none' && pop.style.display !== '') {
          hide();
        }
      });
    }

    // Public API for programmatic triggers (test-page size tester etc.).
    // The .map-trigger click flow remains the primary entry point; this
    // is for non-trigger contexts that need to drive the popover by code.
    window.mapPopover = { show: show, hide: hide, setShape: setShape };
  });
})();
