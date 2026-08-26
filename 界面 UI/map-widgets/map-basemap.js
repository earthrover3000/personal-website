// map-basemap.js — the one definition of "an OpenStreetMap tile layer" for this site, and the
// one place that makes it follow the site theme.
//
// It exists because the tile layer was written out three times — map-explorer.js, map-popover.js
// and the maps-projections county overlay — and had already drifted: two used
// tile.openstreetmap.org, the third the deprecated {s}.tile.openstreetmap.org subdomain form,
// and only one set an attribution. None of them went dark.
//
// Usage:
//   MAP_BASEMAP.addTo(map);                       // canonical OSM layer, theme-aware
//   MAP_BASEMAP.addTo(map, { attribution: false });  // for a chrome-less thumbnail
//   MAP_BASEMAP.isDark();                         // for callers that must pick their own colours
//
// DARK MODE IS A FILTER OVER THE TILES, not a second tile provider. The obvious candidates were
// both dead ends when checked: CARTO's dark_matter now needs an API key and watermarks its raster
// tiles, and Stadia's dark styles need a key too. Inverting OSM keeps one provider, one
// attribution, no key and no watermark.
//
// The invert(0.92)/hue-rotate(180deg) recipe and the two-selector pattern below are lifted from
// the molecule-lookup page, which worked them out for the Ketcher canvas — 0.92 rather than a full
// invert lands white on ~#141414 and black on ~#eaeaea, i.e. on the site's own --bg/--text,
// instead of a harsh pure flip. THE TWO SELECTORS ARE NOT REDUNDANT: theme-init.js REMOVES
// data-theme in auto mode, so the media query is what covers auto-on-a-dark-OS (the common "at
// night" path) and the attribute selector covers a deliberate dark choice.
//
// Only .leaflet-tile-pane is filtered. Vector overlays, markers and tooltips live in their own
// panes and keep their real colours — a caller that wants those to change too should ask isDark().
(function () {
  var STYLE_ID = '__map-basemap-styles';

  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var TILE_MAXZOOM = 19;
  // Exported so the PNG exporter can apply the same transform to the canvas it composites; a
  // CSS filter on the DOM does not reach a canvas drawn from the raw tile images.
  var DARK_FILTER = 'invert(0.92) hue-rotate(180deg)';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '@media (prefers-color-scheme: dark) {' +
      '  :root:not([data-theme="light"]) .leaflet-container .leaflet-tile-pane {' +
      '    filter: ' + DARK_FILTER + ';' +
      '  }' +
      '}' +
      ':root[data-theme="dark"] .leaflet-container .leaflet-tile-pane {' +
      '  filter: ' + DARK_FILTER + ';' +
      '}';
    document.head.appendChild(style);
  }

  // Same rule as world-map.js's darkMode(): the manual site toggle wins, and 'auto' (no attribute)
  // falls through to the OS. Duplicated rather than imported because that one lives inside the
  // projection engine's IIFE and is not reachable from here.
  function isDark() {
    var t = (typeof document !== 'undefined' && document.documentElement)
      ? document.documentElement.getAttribute('data-theme') : null;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  window.MAP_BASEMAP = {
    url: TILE_URL,
    attribution: TILE_ATTR,
    maxZoom: TILE_MAXZOOM,
    DARK_FILTER: DARK_FILTER,
    isDark: isDark,

    // crossOrigin defaults ON: without it the exporter's canvas is tainted and toBlob throws, and
    // that failure surfaces far from here as a silently broken Save PNG.
    addTo: function (map, opts) {
      opts = opts || {};
      injectStyles();
      return L.tileLayer(TILE_URL, {
        maxZoom: opts.maxZoom || TILE_MAXZOOM,
        crossOrigin: opts.crossOrigin !== false,
        attribution: opts.attribution === false ? undefined : TILE_ATTR
      }).addTo(map);
    }
  };
})();
