// division-map.js — the 行政区划 section's county overlay: every county of a territory drawn
// at once over OpenStreetMap tiles. Page-local to maps-projections (deployed as a sibling via
// build.py extra_files), not a shared widget in 界面 UI/map-widgets/ — nothing else uses it yet,
// and the two files there earned their place by having a SECOND consumer. Move it there if one
// appears; the API below is already config-shaped for that.
//
// Sibling in spirit to the Region Map Explorer above it, opposite in intent: that widget crops
// ONE circle at an exact radius, this one frames a WHOLE territory and fills every division in it.
//
// Depends on (all loaded by the page before this file):
//   - Leaflet 1.9.x
//   - map-export.js  (window.exportMapAsPng — called with the 7th `drawOverlay` argument, since
//                     the exporter rasterises tile layers only and the counties ARE the point)
//   - the data global, lazy-fetched: 引擎 Engines/map-projection/admin-divisions.js
//     (window.WORLD_ADMIN_DIVISIONS, built by that folder's scripts/make_admin_divisions.py)
//   - page-widgets/page-nav.js's 'section-expanded' event, if the host page has one — that is what
//     triggers the fetch. See the Data section at the bottom for why it cannot be a viewport check.
//
// Usage:
//   <div id="divisions"></div>
//   <script>
//     createDivisionMap({ mount: '#divisions', filenamePrefix: 'counties',
//                         dataSrc: '…/admin-divisions.js' });
//   </script>
(function () {
  var STYLE_ID = '__division-map-styles';
  var SEQ = 0;

  // Four-colour fills, indexed by the colour baked into each division by make_admin_divisions.py.
  // Deliberately the LIGHT half of world-map.js's regionColors (coral / green / blue / sand) in
  // BOTH themes: these sit on standard OSM raster tiles, which are light whatever the site theme
  // is, so the dark ramp would read as mud on them. Same hue order as the world map's UN-subregion
  // shading above, so the page keeps one four-colour vocabulary.
  var FILL = ['#e79a8e', '#9ecb92', '#9bb6e2', '#e7cd8a'];
  var FILL_OPACITY = 0.5;
  var STROKE = '#3f4a55';        // slate — legible over both the fills and bare tiles
  var STROKE_SELECTED = '#c2185b';
  // Compare overlay. Deliberately outside the four-colour palette and dashed, so a shape that has
  // been moved out of its real place can never be mistaken for one that belongs where it sits.
  var GHOST_STROKE = '#5b21b6';
  // The compare shape needs its own pane, created via map.createPane, so Leaflet builds it a
  // properly-positioned SVG renderer. Do NOT reuse a built-in pane: passing pane:'markerPane' for
  // a vector layer renders it at a visible offset (measured ~210 px low), because that pane is set
  // up for marker positioning, not for a renderer's viewport. z-index 620 puts it above the
  // territory fills (overlayPane, 400) and below the name labels (tooltipPane, 650).
  var GHOST_PANE = 'divisionGhostPane';
  var GHOST_PANE_Z = 620;
  var TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    // Mirrors .map-tester-controls / .map-tester-readout in map-widgets/map-explorer.js rather
    // than reusing those class names: that stylesheet is injected by createMapExplorer, so
    // borrowing it would make this widget silently depend on another one having run first.
    style.textContent =
      '.division-controls { display:flex; gap:0.8rem; align-items:center; flex-wrap:wrap; }' +
      '.division-controls label { display:inline-flex; align-items:center; gap:0.4rem; font-size:0.9rem; color:var(--text); }' +
      '.division-controls select {' +
      '  font:inherit; padding:0.4rem 0.6rem; background:var(--bg); color:var(--text);' +
      '  border:1px solid var(--border); border-radius:4px;' +
      '}' +
      // Centred plate, NOT full page width — see sizeToBounds() for why the aspect matters. These
      // are the PLACEHOLDER dimensions only: they reserve a sensible box at first paint, and
      // sizeToBounds overwrites height (and clears max-height) per territory once data arrives.
      // border-radius matches the 10 px corner the exporter's 'square' shape clips to, so the
      // PNG matches what is on screen.
      '.division-canvas {' +
      '  width:100%; max-width:560px; height:700px; max-height:78vh; margin:0.8rem auto 0;' +
      '  background:#eee; border-radius:10px; overflow:hidden;' +
      '}' +
      '.division-readout { margin-top:0.4rem; display:flex; align-items:flex-start; gap:0.8rem; flex-wrap:wrap; }' +
      '.division-readout .zoom-input {' +
      '  width:4.5rem; font:inherit; padding:0.4rem 0.6rem; background:var(--bg); color:var(--text);' +
      '  border:1px solid var(--border); border-radius:4px;' +
      '}' +
      '.division-readout .readout-meta {' +
      '  font-size:0.8rem; color:var(--muted); display:flex; flex-direction:column; gap:0.1rem;' +
      '}' +
      // Permanent name labels (the Labels toggle). Leaflet's default tooltip chrome — white box,
      // border, drop shadow, callout tip — turns 48 of these into confetti, so it is all stripped
      // back to bare text with a light halo that survives both the pale fills and bare tiles.
      '.division-label.leaflet-tooltip {' +
      '  background:none; border:none; box-shadow:none; padding:0; color:#1c252e;' +
      '  font-size:0.68rem; font-weight:600; white-space:nowrap; pointer-events:none;' +
      '  text-shadow:0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;' +
      '}' +
      '.division-label.leaflet-tooltip::before { display:none; }' +
      '.division-empty {' +
      '  height:100%; display:flex; align-items:center; justify-content:center;' +
      '  color:var(--muted); font-size:0.9rem;' +
      '}' +
      // Compare readout. Sits directly under the controls and above the map, because it explains
      // the dashed shape the eye has just landed on. Empty (and so zero-height) until used.
      '.division-cmp-note:not(:empty) {' +
      '  margin-top:0.5rem; padding:0.4rem 0.6rem; font-size:0.82rem; line-height:1.5;' +
      '  color:var(--text); background:var(--code-bg,rgba(127,127,127,0.10));' +
      '  border-left:3px solid ' + GHOST_STROKE + '; border-radius:3px;' +
      '}' +
      '.leaflet-interactive.division-ghost { cursor:move; }' +
      // Summary table. Scrolls inside its own box rather than widening the page on a phone.
      '.division-table { margin-top:1.2rem; overflow-x:auto; }' +
      '.division-table table { border-collapse:collapse; font-size:0.82rem; min-width:100%; }' +
      '.division-table caption {' +
      '  caption-side:bottom; margin-top:0.6rem; text-align:left;' +
      '  font-size:0.78rem; color:var(--muted); line-height:1.5; max-width:70ch;' +
      '}' +
      '.division-table th, .division-table td {' +
      '  padding:0.35rem 0.6rem; border-bottom:1px solid var(--border); text-align:left;' +
      '  white-space:nowrap;' +
      '}' +
      '.division-table thead th { color:var(--muted); font-weight:600; }' +
      '.division-table tbody th { font-weight:600; color:var(--text); }' +
      '.division-table .num { text-align:right; font-variant-numeric:tabular-nums; }' +
      '.division-table .dim { color:var(--muted); font-variant-numeric:tabular-nums; }';
    document.head.appendChild(style);
  }

  function resolveMount(m) { return typeof m === 'string' ? document.querySelector(m) : m; }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // One in-flight fetch per URL, shared by every caller — the widget asks on reveal and again on
  // any territory change, and a second <script> for the same ~800 KB would be pure waste.
  var pending = {};
  function loadScriptOnce(src) {
    if (window.WORLD_ADMIN_DIVISIONS) return Promise.resolve(window.WORLD_ADMIN_DIVISIONS);
    if (pending[src]) return pending[src];
    pending[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () {
        if (window.WORLD_ADMIN_DIVISIONS) resolve(window.WORLD_ADMIN_DIVISIONS);
        else reject(new Error('division-map: ' + src + ' loaded but WORLD_ADMIN_DIVISIONS is undefined'));
      };
      s.onerror = function () { reject(new Error('division-map: failed to load ' + src)); };
      document.head.appendChild(s);
    });
    return pending[src];
  }

  window.createDivisionMap = function (config) {
    var opts = config || {};
    var mount = resolveMount(opts.mount);
    if (!mount) return null;
    injectStyles();

    var idPfx = 'divmap-' + (++SEQ);
    var setId = idPfx + '-set', labelsId = idPfx + '-labels', canvasId = idPfx + '-canvas';
    var resetId = idPfx + '-reset', saveId = idPfx + '-save', zoomId = idPfx + '-zoom';
    var metaId = idPfx + '-meta', creditId = idPfx + '-credit';
    var cmpId = idPfx + '-cmp', cmpNoteId = idPfx + '-cmpnote', tableId = idPfx + '-table';
    var filenamePrefix = opts.filenamePrefix || 'divisions';

    // Built synchronously so the controls and a correctly-sized box exist at first paint and the
    // deferred data drop-in below does not shift the page.
    mount.innerHTML =
      '<div class="division-controls">' +
        '<label>Territory:<select id="' + setId + '"></select></label>' +
        '<label><input type="checkbox" id="' + labelsId + '"> Division names</label>' +
        '<label title="Draws any division at its TRUE ground size over this map, wherever you drag it. Web Mercator inflates area by sec²(latitude), so the same real area covers 2.8× the pixels at 53°N as it does at the equator — this control is how you see past that.">' +
          'Compare with:<select id="' + cmpId + '"></select>' +
        '</label>' +
      '</div>' +
      '<div class="division-cmp-note" id="' + cmpNoteId + '"></div>' +
      '<div class="division-canvas" id="' + canvasId + '">' +
        '<div class="division-empty">Loading boundaries…</div>' +
      '</div>' +
      '<div class="division-readout">' +
        '<button type="button" class="btn-primary" id="' + resetId + '" disabled>Reset view</button>' +
        '<button type="button" class="btn-primary" id="' + saveId + '" disabled>Save PNG</button>' +
        '<label title="Tile zoom level for the export PNG. Each +1 doubles each side of the file (4× total area). Empty = match the on-screen tile zoom.">' +
          'at zoom <input type="number" class="zoom-input" id="' + zoomId + '" min="0" max="19" step="1" placeholder="auto">' +
        '</label>' +
        '<div class="readout-meta">' +
          '<span id="' + metaId + '"></span>' +
          '<span id="' + creditId + '"></span>' +
        '</div>' +
      '</div>' +
      '<div class="division-table" id="' + tableId + '"></div>';

    var setEl = document.getElementById(setId);
    var labelsEl = document.getElementById(labelsId);
    var canvas = document.getElementById(canvasId);
    var resetBtn = document.getElementById(resetId);
    var saveBtn = document.getElementById(saveId);
    var zoomEl = document.getElementById(zoomId);
    var metaEl = document.getElementById(metaId);
    var creditEl = document.getElementById(creditId);
    var cmpEl = document.getElementById(cmpId);
    var cmpNoteEl = document.getElementById(cmpNoteId);
    var tableEl = document.getElementById(tableId);

    var DATA = null, lmap = null, layer = null, labelLayer = null, current = null, selected = null;
    // Compare-overlay state: the chosen division, its Leaflet layer, and the centre it is
    // currently pinned at (which the drag moves).
    var ghost = null, ghostLayer = null, ghostAt = null;

    // ---- Styling -------------------------------------------------------
    function styleFor(d) {
      var isSel = selected === d.name;
      return {
        color: isSel ? STROKE_SELECTED : STROKE,
        weight: isSel ? 2.5 : 1,
        opacity: 0.85,
        fillColor: FILL[d.color % FILL.length],
        fillOpacity: isSel ? 0.68 : FILL_OPACITY
      };
    }

    // A division's own description line. `alt` and `group` are generic on purpose: Irish name +
    // province for Ireland, romanisation + 吴语 subdivision (小片) for the Wu set, and England has
    // neither. Build from whatever is present rather than assuming a fixed shape.
    function describe(d) {
      var bits = [d.name];
      if (d.alt) bits.push('· ' + d.alt);
      if (d.group) bits.push('· ' + d.group);
      if (d.area) bits.push('· ' + d.area.toLocaleString('en-GB') + ' km²');
      return bits.join(' ');
    }

    // Fit the BOX to the territory before fitting the territory to the box. fitBounds zooms to
    // whichever axis is tighter, so a frame with the wrong aspect wastes the difference as empty
    // sea. In Web Mercator these sets are quite different shapes — England 0.83 and Ireland 0.78
    // wide-over-tall, but the Wu region ~0.95 — so one fixed height cannot serve all three.
    function sizeToBounds(b) {
      function mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
      var wDeg = b[1][1] - b[0][1];
      var hDeg = (mercY(b[1][0]) - mercY(b[0][0])) * 180 / Math.PI;   // into longitude-degree units
      if (!(wDeg > 0 && hDeg > 0)) return;
      var px = canvas.clientWidth || 560;
      var want = Math.round(px * hDeg / wDeg);
      // Clamp: never a letterbox slit, never taller than the viewport. maxHeight is cleared because
      // the CSS placeholder carries one, and it would silently override this.
      canvas.style.maxHeight = 'none';
      canvas.style.height = Math.max(320, Math.min(want, Math.round(window.innerHeight * 0.78))) + 'px';
      if (lmap) lmap.invalidateSize(false);
    }

    function setMeta(text) { metaEl.textContent = text; }

    function selectedDivision() {
      if (!selected || !current) return null;
      for (var i = 0; i < current.divisions.length; i++) {
        if (current.divisions[i].name === selected) return current.divisions[i];
      }
      return null;
    }

    // ---- Rendering -----------------------------------------------------
    function renderSet(key) {
      var set = DATA[key];
      if (!set) return;
      current = set;
      selected = null;

      if (!lmap) {
        canvas.innerHTML = '';
        lmap = L.map(canvas, { attributionControl: true, worldCopyJump: false });
        lmap.createPane(GHOST_PANE).style.zIndex = GHOST_PANE_Z;
        L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_ATTR, crossOrigin: true }).addTo(lmap);
      }
      if (layer) { lmap.removeLayer(layer); layer = null; }
      sizeToBounds(set.bounds);

      layer = L.geoJSON(null, {
        style: function (f) { return styleFor(f.properties.d); },
        onEachFeature: function (f, lyr) {
          var d = f.properties.d;
          lyr.on('mouseover', function () {
            if (selected !== d.name) lyr.setStyle({ weight: 2, fillOpacity: 0.68 });
            setMeta(describe(d));
          });
          lyr.on('mouseout', function () {
            if (selected !== d.name) lyr.setStyle(styleFor(d));
            // Fall back to the SELECTION, not to blank: leaving the last-hovered name up meant the
            // readout could say 上海市 while 舟山市 sat highlighted and zoomed.
            var sd = selectedDivision();
            setMeta(sd ? describe(sd) : '');
          });
          // Click selects and frames the county; clicking the selected one again clears back to
          // the whole territory, so the map is reachable both ways without hunting for Reset.
          lyr.on('click', function () {
            if (selected === d.name) { clearSelection(); return; }
            selected = d.name;
            layer.setStyle(function (ff) { return styleFor(ff.properties.d); });
            lmap.fitBounds(d.bounds, { padding: [24, 24] });
            setMeta(describe(d));
            drawGhost();                 // its note carries a "vs <selection>" line
          });
        }
      });
      set.divisions.forEach(function (d) {
        layer.addData({ type: 'Feature', properties: { d: d },
                        geometry: { type: 'MultiPolygon', coordinates: d.poly } });
      });
      layer.addTo(lmap);
      applyLabels();
      lmap.fitBounds(set.bounds, { padding: [12, 12] });
      // Carry the compare shape into the new view. Comparing ACROSS territories is the whole point
      // (杭州市 dropped on England), so it must survive a territory switch — but its old position
      // is now off-screen, so re-drop it at the new centre.
      if (ghost) { var gc = lmap.getCenter(); ghostAt = [gc.lat, gc.lng]; }
      drawGhost();

      resetBtn.disabled = false;
      saveBtn.disabled = false;
      setMeta('');
      creditEl.textContent = set.kind + ' — ' + set.attribution;
    }

    function clearSelection() {
      selected = null;
      if (layer) layer.setStyle(function (ff) { return styleFor(ff.properties.d); });
      if (current) lmap.fitBounds(current.bounds, { padding: [12, 12] });
      setMeta('');
      drawGhost();
    }

    // Where a division's name goes: the centroid of its LARGEST outer ring.
    //
    // Not Leaflet's own placement. bindTooltip on a path anchors at layer.getCenter(), which for a
    // multi-part shape uses the FIRST ring in the coordinate array — arbitrary, and wrong wherever
    // a division has distant outliers. 上海市 is the case that forced this: OSM correctly gives it
    // its real exclaves in Anhui (白茅岭, 军天湖农场), and the label was landing on one of those,
    // ~250 km west of Shanghai and inside another province.
    //
    // Largest-ring centroid is still only a heuristic — on a crescent like Cornwall or Kerry a
    // centroid can sit just offshore. That is a fair price for a toggle that is off by default,
    // and far cheaper than a real pole-of-inaccessibility pass.
    function labelPoint(d) {
      var best = null, bestArea = -1;
      d.poly.forEach(function (rings) {
        var r = rings[0], a = 0;                       // rings[0] is the outer ring; holes cannot host a label
        for (var i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
        a = Math.abs(a) / 2;
        if (a > bestArea) { bestArea = a; best = r; }
      });
      if (!best) return null;
      var cx = 0, cy = 0, f = 0;
      for (var i = 0; i < best.length - 1; i++) {
        var x0 = best[i][0], y0 = best[i][1], x1 = best[i + 1][0], y1 = best[i + 1][1];
        var cr = x0 * y1 - x1 * y0;
        f += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
      }
      if (!f) return null;
      return [cy / (3 * f), cx / (3 * f)];             // stored [lon, lat] → Leaflet [lat, lng]
    }

    // Standalone tooltips in their own group rather than bound to each path, so the anchor above is
    // honoured and clearing them is one removeLayer.
    function applyLabels() {
      if (!lmap) return;
      if (labelLayer) { lmap.removeLayer(labelLayer); labelLayer = null; }
      if (!labelsEl.checked || !current) return;
      labelLayer = L.layerGroup();
      current.divisions.forEach(function (d) {
        var pt = labelPoint(d);
        if (!pt) return;
        L.tooltip({ permanent: true, direction: 'center', className: 'division-label' })
          .setContent(d.name).setLatLng(pt).addTo(labelLayer);
      });
      labelLayer.addTo(lmap);
    }

    // ---- True-scale comparison overlay ---------------------------------
    //
    // The problem this exists for. Web Mercator scales area by sec²(latitude), so on the OSM
    // basemap an English county at 53°N is inflated 2.76× while a Chinese prefecture at 30°N is
    // inflated only 1.33×. 杭州市 (16,850 km²) is 95% larger than North Yorkshire (8,646 km²) and
    // yet draws about 6% SMALLER. A territory dropdown that invites comparison across 23° of
    // latitude is therefore actively misleading, and a table of areas underneath does not fix it —
    // it just contradicts the picture. This does: pick a division, drag its outline anywhere, and
    // it is continuously re-projected to keep its TRUE ground size at wherever it now sits.
    //
    // Method: hold each vertex's offset from the shape's own centre in ground units. Latitude
    // offsets carry over unchanged (a degree of latitude is the same length everywhere); longitude
    // offsets are rescaled by cos(oldLat)/cos(newLat), because a degree of longitude shortens
    // toward the poles. Per-vertex rather than one factor for the whole shape, so tall divisions
    // (Cumbria, 杭州市) do not shear. This is the thetruesize.com transform.
    function ghostCentre(d) {
      return [(d.bounds[0][0] + d.bounds[1][0]) / 2, (d.bounds[0][1] + d.bounds[1][1]) / 2];
    }

    function reproject(poly, from, to) {
      var RAD = Math.PI / 180;
      var cosFrom = Math.cos(from[0] * RAD);
      return poly.map(function (rings) {
        return rings.map(function (ring) {
          return ring.map(function (p) {
            var lat = to[0] + (p[1] - from[0]);
            var c = Math.cos(lat * RAD);
            // Guard the poles: cos → 0 makes the longitude scale blow up. Nothing in these three
            // sets goes near it, but a dragged shape can be thrown anywhere on the map.
            var k = Math.abs(c) < 1e-6 ? 1 : Math.cos(p[1] * RAD) / c;
            return [to[1] + (p[0] - from[1]) * k, lat];
          });
        });
      });
    }

    // How much more (or less) screen area the ghost covers here than at home — the distortion made
    // into a number. Mercator area scale ∝ sec²(lat), so the ratio is cos²(home)/cos²(here).
    function inflation(homeLat, hereLat) {
      var RAD = Math.PI / 180;
      var a = Math.cos(homeLat * RAD), b = Math.cos(hereLat * RAD);
      if (Math.abs(b) < 1e-6) return Infinity;
      return (a * a) / (b * b);
    }

    function fmtKm2(n) { return n.toLocaleString('en-GB') + ' km²'; }

    function drawGhost() {
      if (ghostLayer) { lmap.removeLayer(ghostLayer); ghostLayer = null; }
      if (!ghost) { cmpNoteEl.textContent = ''; return; }
      var home = ghostCentre(ghost);
      var coords = reproject(ghost.poly, home, ghostAt);
      ghostLayer = L.geoJSON({ type: 'Feature', properties: {},
                               geometry: { type: 'MultiPolygon', coordinates: coords } },
                             { style: { color: GHOST_STROKE, weight: 2, opacity: 0.95,
                                        dashArray: '6 4', fillColor: GHOST_STROKE,
                                        fillOpacity: 0.22, interactive: true,
                                        className: 'division-ghost' },
                               pane: GHOST_PANE });
      ghostLayer.addTo(lmap);
      bindGhostDrag();

      var infl = inflation(home[0], ghostAt[0]);
      // describe() already ends with the area — don't append it twice.
      var bits = [describe(ghost) + ' · drawn at true size'];
      if (Math.abs(infl - 1) >= 0.02) {
        bits.push('covers ' + infl.toFixed(2) + '× the pixels here as at home (' +
                  home[0].toFixed(1) + '°N → ' + ghostAt[0].toFixed(1) + '°N)');
      }
      var sd = selectedDivision();
      if (sd && sd.name !== ghost.name) {
        var r = ghost.area / sd.area;
        bits.push('vs ' + sd.name + ' ' + fmtKm2(sd.area) + ' — ' +
                  (r >= 1 ? r.toFixed(2) + '× larger' : (1 / r).toFixed(2) + '× smaller'));
      }
      cmpNoteEl.textContent = bits.join('  ·  ');
    }

    // Drag by hand: Leaflet has no draggable polygon. Grab on mousedown over the ghost, follow the
    // map's own mousemove (which already gives geographic coords, so no pixel maths), release on
    // mouseup. Map dragging is suspended meanwhile or the basemap would slide with the shape.
    function bindGhostDrag() {
      if (!ghostLayer) return;
      ghostLayer.on('mousedown', function (ev) {
        if (!ghost) return;
        L.DomEvent.stop(ev.originalEvent);
        lmap.dragging.disable();
        var grabbed = ev.latlng, start = [ghostAt[0], ghostAt[1]];
        function move(e) {
          ghostAt = [start[0] + (e.latlng.lat - grabbed.lat), start[1] + (e.latlng.lng - grabbed.lng)];
          drawGhost();                     // rebuilds the layer, so re-grab against the new one
        }
        function up() {
          lmap.off('mousemove', move); lmap.off('mouseup', up);
          document.removeEventListener('mouseup', up);
          lmap.dragging.enable();
        }
        lmap.on('mousemove', move); lmap.on('mouseup', up);
        document.addEventListener('mouseup', up);   // catch a release outside the map
      });
    }

    function setGhost(key) {
      ghost = null;
      if (key && DATA) {
        // Key is "<setKey>:<index>", NOT "<setKey> <name>". Names contain spaces — splitting
        // "england Greater London (incl. City of London)" on a space yields "Greater", and the
        // lookup silently finds nothing. An index cannot be ambiguous.
        var cut = key.indexOf(':');
        var set = DATA[key.slice(0, cut)];
        var i = parseInt(key.slice(cut + 1), 10);
        if (set && set.divisions[i]) ghost = set.divisions[i];
      }
      // Drop it at the middle of what is on screen, not at its own home — the point is to see it
      // against the territory currently displayed.
      if (ghost && lmap) {
        var c = lmap.getCenter();
        ghostAt = [c.lat, c.lng];
      }
      drawGhost();
    }

    function buildCompareOptions() {
      var html = '<option value="">none</option>';
      Object.keys(DATA).forEach(function (k) {
        html += '<optgroup label="' + escHtml(DATA[k].label) + '">';
        DATA[k].divisions.forEach(function (d, i) {
          html += '<option value="' + escHtml(k + ':' + i) + '">' +
                  escHtml(d.name) + ' — ' + fmtKm2(d.area) + '</option>';
        });
        html += '</optgroup>';
      });
      cmpEl.innerHTML = html;
    }

    // ---- Summary table -------------------------------------------------
    // Reads the areas baked into the data by make_admin_divisions.py, so it cannot drift from the
    // shapes above it. Three rows — one per territory — because the interesting comparison is
    // between SYSTEMS of division, not between 89 individual counties.
    function buildTable() {
      var rows = Object.keys(DATA).map(function (k) {
        var s = DATA[k];
        return '<tr>' +
          '<th scope="row">' + escHtml(s.label) + '</th>' +
          '<td>' + escHtml(s.kind) + '</td>' +
          '<td class="num">' + s.count + '</td>' +
          '<td class="num">' + s.area_total.toLocaleString('en-GB') + '</td>' +
          '<td class="num">' + s.area_mean.toLocaleString('en-GB') + '</td>' +
          '<td class="num">' + s.area_median.toLocaleString('en-GB') + '</td>' +
          '<td>' + escHtml(s.largest.name) + ' <span class="dim">' +
            s.largest.area.toLocaleString('en-GB') + '</span></td>' +
          '<td>' + escHtml(s.smallest.name) + ' <span class="dim">' +
            s.smallest.area.toLocaleString('en-GB') + '</span></td>' +
          '<td class="num">' + Math.round(s.largest.area / s.smallest.area) + '×</td>' +
        '</tr>';
      }).join('');
      tableEl.innerHTML =
        '<table>' +
          '<caption>Area enclosed by each set of boundaries, km². Computed from the geometry drawn ' +
            'above, so it includes tidal water inside an administrative line — estuary divisions ' +
            'read high (Bristol 236 against a published land area of 110). Inland divisions are ' +
            'within about 1% of published figures.</caption>' +
          '<thead><tr>' +
            '<th scope="col">Territory</th><th scope="col">Divisions of</th>' +
            '<th scope="col" class="num">n</th><th scope="col" class="num">Total</th>' +
            '<th scope="col" class="num">Mean</th><th scope="col" class="num">Median</th>' +
            '<th scope="col">Largest</th><th scope="col">Smallest</th>' +
            '<th scope="col" class="num">Spread</th>' +
          '</tr></thead><tbody>' + rows + '</tbody>' +
        '</table>';
    }

    // ---- Export --------------------------------------------------------
    // The exporter draws tile layers only, so hand it a painter for the vector half. Same fills,
    // same stroke weights, same even-odd hole handling as the on-screen layer — scaled by `scale`
    // so line weights stay visually equal at a higher export zoom instead of hairlining away.
    function paintOverlay(ctx, project, scale) {
      if (!current) return;
      ctx.save();
      ctx.lineJoin = 'round';
      current.divisions.forEach(function (d) {
        var st = styleFor(d);
        ctx.beginPath();
        d.poly.forEach(function (rings) {
          rings.forEach(function (ring) {
            for (var i = 0; i < ring.length; i++) {
              var p = project([ring[i][1], ring[i][0]]);   // stored [lon, lat] → Leaflet [lat, lng]
              if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
          });
        });
        ctx.fillStyle = st.fillColor;
        ctx.globalAlpha = st.fillOpacity;
        ctx.fill('evenodd');                                // ring order is [outer, …holes]
        ctx.globalAlpha = st.opacity;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = st.weight * scale;
        ctx.stroke();
      });
      // The compare shape too, if one is up — same dashed treatment. Without this a saved PNG
      // would quietly drop the very thing the export was taken to capture.
      if (ghost && ghostAt) {
        var coords = reproject(ghost.poly, ghostCentre(ghost), ghostAt);
        ctx.beginPath();
        coords.forEach(function (rings) {
          rings.forEach(function (ring) {
            for (var i = 0; i < ring.length; i++) {
              var p = project([ring[i][1], ring[i][0]]);
              if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
          });
        });
        ctx.fillStyle = GHOST_STROKE;
        ctx.globalAlpha = 0.22;
        ctx.fill('evenodd');
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = GHOST_STROKE;
        ctx.lineWidth = 2 * scale;
        ctx.setLineDash([6 * scale, 4 * scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ---- Wiring --------------------------------------------------------
    setEl.addEventListener('change', function () { renderSet(setEl.value); });
    cmpEl.addEventListener('change', function () { setGhost(cmpEl.value); });
    labelsEl.addEventListener('change', applyLabels);
    resetBtn.addEventListener('click', clearSelection);

    saveBtn.addEventListener('click', function () {
      if (!lmap || !current) return;
      var btn = this;
      var z = parseInt(zoomEl.value, 10);
      if (!isFinite(z)) z = Math.round(lmap.getZoom());
      var name = filenamePrefix + '-' + setEl.value + '-z' + z + '.png';
      var old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      Promise.resolve(window.exportMapAsPng(lmap, canvas, 'square', name, function (done, total) {
        btn.textContent = 'Saving ' + done + '/' + total + '…';
      }, z, paintOverlay))
        .catch(function (e) { console.error(e); })
        .then(function () { btn.disabled = false; btn.textContent = old; });
    });

    // ---- Data ----------------------------------------------------------
    // 700 KB of county geometry, deferred until the section is actually opened — the page already
    // ships ~3 MB of basemap for the two sections above it.
    //
    // The trigger is page-widgets/page-nav.js's 'section-expanded' event, which is the site's SSOT
    // for exactly this ("pages lazy-init heavy widgets on this"). On any page with a Contents nav
    // every section starts COLLAPSED — page-nav classes each element between two <h2>s with
    // .pn-collapsed, i.e. height:0 + visibility:hidden. An IntersectionObserver cannot substitute:
    // a zero-height box never intersects anything, so it would wait forever on precisely the pages
    // that need it.
    var started = false;
    function start() {
      if (started) return;
      started = true;
      loadScriptOnce(opts.dataSrc).then(function (data) {
        DATA = data;
        // Territory list comes from the DATA, in its own key order — adding a set to
        // make_admin_divisions.py puts it in the dropdown with no change here. opts.sets only
        // exists to let a host page show a subset or reorder them.
        var setKeys = opts.sets || Object.keys(data);
        setEl.innerHTML = setKeys.filter(function (k) { return data[k]; }).map(function (k) {
          return '<option value="' + escHtml(k) + '">' + escHtml(data[k].label) + '</option>';
        }).join('');
        buildCompareOptions();
        buildTable();
        renderSet(setEl.value);
      }).catch(function (e) {
        console.error(e);
        canvas.innerHTML = '<div class="division-empty">Boundaries could not be loaded.</div>';
      });
    }

    // The event bubbles to document from whichever <h2> was opened, so re-check OUR box rather than
    // trusting the event: a sibling section expanding says nothing about this one.
    function startIfVisible() { if (mount.offsetHeight > 0) start(); }
    document.addEventListener('section-expanded', startIfVisible);
    // Fallback for a page with no Contents nav (fewer than two <h2>s) or a section page-nav opened
    // from the URL hash before this listener existed: nothing will ever fire the event, so settle it
    // once the DOM is ready. Not sooner — this widget is built during parse, while page-nav is
    // `defer`red and has not collapsed anything yet, so an immediate check always reads "visible"
    // and would load the data eagerly on every visit. start() is idempotent, so a race is harmless.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startIfVisible);
    } else {
      startIfVisible();
    }

    return { start: start, select: function (name) { selected = name; }, getMap: function () { return lmap; } };
  };
})();
