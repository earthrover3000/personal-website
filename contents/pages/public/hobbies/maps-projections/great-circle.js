// Page-local config for the Great Circle Mapper — belongs to THIS page (maps-projections),
// not to the shared projection engine in 引擎 Engines/map-projection/. The engine knows how to
// compute and draw any flight path; this file only says which PRESET routes this page offers
// in its dropdown, plus the page's initial control state. Other consumers of the engine
// (e.g. itinerary-calendar) bring their own routes. Deployed as a page sibling via build.py
// extra_files; index.html passes it into createWorldMap({ presets, uiDefaults }).
//
// Route grammar (same as the Custom box): comma-separated; "A-B-C" = connected arcs; a lone
// "X" just marks that airport (no arc). `category` groups entries into <optgroup> sections
// (first-seen order). Add/edit groups freely — the dropdown is built from this list.
(function (r) {
  r.GREAT_CIRCLE = {
    defaults: { boundaries: false, bathymetry: false, topography: false, regions: false, mercator_edge: false, mercator_edge_gen: false, city_layer: 'none', flight_paths: 'selected' },   // initial control state: borders/terrain/region-shading/mercator-limits off; preset-routes mode
    routes: {
      default_group: '',                                         // '' → dropdown starts on "Preset routes…" (none)
      groups: [
        { id: 'northern',       label: 'Arctic Ocean',                        category: 'Regional',         routes: 'PEK-JFK, LHR-HND, LAX-DXB' },
        { id: 'southern',       label: 'Southern Ocean',                      category: 'Regional',         routes: 'MEL-SCL, CPT-GRU, JNB-SYD' },
        { id: 'indian',         label: 'Indian Ocean',                        category: 'Regional',         routes: 'MRU-BLR, SEZ-CMB' },
        { id: 'natlantic',      label: 'North Atlantic Ocean',                category: 'Regional',         routes: 'MEX-JFK-LHR-IST-RUH' },
        { id: 'natlantic-full', label: 'North Atlantic Ocean — detailed',     category: 'Regional',         routes: 'MEX, ATL, CLT, IAD, PHL, EWR, JFK, BOS, DUB, LHR, LGW, BRU, FRA, MUC, BEG, IST, RUH, MEX-JFK-LHR-IST-RUH' },
        { id: 'satlantic',      label: 'South Atlantic Ocean',                category: 'Regional',         routes: 'GRU-IST, CPT-IAD' },
        { id: 'satlantic-comp', label: 'South Atlantic Ocean — comparison',   category: 'Regional',         routes: 'CPT-IAD, CPT-EWR, CPT-ATL' },
        { id: 'npacific',       label: 'North Pacific Ocean',                 category: 'Regional',         routes: 'KUL-PVG-SEA-LIR' },
        { id: 'npacific-full',  label: 'North Pacific Ocean — detailed',      category: 'Regional',         routes: 'SGN, HKG, PVG, ICN, YVR, SEA, SLC, KUL-PVG-SEA-LIR' },
        { id: 'longhaul-a',     label: 'Eurasia',                             category: 'Ultra-long-haul',  routes: 'AKL-DOH, LAX-DOH, GRU-DOH, PER-LHR' },
        { id: 'longhaul-b',     label: 'North America',                       category: 'Ultra-long-haul',  routes: 'SIN-EWR, DFW-MEL, JNB-EWR, SZX-MEX, DFW-DXB' }
      ]
    }
  };
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
