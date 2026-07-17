/* map-route — 'hao-route' renderer for the shared floating map popover.

   Draws a flight's great-circle arc (with a direction arrowhead) on a
   small Northern-Hǎo world map, via the shared map-projection engine
   (引擎 Engines/map-projection). Registered into map-popover.js's renderer
   registry under the name 'hao-route'; drive it with:

     window.mapPopover.show({
       renderer: 'hao-route',
       origin: 'PEK', dest: 'JFK',       // precise IATA AIRPORT codes only
       label: 'PEK → JFK',               // shown on the popover label bar
       dismiss: 'manual', shape: 'square'   // typical hover-follow config
     });

   Codes are validated against the engine's WORLD_AIRPORTS table after it
   loads; an unknown code (e.g. a metro code) can't be placed, so show()
   resolves false and the shell keeps the popover hidden.

   The engine (6 classic scripts, ~coarse basemap only: no borders /
   terrain / cities) is lazy-loaded ONCE, on the first show — pages that
   include this file stay fast to load. The engine's base URL is derived
   from THIS script's own src (…/界面 UI/map-widgets/map-route.js →
   …/引擎 Engines/map-projection/ — the two module roots are siblings at
   the deployed site root), so any page depth works. Override for
   non-standard layouts (test harnesses) with
   <body data-map-route-engine-base="…/"> (read lazily at first show).

   Load order vs map-popover.js: either works. Loaded after (the normal
   case) it registers directly on window.mapPopover; loaded before, it
   queues on window.__mapPopoverPending, which the shell drains when it
   executes. Requires nothing else at load time — no Leaflet, no engine. */

(function () {
  // Captured at script-execute time — document.currentScript is null later
  // (e.g. inside async callbacks), so grab it now.
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';

  // The tail of this script's URL, replaced to reach the sibling engine
  // root. decodeURI first: the browser percent-encodes the Chinese path
  // segments in .src, so a raw match against 界面 UI would never hit.
  var WIDGET_TAIL = /界面 UI\/map-widgets\/map-route\.js([?#].*)?$/;

  function engineBase() {
    var override = document.body && document.body.dataset.mapRouteEngineBase;
    if (override) return /\/$/.test(override) ? override : override + '/';
    var decoded = scriptSrc;
    try { decoded = decodeURI(scriptSrc); } catch (e) { /* keep raw */ }
    if (WIDGET_TAIL.test(decoded)) {
      return decoded.replace(WIDGET_TAIL, '引擎 Engines/map-projection/');
    }
    console.warn('[map-route] cannot derive engine base from own src (' +
      scriptSrc + ') — set <body data-map-route-engine-base="…">');
    return '引擎 Engines/map-projection/';   // last-resort: page-relative guess
  }

  // Core is dependency-ordered (config → projection → geometry → widget).
  var CORE = ['projection-config.js', 'projection.js', 'map-geometry.js', 'world-map.js'];
  // Only the layers a small arc needs: coastline (land) + airports (endpoints).
  var DATA = ['coastline.js', 'airports.js'];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Lazy-load the engine + coarse basemap ONCE, on the first show. On
  // failure the cached promise is cleared so a later hover retries instead
  // of being wedged on a transient network error.
  var enginePromise = null;
  function ensureEngine() {
    if (!enginePromise) {
      var base = engineBase();
      enginePromise = CORE.reduce(function (p, f) {   // ordered: each depends on the last
        return p.then(function () { return loadScript(base + f); });
      }, Promise.resolve()).then(function () {
        return Promise.all(DATA.map(function (f) { return loadScript(base + f); }));
      });
      enginePromise.catch(function () { enginePromise = null; });
    }
    return enginePromise;
  }

  function factory(contentEl /*, shellApi */) {
    var root = document.createElement('div');
    root.className = 'map-popover-route';   // styled by map-popover.css
    contentEl.appendChild(root);

    var map = null;      // createWorldMap handle — built once, reused
    var mapOpts = null;  // the SAME opts object every render (embed mode
                         // re-reads opts.routes each render, so route
                         // switching is a mutation + .render())

    return {
      el: root,
      show: function (props) {
        // Async: the shell token-guards the resolution, so hovering event
        // A then quickly event B always ends showing B's route.
        return ensureEngine().then(function () {
          // The engine resolves precise IATA airport codes only; a metro/
          // unknown code can't be placed — signal the shell not to show.
          var AIR = window.WORLD_AIRPORTS || {};
          if (!AIR[props.origin] || !AIR[props.dest]) return false;
          if (!map) {
            // Size the square canvas to the card's content width — the
            // shell lays the popover out (display: flex, opacity 0)
            // before calling show(), so clientWidth is real by now.
            var size = root.clientWidth || 220;
            mapOpts = {
              mount: root, controls: false, coordinate: 'north',
              projection: 'hao', detail: 'coarse', disablePan: true,
              size: size, routes: [],
              routeArrows: true,   // direction arrow always on (origin → destination)
            };
            map = window.createWorldMap(mapOpts);
          }
          mapOpts.routes = [[props.origin, props.dest]];
          map.render();
        }, function (err) {
          console.warn('[map-route] engine failed to load:', err);
          return false;
        });
      }
    };
  }

  if (window.mapPopover && typeof window.mapPopover.register === 'function') {
    window.mapPopover.register('hao-route', factory);
  } else {
    // Shell not loaded yet — leave the registration for it to drain.
    (window.__mapPopoverPending = window.__mapPopoverPending || [])
      .push(['hao-route', factory]);
  }
})();
