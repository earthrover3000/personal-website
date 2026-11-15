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
//   • out-of-ring: a semi-ellipse bump BEYOND the outer edge — the HAT:
//     flat base on the outer edge, 1 + 2·HAT_OVERHANG_DAYS days wide and
//     centred on the day, rounded crown ringWidth/2 past the edge
//     (tangential semi-axis 0.5 + HAT_OVERHANG_DAYS days, radial
//     semi-axis ringWidth/2). Wider than the cell on purpose — see
//     HAT_OVERHANG_DAYS.
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

/** Out-of-ring semi-ellipse bump — THE HAT — centred on the day starting
 *  at f0 (base on the outer edge at y = ringWidth, crown ringWidth/2 past
 *  it), `overhangDays` wider than the day on each side (HAT_OVERHANG_DAYS),
 *  sampled left base corner → crown → right base corner. Shared point-for-
 *  point by the locomotive (its outward bump) and the atlas's carriages
 *  (the carve that makes room for that bump), so the two boundaries
 *  coincide exactly. */
export function markerBumpPts(project, f0, dayFrac, ringWidth, bumpSamples,
                              overhangDays) {
  const fmid = f0 + dayFrac / 2;
  const hOut = ringWidth / 2;
  const hatHalf = dayFrac / 2 + overhangDays * dayFrac;
  const bump = [];
  for (let i = 0; i <= bumpSamples; i++) {
    const phi = Math.PI * (1 - i / bumpSamples); // π (base-left) → 0
    bump.push(project(fmid + hatHalf * Math.cos(phi),
                      ringWidth + hOut * Math.sin(phi)));
  }
  return bump;
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
 *  edgeSamples = 8, hatOverhangDays = HAT_OVERHANG_DAYS}. */
export function eventMarkerPath(opts) {
  const { startFrac, dayFrac, ringWidth, project } = opts;
  const bumpSamples = opts.bumpSamples ?? 16;
  const S = opts.edgeSamples ?? 8;
  const ov = (opts.hatOverhangDays ?? HAT_OVERHANG_DAYS) * dayFrac;
  const f0 = startFrac;
  const f1 = startFrac + dayFrac;
  const outBump = [
    ...markerBumpPts(project, f0, dayFrac, ringWidth, bumpSamples,
                     ov / dayFrac),
    ...markerEdge(project, f1 + ov, ringWidth, f0 - ov, ringWidth, S, true),
  ];
  return markerSubPath(outBump) + " "
    + markerCellSubpaths(project, f0, dayFrac, ringWidth, S);
}
