// map-explorer.js — shared "pick a location, render its map at a fixed
// circular radius, save as a lossless PNG" widget. Used by:
//   - /public/hobbies/cities-transport/   (City Map Explorer, ~30 cities)
//   - /public/hobbies/maps-projections/   (Region Map Explorer, regional scales)
//
// Per-page differences are pure config; the markup, Leaflet wiring,
// railway-overlay handling, export-zoom clamping, save-button
// progress feedback, and width/aspect clamping all live here.
//
// Single source of truth — anything we change later (padding, button
// styles, brackets around coords, new controls) lands in one file
// and both pages pick it up automatically.
//
// Depends on:
//   - Leaflet 1.9.x (loaded by the page before this file)
//   - map-export.js (window.exportMapAsPng + window.EXPORT_MAX_CANVAS_DIM)
//
// Usage from a page:
//
//   <div id="explorer"></div>
//   <script>
//     createMapExplorer({
//       mount: '#explorer',
//       locationLabel: 'City',
//       defaultRadiusKm: 17,
//       filenamePrefix: 'map',
//       locations: [
//         { value: 'dublin', lat: 53.3493795, lon: -6.2605593, label: 'Dublin' },
//         { divider: true },
//         { value: 'beijing', lat: 39.9057136, lon: 116.3912972, label: 'Beijing' },
//         ...
//       ]
//     });
//   </script>

