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
  function buildLocationOptionsHtml(locations) {
    return locations.map(function (loc) {
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

  function buildLocationSelectHtml(id, locations) {
    return '<select id="' + id + '" aria-describedby="' + id + '-coord">' +
      buildLocationOptionsHtml(locations) +
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

    // Inject markup
    var selectId = idPfx + '-loc';
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
        '<span class="map-radius-group">Radius (km):' +
          presetRadiosHtml +
          '<label><input type="radio" name="' + radiusModeName + '" value="custom"' + customChecked + '> Custom</label>' +
          '<input type="number" id="' + radiusId + '" value="' + defaultRadiusKm + '" min="0.5" max="5000" step="1"' + numberDisabled + '>' +
        '</span>';
    } else {
      radiusControlHtml =
        '<label>Radius (km):' +
          '<input type="number" id="' + radiusId + '" value="' + defaultRadiusKm + '" min="0.5" max="5000" step="1">' +
        '</label>';
    }

    mount.innerHTML =
      '<div class="map-tester-controls">' +
        '<label>' + escHtml(locationLabel) + ':' +
          buildLocationSelectHtml(selectId, locations) +
        '</label>' +
        '<label>Size (px):' +
          '<input type="number" id="' + sizeId + '" value="360" min="50" max="2000" step="10">' +
        '</label>' +
        radiusControlHtml +
        '<label><input type="checkbox" id="' + railwaysId + '"> Railways</label>' +
      '</div>' +
      '<div class="map-explorer-canvas" id="' + canvasId + '"></div>' +
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
    var coordEl = document.getElementById(coordId);
    var rzEl = document.getElementById(rzId);
    var actualEl = document.getElementById(actualId);
    var lmap = null;
    var railwaysLayer = null;

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
      var size = parseInt(sizeEl.value, 10);
      var radiusKm = getRadiusKm();
      if (!isFinite(size) || size < 50) return;
      if (!isFinite(radiusKm) || radiusKm <= 0) return;
      // Clamp to the available column width — going wider would trigger
      // canvas's max-width:100% (which leaves height untouched and breaks
      // the square aspect ratio). Probe by stretching to 100% and reading
      // the laid-out width, then restore.
      var prevW = canvas.style.width;
      canvas.style.width = '100%';
      var maxSize = Math.floor(canvas.getBoundingClientRect().width);
      canvas.style.width = prevW;
      if (maxSize > 0 && size > maxSize) {
        size = maxSize;
        sizeEl.value = size;
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
    sizeEl.addEventListener('change', render);
    radiusEl.addEventListener('change', render);
    if (radiusPresets) {
      // Radios fire 'change' only on the newly-checked one; sync the
      // number-input enable state, then re-render with the new value.
      mount.querySelectorAll('input[name="' + radiusModeName + '"]').forEach(function (r) {
        r.addEventListener('change', function () { syncRadiusModeUI(); render(); });
      });
    }
    railwaysEl.addEventListener('change', updateRailways);

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
      if (!lmap) return;
      var btnEl = this;
      var opt = locEl.options[locEl.selectedIndex];
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
        locEl.innerHTML = buildLocationOptionsHtml(newLocations);
        applyLocationRadius();
        updateCoordReadout();
        render();
      }
    };
  };
})();
