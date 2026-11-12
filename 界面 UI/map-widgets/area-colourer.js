// area-colourer.js — a shade-it-in map: click an area to shade it, click
// again to clear it. First used by the Cities & Transport page's Dublin
// Areas section (central street blocks); nothing in it is
// Dublin-specific.
//
//   - one shade only, on or off (user decision 2026-11-12: no named
//     swatches); the shade is the site's --accent, read at draw time so
//     it follows the theme
//   - several layers of the same place are allowed (a segmented control
//     appears only when there is more than one); each keeps its own
//     shading
//   - shading persists in localStorage under config.storageKey;
//     export/import as JSON; vector SVG download (no tiles, so no
//     cross-origin canvas trouble)
//   - base tiles via map-basemap.js (theme-aware OSM), ONE shared hover
//     readout (as roadmap-viewer.js, for the same reason)
//
// Depends on Leaflet 1.9.x and map-basemap.js, loaded by the page first.
//
// Usage:
//
//   createAreaColourer({
//     mount: '#dub-map',
//     storageKey: 'dublin-areas',
//     view: [53.345, -6.262, 14.5],       // optional centre + zoom;
//                                         //   omitted → fit layer 1
//     exportName: 'dublin',               // → dublin-<layer>.svg
//     layers: [
//       { key: 'blocks', label: 'Street blocks', fc: DUBLIN_AREAS.blocks,
//         weight: 0.5, hint: '…',
//         labels: false,                  // permanent name labels
//         detail: function (p) { return ''; } }   // hover extra
//     ]
//   });
//
// Each feature needs properties.id (the shading key) and .name.

