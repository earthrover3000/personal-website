// SYNCED COPY (2026-08-15) of 创作 Works/cities-transport/map-style/
// road-palette.js — that file stays the SSOT (the three research previews
// load it by relative path and can't reach the website tree). After editing
// the palette there, re-copy it over this file; do not edit here.
// road-palette.js — SSOT for the map palette shared by the lujiazui-roads
// and cambridge-cycleways previews (loaded via <script src="../map-style/
// road-palette.js">; script tags may load sibling file:// paths, fetch()
// may not). Change a colour HERE and both maps + both legends follow.
//
// road: the driving-hierarchy palette (born on lujiazui-roads).
//   pedestrian is dashed — a street in the legal sense, not a carriageway;
//   Lujiazui's converter drops the class, Cambridge keeps it as context.
// cycle: the cycle-infrastructure families (born on cambridge-cycleways).
//   lane is BLUE, not orange: a painted lane rides on top of primary
//   roads, and primary's orange would swallow it.
var MAP_PALETTE = {
  road: {
    trunk:         { color: '#b3452c', weight: 5 },
    primary:       { color: '#d97e1e', weight: 4 },
    secondary:     { color: '#c9a227', weight: 3 },
    tertiary:      { color: '#7d8a4e', weight: 2.5 },
    unclassified:  { color: '#808080', weight: 2 },
    residential:   { color: '#808080', weight: 2 },
    living_street: { color: '#808080', weight: 2 },
    pedestrian:    { color: '#808080', weight: 2, dashArray: '4 3' },
    service:       { color: '#b8b8b8', weight: 1 }
  },
  cycle: {
    track:      { color: '#2d8a4e', weight: 3 },
    lane:       { color: '#3566c4', weight: 2.5 },
    shared:     { color: '#2f8f8a', weight: 2.2, dashArray: '6 4' },
    permissive: { color: '#8aa8a6', weight: 1.5, dashArray: '3 4' }
  },
  // Regional expressway palette (born on yangtze-delta-motorways): a
  // TWO-WAY split — 高速 (all motorways: G/S/unref'd alike, user's call
  // 2026-07-24) vs trunk 快速路 as thin context. The G/S distinction
  // survives in the data (`cat`) and hover labels, just not in colour.
  expwy: {
    mwy:   { color: '#b3452c', weight: 3.5 },
    trunk: { color: '#7d8a4e', weight: 1.8 }
  }
};

// Leaflet style for a road by its highway tag: _link ramps inherit their
// parent class thinned; tunnels render dashed and faded.
function roadStyle(highway, props) {
  var hw = (highway || '').replace(/_link$/, '');
  var s = Object.assign({ opacity: 0.9 },
                        MAP_PALETTE.road[hw] || { color: '#808080', weight: 2 });
  if (/_link$/.test(highway)) s.weight = Math.max(1.5, s.weight - 1.5);
  if (props && props.tunnel) { s.dashArray = '6 5'; s.opacity = 0.6; }
  return s;
}

// Bounding box of a FeatureCollection's coordinates → [[S,W],[N,E]] for
// Leaflet. Backs the previews' "Show frame data box" toggle — computed
// from the DATA, so it stays honest whenever a frame definition changes.
function dataBounds(fc) {
  var s = 90, w = 180, n = -90, e = -180;
  fc.features.forEach(function (f) {
    f.geometry.coordinates.forEach(function (c) {
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
    });
  });
  return [[s, w], [n, e]];
}
function boundsString(b) {
  return b[0][0].toFixed(4) + ',' + b[0][1].toFixed(4) + ',' +
         b[1][0].toFixed(4) + ',' + b[1][1].toFixed(4);
}

// Stamp legend swatches from the palette: give a swatch data-road="primary"
// or data-cycle="track" and its colour is derived, never hand-written.
function applyPaletteSwatches() {
  document.querySelectorAll('.swatch[data-road]').forEach(function (el) {
    el.style.borderColor = MAP_PALETTE.road[el.dataset.road].color;
  });
  document.querySelectorAll('.swatch[data-cycle]').forEach(function (el) {
    el.style.borderColor = MAP_PALETTE.cycle[el.dataset.cycle].color;
  });
  document.querySelectorAll('.swatch[data-expwy]').forEach(function (el) {
    el.style.borderColor = MAP_PALETTE.expwy[el.dataset.expwy].color;
  });
}
