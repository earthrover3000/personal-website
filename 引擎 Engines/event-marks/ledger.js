// event-marks/ledger — a cumulative series read off at period ends.
//
// Sibling of marks.js: marks.js says WHERE the blocks / phases / months /
// weeks fall, this file says what a running total STOOD AT when each of them
// closed, and how far it moved inside. It is the maths behind the "Table"
// view of the site-stats Line & Word Counts chart (界面 UI/page-widgets/
// stats-table.js), and it lives here rather than in that widget so a second
// surface — the lifespan atlas already reads the same line-history log for
// its ♒️ Pulse curve — can adopt it without re-deriving the rules. Like
// marks.js it is framework-agnostic, browser-runnable, and returns NUMBERS
// plus the language-neutral period fields; every label, month name and
// number format belongs to the consumer.
//
// THE SERIES IS A STEP FUNCTION. A line count changes only where a build
// recorded a snapshot; between two snapshots the value holds. So "the count
// at the close of March" is EXACTLY the newest snapshot at or before the
// moment March ended — not an interpolation, and not the nearest snapshot,
// which could sit in April. A quiet fortnight before a boundary means the
// closing value is a fortnight old, which is the truth, not an approximation.
// This is the same rule the chart's crosshair uses for its 24-hour baseline;
// keeping it in one place is what lets a table cell and a hover readout never
// disagree.

import {
  getBlockMarksInRange,
  getMonthMarksInRange,
  getPhaseMarksInRange,
  getWeekMarksInRange,
} from "./marks.js";

/** Every period of one unit that overlaps [startMs, endMs].
 *
 *  `unit` is "blocks" | "phases" | "months" | "weeks". `ctx` carries what the
 *  unit needs: `blockCtx` (from computeBlockContext) for blocks, `phases`
 *  ([{ startMs, label }], as getPhaseMarksInRange takes) for phases; months
 *  and weeks need nothing. Each period is the engine's own mark (startMs /
 *  midMs / endMs plus its unit-specific fields — monthIndex + calendarYear,
 *  isoWeek + isoYear, label + blockIndex, or label) with `unit` stamped on.
 *
 *  The overlap filter is the one both consumers used to apply by hand: the
 *  mark walkers emit one period early for the atlas ring's midpoint labels,
 *  and a table has no use for a row whose whole window predates the data.
 *  An unknown unit or a unit whose context is missing yields []. */
export function periodsFor(unit, startMs, endMs, ctx) {
  const c = ctx || {};
  let marks;
  if (unit === "months") marks = getMonthMarksInRange(startMs, endMs);
  else if (unit === "weeks") marks = getWeekMarksInRange(startMs, endMs);
  else if (unit === "phases") marks = c.phases ? getPhaseMarksInRange(startMs, endMs, c.phases) : [];
  else if (unit === "blocks") marks = c.blockCtx ? getBlockMarksInRange(startMs, endMs, c.blockCtx) : [];
  else marks = [];
  return marks
    .filter((m) => m.endMs > startMs && m.startMs < endMs)
    .map((m) => ({ unit, ...m }));
}

/** Index of the newest point whose ms is strictly before `cutoffMs`, or -1.
 *  Strict, because a period's endMs IS the next period's startMs: a snapshot
 *  stamped exactly on the boundary belongs to the period it opens. */
function newestBefore(points, cutoffMs, fromIdx) {
  let j = fromIdx;
  while (j + 1 < points.length && points[j + 1].ms < cutoffMs) j++;
  return j;
}

/** One ledger row per period.
 *
 *  `points` is the snapshot series, ascending by `ms`, each { ms, total,
 *  words } with `words` null where the snapshot predates word tracking.
 *  `periods` is what periodsFor returned (or any ascending list of
 *  { startMs, endMs, … }). `nowMs` says which period is still open.
 *
 *  Each row:
 *    period   — the input period, untouched.
 *    open     — true when the period has not ended yet (endMs >= nowMs).
 *    closeMs  — the moment the closing values are read at: the period's end,
 *               or `nowMs` while it is open.
 *    closing  — { total, words } at closeMs: the newest snapshot before it.
 *               Both null when no snapshot exists yet at that moment.
 *    opening  — { total, words } as the period began: the newest snapshot
 *               before startMs. Null fields before the first snapshot.
 *    movement — closing minus opening, per series; null where either side is
 *               null. A period the history starts INSIDE therefore shows no
 *               movement rather than counting its first snapshot as growth
 *               from zero — the lines existed before the log did.
 *    snapshots — how many snapshots fall in [startMs, endMs). Informational;
 *               a consumer publishing a day-collapsed series should remember
 *               this then counts days, not builds.
 *
 *  One forward sweep: both lists ascend, so the "newest before" pointer never
 *  rewinds. Linear in points + periods, which matters on a mature log — the
 *  site's carries thousands of builds and the table re-renders on every
 *  toggle. */
export function ledgerRows(points, periods, nowMs) {
  const rows = [];
  let jOpen = -1;   // newest point before the current period's start
  let jClose = -1;  // newest point before the current period's close
  let kCount = 0;   // first point at or after the current period's start
  const at = (j) => (j >= 0 ? points[j] : null);
  const val = (p, key) => (p && p[key] != null ? p[key] : null);
  const diff = (a, b) => (a == null || b == null ? null : a - b);
  for (const period of periods) {
    // >= rather than >: an open phase has no dated end, so the phase walker
    // clamps its endMs to the range end the caller passed — which is `now`
    // for every live chart. Strict > would file today's phase as closed.
    const open = period.endMs >= nowMs;
    const closeMs = open ? nowMs : period.endMs;
    jOpen = newestBefore(points, period.startMs, jOpen);
    jClose = newestBefore(points, closeMs, Math.max(jClose, jOpen));
    while (kCount < points.length && points[kCount].ms < period.startMs) kCount++;
    let snapshots = 0;
    for (let k = kCount; k < points.length && points[k].ms < period.endMs; k++) snapshots++;
    const o = at(jOpen);
    const c = at(jClose);
    const opening = { total: val(o, "total"), words: val(o, "words") };
    const closing = { total: val(c, "total"), words: val(c, "words") };
    rows.push({
      period,
      open,
      closeMs,
      opening,
      closing,
      movement: {
        total: diff(closing.total, opening.total),
        words: diff(closing.words, opening.words),
      },
      snapshots,
    });
  }
  return rows;
}