(function () {
  var STYLE_ID = '__area-colourer-styles';

  function isDark() {
    return !!(window.MAP_BASEMAP && MAP_BASEMAP.isDark());
  }
  function stroke() { return isDark() ? '#c6ced6' : '#3f4a55'; }
  // --accent is a light-dark() pair, and a custom property reads back
  // unresolved — a canvas fillStyle silently ignores that string. A
  // probe's computed `color` comes back as plain rgb().
  function shade(root) {
    var probe = document.createElement('span');
    probe.style.cssText = 'color:var(--accent,#3a5fd9);display:none';
    root.appendChild(probe);
    var c = getComputedStyle(probe).color;
    probe.remove();
    return c || '#3a5fd9';
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.ac-bar { display:flex; flex-wrap:wrap; gap:0.5rem 1.2rem;' +
      '  align-items:center; margin:0 0 0.6rem; font-size:0.9rem; }' +
      '.ac-seg { display:inline-flex; border:1px solid var(--border);' +
      '  border-radius:6px; overflow:hidden; }' +
      '.ac-seg button { font:inherit; font-size:0.85rem; border:0;' +
      '  background:var(--surface); color:var(--text);' +
      '  padding:0.25rem 0.7rem; cursor:pointer; }' +
      '.ac-seg button + button { border-left:1px solid var(--border); }' +
      '.ac-seg button.ac-on { background:var(--accent); color:var(--bg); }' +
      '.ac-hint { color:var(--muted); font-size:0.85rem;' +
      '  margin:0 0 0.6rem; }' +
      '.ac-n { color:var(--muted); }' +
      '.ac-btn { font:inherit; font-size:0.85rem; padding:0.25rem 0.7rem;' +
      '  border:1px solid var(--border); border-radius:6px;' +
      '  background:var(--surface); color:var(--text); cursor:pointer; }' +
      '.ac-btn:hover { border-color:var(--accent); color:var(--accent); }' +
      '.ac-bar label { display:inline-flex; align-items:center;' +
      '  gap:0.4rem; }' +
      '.ac-wrap { position:relative; }' +
      '.ac-map { width:100%; border:1px solid var(--border);' +
      '  border-radius:8px; }' +
      '.ac-map.leaflet-container { background:var(--surface); }' +
      '.ac-hover { position:absolute; z-index:1000; top:10px; right:10px;' +
      '  max-width:60%; background:var(--surface); color:var(--text);' +
      '  border:1px solid var(--border); border-radius:6px;' +
      '  padding:0.25rem 0.6rem; font-size:0.85rem; pointer-events:none;' +
      '  display:none; }' +
      '.ac-hover em { color:var(--muted); font-style:normal; }' +
      '.leaflet-tooltip.ac-label { background:transparent; border:0;' +
      '  box-shadow:none; padding:0; font-weight:600; font-size:11px;' +
      '  color:#1d2329; text-shadow:0 0 3px #fff, 0 0 3px #fff; }' +
      '.leaflet-tooltip.ac-label::before { display:none; }' +
      '.ac-dark .leaflet-tooltip.ac-label { color:#eef2f5;' +
      '  text-shadow:0 0 3px #000, 0 0 3px #000; }';
    document.head.appendChild(s);
  }

  window.createAreaColourer = function (config) {
    injectStyles();
    var root = typeof config.mount === 'string'
      ? document.querySelector(config.mount) : config.mount;
    var layers = config.layers;
    var byKey = {};
    layers.forEach(function (l) { byKey[l.key] = l; });
    var anyLabels = layers.some(function (l) { return l.labels; });
    var KEY = 'area-colourer:' + config.storageKey;

    // ---- State ---------------------------------------------------------
    // fills[layer][id] is truthy when the area is shaded.
    function fresh() {
      return { layer: layers[0].key, base: true, labels: true,
               opacity: 55, fills: {} };
    }
    function normalise(s) {
      if (!s || typeof s.fills !== 'object') s = fresh();
      if (!byKey[s.layer]) s.layer = layers[0].key;
      layers.forEach(function (l) {
        s.fills[l.key] = s.fills[l.key] || {};
      });
      return s;
    }
    var state = null;
    try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    state = normalise(state);
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    }
    function fills() { return state.fills[state.layer]; }

    // ---- Markup ----------------------------------------------------------
    root.innerHTML =
      (layers.length > 1
        ? '<div class="ac-bar"><span class="ac-seg ac-layers"></span>' +
          '</div>' : '') +
      '<p class="ac-hint"></p>' +
      '<div class="ac-bar">' +
      '  <span class="ac-n"></span>' +
      '  <button type="button" class="ac-btn ac-clear">Clear</button>' +
      '  <label><input type="checkbox" class="ac-base"> Base map</label>' +
      (anyLabels
        ? '<label><input type="checkbox" class="ac-names"> Names</label>'
        : '') +
      '  <label>Shade <input type="range" class="ac-op" min="15"' +
      '    max="100"></label>' +
      '</div>' +
      '<div class="ac-wrap"><div class="ac-map"></div>' +
      '  <div class="ac-hover"></div></div>' +
      '<div class="ac-bar" style="margin-top:0.6rem">' +
      '  <button type="button" class="ac-btn ac-svg">Save SVG</button>' +
      '  <button type="button" class="ac-btn ac-exp">Export shading' +
      '  </button>' +
      '  <button type="button" class="ac-btn ac-imp">Import</button>' +
      '  <input type="file" class="ac-file" accept=".json" hidden>' +
      '</div>';
    function q(sel) { return root.querySelector(sel); }
    var mapEl = q('.ac-map'), hover = q('.ac-hover');
    mapEl.style.height = (config.height || 520) + 'px';

    var map = L.map(mapEl, { preferCanvas: true, zoomSnap: 0.25 });
    if (config.view) {
      map.setView([config.view[0], config.view[1]], config.view[2]);
    }
    var tiles = null, geo = null, fillColour = shade(root);

    function setBase(on) {
      state.base = on;
      if (on && !tiles) tiles = MAP_BASEMAP.addTo(map);
      if (!on && tiles) { map.removeLayer(tiles); tiles = null; }
      // Without tiles the OSM-derived shapes still need their credit.
      map.attributionControl.setPrefix(on ? false :
        '<a href="https://leafletjs.com">Leaflet</a> | ' +
        MAP_BASEMAP.attribution);
    }

    function style(f) {
      var on = !!fills()[f.properties.id], l = byKey[state.layer];
      return { color: stroke(), weight: l.weight || 1, opacity: 0.9,
               fillColor: on ? fillColour
                             : (isDark() ? '#1c2228' : '#ffffff'),
               fillOpacity: on ? state.opacity / 100
                               : (state.base ? 0.04 : 0.9) };
    }

    // Hover: a light grey wash on an unshaded area (user request
    // 2026-11-12), a deeper shade on a shaded one, and a heavier edge.
    function hoverStyle(f) {
      var on = !!fills()[f.properties.id], l = byKey[state.layer];
      return on
        ? { weight: (l.weight || 1) * 2.5,
            fillOpacity: Math.min(1, state.opacity / 100 + 0.2) }
        : { weight: (l.weight || 1) * 2.5,
            fillColor: isDark() ? '#9aa3ad' : '#6b7280',
            fillOpacity: 0.3 };
    }

    function count() {
      var n = Object.keys(fills()).length;
      q('.ac-n').textContent = n ? n + ' shaded' : 'Click to shade';
    }

    function draw() {
      var l = byKey[state.layer];
      if (geo) map.removeLayer(geo);
      fillColour = shade(root);
      root.classList.toggle('ac-dark', isDark());
      geo = L.geoJSON(l.fc, {
        style: style,
        onEachFeature: function (f, layer) {
          var p = f.properties;
          if (state.labels && l.labels) {
            layer.bindTooltip(esc(l.short ? l.short(p.name) : p.name),
              { permanent: true, direction: 'center',
                className: 'ac-label' });
          }
          layer.on('click', function () {
            var fl = fills();
            if (fl[p.id]) delete fl[p.id]; else fl[p.id] = 1;
            layer.setStyle(style(f));
            layer.setStyle(hoverStyle(f));     // pointer is still on it
            save();
            count();
          });
          layer.on('mouseover', function () {
            var d = l.detail ? l.detail(p) : '';
            hover.innerHTML = '<strong>' + esc(p.name) + '</strong>' +
              (d ? ' <em>· ' + esc(d) + '</em>' : '');
            hover.style.display = 'block';
            layer.setStyle(hoverStyle(f));
          });
          layer.on('mouseout', function () {
            hover.style.display = 'none';
            geo.resetStyle(layer);
          });
        }
      }).addTo(map);
      q('.ac-hint').textContent = l.hint || '';
      renderSegs();
      count();
    }
    function restyle() { if (geo) geo.setStyle(style); count(); }

    // ---- Controls ----------------------------------------------------------
    function renderSegs() {
      var seg = q('.ac-layers');
      if (!seg) return;
      seg.innerHTML = '';
      layers.forEach(function (l) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = l.label;
        if (l.key === state.layer) b.className = 'ac-on';
        b.onclick = function () {
          if (l.key === state.layer) return;
          state.layer = l.key;
          save();
          if (l.view && map.getZoom() < l.view[2] - 1) {
            map.setView([l.view[0], l.view[1]], l.view[2]);
          }
          draw();
        };
        seg.appendChild(b);
      });
    }

    // Two clicks rather than a confirm() dialog.
    var armed = 0, clearBtn = q('.ac-clear');
    clearBtn.onclick = function () {
      if (Date.now() - armed > 3000) {
        armed = Date.now();
        clearBtn.textContent = 'Click again to clear';
        setTimeout(function () { clearBtn.textContent = 'Clear'; }, 3000);
        return;
      }
      armed = 0;
      clearBtn.textContent = 'Clear';
      state.fills[state.layer] = {};
      save();
      restyle();
    };
    var baseBox = q('.ac-base'), namesBox = q('.ac-names'), op = q('.ac-op');
    function syncControls() {
      baseBox.checked = state.base;
      if (namesBox) namesBox.checked = state.labels;
      op.value = state.opacity;
    }
    syncControls();
    baseBox.onchange = function () {
      setBase(baseBox.checked); save(); restyle();
    };
    if (namesBox) {
      namesBox.onchange = function () {
        state.labels = namesBox.checked; save(); draw();
      };
    }
    op.oninput = function () { state.opacity = +op.value; save(); restyle(); };

    // ---- Save / load -------------------------------------------------
    function download(name, text, type) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: type }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    var stem = config.exportName || config.storageKey;
    q('.ac-exp').onclick = function () {
      download(stem + '-shading.json', JSON.stringify(state, null, 1),
               'application/json');
    };
    q('.ac-imp').onclick = function () { q('.ac-file').click(); };
    q('.ac-file').onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (t) {
        state = normalise(JSON.parse(t));
        save();
        syncControls();
        setBase(state.base);
        draw();
      }).catch(function (err) {
        console.error('area-colourer: import failed', err);
      });
      e.target.value = '';
    };

    q('.ac-svg').onclick = function () {
      var l = byKey[state.layer], F = l.fc.features, W = 1400;
      var k = Math.cos(map.getCenter().lat * Math.PI / 180);
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      function P(c) { return [c[0] * k, -c[1]]; }
      F.forEach(function (f) {
        f.geometry.coordinates.forEach(function (poly) {
          poly[0].forEach(function (c) {
            var p = P(c);
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
          });
        });
      });
      var s = W / (x1 - x0), H = Math.round((y1 - y0) * s);
      function T(c) {
        var p = P(c);
        return ((p[0] - x0) * s).toFixed(1) + ',' +
               ((p[1] - y0) * s).toFixed(1);
      }
      var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 ' +
        (W + 40) + ' ' + (H + 70) + '" font-family="system-ui,' +
        'sans-serif"><rect x="-20" y="-20" width="' + (W + 40) +
        '" height="' + (H + 70) + '" fill="#fff"/>'];
      var sw = (l.weight || 1) * 0.9, fl = fills();
      F.forEach(function (f) {
        var on = !!fl[f.properties.id];
        var d = f.geometry.coordinates.map(function (poly) {
          return poly.map(function (r) {
            return 'M' + r.map(T).join('L') + 'Z';
          }).join('');
        }).join('');
        out.push('<path d="' + d + '" fill="' + (on ? fillColour : '#fff') +
          '" fill-opacity="' + (on ? state.opacity / 100 : 1) +
          '" stroke="#3f4a55" stroke-width="' + sw +
          '" fill-rule="evenodd"><title>' + esc(f.properties.name) +
          '</title></path>');
      });
      out.push('<text x="' + W + '" y="' + (H + 40) + '" font-size' +
        '="11" text-anchor="end" fill="#888">Boundaries © OpenStreetMap ' +
        'contributors</text></svg>');
      download(stem + '-' + state.layer + '.svg', out.join(''),
               'image/svg+xml');
    };

    // ---- Theme + first render ----------------------------------------
    if (typeof window.onSiteThemeChange === 'function') {
      window.onSiteThemeChange(function () { draw(); });
    }
    if (window.matchMedia) {
      var mq = matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', draw);
    }
    setBase(state.base);
    // No config.view: open fitted to the first layer's areas.
    if (!config.view) {
      map.fitBounds(L.geoJSON(layers[0].fc).getBounds(),
                    { padding: [8, 8] });
    }
    draw();
    return { map: map, redraw: draw };
  };
})();
