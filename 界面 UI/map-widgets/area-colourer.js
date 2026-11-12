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
//     credits: false,                     // optional: show no credits
//     layers: [
//       { key: 'blocks', label: 'Street blocks', fc: DUBLIN_AREAS.blocks,
//         weight: 0.5, hint: '…',
//         labels: false,                  // permanent name labels
//         detail: function (p) { return ''; },    // hover extra
//         credit: 'Boundaries © …',        // non-OSM data: shown in the
//                                          //   map's attribution and SVG
//         group: function (p) { return null; },    // optional: areas
//                                          //   sharing a key form a group;
//                                          //   ◀ ▶ steps through groups of
//                                          //   2+ (e.g. a split Small Area)
//         copy: function (p) { return p.name; } }  // the text "Copy"
//                                          //   and the C key put on the
//                                          //   clipboard (default: name)
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
      '  margin:0 0 0.6rem; display:flex; flex-wrap:wrap;' +
      '  align-items:center; gap:0.3rem 1rem; }' +
      '.ac-nav { display:inline-flex; align-items:center; gap:0.35rem;' +
      '  color:var(--text); }' +
      '.ac-nav .ac-btn { padding:0.05rem 0.55rem; line-height:1.4; }' +
      '.ac-keys { display:inline-flex; align-items:center; gap:0.3rem;' +
      '  margin-left:0.6rem; color:var(--muted); cursor:pointer; }' +
      '.ac-nav-n { min-width:5.5em; text-align:center;' +
      '  font-variant-numeric:tabular-nums; }' +
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
      '.ac-pick { display:flex; flex-wrap:wrap; align-items:center;' +
      '  gap:0.4rem 0.8rem; margin:0 0 0.6rem; font-size:0.9rem;' +
      '  min-height:1.9rem; }' +
      '.ac-pick .ac-tip { color:var(--muted); }' +
      '.ac-pick code { font-size:0.95rem; padding:0.1rem 0.4rem;' +
      '  border:1px solid var(--border); border-radius:4px;' +
      '  background:var(--surface); user-select:all; }' +
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
    var anyHint = layers.some(function (l) { return l.hint || l.group; });
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
      '<div class="ac-pick"></div>' +
      // The count and ◀ ▶ line sits right above the map (user request).
      '<p class="ac-hint"><span class="ac-hint-text"></span>' +
      '<span class="ac-nav"></span></p>' +
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

    // Leaflet pans with the arrow keys; that is switched off while the
    // "Arrow keys" box is ticked, when ← → step through groups instead.
    // config.credits === false (the page owner's choice) drops every credit:
    // the attribution box, the tile credit, layer credits, the SVG footer.
    var credits = config.credits !== false;
    var map = L.map(mapEl, { preferCanvas: true, zoomSnap: 0.25,
                             attributionControl: credits });
    if (config.view) {
      map.setView([config.view[0], config.view[1]], config.view[2]);
    }
    var tiles = null, geo = null, fillColour = shade(root);
    var shownCredit = null;

    function setBase(on) {
      state.base = on;
      if (on && !tiles) {
        tiles = MAP_BASEMAP.addTo(map, credits ? {} : { attribution: false });
      }
      if (!on && tiles) { map.removeLayer(tiles); tiles = null; }
      if (!credits) return;
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

    // ---- Copying an area's reference (user request 2026-11-12) ---------
    // The last clicked area sits in a bar above the map with a Copy
    // button; C over an area copies it without clicking. The site is also
    // served over plain http on the LAN, where navigator.clipboard does
    // not exist — hence the execCommand fallback.
    var hovered = null, pickTip = 'Click an area, or press C while ' +
      'hovering one, to copy its code.';
    function copyText(l, p) {
      return l.copy ? l.copy(p) : p.name;
    }
    function toClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
    }
    function flash(btn, text) {
      var was = btn.textContent;
      btn.textContent = text;
      setTimeout(function () { btn.textContent = was; }, 1500);
    }
    function showPick(l, p) { showPickText(p.name, copyText(l, p)); }
    function showPickText(name, text) {
      var bar = q('.ac-pick');
      bar.innerHTML = '<span>' + esc(name) + '</span><code>' +
        esc(text) + '</code><button type="button" class="ac-btn">Copy' +
        '</button><span class="ac-tip">or press C over any area</span>';
      var btn = bar.querySelector('button');
      btn.onclick = function () {
        toClipboard(text).then(function () { flash(btn, 'Copied'); },
                               function () { flash(btn, 'Select it'); });
      };
    }
    document.addEventListener('keydown', function (e) {
      if (state.arrows && !e.ctrlKey && !e.metaKey && !e.altKey &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        var t0 = e.target;
        if (t0 && (t0.tagName === 'INPUT' || t0.tagName === 'TEXTAREA'))
          return;
        var l0 = byKey[state.layer];
        if (!groupsOf(l0).length) return;
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (!hovered || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'c' && e.key !== 'C') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                t.isContentEditable)) return;
      var text = copyText(hovered.l, hovered.p), shown = hovered.p;
      showPick(hovered.l, hovered.p);
      toClipboard(text).then(function () {
        hover.innerHTML = '<strong>' + esc(shown.name) + '</strong>' +
          ' <em>· copied</em>';
      });
    });

    // ---- Stepping through groups (user request 2026-11-12) ------------
    // ◀ n / N ▶ in the hint line (and ← → while its "Arrow keys" box is
    // ticked, user request) walks every group of 2+ areas, looping: the
    // group is outlined, its pieces lettered, the map fitted to it and
    // its key put in the copy bar.
    var navAt = {}, focus = null;
    function setArrows(on) {
      state.arrows = on;
      if (map.keyboard) map.keyboard[on ? 'disable' : 'enable']();
    }
    function groupsOf(l) {
      if (!l.group) return [];
      if (l._groups) return l._groups;
      var byG = {};
      l.fc.features.forEach(function (f) {
        var k = l.group(f.properties);
        if (k != null) (byG[k] = byG[k] || []).push(f);
      });
      l._groups = Object.keys(byG).sort().filter(function (k) {
        return byG[k].length > 1;
      }).map(function (k) { return { key: k, feats: byG[k] }; });
      return l._groups;
    }
    function clearFocus() {
      if (focus) { map.removeLayer(focus); focus = null; }
    }
    function renderNav() {
      var l = byKey[state.layer], gs = groupsOf(l), nav = q('.ac-nav');
      if (!gs.length) { nav.innerHTML = ''; return; }
      var at = navAt[l.key];
      nav.innerHTML = '<button type="button" class="ac-btn ac-prev" ' +
        'title="Previous (\u2190)">\u25c0</button><span class="ac-nav-n">' +
        (at == null ? '\u2013' : at + 1) + ' / ' + gs.length +
        '</span><button type="button" class="ac-btn ac-next" ' +
        'title="Next (\u2192)">\u25b6</button><label class="ac-keys">' +
        '<input type="checkbox"' + (state.arrows ? ' checked' : '') +
        '> Arrow keys</label>';
      nav.querySelector('.ac-prev').onclick = function () { step(-1); };
      nav.querySelector('.ac-next').onclick = function () { step(1); };
      nav.querySelector('.ac-keys input').onchange = function (e) {
        setArrows(e.target.checked);
        save();
      };
    }
    function step(d) {
      var l = byKey[state.layer], gs = groupsOf(l), n = gs.length;
      if (!n) return;
      var at = navAt[l.key];
      at = at == null ? (d > 0 ? 0 : n - 1) : ((at + d) % n + n) % n;
      navAt[l.key] = at;
      var g = gs[at];
      clearFocus();
      focus = L.geoJSON({ type: 'FeatureCollection', features: g.feats }, {
        interactive: false,
        style: function () {
          return { color: isDark() ? '#ffd166' : '#c2185b', weight: 3.5,
                   opacity: 1, fill: false };
        },
        onEachFeature: function (f, layer) {
          var id = String(l.copy ? l.copy(f.properties) : f.properties.id);
          var dash = id.lastIndexOf('-');
          layer.bindTooltip(esc(dash > 0 ? id.slice(dash + 1) : id),
            { permanent: true, direction: 'center',
              className: 'ac-label' });
        }
      }).addTo(map);
      map.fitBounds(focus.getBounds(), { padding: [70, 70], maxZoom: 17 });
      showPickText((l.groupName || 'Small Area') + ' ' + g.key, g.key);
      renderNav();
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
            showPick(l, p);
          });
          layer.on('mouseover', function () {
            var d = l.detail ? l.detail(p) : '';
            hover.innerHTML = '<strong>' + esc(p.name) + '</strong>' +
              (d ? ' <em>· ' + esc(d) + '</em>' : '');
            hover.style.display = 'block';
            layer.setStyle(hoverStyle(f));
            hovered = { l: l, p: p };
          });
          layer.on('mouseout', function () {
            hover.style.display = 'none';
            hovered = null;
            geo.resetStyle(layer);
          });
        }
      }).addTo(map);
      q('.ac-hint-text').textContent = l.hint || '\u00a0'; // same height
      clearFocus();
      renderNav();
      // If any layer has a hint, the line keeps its room on every layer
      // (empty but present), so switching layers never shifts the map
      // (user request 2026-11-12); with no hints anywhere it collapses.
      q('.ac-hint').style.display = anyHint ? '' : 'none';
      q('.ac-hint').style.visibility =
        l.hint || groupsOf(l).length ? 'visible' : 'hidden';
      // Per-layer data credit (e.g. CSO boundaries) beside the OSM one.
      if (credits) {
        if (shownCredit) {
          map.attributionControl.removeAttribution(shownCredit);
        }
        shownCredit = l.credit || null;
        if (shownCredit) map.attributionControl.addAttribution(shownCredit);
      }
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
      if (credits) {
        out.push('<text x="' + W + '" y="' + (H + 40) + '" font-size' +
          '="11" text-anchor="end" fill="#888">' +
          esc(l.credit || 'Boundaries © OpenStreetMap contributors') +
          '</text>');
      }
      out.push('</svg>');
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
    q('.ac-pick').innerHTML = '<span class="ac-tip">' + pickTip +
      '</span>';
    setBase(state.base);
    setArrows(!!state.arrows);
    // No config.view: open fitted to the first layer's areas.
    if (!config.view) {
      map.fitBounds(L.geoJSON(layers[0].fc).getBounds(),
                    { padding: [8, 8] });
    }
    draw();
    return { map: map, redraw: draw };
  };
})();
