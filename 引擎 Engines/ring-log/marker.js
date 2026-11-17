// marker — THE TODAY / ANCHOR MARKER'S SHAPE, the radial mirror of an event
// mark (user decision 2026-11-15, "SSOT"): the red "you are here" on every
// ring surface — the lifespan-atlas (lib/eventMarkShape re-exports it, and
// builds its week train on these pieces), the site roadmap's Site Log and
// the Death Plan's Progress Log (both through 界面 UI/page-widgets/
// site-log-rings.js). Moved here from the atlas's lib/eventMarkShape.ts,
// point for point, so the three can never draw it differently.
//
// Where an event points INWARD (arrowhead below the inner edge), this
// marker points OUTWARD:
//   • in-ring: the 1-day band (inner→outer) MINUS the major-event triangle
//     (base on inner edge, apex at the outer-edge centre) = two corner
//     triangles flanking a central notch a major event on that day fills.
//   • out-of-ring: the HAT, BEYOND the outer edge, 1 + 2·HAT_OVERHANG_DAYS
//     days wide and centred on the day, its crown ringWidth/2 past the edge.
//     Wider than the cell on purpose — see HAT_OVERHANG_DAYS. Its shape
//     says the anchor's STATE (user decision 2026-11-17; the atlas's
//     lib/anchorNow says what the states mean):
//       "now" — a WHOLE ELLIPSE, ringWidth/2 tall (radial semi-axis
//               ringWidth/4), resting on the outer edge at the day's
//               centre. The cell's two outer edges (the day's edges) run
//               straight on up to meet its underside, so the marker is one
//               continuous blob.
//       "day" — a LOAF: a ringWidth/4 tall rectangle on the outer edge, a
//               semi-ellipse of radial semi-axis ringWidth/4 on top of it.
//     A marker that only ever means today — the Site Log, the Progress Log
//     — draws "now", the default. Until 2026-11-17 the hat was one semi-
//     ellipse of radial semi-axis ringWidth/2 for every state.
// Render as ONE <path> in the marker colour.
//
// Pure: no DOM, no colours. `project(frac, y)` → {x, y} pixels, y = 0 the
// band's inner edge, y > 0 outward — the event-mark projector convention.

/** THE HAT'S OVERHANG (user decision 2026-10-11): the out-of-ring bump
 *  covers its day PLUS this many days on each side — three days wide for
 *  the day grain — while the in-ring cell stays exactly one day. The two
 *  halves of a marker mean different things: the cell is a MEASUREMENT
 *  (its edges are the day's edges, the ticks beside it share the scale,
 *  and a major event on that day fills its notch), so it may not widen;
 *  the hat is a POINTER sitting outside the band where nothing is
 *  measured, so it may. In days rather than pixels because the ring is
 *  measured in days — the hat zooms with the ticks beside it, and the
 *  week train's roof is the same rule at the larger grain (its end caps
 *  overhang the carriages by the same amount). Why: on the Clock a day is
 *  2.25 px at the design width, so the one-day hat was a 2 px sliver over
 *  a 6 px ring; it could not grow outward (the week labels start ~1.5 px
 *  past its crown), so it grew sideways. */
export const HAT_OVERHANG_DAYS = 1;

/** An SVG subpath ("M … L … Z") from a list of projected points. */
export function markerSubPath(pts) {
  if (pts.length === 0) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  }
  return d + " Z";
}

/** Straight edge from (fa, ya) to (fb, yb), sampled through `project` so it
 *  bends on curved projections. */
export function markerEdge(project, fa, ya, fb, yb, n, skipFirst) {
  const out = [];
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const u = i / n;
    out.push(project(fa + (fb - fa) * u, ya + (yb - ya) * u));
  }
  return out;
}

/** The two hat STATES (see the header). */
export const HAT_STATES = Object.freeze({ NOW: "now", DAY: "day" });

/** The hat's geometry for the day starting at f0: its centre, its
 *  tangential semi-axis `a` (the day's half plus the overhang) and the
 *  radial semi-axis `b` of its curved part (ringWidth/4 for both states). */
function hatGeom(f0, dayFrac, ringWidth, overhangDays) {
  return {
    fmid: f0 + dayFrac / 2,
    a: dayFrac / 2 + overhangDays * dayFrac,
    b: ringWidth / 4,
  };
}