(function () {
  // ---- Once-per-document style injection ------------------------------
  // Self-contained: page only includes this script, gets controls + canvas
  // + readout styling for free.
  var STYLE_ID = '__map-explorer-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.map-tester-controls { display:flex; gap:0.8rem; align-items:center; flex-wrap:wrap; }' +
      '.map-tester-controls label { display:inline-flex; align-items:center; gap:0.4rem; font-size:0.9rem; color:var(--text); }' +
      '.map-tester-controls select, .map-tester-controls input[type="number"] {' +
      '  font: inherit; padding:0.4rem 0.6rem;' +
      '  background:var(--bg); color:var(--text);' +
      '  border:1px solid var(--border); border-radius:4px;' +
      '}' +
      '.map-tester-controls input[type="number"] { width:5.5rem; }' +
      '.map-tester-controls .map-radius-group {' +
      '  display:inline-flex; align-items:center; gap:0.5rem; flex-wrap:wrap;' +
      '  font-size:0.9rem; color:var(--text);' +
      '}' +
      '.map-tester-controls .map-radius-group input[type="number"]:disabled { opacity:0.5; }' +
      '.map-explorer-canvas {' +
      '  width:360px; height:360px; max-width:100%;' +
      '  background:#eee; margin-top:0.8rem;' +
      '  overflow:hidden; border-radius:50%;' +
      '}' +
      // Overview slot (the empty-state map, e.g. the Northern-Hǎo region map). Square, NOT
      // circle-clipped — the Hǎo lens isn't circular and a clip would crop its E/W tips.
      // Clicks pass through (region areas are clickable); panning is disabled at the engine
      // level via createWorldMap's disablePan, so the map stays static. cursor:default until
      // world-map sets it to pointer over a clickable region.
      '.map-explorer-overview { margin-top:0.8rem; max-width:100%; }' +
      '.map-explorer-overview canvas { cursor:default; }' +
      // Vector-basemap slot (opt-in via opts.vectorCrop): sized + circle-clipped exactly like the
      // Leaflet canvas, so the two basemaps swap in place. The engine's own canvas chrome (border +
      // 6px radius) is stripped — inside the circular clip it would leave stray border arcs at the
      // four points where the circle touches the square edge.
      '.map-explorer-vector {' +
      '  width:360px; height:360px; max-width:100%;' +
      '  background:#eee; margin-top:0.8rem;' +
      '  overflow:hidden; border-radius:50%;' +
      '}' +
      '.map-explorer-vector canvas { border:none; border-radius:0; }' +
      // Vector basemap active: dim the OSM-tile-only controls (Railways overlay + export tile-zoom);
      // the inputs are also disabled in JS so the dimming maps to genuinely inert controls.
      '.map-explorer-vector-mode .map-ctl-railways,' +
      '.map-explorer-vector-mode .map-tester-readout > label { opacity:0.45; }' +
      // Empty state ("Select location…"): dim the controls that only act on a rendered Mercator
      // crop. Location + Size (px) stay live (Size resizes the overview); the inputs themselves are
      // also disabled in JS so the dimming maps to genuinely inert controls.
      '.map-explorer-empty .map-ctl-radius,' +
      '.map-explorer-empty .map-ctl-railways,' +
      '.map-explorer-empty .map-ctl-basemap,' +
      '.map-explorer-empty .map-tester-readout > button,' +
      '.map-explorer-empty .map-tester-readout > label { opacity:0.45; }' +
      '.map-tester-readout {' +
      '  margin-top:0.4rem; display:flex; align-items:flex-start;' +
      '  gap:0.8rem; flex-wrap:wrap;' +
      '}' +
      '.map-tester-readout .zoom-input {' +
      '  width:4.5rem; font:inherit; padding:0.4rem 0.6rem;' +
      '  background:var(--bg); color:var(--text);' +
      '  border:1px solid var(--border); border-radius:4px;' +
      '}' +
      '.map-tester-readout .zoom-max { color:var(--muted); font-size:0.85rem; font-variant-numeric:tabular-nums; }' +
      '.map-tester-readout .readout-meta {' +
      '  font-size:0.8rem; color:var(--muted); font-variant-numeric:tabular-nums;' +
      '  display:flex; flex-direction:column; gap:0.1rem;' +
      '}';
    document.head.appendChild(style);
  }

  // ---- Helpers --------------------------------------------------------

  function resolveMount(mount) {
    if (typeof mount === 'string') return document.querySelector(mount);
    return mount;
  }

  // Leaflet's tile-zoom rule (Math.round of fractional view zoom) — same
  // formula used inside map-popover.js and map-export.js. Fractional
  // zoom from this gives every location the same on-screen ground span
  // regardless of latitude, accounting for Mercator stretching.
  function computeZoom(lat, widthPx, radiusKm) {
    var latRad = lat * Math.PI / 180;
    return Math.log2(156543.03392 * Math.cos(latRad) * widthPx / (2000 * radiusKm));
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Build <option> markup from a flat list that may contain
  // { divider: true } items. Each location item carries its lat/lon (and
  // optional defaultRadiusKm) on data-attributes so the runtime can read
  // them off the chosen <option>.
  //
  // placeholder (optional): when given, a real, re-selectable prompt
  // option with no coords is prepended and selected by default. It carries
  // no data-lat/lon, so render() clears the display instead of drawing a
  // map — and because it stays enabled and visible, the user can pick it
  // again at any time to blank the canvas.
  function buildLocationOptionsHtml(locations, placeholder) {
    var html = placeholder
      ? '<option value="" selected>' + escHtml(placeholder) + '</option>'
      : '';
    return html + locations.map(function (loc) {
      if (loc.divider) return '<option disabled>──────────</option>';
      var radAttr = (loc.defaultRadiusKm != null)
        ? ' data-radius-km="' + escHtml(loc.defaultRadiusKm) + '"' : '';
      return '<option value="' + escHtml(loc.value) + '"' +
        ' data-lat="' + escHtml(loc.lat) + '"' +
        ' data-lon="' + escHtml(loc.lon) + '"' +
        radAttr +
        '>' + escHtml(loc.label) + '</option>';
    }).join('');
  }

  function buildLocationSelectHtml(id, locations, placeholder) {
    return '<select id="' + id + '" aria-describedby="' + id + '-coord">' +
      buildLocationOptionsHtml(locations, placeholder) +
      '</select>';
  }

  // ---- Public API -----------------------------------------------------

  window.createMapExplorer = function (config) {
    injectStyles();

    var mount = resolveMount(config.mount);
    if (!mount) {
      console.error('createMapExplorer: mount element not found', config.mount);
      return;
    }

    // Per-instance ID prefix isolates multiple widgets on the same page.
    var idPfx = mount.id || ('map-explorer-' + Math.random().toString(36).slice(2, 8));
    var locationLabel = config.locationLabel || 'Location';
    var defaultRadiusKm = config.defaultRadiusKm || 17;
    // Optional preset list. When provided (e.g. [17, 63]), the radius
    // control becomes "<preset> <preset> Custom" radios with the number
    // input only editable while Custom is selected. Omitted → original
    // freeform number input.
    var radiusPresets = Array.isArray(config.radiusPresets) ? config.radiusPresets : null;
    var filenamePrefix = config.filenamePrefix || 'map';
    var locations = config.locations || [];
    // Optional prompt option (e.g. 'Select location…'). When set, the
    // dropdown starts on it with a blank canvas and the user can re-select
    // it any time to clear the display. Omitted → original eager behaviour
    // (first option selected + rendered on load).
    var placeholder = config.placeholder || null;
    // Optional empty-state map. A function(mountEl) the page uses to render
    // something into the display slot whenever the placeholder/coordless
    // option is selected (e.g. a static Northern-Hǎo region overview).
    // Called once (lazily, on first entry to the empty state); the slot is
    // then just shown/hidden as the selection toggles. Omitted → the slot
    // stays an empty grey circle as before.
    var overview = (typeof config.overview === 'function') ? config.overview : null;
    // Optional vector basemap. A function(el, location, radiusKm, sizePx) the page
    // uses to render an engine-drawn Web-Mercator crop of the SAME location disc
    // into `el` (which this widget sizes + circle-clips exactly like the Leaflet
    // canvas). Must return a handle:
    //   { update(location, radiusKm, sizePx),   // re-crop/resize the cached instance
    //     getCanvas() }                          // live <canvas>, for Save PNG (optional)
    // When configured, a "Basemap" toggle (OpenStreetMap / Projection engine)
    // appears in the control row; OSM stays the default. Omitted (cities-transport)
    // → no toggle UI exists at all and behaviour is exactly as before.
    var vectorCrop = (typeof config.vectorCrop === 'function') ? config.vectorCrop : null;

    // Inject markup
    var selectId = idPfx + '-loc';
    var overviewId = idPfx + '-overview';
    var vectorId = idPfx + '-vector';
    var basemapModeName = idPfx + '-basemap-mode';
    var sizeId = idPfx + '-size';
    var radiusId = idPfx + '-radius';
    var radiusModeName = idPfx + '-radius-mode';
    var railwaysId = idPfx + '-railways';
    var canvasId = idPfx + '-canvas';
    var renderBtnId = idPfx + '-render';
    var saveBtnId = idPfx + '-save';
    var zoomInputId = idPfx + '-zoom';
    var zoomMaxId = idPfx + '-zoommax';
    var coordId = idPfx + '-coord';
    var rzId = idPfx + '-rz';
    var actualId = idPfx + '-actual';

    // Radius control: presets → radio group + (initially-disabled) number
    // input next to a "Custom" radio. No presets → original freeform input.
    var radiusControlHtml;
    if (radiusPresets) {
      var defaultMatchesPreset = radiusPresets.indexOf(defaultRadiusKm) >= 0;
      var presetRadiosHtml = radiusPresets.map(function (p) {
        var checked = (defaultMatchesPreset && p === defaultRadiusKm) ? ' checked' : '';
        return '<label><input type="radio" name="' + radiusModeName + '" value="' + p + '"' + checked + '> ' + p + '</label>';
      }).join('');
      var customChecked = defaultMatchesPreset ? '' : ' checked';
      var numberDisabled = defaultMatchesPreset ? ' disabled' : '';
      radiusControlHtml =
        '<span class="map-radius-group map-ctl-radius">Radius (km):' +
          presetRadiosHtml +
          '<label><input type="radio" name="' + radiusModeName + '" value="custom"' + customChecked + '> Custom</label>' +
          '<input type="number" id="' + radiusId + '" value="' + defaultRadiusKm + '" min="0.5" max="5000" step="1"' + numberDisabled + '>' +
        '</span>';
    } else {
      radiusControlHtml =
        '<label class="map-ctl-radius">Radius (km):' +
          '<input type="number" id="' + radiusId + '" value="' + defaultRadiusKm + '" min="0.5" max="5000" step="1">' +
        '</label>';
    }

    // Basemap toggle — only rendered when the page supplies a vectorCrop
    // callback (Region Explorer); without it (City Explorer) no trace of the
    // control exists. Option labels are deliberate literals right here so
    // rewording them later is a one-line change.
    var basemapControlHtml = '';
    if (vectorCrop) {
      basemapControlHtml =
        '<span class="map-radius-group map-ctl-basemap">Basemap:' +
          '<label><input type="radio" name="' + basemapModeName + '" value="osm" checked> OpenStreetMap</label>' +
          '<label><input type="radio" name="' + basemapModeName + '" value="vector"> Projection engine</label>' +
        '</span>';
    }

    mount.innerHTML =
      '<div class="map-tester-controls">' +
        '<label>' + escHtml(locationLabel) + ':' +
          buildLocationSelectHtml(selectId, locations, placeholder) +
        '</label>' +
        '<label>Size (px):' +
          '<input type="number" id="' + sizeId + '" value="360" min="50" max="2000" step="10">' +
        '</label>' +
        radiusControlHtml +
        '<label class="map-ctl-railways"><input type="checkbox" id="' + railwaysId + '"> Railways</label>' +
        basemapControlHtml +
      '</div>' +
      '<div class="map-explorer-canvas" id="' + canvasId + '"></div>' +
      (vectorCrop ? '<div class="map-explorer-vector" id="' + vectorId + '" style="display:none"></div>' : '') +
      '<div class="map-explorer-overview" id="' + overviewId + '" style="display:none"></div>' +
      '<div class="map-tester-readout">' +
        '<button type="button" class="btn-primary" id="' + renderBtnId + '">Render</button>' +
        '<button type="button" class="btn-primary" id="' + saveBtnId + '">Save PNG</button>' +
        '<label title="Tile zoom level for the export PNG. Each +1 doubles each side of the file (4× total area). Empty = match the on-screen tile zoom. Range 0–19." style="display:inline-flex;align-items:center;gap:0.4rem;font-size:0.9rem;color:var(--text);">' +
          'at zoom <input type="number" class="zoom-input" id="' + zoomInputId + '" min="0" max="19" step="1" placeholder="auto">' +
          '<span class="zoom-max" id="' + zoomMaxId + '"></span>' +
        '</label>' +
        '<div class="readout-meta">' +
          '<span id="' + coordId + '"></span>' +
          '<span id="' + rzId + '"></span>' +
          '<span id="' + actualId + '"></span>' +
        '</div>' +
      '</div>';

    // ---- Wire up runtime ----------------------------------------------
    var locEl = document.getElementById(selectId);
    var sizeEl = document.getElementById(sizeId);
    var radiusEl = document.getElementById(radiusId);
    var railwaysEl = document.getElementById(railwaysId);
    var renderBtn = document.getElementById(renderBtnId);
    var saveBtn = document.getElementById(saveBtnId);
    var zoomEl = document.getElementById(zoomInputId);
    var zoomMaxEl = document.getElementById(zoomMaxId);
    var canvas = document.getElementById(canvasId);
    var overviewEl = document.getElementById(overviewId);
    var coordEl = document.getElementById(coordId);
    var rzEl = document.getElementById(rzId);
    var actualEl = document.getElementById(actualId);
    var lmap = null;
    var railwaysLayer = null;
    var overviewInited = false;
    var overviewHandle = null;            // whatever config.overview() returns; may expose setSize(px)
    var hasEmptyState = !!placeholder;    // only widgets with a prompt option have an empty state to grey out
    var vectorEl = vectorCrop ? document.getElementById(vectorId) : null;
    var vectorHandle = null;              // whatever config.vectorCrop() returns; cached so mode flips just update it

    // ---- Basemap mode helpers (all no-ops without opts.vectorCrop) ----
    function basemapRadios() {
      return vectorCrop ? mount.querySelectorAll('input[name="' + basemapModeName + '"]') : null;
    }
    // The selected radio is the mode's single source of truth ('osm' | 'vector').
    function vectorActive() {
      var rs = basemapRadios();
      if (rs) for (var i = 0; i < rs.length; i++) if (rs[i].checked) return rs[i].value === 'vector';
      return false;
    }
    // Disable + dim the OSM-tile-only controls while the vector basemap shows:
    // Railways is an OpenRailwayMap TILE overlay (nothing to overlay on the engine
    // canvas) and the export "at zoom" input is a tile-zoom concept. Both restore
    // when flipping back — render() calls this on every mode-relevant pass.
    function applyVectorModeUI(isVector) {
      if (!vectorCrop) return;
      railwaysEl.disabled = isVector;
      zoomEl.disabled = isVector;
      mount.classList.toggle('map-explorer-vector-mode', isVector);
    }

    // Is the currently-selected option a real location (has coords) vs the
    // coordless "Select location…" prompt? Drives both render() and the UI mode.
    function selectedHasCoords() {
      var opt = locEl.options[locEl.selectedIndex];
      return !!(opt && isFinite(parseFloat(opt.dataset.lat)) && isFinite(parseFloat(opt.dataset.lon)));
    }

    // Select a location by its option value and run the same flow as a manual dropdown change.
    // Exposed to the overview (via the api arg) so clicking a region's area picks it. Returns true on match.
    function selectLocation(value) {
      for (var i = 0; i < locEl.options.length; i++) {
        if (locEl.options[i].value === value && !locEl.options[i].disabled) {
          locEl.selectedIndex = i;
          applyLocationRadius(); updateCoordReadout(); render();
          return true;
        }
      }
      return false;
    }

    // Empty-state map slot: when an overview is configured, the placeholder
    // state hides the (circular) Leaflet canvas and shows the overview slot
    // instead, rendering it once on first reveal. No overview → no-op, so
    // the slot just stays the empty grey circle.
    function showOverview() {
      if (!overview) return;
      canvas.style.display = 'none';
      overviewEl.style.display = '';
      if (!overviewInited) { overviewInited = true; overviewHandle = overview(overviewEl, { selectLocation: selectLocation }) || null; }
      applyOverviewSize();              // honour the Size (px) control, which stays live in the empty state
    }
    function hideOverview() {
      if (!overview) return;
      overviewEl.style.display = 'none';
      canvas.style.display = '';
    }
    // Push the Size (px) value into the overview (if it exposed setSize). Size is the one control
    // that stays meaningful with no location chosen, so it resizes the empty-state map too.
    function applyOverviewSize() {
      if (!overviewHandle || typeof overviewHandle.setSize !== 'function') return;
      var px = parseInt(sizeEl.value, 10);
      if (isFinite(px)) overviewHandle.setSize(Math.max(50, Math.min(2000, px)));
    }
    // Grey out + disable the controls that only act on a rendered Mercator crop (Radius, Railways,
    // Render, Save PNG, export-zoom). Location + Size (px) stay live. Restores cleanly on exit,
    // re-applying any preset-driven radius disable. No-op for widgets without an empty state.
    function applyEmptyStateUI(isEmpty) {
      if (!hasEmptyState) return;
      railwaysEl.disabled = isEmpty;
      renderBtn.disabled = isEmpty;
      saveBtn.disabled = isEmpty;
      zoomEl.disabled = isEmpty;
      // Basemap toggle: only meaningful with a rendered location crop — the overview
      // (a Northern-Hǎo world map) has no OSM equivalent to toggle to, so it greys out.
      var bms = basemapRadios();
      if (bms) for (var b = 0; b < bms.length; b++) bms[b].disabled = isEmpty;
      var radios = radiusRadios();
      if (radios) for (var i = 0; i < radios.length; i++) radios[i].disabled = isEmpty;
      if (isEmpty) radiusEl.disabled = true;
      else { radiusEl.disabled = false; syncRadiusModeUI(); }   // syncRadiusModeUI re-disables the number input under a preset; no-op without presets
      mount.classList.toggle('map-explorer-empty', isEmpty);
    }

    function updateRailways() {
      if (!lmap) return;
      if (railwaysEl.checked) {
        if (!railwaysLayer) {
          railwaysLayer = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
            maxZoom: 19,
            crossOrigin: true,
            attribution: '© OpenRailwayMap (CC-BY-SA)'
          });
        }
        railwaysLayer.addTo(lmap);
      } else if (railwaysLayer) {
        railwaysLayer.remove();
      }
    }

    // Blank the canvas back to its empty grey circle and drop the Leaflet
    // instance — used when the placeholder ("nothing chosen") option is
    // selected. Tearing the map down (rather than hiding it) means Save
    // PNG correctly no-ops via its `if (!lmap)` guard, and a later real
    // selection rebuilds cleanly.
    function clearDisplay() {
      if (lmap) { lmap.remove(); lmap = null; railwaysLayer = null; }
      canvas.innerHTML = '';
      canvas.style.borderRadius = '50%';
      // Park the vector slot (instance stays cached — the basemap mode survives a trip
      // through the empty state) and restore the Leaflet canvas as the visible slot;
      // showOverview() below then swaps in the overview where one is configured.
      if (vectorEl) { vectorEl.style.display = 'none'; canvas.style.display = ''; }
      coordEl.textContent = '';
      rzEl.textContent = '';
      actualEl.textContent = '';
      zoomMaxEl.textContent = '';
      showOverview();                       // reveal the empty-state map (if any)
      applyEmptyStateUI(true);              // grey out the crop-only controls
    }

    function updateCoordReadout() {
      var opt = locEl.options[locEl.selectedIndex];
      var lat = opt && opt.dataset.lat;
      var lon = opt && opt.dataset.lon;
      if (!lat || !lon) { coordEl.textContent = ''; return; }
      // Full precision (raw data-lat/data-lon strings, not parsed→
      // toFixed) so trailing zeros from Nominatim/Overpass are preserved.
      // Bracketed as a math/geometric point pair to set them off from
      // surrounding text and match the personal-info convention.
      coordEl.textContent = '(' + lat + ', ' + lon + ')';
    }

    // ---- Radius read/write helpers ----
    // With presets, the "current" radius is the selected radio's value
    // (or the number-input value when Custom is selected). Without
    // presets, the number input is the single source of truth.
    function radiusRadios() {
      return radiusPresets
        ? mount.querySelectorAll('input[name="' + radiusModeName + '"]')
        : null;
    }
    function selectedRadiusMode() {
      var rs = radiusRadios();
      if (!rs) return null;
      for (var i = 0; i < rs.length; i++) if (rs[i].checked) return rs[i].value;
      return null;
    }
    function getRadiusKm() {
      if (!radiusPresets) return parseFloat(radiusEl.value);
      var v = selectedRadiusMode();
      if (v && v !== 'custom') return parseFloat(v);
      return parseFloat(radiusEl.value);
    }
    function syncRadiusModeUI() {
      if (!radiusPresets) return;
      var v = selectedRadiusMode();
      if (v === 'custom') {
        radiusEl.disabled = false;
      } else {
        radiusEl.disabled = true;
        if (v) radiusEl.value = parseFloat(v);
      }
    }
    function setRadiusKm(r) {
      if (!isFinite(r) || r <= 0) return;
      if (!radiusPresets) { radiusEl.value = r; return; }
      var rs = radiusRadios();
      var matched = false;
      for (var i = 0; i < rs.length; i++) {
        if (rs[i].value !== 'custom' && parseFloat(rs[i].value) === r) {
          rs[i].checked = true;
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (var j = 0; j < rs.length; j++) {
          if (rs[j].value === 'custom') { rs[j].checked = true; break; }
        }
        radiusEl.value = r;
      }
      syncRadiusModeUI();
    }

    function applyLocationRadius() {
      var opt = locEl.options[locEl.selectedIndex];
      if (!opt) return;
      var r = parseFloat(opt.dataset.radiusKm);
      if (isFinite(r) && r > 0) setRadiusKm(r);
    }

    function exportMaxZoom() {
      if (!lmap) return 19;
      var w = canvas.getBoundingClientRect().width;
      if (!w) return 19;
      var maxScale = (window.EXPORT_MAX_CANVAS_DIM || 8192) / w;
      return Math.min(19, Math.floor(lmap.getZoom() + Math.log2(maxScale)));
    }

    // Smallest zoom whose output canvas is still meaningfully a map —
    // 256 px = one tile, below which detail becomes unreadable. Symmetric
    // formula to exportMaxZoom but with ceil (the smallest integer zoom
    // whose output is ≥ MIN_OUTPUT_DIM).
    var MIN_OUTPUT_DIM = 256;
    function exportMinZoom() {
      if (!lmap) return 0;
      var w = canvas.getBoundingClientRect().width;
      if (!w) return 0;
      var minScale = MIN_OUTPUT_DIM / w;
      return Math.max(0, Math.ceil(lmap.getZoom() + Math.log2(minScale)));
    }

    function refreshExportZoomLimit() {
      var mn = exportMinZoom();
      var mx = exportMaxZoom();
      zoomEl.min = mn;
      zoomEl.max = mx;
      // Sibling span keeps the range visible even when the user has typed
      // a value; placeholder stays as just "auto" so the narrow input
      // doesn't crop it.
      zoomMaxEl.textContent = '· min ' + mn + ' · max ' + mx;
    }

    function render() {
      var opt = locEl.options[locEl.selectedIndex];
      if (!opt || opt.disabled) return;
      var lat = parseFloat(opt.dataset.lat);
      var lon = parseFloat(opt.dataset.lon);
      // Placeholder / coordless option ("Select location…") — blank the
      // canvas instead of drawing. Lets the user return to it any time to
      // clear the display.
      if (!isFinite(lat) || !isFinite(lon)) { clearDisplay(); return; }
      hideOverview();                       // a real location → show the active basemap slot (must precede the width probe below)
      applyEmptyStateUI(false);             // re-enable the crop-only controls
      var vector = vectorActive();
      applyVectorModeUI(vector);            // vector basemap → park the OSM-tile-only controls
      // Swap the display slots to the active basemap (Leaflet canvas vs vector slot).
      // Instances are never torn down on a flip — the hidden one just waits, and gets
      // refreshed lazily on its next activation via this same render() path.
      if (vectorEl) { vectorEl.style.display = vector ? '' : 'none'; canvas.style.display = vector ? 'none' : ''; }
      var size = parseInt(sizeEl.value, 10);
      var radiusKm = getRadiusKm();
      if (!isFinite(size) || size < 50) return;
      if (!isFinite(radiusKm) || radiusKm <= 0) return;
      // Clamp to the available column width — going wider would trigger
      // the slot's max-width:100% (which leaves height untouched and breaks
      // the square aspect ratio). Probe by stretching to 100% and reading
      // the laid-out width, then restore. Probe the VISIBLE slot — a
      // display:none one reports zero width.
      var probeEl = vector ? vectorEl : canvas;
      var prevW = probeEl.style.width;
      probeEl.style.width = '100%';
      var maxSize = Math.floor(probeEl.getBoundingClientRect().width);
      probeEl.style.width = prevW;
      if (maxSize > 0 && size > maxSize) {
        size = maxSize;
        sizeEl.value = size;
      }
      if (vector) {
        // ---- Vector basemap: delegate rendering to the page's callback ----
        // The widget owns the slot's box + circular clip (mirroring the Leaflet
        // canvas); the callback owns everything drawn inside it. Lazily built on
        // first activation, then re-cropped/resized in place — so flipping back
        // and forth is cheap and the readout mirrors the OSM one sans tile zoom.
        vectorEl.style.width = size + 'px';
        vectorEl.style.height = size + 'px';
        var loc = { value: opt.value, lat: lat, lon: lon };
        if (!vectorHandle) vectorHandle = vectorCrop(vectorEl, loc, radiusKm, size) || {};
        else if (typeof vectorHandle.update === 'function') vectorHandle.update(loc, radiusKm, size);
        rzEl.textContent = radiusKm + ' km radius · projection engine';
        actualEl.textContent = 'rendered: ' + size + ' × ' + size + ' px';
        zoomMaxEl.textContent = '';         // tile-zoom range is meaningless here
        return;
      }
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
      // Always rendered as a circle (the rounded-square option was
      // removed). Set unconditionally on every render in case anything
      // else cleared it.
      canvas.style.borderRadius = '50%';
      if (!lmap) {
        lmap = L.map(canvas, {
          // zoomSnap: 0 — we pass fractional zooms from computeZoom and
          // don't want them rounded.
          zoomSnap: 0,
          zoomControl: false, attributionControl: false,
          dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
          touchZoom: false, boxZoom: false, keyboard: false
        });
        // crossOrigin: true — needed so the export can draw tile <img>s
        // onto a canvas without tainting it.
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true }).addTo(lmap);
      }
      updateRailways();
      // Compute zoom after invalidateSize so the canvas reports its
      // laid-out width to the formula.
      setTimeout(function () {
        lmap.invalidateSize();
        var r = canvas.getBoundingClientRect();
        var z = computeZoom(lat, r.width, radiusKm);
        lmap.setView([lat, lon], z);
        rzEl.textContent = radiusKm + ' km radius · zoom ' + z.toFixed(4);
        actualEl.textContent = 'rendered: ' + Math.round(r.width) + ' × ' + Math.round(r.height) + ' px';
        refreshExportZoomLimit();
      }, 50);
    }

    // Auto-render on every control change + the explicit Render button.
    // Number inputs fire "change" on blur or Enter (not every keystroke),
    // so typing "20" doesn't render at "2" mid-stream.
    renderBtn.addEventListener('click', render);
    locEl.addEventListener('change', function () {
      applyLocationRadius();  // honours per-location data-radius-km
      updateCoordReadout();
      render();
    });
    sizeEl.addEventListener('change', function () {
      // Size stays live in the empty state, where it resizes the overview map
      // rather than the (absent) Leaflet crop.
      if (overview && !selectedHasCoords()) applyOverviewSize();
      else render();
    });
    radiusEl.addEventListener('change', render);
    if (radiusPresets) {
      // Radios fire 'change' only on the newly-checked one; sync the
      // number-input enable state, then re-render with the new value.
      mount.querySelectorAll('input[name="' + radiusModeName + '"]').forEach(function (r) {
        r.addEventListener('change', function () { syncRadiusModeUI(); render(); });
      });
    }
    railwaysEl.addEventListener('change', updateRailways);
    if (vectorCrop) {
      // Basemap flip → re-render: render() reads the checked radio and swaps slots.
      basemapRadios().forEach(function (r) { r.addEventListener('change', render); });
    }

    // Snap to integer + clamp to [min, max] on commit. The export
    // pipeline rounds internally anyway, so showing fractional values
    // would be misleading — the user sees exactly what's about to be
    // used. Round (not floor) so 5.4 → 5 and 5.6 → 6, the more
    // intuitive mapping of "type roughly what you want."
    zoomEl.addEventListener('change', function () {
      var v = parseFloat(this.value);
      if (!isFinite(v)) return;
      v = Math.round(v);
      var mn = exportMinZoom();
      var mx = exportMaxZoom();
      if (v > mx) v = mx;
      if (v < mn) v = mn;
      this.value = v;
    });

    saveBtn.addEventListener('click', function () {
      var opt = locEl.options[locEl.selectedIndex];
      // Vector basemap: map-export.js is Leaflet-tile-specific, so export here is a
      // plain snapshot of the engine canvas — drawn circle-clipped at its native
      // (devicePixelRatio-scaled) resolution onto a transparent-cornered PNG. No
      // tile zoom applies; the "at zoom" input is disabled in this mode.
      if (vectorActive()) {
        var src = (vectorHandle && typeof vectorHandle.getCanvas === 'function') ? vectorHandle.getCanvas() : null;
        if (!src || !src.width) return;
        var out = document.createElement('canvas');
        out.width = src.width; out.height = src.height;
        var octx = out.getContext('2d');
        octx.beginPath();
        octx.arc(out.width / 2, out.height / 2, Math.min(out.width, out.height) / 2, 0, 2 * Math.PI);
        octx.clip();
        octx.drawImage(src, 0, 0);
        var vname = filenamePrefix + '-' + opt.value + '-' + getRadiusKm() + 'km-vector.png';
        out.toBlob(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = vname;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }, 'image/png');
        return;
      }
      if (!lmap) return;
      var btnEl = this;
      var exportZ = parseInt(zoomEl.value, 10);
      if (!isFinite(exportZ)) exportZ = Math.round(lmap.getZoom());
      // Defensive clamp in case auto falls outside the displayed
      // [min, max] (formulas could drift if MIN_OUTPUT_DIM or
      // EXPORT_MAX_CANVAS_DIM change but the user already had a value).
      exportZ = Math.max(exportMinZoom(), Math.min(exportMaxZoom(), exportZ));
      var name = filenamePrefix + '-' + opt.value + '-' + getRadiusKm() + 'km-z' + exportZ + '.png';
      var oldText = btnEl.textContent;
      btnEl.disabled = true;
      btnEl.textContent = 'Saving…';
      Promise.resolve(window.exportMapAsPng(lmap, canvas, 'circle', name, function (done, total) {
        btnEl.textContent = 'Saving ' + done + '/' + total + '…';
      }, exportZ))
        .catch(function (e) { console.error(e); })
        .then(function () {
          btnEl.disabled = false;
          btnEl.textContent = oldText;
        });
    });

    // Initial state: pick up location's radius (if any), update the coord
    // readout, render once. Eager init — the map is the page's main
    // content, so no lazy <details>-toggle wrapping like on the test page.
    applyLocationRadius();
    updateCoordReadout();
    render();

    // Public API — currently just setLocations, used by pages that want
    // to swap the dropdown contents at runtime (e.g. cities-transport's "include
    // cities I've lived in" toggle). Picks the first option as the new
    // selection and re-renders.
    return {
      setLocations: function (newLocations) {
        locations = newLocations;
        locEl.innerHTML = buildLocationOptionsHtml(newLocations, placeholder);
        applyLocationRadius();
        updateCoordReadout();
        render();
      }
    };
  };
})();
