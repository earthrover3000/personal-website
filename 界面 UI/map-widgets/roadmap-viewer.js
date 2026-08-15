// roadmap-viewer.js — shared "curated GeoJSON road map" viewer for the
// Cities & Transport page's three map sections (Cambridge Cycleways,
// Lujiazui Roads, Yangtze Delta Motorways). Distilled from the three
// research previews in P:\资料 Materials\…\创作 Works\cities-transport\
// (which keep the research tools: pins, bbox copy, cursor readout, full
// variants); this widget is the clean public viewer:
//
//   - schematic look by default (no base tiles), "Show base map" toggle
//   - legend rows from supplied swatch specs
//   - ONE shared hover tooltip (per-feature bound tooltips strand copies
//     whenever a mouseout is missed and pile up until refresh)
//   - page-specific extra toggles via config callbacks
//   - lossless PNG export: vectors drawn straight onto a canvas in Web
//     Mercator — BOTH axes in radians (mixing degree x with radian y is
//     the 57.3× ribbon bug, 2026-07-24) — transparent ground, ZERO
//     padding (image rectangle = data bbox exactly)
//   - permanent "© OpenStreetMap contributors" attribution: the vectors
//     are OSM-derived (ODbL), so the credit stays even in schematic mode
//
// Depends on Leaflet 1.9.x, loaded by the page before this file.
// Data + per-section styling stay page-side: the page passes style/label
// callbacks and swatch colors (usually derived from road-palette.js).
//
// Usage:
//
//   var viewer = createRoadmapViewer({
//     mount: '#cam-map',
//     fc: CAMBRIDGE_CYCLEWAYS,          // initial FeatureCollection
//     style: function (f) { … },        // Leaflet style per feature
//     label: function (props) { … },    // hover tooltip HTML ('' = none)
//     legend: [{ color:'#2d8a4e', text:'track — separated path' },
//              { color:'#2f8f8a', dashed:true, text:'shared-use path' }],
//     toggles: [{ id:'hide-streets', label:'Hide streets',
//                 onChange:function (checked, api) { … } }],
//     exportName: 'cambridge-cycleways.png',
//     height: 480,                      // optional, px
//     preferCanvas: true,               // for multi-thousand-path data
//     exportLong: 2400, exportWeightScale: 2.5,   // optional export tuning
//     exportSort: function (a, b) { … } // optional draw order (default:
//   });                                 //   weight ascending, major on top)
//
// Lazy init against page-nav.js's collapsed-by-default sections:
//
//   createRoadmapViewer.lazy('cambridge-cycleways', ['cycle-data.js'],
//     function () { createRoadmapViewer({ … }); });
//
// waits for the section's first 'section-expanded' event before injecting
// the data <script>s and building the map — a multi-hundred-KB dataset
// only ever downloads for sections the reader actually opens. If the
// section never got collapsed (page-nav absent), it initializes right
// after DOMContentLoaded instead.