/** The hat's REAR HALF, crown → rear base on the outer edge: what a train's
 *  roof traces where it meets its locomotive, so the two share a boundary
 *  point for point and never overlap. "now": the ellipse's upper-rear
 *  quarter, its underside forward to the day's rear edge, then straight
 *  down that edge (the cell's outer edge, run on up) to the outer edge.
 *  "day": the loaf's quarter-ellipse shoulder, then straight down. */
export function markerHatRearPts(project, f0, dayFrac, ringWidth, samples,
                                 overhangDays, state = HAT_STATES.NOW) {
  const { fmid, a, b } = hatGeom(f0, dayFrac, ringWidth, overhangDays);
  const pts = [];
  if (state === HAT_STATES.DAY) {
    for (let i = 0; i <= samples; i++) {
      const phi = (Math.PI / 2) * (1 - i / samples); // crown → shoulder
      pts.push(project(fmid + a * Math.cos(phi), ringWidth + b + b * Math.sin(phi)));
    }
    pts.push(project(fmid + a, ringWidth));
    return pts;
  }
  const cy = ringWidth + b;
  for (let i = 0; i <= samples; i++) {
    const phi = (Math.PI / 2) * (1 - i / samples); // crown → rear tip
    pts.push(project(fmid + a * Math.cos(phi), cy + b * Math.sin(phi)));
  }
  // Underside from the tip forward to the day's rear edge (x = f0+dayFrac).
  const phiEdge = -Math.acos(Math.min(1, (dayFrac / 2) / a));
  for (let i = 1; i <= samples; i++) {
    const phi = phiEdge * (i / samples);
    pts.push(project(fmid + a * Math.cos(phi), cy + b * Math.sin(phi)));
  }
  pts.push(project(f0 + dayFrac, ringWidth));
  return pts;
}

/** The whole hat as one closed outline, rear base → crown → front base:
 *  the rear half, mirrored for the front. */
export function markerHatPts(project, f0, dayFrac, ringWidth, samples,
                             overhangDays, state = HAT_STATES.NOW) {
  const fmid = f0 + dayFrac / 2;
  const flat = (frac, y) => ({ x: frac, y });
  const rear = markerHatRearPts(flat, f0, dayFrac, ringWidth, samples,
                                overhangDays, state);
  const front = rear.slice(1).map((p) => ({ x: 2 * fmid - p.x, y: p.y }));
  return [...rear].reverse().concat(front).map((p) => project(p.x, p.y));
}

/** In-ring complement of one day cell: the two corner triangles flanking
 *  the central major-event notch (base on the inner edge, apex at the
 *  outer-edge centre). Returned as two closed subpaths. */
export function markerCellSubpaths(project, f0, dayFrac, ringWidth, S) {
  const f1 = f0 + dayFrac;
  const fmid = f0 + dayFrac / 2;
  const leftTri = [
    ...markerEdge(project, f0, 0, f0, ringWidth, 1, false),
    ...markerEdge(project, f0, ringWidth, fmid, ringWidth, S, true),
    ...markerEdge(project, fmid, ringWidth, f0, 0, S, true),
  ];
  const rightTri = [
    ...markerEdge(project, f1, 0, f1, ringWidth, 1, false),
    ...markerEdge(project, f1, ringWidth, fmid, ringWidth, S, true),
    ...markerEdge(project, fmid, ringWidth, f1, 0, S, true),
  ];
  return markerSubPath(leftTri) + " " + markerSubPath(rightTri);
}

/** The day marker: hat + cell, one path (see the header). `opts`:
 *  {startFrac, dayFrac, ringWidth, project, bumpSamples = 16,
 *  edgeSamples = 8, hatOverhangDays = HAT_OVERHANG_DAYS,
 *  state = "now" | "day" (HAT_STATES; default "now")}. */
export function eventMarkerPath(opts) {
  const { startFrac, dayFrac, ringWidth, project } = opts;
  const bumpSamples = opts.bumpSamples ?? 16;
  const S = opts.edgeSamples ?? 8;
  const ov = opts.hatOverhangDays ?? HAT_OVERHANG_DAYS;
  const hat = markerHatPts(project, startFrac, dayFrac, ringWidth,
                           bumpSamples, ov, opts.state ?? HAT_STATES.NOW);
  return markerSubPath(hat) + " "
    + markerCellSubpaths(project, startFrac, dayFrac, ringWidth, S);
}
