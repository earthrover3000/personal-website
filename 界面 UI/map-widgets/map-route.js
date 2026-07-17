/* map-route — 'flight-route' renderer for the shared floating map popover.

   Draws a flight's great-circle arc (with a direction arrowhead) via the
   shared map-projection engine (引擎 Engines/map-projection), picking the
   framing per route:

     · CLOSE-UP — both endpoints fall inside one region of the engine's
       region SSOT (regions.js → window.WORLD_REGIONS): render that region's
       canonical Web-Mercator crop (the exact disc the Region Map Explorer
       shows — PROJ.mercatorDiscContains shares mercatorDisc's plane math,
       so the gate and the drawn circle always agree), via createWorldMap's
       `crop` option on the engine's own Mercator projection. Fine (50m)
       coastline — a close-up needs the detail.
     · WHOLE-WORLD — everything else: the small Northern-Hǎo world map,
       coarse basemap, as before.

   The projection choice is internal policy — hence the projection-neutral
   renderer name 'flight-route'. Registered into map-popover.js's renderer
   registry; drive it with:

     window.mapPopover.show({
       renderer: 'flight-route',
       origin: 'PEK', dest: 'JFK',       // precise IATA AIRPORT codes only
       label: 'PEK → JFK',               // shown on the popover label bar
       dismiss: 'manual', shape: 'circle'   // typical hover-follow config
     });

   Codes are validated against the engine's WORLD_AIRPORTS table after it
   loads; an unknown code (e.g. a metro code) can't be placed, so show()
   resolves false and the shell keeps the popover hidden.

   The engine is lazy-loaded on the first show, in TWO stages so pages that
   include this file stay fast to load AND the gate never waits on basemap
   data: STAGE-SMALL (config + projection kernels + airports + regions — a
   few KB, enough to resolve codes and pick the mode) then STAGE-FULL (the
   geometry/widget/coastline the actual render needs, either mode). Each
   stage is a cached promise, cleared on failure so a later hover retries
   instead of being wedged on a transient network error.

   The engine's base URL is derived from THIS script's own src
   (…/界面 UI/map-widgets/map-route.js → …/引擎 Engines/map-projection/ —
   the two module roots are siblings at the deployed site root), so any
   page depth works. Override for non-standard layouts (test harnesses)
   with <body data-map-route-engine-base="…/"> (read lazily at first show).

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

  // STAGE-SMALL: enough to resolve codes + gate the close-up mode — the numeric
  // kernels (PROJ.mercatorDiscContains), the airport table and the region SSOT.
  // Config → projection is the only order dependency; airports/regions are
  // independent data globals.
  var SMALL_CORE = ['projection-config.js', 'projection.js'];
  var SMALL_DATA = ['airports.js', 'regions.js'];
  // STAGE-FULL: what an actual render needs, either mode. geometry → widget is
  // ordered (world-map.js reads MAPGEO at execute time); coastline (which holds
  // BOTH the fine 50m and coarse 110m layers) is independent data.
  var FULL_CORE = ['map-geometry.js', 'world-map.js'];
  var FULL_DATA = ['coastline.js'];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadStage(base, core, data) {   // core strictly ordered, then the data files in parallel
    return core.reduce(function (p, f) {
      return p.then(function () { return loadScript(base + f); });
    }, Promise.resolve()).then(function () {
      return Promise.all(data.map(function (f) { return loadScript(base + f); }));
    });
  }

  // Each stage's promise is cached ONCE; on failure it is cleared so a later
  // hover retries instead of being wedged on a transient network error.
  var smallPromise = null, fullPromise = null;
  function ensureSmall() {
    if (!smallPromise) {
      smallPromise = loadStage(engineBase(), SMALL_CORE, SMALL_DATA);
      smallPromise.catch(function () { smallPromise = null; });
    }
    return smallPromise;
  }
  function ensureFull() {
    if (!fullPromise) {
      var base = engineBase();
      fullPromise = ensureSmall().then(function () {
        return loadStage(base, FULL_CORE, FULL_DATA);
      });
      fullPromise.catch(function () { fullPromise = null; });
    }
    return fullPromise;
  }

  // The FIRST region (SSOT order) whose Mercator-plane disc contains BOTH
  // endpoints, else null. Every region listed in WORLD_REGIONS participates —
  // no names hardcoded here. The disc is the SAME circle the Region Explorer
  // draws: PROJ.mercatorDiscContains shares mercatorDisc's exact plane math.
  function closeUpRegion(A, B) {
    var list = (window.WORLD_REGIONS && window.WORLD_REGIONS.regions) || [];
    for (var i = 0; i < list.length; i++) {
      var rg = list[i], c = { lat: rg.lat, lon: rg.lon };
      if (window.PROJ.mercatorDiscContains(c, rg.defaultRadiusKm, A[0], A[1]) &&
          window.PROJ.mercatorDiscContains(c, rg.defaultRadiusKm, B[0], B[1])) return rg;
    }
    return null;
  }

  function factory(contentEl /*, shellApi */) {
    var root = document.createElement('div');
    root.className = 'map-popover-route';   // styled by map-popover.css
    contentEl.appendChild(root);

    // TWO cached engine instances, one per mode, display-toggled: each
    // createWorldMap owns its canvas + projected-geometry caches, so cycling
    // hover A(close-up) → B(long-haul) → A never rebuilds a widget or leaks —
    // both are built at most once and re-rendered by mutating their opts
    // (routes / crop) + render(), exactly like the old single-instance path.
    var haoMount = document.createElement('div');
    var merMount = document.createElement('div');
    root.appendChild(haoMount); root.appendChild(merMount);
    var hao = null, haoOpts = null;   // whole-world Northern-Hǎo (default path)
    var mer = null, merOpts = null;   // close-up Web-Mercator region crop

    return {
      el: root,
      show: function (props) {
        // Async: the shell token-guards the resolution, so hovering event
        // A then quickly event B always ends showing B's route.
        return ensureSmall().then(function () {
          // The engine resolves precise IATA airport codes only; a metro/
          // unknown code can't be placed — signal the shell not to show.
          var AIR = window.WORLD_AIRPORTS || {};
          var A = AIR[props.origin], B = AIR[props.dest];
          if (!A || !B) return false;
          var rg = closeUpRegion(A, B);   // gate decided on stage-small data only
          return ensureFull().then(function () {
            // Size the square canvas to the card's content width — the
            // shell lays the popover out (display: flex, opacity 0)
            // before calling show(), so clientWidth is real by now.
            var size = root.clientWidth || 220;
            if (rg) {
              if (!mer) {
                // No `coordinate`: with `crop` set the engine picks the
                // equatorial framing whose seam stays clear of the region.
                merOpts = {
                  mount: merMount, controls: false, projection: 'mercator',
                  detail: 'fine', disablePan: true, size: size,
                  routes: [], crop: null,
                  routeArrows: true,   // direction arrow always on (origin → destination)
                };
                mer = window.createWorldMap(merOpts);
              }
              // fill: 1 — the disc exactly inscribes the square, so the circle
              // porthole clip coincides with the region's radius circle. Same
              // extent as the Region Map Explorer's crops (both modes), which
              // pass fill: 1 for the same reason — the region's canonical crop
              // means ONE extent everywhere it appears.
              merOpts.crop = { lat: rg.lat, lon: rg.lon, radiusKm: rg.defaultRadiusKm, fill: 1 };
              merOpts.routes = [[props.origin, props.dest]];
            } else if (!hao) {
              haoOpts = {
                mount: haoMount, controls: false, coordinate: 'north',
                projection: 'hao', detail: 'coarse', disablePan: true,
                size: size, routes: [],
                routeArrows: true,   // direction arrow always on (origin → destination)
              };
              hao = window.createWorldMap(haoOpts);
            }
            if (!rg) haoOpts.routes = [[props.origin, props.dest]];
            haoMount.style.display = rg ? 'none' : '';   // display-toggle BEFORE render so the live mount measures real
            merMount.style.display = rg ? '' : 'none';
            (rg ? mer : hao).render();
          });
        }).catch(function (err) {
          // Either stage failed to load (the stage promise is already cleared
          // for a retry on the next hover) → keep the popover hidden.
          console.warn('[map-route] engine failed to load:', err);
          return false;
        });
      }
    };
  }

  if (window.mapPopover && typeof window.mapPopover.register === 'function') {
    window.mapPopover.register('flight-route', factory);
  } else {
    // Shell not loaded yet — leave the registration for it to drain.
    (window.__mapPopoverPending = window.__mapPopoverPending || [])
      .push(['flight-route', factory]);
  }
})();