(function () {
  var STYLE_ID = '__roadmap-viewer-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.rv-legend { display:flex; flex-wrap:wrap; gap:0.2rem 1.4rem;' +
      '  margin:0 0 0.6rem; font-size:0.85rem; color:var(--text); }' +
      '.rv-legend .rv-item { display:inline-flex; align-items:center; gap:0.5rem; }' +
      '.rv-swatch { display:inline-block; width:22px; height:0; border-bottom:3px solid; }' +
      '.rv-swatch.rv-dashed { border-bottom-style:dashed; }' +
      // Controls row reuses the shared control styling injected by
      // map-explorer.js? No — that injection is explorer-scoped, so the
      // few rules needed here are declared locally instead of reaching in.
      '.rv-controls { display:flex; gap:0.4rem 1.4rem; align-items:center;' +
      '  flex-wrap:wrap; margin:0 0 0.8rem; }' +
      '.rv-controls label { display:inline-flex; align-items:center; gap:0.4rem;' +
      '  font-size:0.9rem; color:var(--text); cursor:pointer; }' +
      '.rv-controls label.rv-disabled { opacity:0.45; cursor:default; }' +
      '.rv-export { font:inherit; font-size:0.85rem; padding:0.25rem 0.7rem;' +
      '  background:var(--bg); color:var(--text); border:1px solid var(--border);' +
      '  border-radius:4px; cursor:pointer; }' +
      '.rv-export:hover { border-color:var(--accent); color:var(--accent); }' +
      // The map itself. Theme-aware ground so the schematic view reads as
      // part of the page in dark mode; Leaflet's own #ddd is overridden.
      '.rv-map { width:100%; border:1px solid var(--border); border-radius:8px; }' +
      '.rv-map.leaflet-container { background:var(--surface); }';
    document.head.appendChild(style);
  }

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  window.createRoadmapViewer = function (config) {
    injectStyles();
    var mount = (typeof config.mount === 'string')
      ? document.querySelector(config.mount) : config.mount;
    if (!mount) {
      console.error('createRoadmapViewer: mount element not found', config.mount);
      return null;
    }
    var styleOf = config.style;
    var labelOf = config.label || function () { return ''; };
    var exportName = config.exportName || 'map.png';

    // ---- Markup: legend / controls / map ------------------------------
    var legendEl = el('div', 'rv-legend', mount);
    (config.legend || []).forEach(function (item) {
      var row = el('span', 'rv-item', legendEl);
      var sw = el('span', 'rv-swatch' + (item.dashed ? ' rv-dashed' : ''), row);
      sw.style.borderBottomColor = item.color;
      row.appendChild(document.createTextNode(item.text));
    });

    var controlsEl = el('div', 'rv-controls', mount);
    var idPfx = mount.id || ('rv-' + Math.random().toString(36).slice(2, 8));

    function addToggle(id, labelText, checked, onChange) {
      var label = el('label', null, controlsEl);
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = idPfx + '-' + id;
      box.checked = !!checked;
      label.appendChild(box);
      label.appendChild(document.createTextNode(' ' + labelText));
      box.addEventListener('change', function () { onChange(box.checked); });
      return { input: box, label: label };
    }

    var mapEl = el('div', 'rv-map', mount);
    mapEl.style.height = (config.height || 480) + 'px';

    // ---- Map + data layer ---------------------------------------------
    var map = L.map(mapEl, { preferCanvas: !!config.preferCanvas, maxZoom: 19 });
    // The data is ODbL regardless of whether tiles are showing.
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
    var base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                           { maxZoom: 19, opacity: 0.35 });

    var roadTip = L.tooltip({ direction: 'top', offset: [0, -6] });
    function buildLayer(fc) {
      return L.geoJSON(fc, {
        style: styleOf,
        onEachFeature: function (f, layer) {
          layer.on('mousemove', function (e) {
            var html = labelOf(f.properties);
            if (!html) return;
            roadTip.setLatLng(e.latlng).setContent(html);
            if (!map.hasLayer(roadTip)) roadTip.addTo(map);
          });
          layer.on('mouseout', function () { map.removeLayer(roadTip); });
        }
      });
    }

    var currentFC = null;
    var roadsLayer = null;
    function setFC(fc, opts) {
      opts = opts || {};
      map.removeLayer(roadTip);       // don't strand a label from the old layer
      if (roadsLayer) map.removeLayer(roadsLayer);
      currentFC = fc;
      roadsLayer = buildLayer(fc);
      // First layer must be added AFTER the view exists on later calls but
      // the very first setFC also establishes the view: fit before add
      // crashes Leaflet ("reading 'min'"), so add first, then fit.
      roadsLayer.addTo(map);
      if (opts.fit || !map._loaded) map.fitBounds(roadsLayer.getBounds());
      if (opts.exportName) exportName = opts.exportName;
    }

    // ---- Base-map toggle (schematic by default) -----------------------
    var baseAllowed = true;
    var baseToggle = addToggle('base', 'Show base map', false, applyBase);
    function applyBase() {
      var on = baseAllowed && baseToggle.input.checked;
      if (on && !map.hasLayer(base)) base.addTo(map);
      if (!on && map.hasLayer(base)) map.removeLayer(base);
    }
    // For views whose coordinates no longer align with real-world tiles
    // (e.g. Lujiazui's rectified frame): force the base off + grey the
    // toggle; the user's choice survives underneath and restores.
    function setBaseAllowed(allowed) {
      baseAllowed = allowed;
      baseToggle.input.disabled = !allowed;
      baseToggle.label.classList.toggle('rv-disabled', !allowed);
      applyBase();
    }

    // ---- API (built before extra toggles so their callbacks can use it) --
    var api = {
      map: map,
      setFC: setFC,
      setBaseAllowed: setBaseAllowed,
      getFC: function () { return currentFC; }
    };

    (config.toggles || []).forEach(function (t) {
      addToggle(t.id, t.label, t.checked, function (checked) {
        t.onChange(checked, api);
      });
    });

    // ---- PNG export ---------------------------------------------------
    var exportBtn = el('button', 'rv-export', controlsEl);
    exportBtn.type = 'button';
    exportBtn.textContent = '⤓ Save PNG';
    exportBtn.title = 'Lossless PNG of the current data view — transparent ground, no tiles';
    exportBtn.addEventListener('click', function () {
      if (currentFC) exportPNG(currentFC, exportName);
    });

    function exportPNG(fc, filename) {
      var LONG = config.exportLong || 2400;
      var WSCALE = config.exportWeightScale || 2.5;
      function mercX(lng) { return lng * Math.PI / 180; }
      function mercY(lat) {
        return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
      }
      // LineString and MultiLineString both occur (YRD merges ways with
      // identical properties into MultiLineStrings to shrink the file).
      function linesOf(f) {
        return f.geometry.type === 'MultiLineString'
          ? f.geometry.coordinates : [f.geometry.coordinates];
      }
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      fc.features.forEach(function (f) {
        linesOf(f).forEach(function (line) {
          line.forEach(function (c) {
            var x = mercX(c[0]), y = mercY(c[1]);
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          });
        });
      });
      var k = LONG / Math.max(x1 - x0, y1 - y0);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round((x1 - x0) * k);
      canvas.height = Math.round((y1 - y0) * k);
      var ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      var feats = fc.features.slice().sort(config.exportSort || function (a, b) {
        return styleOf(a).weight - styleOf(b).weight;   // thin first, major on top
      });
      feats.forEach(function (f) {
        var s = styleOf(f);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.weight * WSCALE;
        ctx.globalAlpha = (s.opacity != null) ? s.opacity : 1;
        ctx.setLineDash(s.dashArray
          ? s.dashArray.split(' ').map(function (n) { return n * WSCALE; }) : []);
        ctx.beginPath();
        linesOf(f).forEach(function (line) {
          line.forEach(function (c, i) {
            var px = (mercX(c[0]) - x0) * k;
            var py = (y1 - mercY(c[1])) * k;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
        });
        ctx.stroke();
      });
      canvas.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    }

    // ---- Initial render ----------------------------------------------
    if (config.fc) setFC(config.fc);
    return api;
  };

  // ---- Lazy init helper (see header) ----------------------------------
  window.createRoadmapViewer.lazy = function (h2Id, dataSrcs, build) {
    function loadThenBuild() {
      var remaining = dataSrcs.length;
      if (!remaining) { build(); return; }
      dataSrcs.forEach(function (src) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { if (--remaining === 0) build(); };
        s.onerror = function () {
          console.error('roadmap-viewer: failed to load data script', src);
        };
        document.head.appendChild(s);
      });
    }
    function arm() {
      var h2 = document.getElementById(h2Id);
      if (!h2) { console.error('roadmap-viewer: no section h2 #' + h2Id); return; }
      // page-nav.js has run by DOMContentLoaded (it loads deferred): a
      // collapsed section shows aria-expanded="false". No collapse state →
      // the section is visible; build straight away.
      if (h2.getAttribute('aria-expanded') === 'false') {
        h2.addEventListener('section-expanded', loadThenBuild, { once: true });
      } else {
        loadThenBuild();
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', arm);
    } else {
      arm();
    }
  };
})();
