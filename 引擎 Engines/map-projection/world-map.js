// world-map.js — reusable client-side world-map widget. Renders coastlines,
// graticule, optional country boundaries, and great-circle flight paths on a
// chosen projection + coordinate framing, all client-side on a Canvas. Built on
// PROJECTION_CONFIG + PROJ + MAPGEO + the WORLD_COASTLINE/BOUNDARIES/AIRPORTS
// data globals (all from 引擎 Engines/map-projection/).
//
// Usage (maps-projections "Great Circle Mapper" — full interactive controls):
//   createWorldMap({ mount: '#great-circle-mapper', controls: true });
// Usage (embed, e.g. travel-calendar — fixed framing + own routes, no UI):
//   createWorldMap({ mount: el, controls: false, coordinate: 'north',
//                    projection: 'winkel', routes: [['LHR','HND'], ...] });

(function (root) {
  'use strict';
  var PROJ = root.PROJ, MAPGEO = root.MAPGEO;

  // Canvas palette, theme-aware (the site is dark by default, light only under prefers-color-scheme: light).
  // bathyColors / landColors are the terrain ramps, each keyed by the band's bound (ocean depth m / land
  // lower-elevation m). Values are sampled from GMT's classic `geo.cpt` hypsometric scheme (Wessel & Smith):
  // ocean pale→navy, land green→yellow→brown→grey. The LIGHT set is geo.cpt verbatim; the DARK set blends
  // each toward a dark anchor (geo.cpt assumes a paper background, so dark mode needs a parallel ramp).
  var LIGHT_PAL = {
    ocean: '#b7d2ea', land: '#cde0a8', coast: '#5f7d43',
    graticule: '#9bb6d0', edge: '#4f7193', border: '#9a7b5a', marker: '#15202b', mercVoid: '#707a85', city: '#0e7490',
    bathyColors: { 0: '#f5ffff', 200: '#e4f8fc', 1000: '#a2dbf2', 2000: '#6ec3eb', 3000: '#53abe0', 4000: '#448dc9', 5000: '#3563a0', 6000: '#2f548a', 7000: '#294475', 8000: '#1f3055' },
    landColors: { 0: '#33893c', 500: '#a8bc66', 1000: '#d0a553', 2000: '#9e4201', 3000: '#64331a', 4000: '#694d3f', 5000: '#7f7e7d' },
    // UN-subregion shading: four distinct hues (coral / green / blue / sand), indexed by the colour
    // baked into WORLD_UN_REGIONS so no two land-adjacent subregions share one. Pastel so coastlines,
    // borders and route arcs stay legible on top; LIGHT set tuned for the paper background.
    regionColors: ['#e79a8e', '#9ecb92', '#9bb6e2', '#e7cd8a']
  };
  var DARK_PAL = {
    ocean: '#172430', land: '#36422f', coast: '#76926a',
    graticule: '#314a5e', edge: '#5e83a3', border: '#8f7458', marker: '#e9eef2', mercVoid: '#525c67', city: '#22d3ee',
    bathyColors: { 0: '#4f5966', 200: '#4b5765', 1000: '#384f62', 2000: '#2a4960', 3000: '#22425d', 4000: '#1e3957', 5000: '#1a2e4b', 6000: '#182a45', 7000: '#16253f', 8000: '#131f36' },
    landColors: { 0: '#234925', 500: '#525d36', 1000: '#62542e', 2000: '#4e2c0e', 3000: '#362618', 4000: '#383126', 5000: '#41443f' },
    // Parallel four-colour subregion ramp for the dark theme: same hue order (coral/green/blue/sand),
    // darkened toward the dark ocean so the tint reads without glowing.
    regionColors: ['#7d4a42', '#42603c', '#3c4d70', '#6a5a33']
  };
  // Effective theme: the manual site toggle (<html data-theme>, set by
  // 界面 UI/page-widgets/theme-init.js) wins; in 'auto' (no attribute) fall
  // back to the OS via prefers-color-scheme.
  function darkMode() {
    var t = (typeof document !== 'undefined' && document.documentElement)
      ? document.documentElement.getAttribute('data-theme') : null;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function palette() { return darkMode() ? DARK_PAL : LIGHT_PAL; }
  var ROUTE_COLORS = ['#c0392b', '#1f6f3d', '#6c3483', '#b9770e', '#1a5276', '#7b241c'];
  var REGION_COLOR = '#e91e63';   // region-disc outline — vivid pink, distinct from the route palette + seam belts, legible on land/ocean in both themes
  // Mercator-limit overlay — marks Web Mercator's ±PROJ.MERCATOR_MAXLAT (85.05°) coverage limit. On
  // Hǎo/Winkel the two geographic polar caps are CUT OUT (punched transparent, crimson-ringed) so the
  // bit Mercator can't show reads as a literal hole. On the Mercator projection itself the caps are
  // already off-map, so instead a translucent crimson belt shades its own ±85.05° top/bottom clamp edge.
  var MERC_BAND = 3;                          // band width, degrees of latitude (the shaded belt on Mercator's own clamp edge)
  var MERC_FILL = 'rgba(192,57,43,0.22)';     // the shaded belt — translucent crimson (drawn on the Mercator projection's own top/bottom clamp)
  var MERC_EDGE = '#c0392b';                  // crimson ring on ±MERCATOR_MAXLAT — the cut-out cap boundary on Hǎo/Winkel
  var GRAT = 15;            // graticule spacing, degrees
  var NSAMP = 500;          // samples per graticule line / arc
  // Terrain-grid bin lower bounds — MUST match scripts/make_terrain_grid.py.
  // Ocean codes 0..11 map to DEPTH_BOUNDS (the historical NE bathymetry band
  // set, so PAL.bathyColors lookups keep identical visuals); land codes
  // TERRAIN_LAND_BASE.. map to LAND_BOUNDS (make_topography.py's LEVELS).
  var DEPTH_BOUNDS = [0, 200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
  var LAND_BOUNDS = [0, 500, 1000, 2000, 3000, 4000, 5000];
  var TERRAIN_LAND_BASE = 16;
  var DEFAULT_SIZE = 360;   // box px — matches the Region Map Explorer default
  var ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];   // each step doubles: 100, 200, 400, 800, 1600, 3200 %
  // Quick-orient presets: which region sits at the top, as a fixed-dial angle (°, multiple of 15),
  // per vertical framing. Only the vertical (Northern/Southern) framings have these; the horizontal
  // (Eastern/Western) framings get an empty list.
  var ORIENT_PRESETS = {
    north: [['East Asia', 135], ['Europe', 30], ['North America', 285]],
    south: [['South America', 120], ['Oceania', 315], ['Africa', 15]]
  };
  var WORLDMAP_UID = 0;

  var STYLE_ID = '__world-map-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent =
      // Controls live in a floating ⚙ panel overlaying a full-bleed map; the map gets the
      // whole widget area. A small always-visible rail (compass + zoom + reset/save) stays out.
      '.gcm-controls{display:flex;flex-direction:column;gap:1rem;margin:0;}' +
      '.gcm-group{border:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.3rem;}' +
      '.gcm-group .gcm-legend{font-size:0.72rem;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted);}' +
      '.gcm-opts{display:flex;flex-wrap:wrap;gap:0.35rem 0.8rem;align-items:center;}' +
      '.gcm-controls label{display:inline-flex;align-items:center;gap:0.35rem;font-size:0.9rem;color:var(--text);cursor:pointer;}' +
      '.gcm-controls input[type=radio],.gcm-controls input[type=checkbox]{accent-color:var(--accent);}' +
      '.gcm-controls input[type=number]{font:inherit;width:5rem;padding:0.3rem 0.5rem;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;}' +
      '.gcm-controls select{font:inherit;padding:0.4rem 0.6rem;max-width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;}' +
      '.gcm-routesel{display:inline-flex;align-items:center;gap:0.35rem;}' +
      '.gcm-routefree{display:flex;align-items:center;gap:0.4rem;width:100%;}' +
      '.gcm-routefree input[type=text]{flex:1 1 auto;min-width:0;font:inherit;padding:0.4rem 0.6rem;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;}' +
      '.gcm-btn{font:inherit;padding:0.35rem 0.7rem;background:var(--surface);color:var(--text);' +
      'border:1px solid var(--border);border-radius:4px;cursor:pointer;}' +
      '.gcm-btn:hover{border-color:var(--accent);}' +
      // full-bleed map stage (interactive only); embeds keep a plain block canvas sized by state.size
      '.gcm-wrap{display:flex;flex-direction:column;gap:0.5rem;width:100%;max-width:min(100%,82vh);}' +   // vertical stack: toolbar, the square map, then the ⚙ settings block — all the SAME (map) width
      '.gcm-stage{position:relative;}' +
      '.gcm-stage.gcm-interactive{width:100%;aspect-ratio:1/1;}' +   // full-width square (the wrap caps the width); the toolbar sits above it
      '.gcm-canvas{display:block;background:transparent;border:1px solid var(--border);border-radius:6px;touch-action:none;cursor:grab;}' +
      '.gcm-canvas:active{cursor:grabbing;}' +
      '.gcm-interactive .gcm-canvas{position:absolute;inset:0;width:100%;height:100%;}' +
      // ⚙ settings live BELOW the map as a collapsible block (the toggle bar + the panel), NOT as an
      // overlay — so opening them never covers the canvas you're adjusting, and never blanks a phone-sized map.
      '.gcm-gear{display:inline-flex;align-items:center;gap:0.4rem;margin-top:0.6rem;font-size:0.95rem;}' +
      '.gcm-panel{width:100%;margin-top:0.5rem;' +
      'background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.8rem 0.95rem;}' +
      '.gcm-panel.gcm-hidden{display:none;}' +
      '.gcm-panelhead{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:0.6rem;}' +
      '.gcm-paneltitle{font-size:0.74rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--muted);font-weight:600;}' +
      '.gcm-panelclose{padding:0.15rem 0.5rem;line-height:1;}' +
      '.gcm-toolbar{display:flex;flex-direction:column;gap:0.4rem;width:100%;}' +   // two stacked rows ABOVE the map: selectors, then view controls
      '.gcm-toolrow{display:flex;align-items:center;flex-wrap:wrap;gap:0.4rem 0.9rem;width:100%;}' +
      '.gcm-toolfield{display:inline-flex;align-items:center;gap:0.3rem;font-size:0.85rem;color:var(--muted);}' +   // "Projection:" / "Hemisphere:" labelled select
      '.gcm-toolgroup{display:flex;align-items:center;gap:0.35rem;}' +
      '.gcm-toolright{margin-left:auto;}' +   // actions pinned right; the flex gap between the groups absorbs the live-checkbox show/hide so nothing else shifts
      '.gcm-compass svg{display:block;}' +
      '.gcm-toolbar select{font:inherit;padding:0.3rem 0.45rem;max-width:11rem;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;cursor:pointer;}' +
      '.gcm-zbtns{display:flex;align-items:center;gap:0.3rem;}' +
      '.gcm-zbtns .gcm-zoombtn{width:2.4rem;}' +
      '.gcm-railbtn{white-space:nowrap;}' +
      '.gcm-compass{display:flex;cursor:pointer;}' +
      '.gcm-compass:hover{opacity:0.82;}' +
      '.gcm-zoombtn{height:2.2rem;text-align:center;padding:0;font-size:1.2rem;line-height:1;}' +
      '.gcm-zoom-readout{text-align:center;font-size:0.8rem;color:var(--muted);font-variant-numeric:tabular-nums;background:var(--surface);border-radius:4px;padding:0 0.3rem;}' +
      '.gcm-dial .gcm-zoombtn{min-width:2.2rem;padding:0 0.35rem;}' +
      '.gcm-orient-readout{min-width:7rem;white-space:nowrap;text-align:center;font-size:0.85rem;color:var(--muted);font-variant-numeric:tabular-nums;}' +
      '.gcm-northup,.gcm-northlive{display:inline-flex;align-items:center;gap:0.15rem;font-size:0.78rem;color:var(--muted);}' +
      '.gcm-northlive{background:var(--surface);border-radius:4px;padding:0 0.25rem;}' +
      '.gcm-zoombtn:disabled{opacity:0.4;cursor:default;}' +
      '.gcm-err{color:#d9534f;font-size:0.85rem;}';
    document.head.appendChild(s);
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function createWorldMap(opts) {
    opts = opts || {};
    var instanceId = ++WORLDMAP_UID;
    var cfg = root.PROJECTION_CONFIG;
    // PAGE policy (preset route groups + initial control state) is NOT in the shared engine config —
    // the consumer passes it in: maps-projections supplies opts.presets / opts.uiDefaults from its
    // own great-circle.js. (cfg.routes / cfg.defaults are accepted as a legacy fallback only.)
    var presets = opts.presets || cfg.routes || {};
    var uiDefaults = opts.uiDefaults || cfg.defaults || {};
    // Static region-disc overlays: each {lat, lon, radiusKm|defaultRadiusKm} is drawn as the image,
    // on THIS framing, of the exact Web-Mercator crop the Region Map Explorer shows (PROJ.mercatorDisc).
    // Outline only. The {defaultRadiusKm} alias lets the Region Explorer's region list pass straight through.
    var regions = opts.regions || [];
    // Optional lazy data sources: {terrain:url, regions:url}. When given, the heavy data globals
    // are NOT shipped up-front — they're fetched on first toggle-on so the UI/basemap load fast. Absent →
    // the layer just no-ops until its global is present (e.g. eager <script>, or never).
    // `terrain` serves BOTH the Ocean-depth and Land-elevation toggles (one combined
    // WORLD_TERRAIN_GRID file — see scripts/make_terrain_grid.py).
    var lazyLayers = opts.lazyLayers || {};
    var onRegionClick = typeof opts.onRegionClick === 'function' ? opts.onRegionClick : null;   // click a disc's area → callback(region)
    var disablePan = !!opts.disablePan;                                                          // skip drag-to-pan (used by the static Region overview)
    var lastRegionPolys = [];                                                                    // each region's px-space outline from the last draw(), for click hit-testing
    var cities = opts.cities && opts.cities.world ? opts.cities : null;                            // world/lived city-dot lists (Great Circle Mapper only)
    var lastCityDots = [];                                                                         // each drawn city dot's px {x,y,label}, for hover hit-testing
    var mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    if (!mount) throw new Error('createWorldMap: mount not found');
    injectStyles();
    var showControls = opts.controls !== false;
    var state = {
      coordinate: opts.coordinate || cfg.default_coordinate,
      projection: opts.projection || cfg.default_projection,
      boundaries: opts.boundaries != null ? opts.boundaries : !!uiDefaults.boundaries,
      bathymetry: opts.bathymetry != null ? opts.bathymetry : !!uiDefaults.bathymetry,   // ocean-depth tint bands (WORLD_TERRAIN_GRID codes 0..11)
      topography: opts.topography != null ? opts.topography : !!uiDefaults.topography,    // land elevation shade bands (WORLD_TERRAIN_GRID codes 16..)
      regions: opts.regions != null ? opts.regions : !!uiDefaults.regions,                // UN-subregion 4-colour shading (WORLD_UN_REGIONS); mutually exclusive with topography (both shade land)
      mercatorEdge: opts.mercatorEdge != null ? opts.mercatorEdge : !!uiDefaults.mercator_edge,   // STANDARD Web Mercator's ±85.05° limit: cut the GEOGRAPHIC polar caps out of Hǎo/Winkel; band the equatorial-Mercator clamp
      mercatorEdgeGen: opts.mercatorEdgeGen != null ? opts.mercatorEdgeGen : !!uiDefaults.mercator_edge_gen,   // the OBLIQUE Mercator's own ±85.05° limit (GENERALIZED poles) — separate toggle; band on the Mercator projection's clamp, cut out on Hǎo/Winkel
      edges: !!opts.edges,                                // overlay the Hǎo Northern & Southern map edges (seam half-meridians) as geographic curves
      middleLine: !!opts.middleLine,                      // draw the central meridian (the straight middle axis a centred route lies on) at graticule weight
      flightMode: opts.flightMode || uiDefaults.flight_paths || 'selected',
      routeGroup: presets.default_group || '',            // '' → dropdown rests on "(none)" = no flights
      freeRoutes: opts.routes || [], freePoints: [],
      size: opts.size || DEFAULT_SIZE,
      detail: opts.detail || uiDefaults.detail || 'fine',   // fine (50m) | coarse (110m)
      orientation: normalizeOrient(opts.orientation),   // fixed-dial rotation in degrees, multiple of 15 (pure rotation, never a flip)
      orientMode: opts.northUp ? 'north' : 'fixed',      // fixed (manual dial) | north (dynamic: keep local north at the view centre up)
      northLive: !!opts.northLive,                       // north mode: re-orient live during drag (default off → settle on release)
      _theta: -normalizeOrient(opts.orientation) * Math.PI / 180,  // applied rotation (radians); recomputed each render in north mode
      zoom: 1, cx: null, cy: null,   // projected coords shown at the canvas centre (null → init to the projection centre); rotation/zoom pivot here
      centreOverride: null,          // {lat,lon}: a custom vertical-framing centre (from "Centre on arc"); overrides the preset hemisphere
      centreArc: null                // [codeA, codeB]: the arc we re-centred on, drawn straight down the middle
    };
    state.cityLayer = cities ? (opts.cityLayer || uiDefaults.city_layer || 'none') : 'none';   // 'none' | 'world' | 'lived' (mutually-exclusive city-dot layers)
    state.hoverCity = null;                                                                    // label of the hovered city dot (shown as a tooltip)
    var DEFAULT_ORIENT = state.orientation, DEFAULT_MODE = state.orientMode;   // page-load orientation, restored by Reset
    if (opts.centreArc && opts.centreArc.length === 2) {                 // embed/init: centre on an arc so it runs straight down the middle
      var _a = root.WORLD_AIRPORTS[opts.centreArc[0].toUpperCase()], _b = root.WORLD_AIRPORTS[opts.centreArc[1].toUpperCase()];
      if (_a && _b) { var _c = PROJ.centreForStraightLine([_a[0], _a[1]], [_b[0], _b[1]]); if (_c) { state.centreOverride = _c; state.centreArc = [opts.centreArc[0].toUpperCase(), opts.centreArc[1].toUpperCase()]; } }
    } else if (opts.centre) { state.centreOverride = opts.centre; }       // or a direct {lat,lon} centre

    var canvas = el('canvas', 'gcm-canvas');
    var ctx = canvas.getContext('2d');
    var freeWrap, errSpan, zoomReadout, orientReadout, selectedWrap, syncOrientUI = function () {}, syncOrientPresets = function () {}, orientSel, lastScale = 1, compassEl, compassNeedle, compassCircle, liveLab, liveChk, latBox, lonBox;

    if (showControls) {
      var controls = el('div', 'gcm-controls');
      // PROJECTION + HEMISPHERE are promoted to the TOOLBAR (built below as compact dropdowns) — they're
      // the headline "what map am I looking at" controls, so they're not buried in this panel.
      // LAYERS — detail + the overlays toggled on the basemap (Size px control is gone; the map is full-bleed)
      controls.appendChild(layersGroup());
      // ROUTES — a preset group AND your own additive paths
      var flightGroup = el('fieldset', 'gcm-group gcm-flightgroup');     // a preset group AND custom routes can be shown together (custom is additive)
      flightGroup.appendChild(el('span', 'gcm-legend', 'Airports / flight paths'));
      var flightOpts = el('div', 'gcm-opts');

      selectedWrap = el('span', 'gcm-routesel');                         // preset route-group dropdown
      var groupSel = el('select');
      var noneOpt = document.createElement('option'); noneOpt.value = ''; noneOpt.textContent = 'Preset routes…';   // resting state = no preset (custom can still add)
      if (!state.routeGroup) noneOpt.selected = true; groupSel.appendChild(noneOpt);
      var optgroups = {}, catOrder = [];                                 // group options under <optgroup> headers by `category`
      ((presets && presets.groups) || []).forEach(function (g) {
        var cat = g.category || 'Other';
        if (!optgroups[cat]) { optgroups[cat] = document.createElement('optgroup'); optgroups[cat].label = cat; catOrder.push(cat); }
        var o = document.createElement('option'); o.value = g.id; o.textContent = g.label;
        if (g.id === state.routeGroup) o.selected = true; optgroups[cat].appendChild(o);
      });
      catOrder.forEach(function (cat) { groupSel.appendChild(optgroups[cat]); });
      groupSel.addEventListener('change', function () { state.routeGroup = groupSel.value; render(); });
      selectedWrap.appendChild(groupSel);

      freeWrap = el('span', 'gcm-routefree'); freeWrap.style.flex = '1 1 16rem';   // custom routes ADDED on top of the selected preset; grows to fill the row
      var input = el('input'); input.type = 'text'; input.placeholder = '+ add your own: NRT, PEK-JFK, LHR-HND-SIN';
      var drawBtn = el('button', 'gcm-btn', 'Add'); errSpan = el('span', 'gcm-err');
      function applyFree() { var r = parseRoutes(input.value); state.freeRoutes = r.routes; state.freePoints = r.points; errSpan.textContent = r.errors.length ? 'Unknown: ' + r.errors.join(', ') : ''; render(); }
      drawBtn.addEventListener('click', applyFree);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyFree(); });
      freeWrap.appendChild(input); freeWrap.appendChild(drawBtn);

      flightOpts.appendChild(selectedWrap); flightOpts.appendChild(freeWrap); flightOpts.appendChild(errSpan);   // dropdown + custom box shown together
      flightGroup.appendChild(flightOpts);
      controls.appendChild(flightGroup);

      // ORIENTATION — dial + region presets (north-up lock lives on the compass in the rail)
      controls.appendChild(orientationGroup());

      var centreGroup = el('fieldset', 'gcm-group gcm-flightgroup');      // CENTRE: from an arc (two airport codes) OR typed directly as lat/lon
      centreGroup.appendChild(el('span', 'gcm-legend', 'Centre'));
      var centreOpts = el('div', 'gcm-opts'), centreErr = el('span', 'gcm-err');
      var codeStyle = 'font:inherit;width:4.2rem;padding:0.35rem 0.5rem;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;text-transform:uppercase;';
      var numStyle = 'font:inherit;width:5rem;padding:0.35rem 0.5rem;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;';
      var box1 = el('input'), box2 = el('input');
      box1.type = box2.type = 'text'; box1.maxLength = box2.maxLength = 3; box1.placeholder = box2.placeholder = 'AAA';
      box1.style.cssText = box2.style.cssText = codeStyle;
      var centreBtn = el('button', 'gcm-btn', 'Centre!');
      latBox = el('input'); lonBox = el('input'); latBox.type = lonBox.type = 'text';
      latBox.style.cssText = lonBox.style.cssText = numStyle; latBox.title = 'centre latitude °  (+ = N)'; lonBox.title = 'centre longitude °  (+ = E)';
      function clearCodes() { if (box1) box1.value = ''; if (box2) box2.value = ''; }
      function doCentre() {                                              // airport codes → straightening centre, written into the lat/lon boxes
        var a = box1.value.trim().toUpperCase(), b = box2.value.trim().toUpperCase(), AIR = root.WORLD_AIRPORTS;
        var A = AIR[a], B = AIR[b], bad = [];
        if (!A) bad.push(a || '(empty)'); if (!B) bad.push(b || '(empty)');
        if (bad.length) { centreErr.textContent = 'Unknown: ' + bad.join(', '); return; }
        var c = PROJ.centreForStraightLine([A[0], A[1]], [B[0], B[1]]);
        if (!c) { centreErr.textContent = 'No unique great circle (identical or antipodal points).'; return; }
        centreErr.textContent = ''; state.centreOverride = c; state.centreArc = [a, b];
        updateCentreBoxes(); resetView(); render();
      }
      function applyManualCentre() {                                     // typed lat/lon → custom centre; drops any arc and clears the airport boxes
        var la = parseFloat(latBox.value), lo = parseFloat(lonBox.value);
        if (isNaN(la) || isNaN(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) { centreErr.textContent = 'centre needs lat ∈ [−90,90], lon ∈ [−180,180]'; return; }
        centreErr.textContent = ''; state.centreOverride = { lat: la, lon: lo }; state.centreArc = null; clearCodes();
        updateCentreBoxes(); render();   // keep the current zoom/pan — nudging the centre shouldn't reset the view
      }
      centreBtn.addEventListener('click', doCentre);
      box1.addEventListener('keydown', function (e) { if (e.key === 'Enter') doCentre(); });
      box2.addEventListener('keydown', function (e) { if (e.key === 'Enter') doCentre(); });
      latBox.addEventListener('change', applyManualCentre); lonBox.addEventListener('change', applyManualCentre);
      latBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyManualCentre(); });
      lonBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyManualCentre(); });
      centreOpts.appendChild(box1); centreOpts.appendChild(el('span', null, '–')); centreOpts.appendChild(box2); centreOpts.appendChild(centreBtn);
      centreOpts.appendChild(el('span', null, ' · lat')); centreOpts.appendChild(latBox); centreOpts.appendChild(el('span', null, 'lon')); centreOpts.appendChild(lonBox);
      centreOpts.appendChild(centreErr);
      centreGroup.appendChild(centreOpts); controls.appendChild(centreGroup);
      updateCentreBoxes();                                               // show the starting framing's centre immediately

      // EXPORT — Save PNG lives here (a panel action), not in the toolbar: it's an occasional export, not
      // a primary view control. The serious export path is the offline Node port → Personal Works/maps/.
      var exportGroup = el('fieldset', 'gcm-group'); exportGroup.appendChild(el('span', 'gcm-legend', 'Export'));
      var save = el('button', 'gcm-btn', 'Save PNG'); save.title = 'Download the current map as a lossless 2× PNG'; save.addEventListener('click', savePng);
      exportGroup.appendChild(save); controls.appendChild(exportGroup);

    }

    var stage = el('div', 'gcm-stage' + (showControls ? ' gcm-interactive' : ''));
    stage.appendChild(canvas);
    if (showControls) {
      // ⚙ settings: a collapsible block stacked BELOW the map (appended to the mount after the wrap,
      // not inside the stage), so opening it never covers the canvas. The toggle bar stays visible and
      // its caret reflects open/closed; the choice is remembered across visits.
      var gearBtn = el('button', 'gcm-btn gcm-gear'); gearBtn.title = 'Show/hide map settings';
      var panel = el('div', 'gcm-panel');
      var phead = el('div', 'gcm-panelhead');
      phead.appendChild(el('span', 'gcm-paneltitle', 'Map settings'));
      var pclose = el('button', 'gcm-btn gcm-panelclose', '✕'); pclose.title = 'Close settings';
      phead.appendChild(pclose); panel.appendChild(phead); panel.appendChild(controls);
      function setPanel(open) { panel.classList.toggle('gcm-hidden', !open); gearBtn.innerHTML = '⚙ Map settings ' + (open ? '▾' : '▸'); try { localStorage.setItem('gcmPanelOpen', open ? '1' : '0'); } catch (e) {} }
      gearBtn.addEventListener('click', function () { setPanel(panel.classList.contains('gcm-hidden')); });   // toggle open ↔ closed
      pclose.addEventListener('click', function () { setPanel(false); });
      var open0 = true; try { if (localStorage.getItem('gcmPanelOpen') === '0') open0 = false; } catch (e) {}
      setPanel(open0);

      // always-visible toolbar ABOVE the map: zoom (− / readout / +) + compass (north-up) + live on the
      // LEFT (the "view tools"), Reset / Save PNG pinned RIGHT (the "actions"). `live` is the LAST item of
      // the left group — at the inner edge by the flex gap — so toggling it only resizes the gap; the
      // compass and zoom never move.
      var toolbar = el('div', 'gcm-toolbar');
      compassEl = el('div', 'gcm-compass');
      compassEl.innerHTML = '<svg width="48" height="48" viewBox="-28 -28 56 56" aria-label="compass: needle points to north">'
        + '<circle r="18" fill="#fff" stroke="#bbb" stroke-width="1"/>'
        + '<g class="gcm-needle">'
        + '<polygon points="0,-14 4,1 -4,1" fill="#c0392b"/>'           // north half (red), tip up by default
        + '<polygon points="0,14 4,-1 -4,-1" fill="#9aa0a6"/>'          // south half (grey)
        + '<text x="0" y="-20" text-anchor="middle" font-size="8.5" font-weight="bold" fill="#c0392b">N</text>'  // just outside the bezel at the north tip (viewBox padded so it never clips)
        + '</g></svg>';
      compassNeedle = compassEl.querySelector('.gcm-needle');
      compassCircle = compassEl.querySelector('circle');
      compassEl.title = 'Click to lock north up';
      compassEl.addEventListener('click', function () {                  // compass IS the north-up toggle: click to lock, click again to unlock
        state.orientMode = state.orientMode === 'north' ? 'fixed' : 'north';
        if (orientSel) orientSel.value = '';                             // north-up isn't a region preset → clear the dropdown
        syncOrientUI(); render();
      });
      liveLab = el('label', 'gcm-northlive');                            // shown only when locked: live re-orient during drag vs settle on release
      liveChk = el('input'); liveChk.type = 'checkbox'; liveChk.checked = state.northLive;
      liveChk.addEventListener('change', function () { state.northLive = liveChk.checked; render(); });
      liveLab.appendChild(liveChk); liveLab.appendChild(document.createTextNode('live'));
      liveLab.title = 'Re-orient north live while dragging (off = settle on release)';
      var zbtns = el('div', 'gcm-zbtns');
      var zin = el('button', 'gcm-btn gcm-zoombtn', '+'); zin.title = 'Zoom in';
      var zout = el('button', 'gcm-btn gcm-zoombtn', '−'); zout.title = 'Zoom out';
      zoomReadout = el('span', 'gcm-zoom-readout', '100%');
      zin.addEventListener('click', function () { stepZoom(1); });
      zout.addEventListener('click', function () { stepZoom(-1); });
      zbtns.appendChild(zout); zbtns.appendChild(zoomReadout); zbtns.appendChild(zin);   // − 100% + (readout flanked by the buttons)
      var reset = el('button', 'gcm-btn gcm-railbtn', 'Reset'); reset.title = 'Back to 100%, preset centre & original orientation';
      reset.addEventListener('click', function () {
        state.centreOverride = null; state.centreArc = null;
        state.orientation = DEFAULT_ORIENT; state.orientMode = DEFAULT_MODE; state._theta = -DEFAULT_ORIENT * Math.PI / 180;   // restore the page-load orientation
        if (orientSel) orientSel.value = '';
        updateCentreBoxes(); syncOrientPresets(); syncOrientUI(); resetView(); render();
      });
      // Headline "what map" controls, promoted from the panel to the toolbar as compact dropdowns.
      function toolSelect(items, sel, title, onchange) {
        var s = el('select'); s.title = title;
        items.forEach(function (it) { var o = document.createElement('option'); o.value = it.id; o.textContent = it.label; if (it.id === sel) o.selected = true; s.appendChild(o); });
        s.addEventListener('change', function () { onchange(s.value); });
        return s;
      }
      var projSel = toolSelect(cfg.projections.map(idLabel), state.projection, 'Projection', function (v) { state.projection = v; resetView(); render(); });
      var hemiSel = toolSelect(cfg.coordinates.map(idLabel), state.coordinate, 'Which hemisphere the map is framed on', function (v) { state.coordinate = v; state.centreOverride = null; state.centreArc = null; updateCentreBoxes(); syncOrientPresets(); resetView(); render(); });
      function toolField(text, sel) { var f = el('label', 'gcm-toolfield'); f.appendChild(document.createTextNode(text)); f.appendChild(sel); return f; }
      // ROW 1 — "what map am I looking at": labelled Projection + Hemisphere selectors.
      var selRow = el('div', 'gcm-toolrow');
      selRow.appendChild(toolField('Projection:', projSel)); selRow.appendChild(toolField('Hemisphere:', hemiSel));
      // ROW 2 — "adjust the view": zoom + compass on the LEFT (live LAST = inner edge, so toggling it shifts
      // nothing), Reset pinned RIGHT. Save PNG lives in the panel.
      var ctrlRow = el('div', 'gcm-toolrow');
      var toolLeft = el('div', 'gcm-toolgroup'); toolLeft.appendChild(zbtns); toolLeft.appendChild(compassEl); toolLeft.appendChild(liveLab);
      var toolRight = el('div', 'gcm-toolgroup gcm-toolright'); toolRight.appendChild(reset);
      ctrlRow.appendChild(toolLeft); ctrlRow.appendChild(toolRight);
      toolbar.appendChild(selRow); toolbar.appendChild(ctrlRow);
      syncOrientUI();                                                     // set the "live" checkbox's initial visibility now that it exists
    }
    if (showControls) {                                                  // vertical stack: toolbar, the square map, then the ⚙ settings block — all the map's width, nothing overlaps
      var wrap = el('div', 'gcm-wrap');
      wrap.appendChild(toolbar); wrap.appendChild(stage); wrap.appendChild(gearBtn); wrap.appendChild(panel);
      mount.appendChild(wrap);
    } else {
      mount.appendChild(stage);                                          // embed: just the square canvas, no rail
      // Reserve the box at the default size NOW (before the deferred first render) so the page
      // doesn't reflow when the map later fills in. render() recomputes the exact size; on a
      // container at least this wide that's identical, so there's no shift. (The interactive
      // stage reserves itself via its aspect-ratio CSS, so this is only needed for embeds.)
      canvas.style.width = canvas.style.height = state.size + 'px';
      canvas.style.maxWidth = '100%';
    }

    function idLabel(o) { return { id: o.id, label: o.label }; }
    function syncFlightUI() { }   // preset dropdown and custom box are both always visible now (custom is additive)

    function checkboxGroup(legend, label, checked, onchange) {
      var g = el('fieldset', 'gcm-group'); g.appendChild(el('span', 'gcm-legend', legend));
      var lab = el('label'); var c = el('input'); c.type = 'checkbox'; c.checked = checked;
      c.addEventListener('change', function () { onchange(c.checked); });
      lab.appendChild(c); lab.appendChild(document.createTextNode(label)); g.appendChild(lab); return g;
    }
    function layersGroup() {                                          // detail resolution + the basemap overlay toggles, merged into one "Layers" group
      var g = el('fieldset', 'gcm-group'); g.appendChild(el('span', 'gcm-legend', 'Layers'));
      var opts = el('div', 'gcm-opts');
      function radio(val, text) {
        var lab = el('label'); var r = el('input'); r.type = 'radio'; r.name = 'detail-' + instanceId; r.value = val; r.checked = (state.detail === val);
        r.addEventListener('change', function () { if (r.checked) { state.detail = val; render(); } });
        lab.appendChild(r); lab.appendChild(document.createTextNode(text)); opts.appendChild(lab);
      }
      function check(text, on, fn) {
        var lab = el('label'); var c = el('input'); c.type = 'checkbox'; c.checked = on;
        c.addEventListener('change', function () { fn(c.checked); }); lab.appendChild(c); lab.appendChild(document.createTextNode(text)); opts.appendChild(lab);
        return c;
      }
      var topoChk, regionChk;
      radio('coarse', 'Coarse'); radio('fine', 'Fine'); opts.appendChild(el('span', null, '·'));
      check('Countries', state.boundaries, function (v) { state.boundaries = v; render(); });
      check('Ocean depth', state.bathymetry, function (v) { state.bathymetry = v; render(); });   // texture bake is scheduled from the draw path (usually pre-warmed already)
      // Land elevation and UN regions both shade the land, so they're MUTUALLY EXCLUSIVE: turning one on
      // turns the other off (and unticks its box).
      topoChk = check('Land elevation', state.topography, function (v) {
        state.topography = v;
        if (v) { state.regions = false; if (regionChk) regionChk.checked = false; render(); }
        else render();
      });
      regionChk = check('World regions', state.regions, function (v) {
        state.regions = v;
        if (v) { state.topography = false; if (topoChk) topoChk.checked = false; ensureLayer('WORLD_UN_REGIONS', lazyLayers.regions, function (fresh) { if (fresh) geomKey = ''; render(); }); }
        else render();
      });
      check('N/S seam belts', state.edges, function (v) { state.edges = v; render(); });
      check('Mercator limit (poles)', state.mercatorEdge, function (v) { state.mercatorEdge = v; render(); });
      check('Mercator limit (gen. poles)', state.mercatorEdgeGen, function (v) { state.mercatorEdgeGen = v; render(); });
      check('Central axis', state.middleLine, function (v) { state.middleLine = v; render(); });
      if (cities) {                                                   // city-dot layers: World cities (49 GaWC) + Lived-in (4), MUTUALLY EXCLUSIVE; name on hover
        var worldChk, livedChk;
        worldChk = check('World cities', state.cityLayer === 'world', function (v) { state.cityLayer = v ? 'world' : 'none'; if (v && livedChk) livedChk.checked = false; render(); });
        livedChk = check('Lived-in cities', state.cityLayer === 'lived', function (v) { state.cityLayer = v ? 'lived' : 'none'; if (v && worldChk) worldChk.checked = false; render(); });
      }
      g.appendChild(opts); return g;
    }
    function normalizeOrient(o) {                                     // -> degrees, multiple of 15, in [0,360)
      if (o == null || o === 'top') return 0;
      if (o === 'bottom') return 180;
      var n = parseFloat(o); if (!isFinite(n)) return 0;
      return ((Math.round(n / 15) * 15) % 360 + 360) % 360;
    }
    function updateOrientReadout() {
      if (!orientReadout) return;
      if (state.orientMode === 'north') { orientReadout.textContent = 'north up'; return; }
      var d = state.orientation;
      orientReadout.textContent = d + '°' + (d === 0 ? ' (top)' : (d === 180 ? ' (bottom)' : ''));
    }
    function orientationGroup() {                                     // fixed dial (15° steps; 0°=top, 180°=bottom) OR dynamic North up
      var g = el('fieldset', 'gcm-group'); g.appendChild(el('span', 'gcm-legend', 'Orientation'));
      var opts = el('div', 'gcm-opts gcm-dial');
      var dec = el('button', 'gcm-btn gcm-zoombtn', '↺'); dec.title = 'Rotate counter-clockwise 15°';
      orientReadout = el('span', 'gcm-orient-readout');
      var inc = el('button', 'gcm-btn gcm-zoombtn', '↻'); inc.title = 'Rotate clockwise 15°';
      var flip = el('button', 'gcm-btn gcm-zoombtn', '180°'); flip.title = 'Rotate 180°';
      function step(deg) { if (state.orientMode === 'north') return; state.orientation = ((state.orientation + deg) % 360 + 360) % 360; if (orientSel) orientSel.value = ''; updateOrientReadout(); render(); }   // manual rotate ≠ a region preset → clear the dropdown
      dec.addEventListener('click', function () { step(-15); });      // ↺ counts the readout down (345…); ↻ counts up (15…)
      inc.addEventListener('click', function () { step(15); });
      flip.addEventListener('click', function () { step(180); });
      opts.appendChild(dec); opts.appendChild(orientReadout); opts.appendChild(inc); opts.appendChild(flip);
      orientSel = el('select'); orientSel.title = 'Snap the rotation so a region sits at the top';   // quick-orient: pick a region to put at the top
      syncOrientPresets = function () {                                  // populate per focused hemisphere (empty for Eastern/Western)
        orientSel.innerHTML = ''; var def = document.createElement('option'); def.value = ''; def.textContent = 'Put region up…'; orientSel.appendChild(def);
        var presets = ORIENT_PRESETS[state.coordinate] || [];
        presets.forEach(function (r) { var o = document.createElement('option'); o.value = r[1]; o.textContent = r[0]; orientSel.appendChild(o); });
        orientSel.disabled = presets.length === 0;
      };
      orientSel.addEventListener('change', function () {
        if (orientSel.value === '') return;
        state.orientMode = 'fixed'; state.orientation = normalizeOrient(parseFloat(orientSel.value));   // a region preset is a fixed angle → leave north-lock
        syncOrientUI(); render();                                        // keep the chosen region showing in the dropdown
      });
      syncOrientPresets(); opts.appendChild(orientSel);
      // North up (and its "live" toggle) live in the right rail beside the compass, not here.
      syncOrientUI = function () {
        var on = state.orientMode === 'north';
        dec.disabled = on; inc.disabled = on; flip.disabled = on;
        if (liveLab) { liveLab.style.display = on ? '' : 'none'; if (liveChk) liveChk.checked = state.northLive; }   // display:none (not visibility) — live is at the left group's inner edge, so hiding it just shrinks the gap; nothing else shifts
        updateOrientReadout(); updateCompass();
      };
      g.appendChild(opts); syncOrientUI(); return g;
    }
    function viewGroup() {
      var g = el('fieldset', 'gcm-group'); g.appendChild(el('span', 'gcm-legend', 'View'));
      var opts = el('div', 'gcm-opts');
      var sizeLab = el('label'); sizeLab.appendChild(document.createTextNode('Size (px) '));
      var sizeIn = el('input'); sizeIn.type = 'number'; sizeIn.value = state.size; sizeIn.min = 50; sizeIn.max = 2000; sizeIn.step = 10;
      sizeIn.addEventListener('change', function () { var v = parseInt(sizeIn.value, 10); if (isFinite(v)) { state.size = Math.max(50, Math.min(2000, v)); render(); } });
      sizeLab.appendChild(sizeIn); opts.appendChild(sizeLab);
      g.appendChild(opts); return g;
    }
    function stepZoom(dir) {                                          // move to the next/prev round stop
      var idx = 0, best = Infinity;
      for (var i = 0; i < ZOOM_LEVELS.length; i++) { var d = Math.abs(ZOOM_LEVELS[i] - state.zoom); if (d < best) { best = d; idx = i; } }
      setZoom(ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + dir))]);
    }
    function setZoom(z) {
      if (z < 1) z = 1;
      state.zoom = z; updateZoomReadout(); render();                  // zoom pivots on the centre point automatically
    }
    function resetView() { state.zoom = 1; state.cx = null; state.cy = null; updateZoomReadout(); }   // size + centre only — orientation mode/angle are left as the user set them
    // The framing in effect: a custom vertical centre (from "Centre on arc") if set, else the preset hemisphere.
    var _customCoord = null;
    function activeCoord() {
      if (state.centreOverride) {
        if (!_customCoord || _customCoord.centre !== state.centreOverride) _customCoord = { id: 'custom', kind: 'vertical', centre: state.centreOverride };
        return _customCoord;
      }
      return PROJ.coordById(state.coordinate);
    }
    function coordKey() { return state.centreOverride ? ('C' + state.centreOverride.lat.toFixed(3) + ',' + state.centreOverride.lon.toFixed(3)) : state.coordinate; }
    function updateCentreBoxes() {                                        // mirror the active framing's centre into the editable lat/lon boxes (blank for seam-based horizontal framings)
      if (!latBox || !lonBox) return;
      var c = activeCoord();
      if (c.kind === 'vertical' && c.centre) { latBox.value = (+c.centre.lat).toFixed(1); lonBox.value = (+c.centre.lon).toFixed(1); }
      else { latBox.value = ''; lonBox.value = ''; }
    }
    function updateZoomReadout() { if (zoomReadout) zoomReadout.textContent = Math.round(state.zoom * 100) + '%'; }

    function parseRoutes(text) {
      var routes = [], points = [], errors = [];
      (text || '').split(',').forEach(function (seg) {
        var parts = seg.trim().split(/[\s>\-]+/).filter(Boolean).map(function (s) { return s.toUpperCase(); });
        parts.forEach(function (code) { if (!(code.length === 3 && root.WORLD_AIRPORTS[code]) && errors.indexOf(code) < 0) errors.push(code); });
        if (parts.length === 1) {                                        // a lone code (no dash) → just label that airport, no arc
          if (root.WORLD_AIRPORTS[parts[0]] && points.indexOf(parts[0]) < 0) points.push(parts[0]);
        } else {
          for (var i = 0; i + 1 < parts.length; i++) { if (root.WORLD_AIRPORTS[parts[i]] && root.WORLD_AIRPORTS[parts[i + 1]]) routes.push([parts[i], parts[i + 1]]); }
        }
      });
      return { routes: routes, points: points, errors: errors };
    }
    function groupById(id) { return ((presets && presets.groups) || []).filter(function (x) { return x.id === id; })[0]; }
    function groupSpec(g) {                                              // a group's routes/points; `routes` may be a text-box-grammar STRING or a legacy [[a,b],…] array
      if (!g) return { routes: [], points: [] };
      if (typeof g.routes === 'string') { var p = parseRoutes(g.routes); return { routes: p.routes, points: p.points }; }
      return { routes: g.routes || [], points: g.points || [] };
    }
    function activeRoutes() {                                            // selected preset group AND custom routes together (custom is additive, not a replacement)
      if (!showControls) return opts.routes || [];
      return groupSpec(groupById(state.routeGroup)).routes.concat(state.freeRoutes || []);   // "(none)"/no match → []
    }
    function activePoints() {                                            // lone airports to mark (no arc) — preset group + custom, combined
      if (!showControls) return opts.points || [];
      return groupSpec(groupById(state.routeGroup)).points.concat(state.freePoints || []);
    }
    function endpoint(code) { if (Array.isArray(code)) return code; var a = root.WORLD_AIRPORTS[code]; return a ? [a[0], a[1]] : null; }

    // ---- fit + draw -------------------------------------------------------
    function orientationAngle() {                                         // map-space rotation (radians); a pure rotation, never a flip
      return state.orientMode === 'north' ? state._theta : -state.orientation * Math.PI / 180;   // negate so ↻ (readout counts up) turns the map clockwise on screen
    }
    // Dynamic "North up": rotate so the LOCAL north at the point under the canvas centre points up.
    // Local north varies across an oblique map, so this re-rotates as you pan. We precompute a
    // per-coordinate/projection field of (projected x, y, north-screen-angle) sampled on a grid,
    // then look up the nearest sample to the centre point each render.
    var northFields = {};
    function northField() {
      var key = coordKey() + '|' + state.projection;
      if (northFields[key]) return northFields[key];
      var coord = activeCoord(), proj = state.projection, pts = [], lat, lon, p0, p1, a, eps = 0.5;
      for (lat = -88; lat <= 88; lat += 3) {
        for (lon = -180; lon < 180; lon += 3) {
          p0 = PROJ.project(coord, proj, lat, lon); p1 = PROJ.project(coord, proj, lat + eps, lon);
          a = Math.atan2(p1.y - p0.y, p1.x - p0.x); pts.push([p0.x, p0.y, Math.cos(a), Math.sin(a)]);   // store the direction as a unit vector (so it averages without angle-wrap issues)
        }
      }
      northFields[key] = pts; return pts;
    }
    function northAngleAt(field, x, y) {                                  // inverse-distance-weighted mean of the local-north direction — smooth, and exactly 90° at the framing centre (no grid-snap rotation)
      var C = 0, S = 0, i, dx, dy, w;
      for (i = 0; i < field.length; i++) { dx = field[i][0] - x; dy = field[i][1] - y; w = 1 / (dx * dx + dy * dy + 1e-3); C += w * field[i][2]; S += w * field[i][3]; }
      return Math.atan2(S, C);
    }
    function northTargetTheta() { return Math.PI / 2 - northAngleAt(northField(), state.cx, state.cy); }  // θ that puts local north at the centre up
    function updateNorthTheta() {                                         // the centre point is tracked directly (state.cx/cy), so no inverse/iteration needed
      if (state.cx == null) return;
      state._theta = northTargetTheta();
    }
    function animateNorthTo() {                                           // ease _theta to north-up over ~300 ms (used on drag release in locked mode)
      if (state.cx == null) return;
      var start = state._theta, target = northTargetTheta(), d = target - start;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;   // shortest way round
      cancelAnimationFrame(animRaf);
      if (Math.abs(d) < 0.002 || typeof requestAnimationFrame !== 'function') { state._theta = target; animating = false; render(); return; }
      var now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };
      var t0 = now(), dur = 300; animating = true;
      (function frame() {
        var k = Math.min(1, (now() - t0) / dur);
        state._theta = start + d * (1 - Math.pow(1 - k, 3));              // ease-out cubic
        render();
        if (k < 1) animRaf = requestAnimationFrame(frame);
        else { state._theta = target; animating = false; render(); }
      })();
    }
    function updateCompass() {                                            // needle points to geographic north at the view centre; click toggles north-up lock
      if (!compassEl || state.cx == null) return;
      var north = state.orientMode === 'north';
      var aDeg = north ? 0                                                // locked: needle pinned up, even while north is momentarily off during a drag
        : 90 - (northAngleAt(northField(), state.cx, state.cy) + orientationAngle()) * 180 / Math.PI;  // fixed: CSS clockwise rotation toward north
      if (compassNeedle) compassNeedle.setAttribute('transform', 'rotate(' + aDeg.toFixed(1) + ')');
      if (compassCircle) { compassCircle.setAttribute('stroke', north ? '#c0392b' : '#bbb'); compassCircle.setAttribute('stroke-width', north ? '2.5' : '1'); }
      compassEl.title = north ? 'North up locked — click to unlock' : 'Click to lock north up';
    }
    // Geographic curves for the Hǎo Northern & Southern map EDGES (the seam = generalized λ=±180,
    // an open great-circle arc from one pole-point through the apex to the other). Fixed per framing.
    var _seams = null;
    function seams() {
      if (_seams) return _seams;
      function seamGeo(centre) {
        var M = PROJ.rotFromCentre(centre), vc = M[0], vp = M[2], D = Math.PI / 180, lat = [], lon = [], phi, c, s, x, y, z;
        for (phi = -90; phi <= 90; phi += 1) {                           // pole→pole (incl. ±90) so the line meets the generalized-pole dots; geo = −cosφ·vc + sinφ·vp
          c = Math.cos(phi * D); s = Math.sin(phi * D);
          x = -c * vc[0] + s * vp[0]; y = -c * vc[1] + s * vp[1]; z = -c * vc[2] + s * vp[2];
          z = z < -1 ? -1 : (z > 1 ? 1 : z);
          lat.push(Math.asin(z) / D); lon.push(Math.atan2(y, x) / D);
        }
        return { lat: lat, lon: lon };
      }
      var by = {}; ((cfg.coordinates) || []).forEach(function (c) { if (c.kind === 'vertical') by[c.id] = c; });
      _seams = { north: by.north && seamGeo(by.north.centre), south: by.south && seamGeo(by.south.centre) };
      return _seams;
    }
    // A constant-width BELT around each seam centre line (a "conveyor belt"): every point within
    // BELT_HALF degrees of GREAT-CIRCLE distance from the seam, on EACH side (total width 2·BELT_HALF).
    // Because the offset is a true arc distance (measured perpendicular to the seam, along the gen-y
    // axis), the belt never tapers — unlike a fixed gen-longitude band, which narrows toward the poles
    // where meridians converge. Built from two long sides + two rounded pole-end caps (radius BELT_HALF,
    // so the cap reaches gen φ = 90−BELT_HALF); MAPGEO.bandFillPolys ladders each into quads (no boundary
    // closure, so it can never fill the map; the draw step also clips it to the lens).
    var BELT_HALF = 3, _bands = null;                                    // half-width: degrees of ARC on EACH side of the seam — the single tunable knob
    function bands() {
      if (_bands) return _bands;
      var D = Math.PI / 180, half = BELT_HALF, EPS = 0.001;             // sub-pixel inset off the exact seam: avoids the atan2 flip there without a visible centre gap
      function geoOf(M, gx, gy, gz) {                                    // generalized unit vector -> geographic [lat,lon] (geo = M^T · gen)
        var vc = M[0], vy = M[1], vp = M[2];
        var x = gx * vc[0] + gy * vy[0] + gz * vp[0], y = gx * vc[1] + gy * vy[1] + gz * vp[1], z = gx * vc[2] + gy * vy[2] + gz * vp[2];
        z = z < -1 ? -1 : (z > 1 ? 1 : z); return [Math.asin(z) / D, Math.atan2(y, x) / D];
      }
      // Belt point at along-seam position θ∈[−90,90]° and perpendicular arc offset ψ°. The seam
      // meridian (gen λ=180) is ψ=0; the perpendicular runs along the gen-y axis, so ψ is a genuine
      // arc distance for every θ → the width stays constant from pole to pole.
      function beltPt(M, th, psi) {
        var t = th * D, p = psi * D, cp = Math.cos(p), sp = Math.sin(p), ct = Math.cos(t), st = Math.sin(t);
        return geoOf(M, -cp * ct, sp, cp * st);
      }
      function side(M, psiA, psiB) {                                     // one long side of the belt, swept pole→pole at constant offset
        var lonA = [], latA = [], lonB = [], latB = [], th, p;
        for (th = -90; th <= 90; th++) { p = beltPt(M, th, psiA); latA.push(p[0]); lonA.push(p[1]); p = beltPt(M, th, psiB); latB.push(p[0]); lonB.push(p[1]); }
        return { lonA: lonA, latA: latA, lonB: lonB, latB: latB };
      }
      function cap(M, phiA, phiB, lamA, lamB) {                          // rounded pole-end ring (gen parallels phiA→phiB) over the gen-longitude range [lamA,lamB]
        var lonA = [], latA = [], lonB = [], latB = [], lam, lc, p;
        for (lam = lamA; lam <= lamB; lam += 2) {
          lc = lam < -180 + EPS ? -180 + EPS : (lam > 180 - EPS ? 180 - EPS : lam);
          p = geoOf(M, Math.cos(phiA * D) * Math.cos(lc * D), Math.cos(phiA * D) * Math.sin(lc * D), Math.sin(phiA * D)); latA.push(p[0]); lonA.push(p[1]);
          p = geoOf(M, Math.cos(phiB * D) * Math.cos(lc * D), Math.cos(phiB * D) * Math.sin(lc * D), Math.sin(phiB * D)); latB.push(p[0]); lonB.push(p[1]);
        }
        return { lonA: lonA, latA: latA, lonB: lonB, latB: latB };
      }
      // The belt = two long sides + two rounded caps. caps = whole disc (gen λ all); capsOuter = the
      // TIP half only (gen λ∈[−90,90], the side away from the seam). Kept separate so the draw step
      // can layer opacity: strip → +caps (inner half) → +capsOuter (outer half), stepping darker to the tips.
      function frame(centre) {
        var M = PROJ.rotFromCentre(centre), step = Math.max(0.5, half / 4), sides = [side(M, EPS, half), side(M, -half, -EPS)], caps = [], capsOuter = [], t, hi;
        for (t = 90 - half; t < 90 - 1e-9; t += step) { hi = Math.min(t + step, 90); caps.push(cap(M, t, hi, -180, 180)); capsOuter.push(cap(M, t, hi, -90, 90)); }
        for (t = -90; t < -90 + half - 1e-9; t += step) { hi = Math.min(t + step, -90 + half); caps.push(cap(M, t, hi, -180, 180)); capsOuter.push(cap(M, t, hi, -90, 90)); }
        return { sides: sides, caps: caps, capsOuter: capsOuter };
      }
      var by = {}; ((cfg.coordinates) || []).forEach(function (c) { if (c.kind === 'vertical') by[c.id] = c; });
      _bands = { north: by.north && frame(by.north.centre), south: by.south && frame(by.south.centre) };
      return _bands;
    }
    // The framing's central meridian as a geographic curve — the straight MIDDLE axis of the lens
    // (where a centred route lies). Vertical framing: gen-λ=0, the great circle through centre & poles
    // (geo = cosφ·vc + sinφ·vp). Horizontal framing: the meridian at the central longitude.
    function midMeridian(coord) {
      var lat = [], lon = [], a, D = Math.PI / 180;
      if (coord.kind === 'vertical') {
        var M = PROJ.rotFromCentre(coord.centre), vc = M[0], vp = M[2], c, s, x, y, z;
        for (a = -90; a <= 90; a += 1) { c = Math.cos(a * D); s = Math.sin(a * D);
          x = c * vc[0] + s * vp[0]; y = c * vc[1] + s * vp[1]; z = c * vc[2] + s * vp[2];
          z = z < -1 ? -1 : (z > 1 ? 1 : z); lat.push(Math.asin(z) / D); lon.push(Math.atan2(y, x) / D); }
      } else {
        var cm = PROJ.centralOf(coord);
        for (a = -90; a <= 90; a += 1) { lat.push(a); lon.push(cm); }
      }
      return { lat: lat, lon: lon };
    }
    // Web-Mercator coverage cutoff as geographic polylines — framing-independent in geo space (fixed
    // parallels), projected per framing inside geom(). Per hemisphere: the cutoff parallel at
    // ±MERCATOR_MAXLAT (outer, where the line is drawn) and a parallel MERC_BAND° toward the equator
    // (inner) — so the band sits on the COVERED side and its outer edge IS the coverage limit.
    var _mercGeo = null;
    function mercatorGeo() {
      if (_mercGeo) return _mercGeo;
      var maxlat = PROJ.MERCATOR_MAXLAT, lon = lin(-180, 180, 361), n = lon.length, i;
      function hemi(sign) {
        var oLat = [], iLat = [];
        for (i = 0; i < n; i++) { oLat.push(sign * maxlat); iLat.push(sign * (maxlat - MERC_BAND)); }
        return { outerLon: lon, outerLat: oLat, innerLon: lon, innerLat: iLat };
      }
      _mercGeo = { north: hemi(1), south: hemi(-1) };
      return _mercGeo;
    }
    // The clamp band for the MERCATOR projection ITSELF: what THAT Mercator can't show, i.e. the caps
    // around its GENERALIZED poles (the map's own ±MERCATOR_MAXLAT top/bottom edge). For horizontal
    // framings the generalized latitude == geographic latitude, so it's just mercatorGeo(); for the
    // vertical (oblique) framings the cutoff parallels are generalized small-circles, generated here in
    // generalized space and rotated back to geographic coords (geo = Mᵀ·gen) so the shared band
    // machinery can seam-cut + project them like any other ring.
    function mercatorClampGeo(coord) {
      var maxlat = PROJ.MERCATOR_MAXLAT, D = Math.PI / 180, n = 361;
      if (coord.kind !== 'vertical') {
        // Horizontal framings: the perpendicular ("vertical") Mercator's generalized poles are two
        // EQUATORIAL points at (0, central±90); its caps are geodesic small circles around them
        // (radius = 90 − cutoff). On an equatorial E/W map these render as two circles ON THE EQUATOR.
        var central = PROJ.centralOf(coord);
        function smallCircle(lon0, rho) {                              // geodesic circle of angular radius rho° around the equatorial point (0, lon0)
          var lon = [], lat = [], i, az, sR = Math.sin(rho * D), cR = Math.cos(rho * D);
          for (i = 0; i < n; i++) { az = (-180 + 360 * i / (n - 1)) * D; lat.push(Math.asin(sR * Math.cos(az)) / D); lon.push(((lon0 + Math.atan2(Math.sin(az) * sR, cR) / D + 540) % 360) - 180); }
          return { lon: lon, lat: lat };
        }
        function hemiH(lon0) {
          var o = smallCircle(lon0, 90 - maxlat), inr = smallCircle(lon0, 90 - (maxlat - MERC_BAND));
          return { outerLon: o.lon, outerLat: o.lat, innerLon: inr.lon, innerLat: inr.lat };
        }
        return { north: hemiH(central - 90), south: hemiH(central + 90) };
      }
      var M = PROJ.rotFromCentre(coord.centre), vc = M[0], vy = M[1], vp = M[2];
      function geoOf(gx, gy, gz) {                                       // generalized unit vector -> geographic [lat,lon]
        var x = gx * vc[0] + gy * vy[0] + gz * vp[0], y = gx * vc[1] + gy * vy[1] + gz * vp[1], z = gx * vc[2] + gy * vy[2] + gz * vp[2];
        z = z < -1 ? -1 : (z > 1 ? 1 : z); return [Math.asin(z) / D, Math.atan2(y, x) / D];
      }
      function parallel(C) {                                            // a generalized parallel (gen-lat C, swept over gen-lon) as geographic lon[]/lat[]
        var lon = [], lat = [], c = Math.cos(C * D), s = Math.sin(C * D), i, lam, p;
        for (i = 0; i < n; i++) { lam = (-180 + 360 * i / (n - 1)) * D; p = geoOf(c * Math.cos(lam), c * Math.sin(lam), s); lat.push(p[0]); lon.push(p[1]); }
        return { lon: lon, lat: lat };
      }
      function hemi(sign) {
        var o = parallel(sign * maxlat), inr = parallel(sign * (maxlat - MERC_BAND));
        return { outerLon: o.lon, outerLat: o.lat, innerLon: inr.lon, innerLat: inr.lat };
      }
      return { north: hemi(1), south: hemi(-1) };
    }
    // Project + seam-cut the whole basemap ONCE per coordinate/projection/detail and cache the
    // resulting projected segments. Pan, zoom and rotation are applied later in px() (a cheap
    // affine), so a drag re-uses this cache and only re-runs px() — no per-frame re-projection of
    // the 50m geometry. Rebuilds only when coordinate/projection/detail changes.
    var geomCache = null, geomKey = '';
    function geom() {
      var key = coordKey() + '|' + state.projection + '|' + state.detail;
      if (geomCache && geomKey === key) return geomCache;
      var coord = activeCoord(), proj = state.projection, b = MAPGEO.boundary(coord, proj), i, x, y, lon, lat;
      var uMinX = Infinity, uMaxX = -Infinity, uMinY = Infinity, uMaxY = -Infinity;
      for (i = 0; i < b.X.length; i++) { x = b.X[i]; y = b.Y[i]; if (x < uMinX) uMinX = x; if (x > uMaxX) uMaxX = x; if (y < uMinY) uMinY = y; if (y > uMaxY) uMaxY = y; }
      var grat = [];
      // Meridians run the FULL ±90: with the domain-space pole cut they terminate
      // exactly on the pole arcs (the old ±89.5 clamp only existed to keep lines
      // out of spikeBreak's blast radius). Parallels: ±90 are degenerate points,
      // so −75…75 at 15° spacing is simply every interior parallel.
      for (lon = -180; lon <= 180; lon += GRAT) push(grat, MAPGEO.lineSegs(coord, proj, lin(-90, 90, NSAMP), fillArr(lon, NSAMP)));
      for (lat = -75; lat <= 75; lat += GRAT) push(grat, MAPGEO.lineSegs(coord, proj, fillArr(lat, NSAMP), lin(-180, 180, NSAMP)));
      // Keep each ring's seam-cut fill pieces GROUPED so they can be filled as one even-odd path:
      // a ring that encircles a pole (Antarctica) cuts into nested pieces whose crude seam-edge
      // closures overlap, and even-odd makes the overlap cancel — re-opening bays at the seam that
      // a per-piece nonzero fill would bury (the Ross Sea drawn green). A normal ring is one piece,
      // where even-odd == nonzero, so nothing else changes.
      var coastFill = [], coastLine = [];
      layer(root.WORLD_COASTLINE).forEach(function (rg) {
        var ln = [], lt = [], r = rg.ring, k; for (k = 0; k < r.length; k++) { ln.push(r[k][0]); lt.push(r[k][1]); }
        coastFill.push({ polys: MAPGEO.ringFillPolys(coord, proj, ln, lt), hole: rg.hole });
        push(coastLine, MAPGEO.ringOutlineArcs(coord, proj, ln, lt));
      });
      var lakesFill = [], lakesLine = [], LK = layer(root.WORLD_LAKES);
      if (LK) LK.forEach(function (ring) {
        var ln = [], lt = [], k; for (k = 0; k < ring.length; k++) { ln.push(ring[k][0]); lt.push(ring[k][1]); }
        lakesFill.push(MAPGEO.ringFillPolys(coord, proj, ln, lt));
        push(lakesLine, MAPGEO.ringOutlineArcs(coord, proj, ln, lt));
      });
      var bndLine = [], BN = layer(root.WORLD_BOUNDARIES);
      if (BN) BN.forEach(function (ring) {
        var ln = [], lt = [], k; for (k = 0; k < ring.length; k++) { ln.push(ring[k][0]); lt.push(ring[k][1]); }
        push(bndLine, MAPGEO.ringOutlineArcs(coord, proj, ln, lt));
      });
      // Terrain (ocean depth + land elevation) is NOT built here: it lives in
      // the async texture bake (bakeTerrainPair below), so framing switches and
      // the initial basemap render never pay the grid-warp cost.
      // UN-subregion shading — each subregion = many country rings (outer + holes); collect all their
      // seam-cut pieces for one even-odd fill (enclaves punch out, then re-fill if same subregion).
      // `color` is the baked 4-colour index → PAL.regionColors[color] at draw time.
      var regionFill = [], UR = layer(root.WORLD_UN_REGIONS);
      if (UR) UR.forEach(function (grp) {
        var pieces = [], r, k, ln, lt, ri;
        for (ri = 0; ri < grp.rings.length; ri++) {
          r = grp.rings[ri]; ln = []; lt = []; for (k = 0; k < r.length; k++) { ln.push(r[k][0]); lt.push(r[k][1]); }
          push(pieces, MAPGEO.ringFillPolys(coord, proj, ln, lt));
        }
        regionFill.push({ color: grp.color, polys: pieces });
      });
      var sm = seams(), bd = bands();                                      // Hǎo N/S seam belts, projected through the current framing
      // The belt is always drawn; the centre LINE is skipped on its own framing (it would just retrace
      // the lens boundary). Sides and caps fill separately so the pole-end caps can render darker.
      var maxJump = 0.7 * Math.max(uMaxX - uMinX, uMaxY - uMinY);          // a cell larger than this has wrapped the seam (corners land on opposite map edges ≈ full span); smaller cells near projection-stretched poles are kept
      function fillStrips(strips) {
        var out = []; (strips || []).forEach(function (s) { MAPGEO.bandFillPolys(coord, proj, s.lonA, s.latA, s.lonB, s.latB, maxJump).forEach(function (p) { out.push(p); }); });
        return out;
      }
      function fillBelt(b) {                                                // all = sides+caps (one uniform base layer); caps and capsOuter are extra layers stacked on top
        if (!b) return { all: [], caps: [], capsOuter: [] };
        var s = fillStrips(b.sides), c = fillStrips(b.caps);
        return { all: s.concat(c), caps: c, capsOuter: fillStrips(b.capsOuter) };
      }
      var bandN = fillBelt(bd.north), bandS = fillBelt(bd.south);
      var own = state.centreOverride ? '' : state.coordinate;             // on a custom centre, neither N nor S is the "own" framing → draw both seam lines
      var edgeN = (own !== 'north' && sm.north) ? MAPGEO.lineSegs(coord, proj, sm.north.lat, sm.north.lon) : [];
      var edgeS = (own !== 'south' && sm.south) ? MAPGEO.lineSegs(coord, proj, sm.south.lat, sm.south.lon) : [];
      var mm = midMeridian(coord), midLine = MAPGEO.lineSegs(coord, proj, mm.lat, mm.lon);   // central axis (always built; drawn only when toggled)
      // Two Mercator coverage limits, each its own toggle. Each is built as {band, line, cap} from a pair
      // of ±MERCATOR_MAXLAT cutoff parallels (outer = cutoff, inner = MERC_BAND° toward the equator):
      //  · GEOGRAPHIC caps  = what STANDARD (equatorial) Web Mercator omits — the real ±85.05° poles.
      //  · GENERALIZED caps = what the OBLIQUE Mercator of THIS framing omits — its own ±85.05° clamp
      //    (for horizontal framings the two coincide). draw() cuts each cap OUT where it falls in the map
      //    interior (+ a crimson ring), and shades the band as an edge belt where the cap IS the map's clamp.
      function mercBand(h) { return MAPGEO.bandFillPolys(coord, proj, h.outerLon, h.outerLat, h.innerLon, h.innerLat, maxJump); }
      function mercSet(g, domainCaps) {
        // Caps that encircle a DOMAIN pole (generalized clamp always; geographic
        // caps too on horizontal framings, where geo pole = domain pole) are
        // built exactly in domain space — ringFillPolys' seam closure mis-fills
        // pole-encircling rings. Other caps are ordinary rings and stay on
        // ringFillPolys.
        var cap = domainCaps
          ? { north: MAPGEO.domainCapPolys(coord, proj, PROJ.MERCATOR_MAXLAT, 1),
              south: MAPGEO.domainCapPolys(coord, proj, PROJ.MERCATOR_MAXLAT, -1) }
          : { north: MAPGEO.ringFillPolys(coord, proj, g.north.outerLon, g.north.outerLat),
              south: MAPGEO.ringFillPolys(coord, proj, g.south.outerLon, g.south.outerLat) };
        return { band: { north: mercBand(g.north), south: mercBand(g.south) },
                 line: { north: MAPGEO.lineSegs(coord, proj, g.north.outerLat, g.north.outerLon), south: MAPGEO.lineSegs(coord, proj, g.south.outerLat, g.south.outerLon) },
                 cap: cap };
      }
      var mercGeoSet = mercSet(mercatorGeo(), coord.kind === 'horizontal'), mercGenSet = mercSet(mercatorClampGeo(coord), true);
      geomCache = { b: b, px0: (uMinX + uMaxX) / 2, py0: (uMinY + uMaxY) / 2, spanX: uMaxX - uMinX, spanY: uMaxY - uMinY,
                    grat: grat, coastFill: coastFill, coastLine: coastLine, lakesFill: lakesFill, lakesLine: lakesLine, bndLine: bndLine,
                    regionFill: regionFill,
                    bandN: bandN, bandS: bandS, edgeN: edgeN, edgeS: edgeS, midLine: midLine,
                    mercGeoSet: mercGeoSet, mercGenSet: mercGenSet };
      geomKey = key; return geomCache;
    }
    function computeFit() {                                               // cheap: cached geometry metrics + the current rotation
      var g = geom(), theta = orientationAngle();
      return { b: g.b, px0: g.px0, py0: g.py0, c: Math.cos(theta), s: Math.sin(theta), spanX: g.spanX, spanY: g.spanY };
    }

    // ---- terrain texture (async bake, per-frame blit) ------------------------
    // The terrain bands are rasterized ONCE into offscreen bitmaps in PROJECTED
    // space — bathy (lens clip baked in) and topo (land-mask clip baked in) —
    // and every frame draws each enabled layer with a single GPU drawImage
    // under the pan/zoom affine. Rasterizing the ~125k warped cells per frame
    // cost ~1s per drag frame; a blit is instant.
    // The bake itself is kept OFF the interaction path: scheduled as a
    // macrotask, COARSE grid first (fast preview, ~quarter the work), then
    // upgraded to FINE during browser idle time. Keyed by framing+projection+
    // theme; quality tracked separately so the upgrade can be detected.
    // Texture resolution: 2048px across the lens ≈ 2× supersampled at the
    // default view — terrain softens slightly under deep zoom-in, while the
    // vector coastline/graticule/routes on top stay crisp at every zoom.
    var terrainTex = null;        // { key, quality, bathy: {canvas,bx0,by1,ts}, topo: {...} }
    var terrainBakePending = '';  // "<key>|<quality>" scheduled or running
    function texKey() { return coordKey() + '|' + state.projection + '|' + (darkMode() ? 'dark' : 'light'); }
    function bakeTerrainPair(key, quality) {
      var TGall = root.WORLD_TERRAIN_GRID;
      if (!TGall || !TGall[quality]) return;
      var G = geom(), PAL = palette();
      var byCode = MAPGEO.gridFillPolys(activeCoord(), state.projection, TGall[quality]);
      var codes = [], gc;
      for (gc in byCode) codes.push(+gc);
      codes.sort(function (x, y) { return x - y; });                        // ascending = shallow→deep, then low→high land
      var K = 2048;
      var m = 0.01 * Math.max(G.spanX, G.spanY);                            // margin so edge strokes aren't clipped
      var bx0 = G.px0 - G.spanX / 2 - m, by1 = G.py0 + G.spanY / 2 + m;
      var sx = G.spanX + 2 * m, sy = G.spanY + 2 * m;
      var ts = K / Math.max(sx, sy);
      function makeLayer(kind) {
        var cnv = document.createElement('canvas');
        cnv.width = Math.ceil(sx * ts); cnv.height = Math.ceil(sy * ts);
        var tc = cnv.getContext('2d');
        tc.setTransform(ts, 0, 0, -ts, -bx0 * ts, by1 * ts);                // projected coords → texture px (y up → v down)
        function tracePolys(polys) { for (var si = 0; si < polys.length; si++) { var sg = polys[si]; tc.moveTo(sg.X[0], sg.Y[0]); for (var k = 1; k < sg.X.length; k++) tc.lineTo(sg.X[k], sg.Y[k]); tc.closePath(); } }
        tc.save();
        if (kind === 'bathy') {                                             // lens clip baked in: no band (or its AA edge) escapes the map
          tc.beginPath();
          for (var bk = 0; bk < G.b.X.length; bk++) { if (bk === 0) tc.moveTo(G.b.X[bk], G.b.Y[bk]); else tc.lineTo(G.b.X[bk], G.b.Y[bk]); }
          tc.closePath(); tc.clip();
        } else {                                                            // land-mask clip baked in: bands never spill past the NE coastline
          tc.beginPath();
          for (var ci = 0; ci < G.coastFill.length; ci++) tracePolys(G.coastFill[ci].polys);
          tc.clip('evenodd');
        }
        tc.lineJoin = 'miter'; tc.miterLimit = 2; tc.lineWidth = 1 / ts;    // 1 texture px, same-color crack cover between adjacent cells
        for (var i = 0; i < codes.length; i++) {
          var code = codes[i], isLand = code >= TERRAIN_LAND_BASE;
          if ((kind === 'bathy') === isLand) continue;
          var col = isLand ? (PAL.landColors[LAND_BOUNDS[code - TERRAIN_LAND_BASE]] || PAL.land)
                           : (PAL.bathyColors[DEPTH_BOUNDS[code]] || PAL.ocean);
          tc.fillStyle = col; tc.strokeStyle = col;
          tc.beginPath(); tracePolys(byCode[code]);
          tc.fill(); tc.stroke();
        }
        tc.restore();
        return { canvas: cnv, bx0: bx0, by1: by1, ts: ts };
      }
      terrainTex = { key: key, quality: quality, bathy: makeLayer('bathy'), topo: makeLayer('topo') };
    }
    // Worker-first: terrain-worker.js (sibling of the lazy terrain data file)
    // does the warp + rasterization off the main thread and transfers back
    // ImageBitmaps. The synchronous bakeTerrainPair above remains as the
    // fallback when Workers are unavailable or the worker errors out.
    var terrainWorker = null, terrainWorkerBroken = false;
    function ensureTerrainWorker() {
      if (terrainWorker || terrainWorkerBroken) return terrainWorker;
      if (typeof Worker === 'undefined' || !lazyLayers.terrain) { terrainWorkerBroken = true; return null; }
      try {
        terrainWorker = new Worker(lazyLayers.terrain.replace(/terrain-grid\.js.*$/, 'terrain-worker.js'));
      } catch (e) { terrainWorkerBroken = true; return null; }
      terrainWorker.onerror = function () {                                 // e.g. file:// (workers blocked) or a missing sibling file
        terrainWorkerBroken = true;
        try { terrainWorker.terminate(); } catch (e) {}
        terrainWorker = null; terrainBakePending = '';
        if (state.bathymetry || state.topography) scheduleTerrainBake();    // retry on the sync path
      };
      terrainWorker.onmessage = function (ev) {
        var d = ev.data;
        if (d.slot === 'zoom') {                                            // crisp zoom-window overlay
          terrainZoomPending = '';
          if (d.key !== texKey()) return;                                   // framing/theme moved on — the next draw re-requests
          terrainZoom = { key: d.key, bx0: d.bx0, by1: d.by1, sx: d.sx, sy: d.sy, ts: d.ts,
                          bathy: { canvas: d.bathy, bx0: d.bx0, by1: d.by1, ts: d.ts },
                          topo: { canvas: d.topo, bx0: d.bx0, by1: d.by1, ts: d.ts } };
          if (state.bathymetry || state.topography) render();
          return;
        }
        terrainBakePending = '';
        if (d.key !== texKey()) { if (state.bathymetry || state.topography) scheduleTerrainBake(); return; }   // framing/theme moved on — bake again
        terrainTex = { key: d.key, quality: d.quality,
                       bathy: { canvas: d.bathy, bx0: d.bx0, by1: d.by1, ts: d.ts },
                       topo: { canvas: d.topo, bx0: d.bx0, by1: d.by1, ts: d.ts } };
        if (state.bathymetry || state.topography) render();
        scheduleTerrainBake(true);                                          // no-op unless a fine upgrade is still due
      };
      return terrainWorker;
    }
    function scheduleTerrainBake(prewarm) {
      var key = texKey();
      var target = state.detail === 'coarse' ? 'coarse' : 'fine';
      if (terrainTex && terrainTex.key === key && terrainTex.quality === target) return;
      var quality = (terrainTex && terrainTex.key === key) ? target : 'coarse';   // fresh framing → coarse preview first
      var tag = key + '|' + quality;
      if (terrainBakePending === tag) return;
      var w = ensureTerrainWorker();
      if (w) {
        terrainBakePending = tag;
        var c = activeCoord();
        w.postMessage({ key: key, quality: quality, projId: state.projection, detail: state.detail,
                        coord: { kind: c.kind, centre: c.centre ? { lat: c.centre.lat, lon: c.centre.lon } : undefined, seam: c.seam, central: c.central },
                        pal: { bathyColors: palette().bathyColors, landColors: palette().landColors, ocean: palette().ocean, land: palette().land } });
        return;
      }
      if (prewarm) return;                                                  // sync fallback only bakes on real demand
      if (!root.WORLD_TERRAIN_GRID) { ensureLayer('WORLD_TERRAIN_GRID', lazyLayers.terrain, function () { render(); }); return; }
      terrainBakePending = tag;
      var run = function () {
        if (terrainBakePending !== tag) return;
        terrainBakePending = '';
        if (texKey() !== key || !(state.bathymetry || state.topography)) return;   // stale by the time we ran
        bakeTerrainPair(key, quality);
        render();
        if (quality !== target) scheduleTerrainBake();                      // coarse preview shown — queue the fine upgrade
      };
      if (quality === 'coarse') setTimeout(run, 0);                         // preview ASAP (still off the click's own frame)
      else if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 });
      else setTimeout(run, 150);
    }
    // Zoom-window overlay: when the view outresolves the 2048px base texture,
    // the worker re-bakes JUST the visible projected window at screen
    // resolution (fine grid, debounced so wheel-zoom doesn't spam). The base
    // texture keeps covering the whole lens underneath, so panning past the
    // window edge degrades to base resolution instead of blank.
    var terrainZoom = null, terrainZoomPending = '', terrainZoomTimer = 0;
    function scheduleZoomBake(win, key) {
      var tag = key + '|' + Math.round(win.bx0 * 32) + ',' + Math.round(win.by1 * 32) + ',' + Math.round(win.ts);
      if (terrainZoomPending === tag) return;
      clearTimeout(terrainZoomTimer);
      terrainZoomTimer = setTimeout(function () {
        var w = ensureTerrainWorker();
        if (!w || texKey() !== key) return;                                 // no worker → live with base resolution (sync zoom bakes would jank)
        terrainZoomPending = tag;
        var c = activeCoord();
        w.postMessage({ key: key, quality: 'fine', slot: 'zoom', window: win, projId: state.projection, detail: state.detail,
                        coord: { kind: c.kind, centre: c.centre ? { lat: c.centre.lat, lon: c.centre.lon } : undefined, seam: c.seam, central: c.central },
                        pal: { bathyColors: palette().bathyColors, landColors: palette().landColors, ocean: palette().ocean, land: palette().land } });
      }, 150);
    }

    // Pre-warm IMMEDIATELY at widget init (not on idle): the worker fetches and
    // parses its ~2 MB of data and bakes the current framing's textures on its
    // OWN thread, in parallel with the main thread's basemap render — so the
    // page text/UI cost nothing, and by the time the user reaches the
    // Ocean-depth / Land-elevation toggles the blit is usually already ready.
    // (Instances without lazyLayers.terrain — e.g. the region-overview embed —
    // never boot a worker: ensureTerrainWorker no-ops.)
    var terrainPrewarmed = false;
    function prewarmTerrain() {
      if (terrainPrewarmed) return;
      terrainPrewarmed = true;
      setTimeout(function () { scheduleTerrainBake(true); }, 0);
    }

    function draw(ctx2, W, H, f) {
      var PAL = palette();                                                  // light or dark cartographic palette, per the OS theme
      var G = geom();                                                       // cached projected + seam-cut geometry
      if (state.bathymetry || state.topography) scheduleTerrainBake();      // async: no-op once the texture for this framing+theme is ready
      prewarmTerrain();                                                     // safety net — normally already kicked at init
      var scale = Math.min(W / f.spanX, H / f.spanY) * 0.98 * state.zoom;
      lastScale = scale;
      var cx = state.cx == null ? f.px0 : state.cx, cy = state.cy == null ? f.py0 : state.cy;   // projected point pinned to the canvas centre
      function px(x, y) { var dx = x - cx, dy = y - cy, rx = dx * f.c - dy * f.s, ry = dx * f.s + dy * f.c; return [W / 2 + rx * scale, H / 2 - ry * scale]; }

      ctx2.clearRect(0, 0, W, H); ctx2.lineJoin = 'round'; ctx2.lineCap = 'round';
      function poly(seg) { ctx2.beginPath(); for (var k = 0; k < seg.X.length; k++) { var p = px(seg.X[k], seg.Y[k]); if (k === 0) ctx2.moveTo(p[0], p[1]); else ctx2.lineTo(p[0], p[1]); } }
      function fill(seg, color) { poly(seg); ctx2.fillStyle = color; ctx2.fill(); }
      function fillAll(segs, color) {                                       // many polys, ONE fill op → translucent overlaps don't compound
        ctx2.beginPath();
        for (var s = 0; s < segs.length; s++) { var sg = segs[s]; for (var k = 0; k < sg.X.length; k++) { var p = px(sg.X[k], sg.Y[k]); if (k === 0) ctx2.moveTo(p[0], p[1]); else ctx2.lineTo(p[0], p[1]); } ctx2.closePath(); }
        ctx2.fillStyle = color; ctx2.fill();
      }
      function fillRing(polys, color) {                                     // one ring's seam-pieces as a single even-odd path (overlapping seam closures cancel → bays stay open)
        ctx2.beginPath();
        for (var s = 0; s < polys.length; s++) { var sg = polys[s]; for (var k = 0; k < sg.X.length; k++) { var p = px(sg.X[k], sg.Y[k]); if (k === 0) ctx2.moveTo(p[0], p[1]); else ctx2.lineTo(p[0], p[1]); } ctx2.closePath(); }
        ctx2.fillStyle = color; ctx2.fill('evenodd');
      }
      function blitOne(t) {                                                 // one drawImage of a baked texture under the composed pan/zoom affine
        var A = f.c * scale, B = -f.s * scale, C = -f.s * scale, D = -f.c * scale;
        var E = W / 2 - scale * (f.c * cx - f.s * cy), F = H / 2 + scale * (f.s * cx + f.c * cy);
        ctx2.save();
        ctx2.transform(A / t.ts, B / t.ts, -C / t.ts, -D / t.ts,
                       A * t.bx0 + C * t.by1 + E, B * t.bx0 + D * t.by1 + F);
        ctx2.drawImage(t.canvas, 0, 0);
        ctx2.restore();
      }
      function viewWindow(margin) {                                         // visible projected rect (+margin fraction per side), from the inverse of px()
        var xs = [], ys = [], corners = [[0, 0], [W, 0], [0, H], [W, H]], i;
        for (i = 0; i < 4; i++) {
          var rx = (corners[i][0] - W / 2) / scale, ry = -(corners[i][1] - H / 2) / scale;
          xs.push(cx + rx * f.c + ry * f.s); ys.push(cy - rx * f.s + ry * f.c);
        }
        var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
        var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
        var mx = (x1 - x0) * margin, my = (y1 - y0) * margin;
        return { bx0: x0 - mx, by1: y1 + my, sx: (x1 - x0) + 2 * mx, sy: (y1 - y0) + 2 * my };
      }
      function zoomOverlayFresh(need) {                                     // overlay usable: right framing, resolution ≥ need, view inside its window
        if (!terrainZoom || terrainZoom.key !== texKey() || terrainZoom.ts < need * 0.8) return false;
        var v = viewWindow(0);
        return v.bx0 >= terrainZoom.bx0 && v.by1 <= terrainZoom.by1 &&
               v.bx0 + v.sx <= terrainZoom.bx0 + terrainZoom.sx && v.by1 - v.sy >= terrainZoom.by1 - terrainZoom.sy;
      }
      var terrainNeedTs = scale * (root.devicePixelRatio || 1);             // texture px per projected unit needed for 1:1 screen sampling
      function blitTerrain(kind) {
        if (!terrainTex || terrainTex.key !== texKey() || !terrainTex[kind]) return;   // not baked yet — appears on the render the bake triggers
        blitOne(terrainTex[kind]);
        if (terrainNeedTs > terrainTex[kind].ts * 1.3) {                    // view outresolves the base texture
          if (zoomOverlayFresh(terrainNeedTs)) blitOne(terrainZoom[kind]);  // crisp window on top
          else {                                                            // request one (debounced); base keeps showing meanwhile
            var win = viewWindow(0.3);
            win.ts = terrainNeedTs * 1.25;                                  // headroom so slight further zoom stays crisp
            scheduleZoomBake(win, texKey());
          }
        }
      }
      function stroke(segs, color, w) { ctx2.strokeStyle = color; ctx2.lineWidth = w; for (var s = 0; s < segs.length; s++) { if (segs[s].X.length < 2) continue; poly(segs[s]); ctx2.stroke(); } }
      function clipToLand() {                                               // clip subsequent fills to the LAND mask (all coast rings, even-odd → holes/ocean punched) so a land tint never spills past the NE coastline
        ctx2.beginPath();
        for (var tc = 0; tc < G.coastFill.length; tc++) { var cps = G.coastFill[tc].polys; for (var cp = 0; cp < cps.length; cp++) { var cs = cps[cp]; for (var ck = 0; ck < cs.X.length; ck++) { var cq = px(cs.X[ck], cs.Y[ck]); if (ck === 0) ctx2.moveTo(cq[0], cq[1]); else ctx2.lineTo(cq[0], cq[1]); } ctx2.closePath(); } }
        ctx2.clip('evenodd');
      }

      fill(G.b, PAL.ocean);                                                 // ocean lens base
      if (state.bathymetry) blitTerrain('bathy');                          // graded depth bands (lens clip baked into the texture)
      poly(G.b); ctx2.strokeStyle = PAL.edge; ctx2.lineWidth = 1.1; ctx2.stroke();   // lens outline (drawn over the depth bands)
      stroke(G.grat, PAL.graticule, 0.6);                                   // graticule
      for (var ci = 0; ci < G.coastFill.length; ci++) fillRing(G.coastFill[ci].polys, G.coastFill[ci].hole ? PAL.ocean : PAL.land);  // land + holes
      if (state.topography) {                                              // land elevation shade bands (land-mask clip baked into the texture)
        blitTerrain('topo');
      } else if (state.regions && G.regionFill.length) {                   // UN-subregion 4-colour shading (mutually exclusive with topography above)
        ctx2.save(); clipToLand();                                          // clip to land so a subregion's admin-0 fill never spills past the coastline
        for (var rgi = 0; rgi < G.regionFill.length; rgi++) fillRing(G.regionFill[rgi].polys, PAL.regionColors[G.regionFill[rgi].color] || PAL.land);
        ctx2.restore();
      }
      for (var li = 0; li < G.lakesFill.length; li++) fillRing(G.lakesFill[li], PAL.ocean);   // inland water painted over land (and over the shade bands)
      stroke(G.coastLine, PAL.coast, 0.6);                                  // coastline outline
      stroke(G.lakesLine, PAL.coast, 0.4);                                  // lake shores
      if (state.boundaries) stroke(G.bndLine, PAL.border, 0.45);            // country borders
      if (state.edges) {                                                    // Hǎo Northern (purple) & Southern (orange) edge bands + seam centre lines
        ctx2.save(); poly(G.b); ctx2.clip();                                // clip belt fills to the lens so no shading (or its anti-aliased edge) escapes the boundary
        // Three superposed layers at the same 0.22 → a staircase darkening toward the tips:
        // strip 0.22, cap inner half 0.39 (all+caps), cap outer half 0.52 (all+caps+capsOuter).
        fillAll(G.bandN.all, 'rgba(142,36,170,0.22)'); fillAll(G.bandN.caps, 'rgba(142,36,170,0.22)'); fillAll(G.bandN.capsOuter, 'rgba(142,36,170,0.22)');
        fillAll(G.bandS.all, 'rgba(239,108,0,0.22)'); fillAll(G.bandS.caps, 'rgba(239,108,0,0.22)'); fillAll(G.bandS.capsOuter, 'rgba(239,108,0,0.22)');
        ctx2.restore();
        stroke(G.edgeN, '#8e24aa', 0.6); stroke(G.edgeS, '#ef6c00', 0.6);   // solid seam centre line, as thin as a graticule line (empty on its own framing)
      }
      if (state.mercatorEdge || state.mercatorEdgeGen) {                   // the 3°-wide band on the COVERED side of each enabled cutoff: frames the cut-out cap (Hǎo/Winkel) or shades the clamp belt (Mercator)
        ctx2.save(); poly(G.b); ctx2.clip();                               // clip to the lens so no fill (or its anti-aliased edge) escapes the boundary
        if (state.mercatorEdge)    { fillAll(G.mercGeoSet.band.north, MERC_FILL); fillAll(G.mercGeoSet.band.south, MERC_FILL); }
        if (state.mercatorEdgeGen) { fillAll(G.mercGenSet.band.north, MERC_FILL); fillAll(G.mercGenSet.band.south, MERC_FILL); }
        ctx2.restore();
      }
      // The cap(s) are CUT OUT (punched transparent) at the very end of draw() — after every layer — wherever they fall in the map interior. See below.
      if (state.middleLine) stroke(G.midLine, PAL.edge, 0.6);              // the central axis (straight middle line a centred route lies on), graticule weight

      var coord = activeCoord(), proj = state.projection;  // flight arcs + markers (dynamic, few points → projected per frame)
      var routes = activeRoutes(), seen = {};
      routes.forEach(function (rt, ri) {
        var A = endpoint(rt[0]), B = endpoint(rt[1]); if (!A || !B) return;
        var gc = PROJ.greatCircle(A, B, NSAMP);
        stroke(MAPGEO.lineSegs(coord, proj, gc.lat, gc.lon), ROUTE_COLORS[ri % ROUTE_COLORS.length], 1.6);
        mark(rt[0], A); mark(rt[1], B);
      });
      activePoints().forEach(function (code) { var A = endpoint(code); if (A) mark(code, A); });   // lone airports: label, no arc
      if (state.centreArc) {                                              // the arc we re-centred on — drawn bold; runs straight down the middle
        var ca = endpoint(state.centreArc[0]), cb = endpoint(state.centreArc[1]);
        if (ca && cb) {
          var cgc = PROJ.greatCircle(ca, cb, NSAMP);
          stroke(MAPGEO.lineSegs(coord, proj, cgc.lat, cgc.lon), PAL.marker, 2.2);   // theme-aware (dark on light, light on dark)
          mark(state.centreArc[0], ca); mark(state.centreArc[1], cb);
        }
      }
      // Region discs: the exact Web-Mercator crop circle, warped onto this framing. Drawn as a thin
      // ring (graticule weight) sitting ENTIRELY OUTSIDE the disc, so the enclosed area stays clear of
      // red: clip to the disc's EXTERIOR, then stroke at 2× so only the outer half survives — the ring's
      // inner edge lands exactly on the disc boundary. The px-space outline is cached for click hit-testing.
      lastRegionPolys = [];
      regions.forEach(function (rg) {
        var rk = rg && (rg.radiusKm != null ? rg.radiusKm : rg.defaultRadiusKm);   // accept the Region Explorer's {defaultRadiusKm} shape directly
        if (!(rg && isFinite(rg.lat) && isFinite(rg.lon) && rk > 0)) return;
        var loop = PROJ.mercatorDisc({ lat: rg.lat, lon: rg.lon }, rk, 256);
        var outline = MAPGEO.lineSegs(coord, proj, loop.lat, loop.lon);   // seam-safe outline arcs (no artificial seam closure)
        var fillPolys = MAPGEO.ringFillPolys(coord, proj, loop.lon, loop.lat);     // seam-safe interior, to clip the ring to the disc's exterior
        ctx2.save();
        ctx2.beginPath(); ctx2.rect(0, 0, W, H);                                   // whole canvas …
        for (var fp = 0; fp < fillPolys.length; fp++) { var sg = fillPolys[fp]; for (var fk = 0; fk < sg.X.length; fk++) { var fpx = px(sg.X[fk], sg.Y[fk]); if (fk === 0) ctx2.moveTo(fpx[0], fpx[1]); else ctx2.lineTo(fpx[0], fpx[1]); } ctx2.closePath(); }
        ctx2.clip('evenodd');                                                      // … minus the disc interior = its exterior; even-odd cancels seam-piece overlaps
        stroke(outline, REGION_COLOR, 2.0);                                        // 2.0 centred on the boundary; outer 1.0 survives the clip → a 1.0-wide ring, inner edge on the boundary
        ctx2.restore();
        if (onRegionClick) {                                                       // cache the px-space outline (full loop, pre-seam-cut) for point-in-area hit-testing
          var poly = []; for (var qi = 0; qi < loop.lat.length; qi++) { var qp = PROJ.project(coord, proj, loop.lat[qi], loop.lon[qi]); poly.push(px(qp.x, qp.y)); }
          lastRegionPolys.push({ rg: rg, poly: poly });
        }
      });
      function mark(code, AB) {
        if (seen[code]) return; seen[code] = 1;
        var pr = PROJ.project(coord, proj, AB[0], AB[1]); var p = px(pr.x, pr.y);
        ctx2.beginPath(); ctx2.arc(p[0], p[1], 2.6, 0, 2 * Math.PI); ctx2.fillStyle = PAL.marker; ctx2.fill();
        if (typeof code === 'string') { ctx2.fillStyle = PAL.marker; ctx2.font = '11px -apple-system,Segoe UI,sans-serif'; ctx2.fillText(code, p[0] + 4, p[1] - 4); }
      }
      if (dragging && state.orientMode === 'north') {                     // north-locked drag: mark the canvas centre — the point north-up is computed from (hidden on release)
        ctx2.beginPath(); ctx2.arc(W / 2, H / 2, 5, 0, 2 * Math.PI); ctx2.fillStyle = '#c0392b'; ctx2.fill();
        ctx2.beginPath(); ctx2.arc(W / 2, H / 2, 5, 0, 2 * Math.PI); ctx2.strokeStyle = '#fff'; ctx2.lineWidth = 1.4; ctx2.stroke();
      }
      // MASK each enabled cap where it falls in the map INTERIOR — fill it with a theme-aware "void" grey so
      // the area Mercator can't show reads as a clear hole. NOT transparent: on the light theme a transparent
      // hole blends into the white page, and on the dark theme it blends into the dark ocean — a neutral grey
      // (PAL.mercVoid: medium-slate on light, lighter-slate on dark) contrasts with both. Drawn LAST (over
      // every layer) so it's opaque over arcs/coast/etc.; a crimson ring marks it. A cap that IS the Mercator's
      // own clamp edge has no interior to mask (off-map) → it stays a band only (drawn above), no fill, no ring.
      function maskMercLimit(set) {
        fillAll(set.cap.north, PAL.mercVoid); fillAll(set.cap.south, PAL.mercVoid);
        stroke(set.line.north, MERC_EDGE, 1.1); stroke(set.line.south, MERC_EDGE, 1.1);   // crimson ring on the exact ±MERCATOR_MAXLAT cutoff, crisp over the void edge
      }
      var _isMerc = proj === 'mercator', _vert = coord.kind === 'vertical';
      if (state.mercatorEdge && !(_isMerc && !_vert) && G.mercGeoSet) maskMercLimit(G.mercGeoSet);   // geographic caps are interior everywhere except equatorial Mercator (there they're the clamp → band only)
      if (state.mercatorEdgeGen && !(_isMerc && _vert) && G.mercGenSet) maskMercLimit(G.mercGenSet);   // generalized caps are off-map only on the VERTICAL Mercator (its own clamp → band only); on equatorial Mercator + non-Mercator they're interior → cut as holes
      // City dots - the active layer (World cities / Lived-in). Dots only; the name shows on hover.
      // Drawn last so they sit on top of every layer; cached to lastCityDots for hover hit-testing.
      lastCityDots = [];
      if (cities && state.cityLayer !== 'none') {
        var clist = state.cityLayer === 'lived' ? cities.lived : cities.world;
        var cStroke = darkMode() ? '#0b1620' : '#ffffff';
        for (var cyi = 0; cyi < clist.length; cyi++) {
          var cyc = clist[cyi], cyp = PROJ.project(coord, proj, cyc.lat, cyc.lon), cypx = px(cyp.x, cyp.y);
          ctx2.beginPath(); ctx2.arc(cypx[0], cypx[1], 2.7, 0, 2 * Math.PI); ctx2.fillStyle = PAL.city; ctx2.fill();
          ctx2.lineWidth = 0.9; ctx2.strokeStyle = cStroke; ctx2.stroke();
          lastCityDots.push({ x: cypx[0], y: cypx[1], label: cyc.label });
        }
        for (var hci = 0; state.hoverCity && hci < lastCityDots.length; hci++) {
          var hcd = lastCityDots[hci]; if (hcd.label !== state.hoverCity) continue;
          ctx2.font = '11px -apple-system,Segoe UI,sans-serif';
          var ctw = ctx2.measureText(hcd.label).width, clx = hcd.x + 7, cly = hcd.y - 7;
          ctx2.fillStyle = darkMode() ? 'rgba(15,23,32,0.9)' : 'rgba(255,255,255,0.92)'; ctx2.fillRect(clx - 3, cly - 11, ctw + 6, 15);
          ctx2.fillStyle = PAL.marker; ctx2.fillText(hcd.label, clx, cly); break;
        }
      }
    }

    function lin(a, b, n) { var o = []; for (var i = 0; i < n; i++) o.push(a + (b - a) * i / (n - 1)); return o; }
    function fillArr(v, n) { var o = []; for (var i = 0; i < n; i++) o.push(v); return o; }
    function push(dst, segs) { for (var i = 0; i < segs.length; i++) dst.push(segs[i]); }
    function layer(g) { return g ? (Array.isArray(g) ? g : g[state.detail]) : null; }   // pick fine/coarse (or accept a flat array)

    // Lazy-load a heavy data global on demand (first toggle-on). cb(fresh) — fresh=true only when the
    // script was just fetched now (so the caller can invalidate the geom cache); false when already present.
    var lazyPending = {};   // url -> [callbacks awaiting this load]
    function ensureLayer(globalName, url, cb) {
      if (root[globalName] || !url) { cb(false); return; }                  // already loaded, or no lazy source → proceed (toggle no-ops if truly absent)
      if (lazyPending[url]) { lazyPending[url].push(cb); return; }          // a load is in flight → queue
      lazyPending[url] = [cb];
      var s = document.createElement('script'); s.src = url;
      s.onload = function () { var cbs = lazyPending[url]; delete lazyPending[url]; for (var i = 0; i < cbs.length; i++) cbs[i](true); };
      s.onerror = function () { delete lazyPending[url]; cb(false); };      // fail quietly — the layer just stays empty
      document.head.appendChild(s);
    }

    // ---- sizing + render --------------------------------------------------
    function render() {
      var cssW, cssH;
      if (showControls) {                                                  // full-bleed: the canvas fills the stage (CSS sets its display size); controls float on top
        cssW = stage.clientWidth || mount.clientWidth || DEFAULT_SIZE;
        cssH = stage.clientHeight || cssW;
      } else {                                                             // embed (no controls): keep the legacy square box sized by state.size
        cssW = cssH = Math.max(50, Math.min(state.size, (mount.clientWidth || 9999)));
        canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
      }
      var f = computeFit();
      if (state.cx == null) { state.cx = f.px0; state.cy = f.py0; }         // first render: centre on the projection centre
      if (state.orientMode === 'north' && !animating && (!dragging || state.northLive)) { updateNorthTheta(); f = computeFit(); }  // north-up: live while dragging if northLive, else only when not dragging; never mid-tween
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, cssW, cssH, f);
      updateCompass();
    }

    function savePng() {
      var k = 2, cssW = canvas.clientWidth, cssH = canvas.clientHeight;
      var off = document.createElement('canvas'); off.width = cssW * k; off.height = cssH * k;
      var octx = off.getContext('2d'); octx.setTransform(k, 0, 0, k, 0, 0);
      octx.fillStyle = (getComputedStyle(document.body).backgroundColor) || '#fff'; octx.fillRect(0, 0, cssW, cssH);
      draw(octx, cssW, cssH, computeFit());
      off.toBlob(function (blob) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'great-circle-' + state.coordinate + '-' + state.projection + '.png';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }, 'image/png');
    }

    // ---- drag to pan (moves the projected centre point; works at any rotation) ----
    var dragging = false, lastX = 0, lastY = 0, animating = false, animRaf = 0, rafPending = false;
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
    function scheduleRender() { if (rafPending) return; rafPending = true; raf(function () { rafPending = false; render(); }); }  // coalesce drag moves to one render/frame
    if (!disablePan) {                                                     // static overviews opt out of panning (but can still take region clicks below)
      canvas.addEventListener('pointerdown', function (e) { cancelAnimationFrame(animRaf); animating = false; dragging = true; lastX = e.clientX; lastY = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} render(); });   // render now so the centre dot appears on grab
      canvas.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var mx = e.clientX - lastX, my = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
        var th = orientationAngle(), c = Math.cos(th), s = Math.sin(th);     // shift the centre opposite the drag, un-rotated into projected space
        state.cx += (-mx * c + my * s) / lastScale;
        state.cy += (mx * s + my * c) / lastScale;
        scheduleRender();
      });
      function endDrag() { dragging = false; if (state.orientMode === 'north') { if (state.northLive) render(); else animateNorthTo(); } else render(); }   // re-render to drop the centre dot; north mode: live already oriented, else ease to north
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
    }

    // ---- hover a city dot to show its name (World cities / Lived-in layer) ----
    if (cities) {
      canvas.addEventListener('mousemove', function (e) {
        if (state.cityLayer === 'none' || dragging) return;
        var mx = e.offsetX, my = e.offsetY, hit = null, bestD = 64;       // 8px pick radius (squared)
        for (var i = 0; i < lastCityDots.length; i++) { var d = lastCityDots[i], dx = d.x - mx, dy = d.y - my, dd = dx * dx + dy * dy; if (dd < bestD) { bestD = dd; hit = d.label; } }
        if (hit !== state.hoverCity) { state.hoverCity = hit; canvas.style.cursor = hit ? 'pointer' : ''; scheduleRender(); }
      });
      canvas.addEventListener('mouseleave', function () { if (state.hoverCity) { state.hoverCity = null; scheduleRender(); } });
    }

    // ---- click a region's area to select it (overview only) ----
    if (onRegionClick) {
      function pointInPoly(poly, x, y) {                                  // ray-casting, px space
        var inside = false, n = poly.length, j = n - 1;
        for (var i = 0; i < n; i++) {
          var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
          j = i;
        }
        return inside;
      }
      function regionAt(mx, my) {                                         // topmost (last-drawn) disc whose area contains the point
        for (var k = lastRegionPolys.length - 1; k >= 0; k--) if (pointInPoly(lastRegionPolys[k].poly, mx, my)) return lastRegionPolys[k].rg;
        return null;
      }
      canvas.addEventListener('click', function (e) { var rg = regionAt(e.offsetX, e.offsetY); if (rg) onRegionClick(rg); });
      canvas.addEventListener('mousemove', function (e) { canvas.style.cursor = regionAt(e.offsetX, e.offsetY) ? 'pointer' : 'default'; });
    }

    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 150); });
    if (typeof matchMedia === 'function') { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render); } catch (e) {} }   // repaint when the OS light/dark theme flips
    if (typeof window !== 'undefined' && typeof window.onSiteThemeChange === 'function') window.onSiteThemeChange(render);   // repaint when the manual site theme toggle flips
    // Defer the heavy first projection+draw. The DOM/box above is built synchronously (so the page
    // reserves space and won't reflow), but the projection of the ~3 MB basemap is expensive: during
    // initial load the geo-data globals arrive `defer` (after first paint), so we render on
    // DOMContentLoaded (by which point those have run); a widget created later renders next frame.
    prewarmTerrain();                                                        // start the terrain worker prefetch NOW — it loads + bakes on its own thread while the basemap renders
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { render(); }, { once: true });
    else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { render(); });
    else render();
    return { render: render, state: state };
  }

  root.createWorldMap = createWorldMap;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
