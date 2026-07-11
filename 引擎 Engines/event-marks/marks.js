// event-marks — shared month / week / block boundary math for every
// event-manifold surface. SINGLE SOURCE OF TRUTH: the lifespan-atlas
// clock / track / rings views AND the site-stats "Line & Word Counts" chart
// both consume THIS module (the atlas's lib/marks.ts + lib/blocks.ts now
// delegate here). Framework-agnostic, browser-runnable ES module, working
// purely in absolute milliseconds on the UTC day grid.
//
// Division of labour: this module returns NUMBERS only — month index, ISO
// week number, block index — plus the language-agnostic block LABEL string.
// Each consumer applies its own projection (age-fraction for the atlas,
// x-pixels for the chart) and its own i18n (mapping monthIndex → a month
// name). That is the exact split the atlas already used between marks.ts
// (geometry) and eventManifoldLabels/display (i18n).
//
// The block logic is ported VERBATIM from the atlas's lib/blocks.ts and the
// block-mark walk from lib/marks.ts — keep behaviour identical, the atlas has
// ~30 consumers reading block numbers off it.

/** Milliseconds in one calendar day (UTC day grid). Mirrors lib/edges.DAY_MS. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse an ISO date (YYYY-MM-DD) as the START of that UTC day. Mirrors
 *  lib/edges.isoToDayMs so block boundaries land on the same grid. */
export const isoToDayMs = (iso) => Date.parse(iso + "T00:00:00Z");

// ─── Block context (ported verbatim from lib/blocks.ts) ─────────────────

/** Build a block context from raw boundary date strings (ISO YYYY-MM-DD) and
 *  the current "today" timestamp. Pure — no side effects. Synthesises a
 *  virtual current block past the last CSV boundary (length = 2 × slot-length
 *  days, extending in slot-length steps until it exceeds today).
 *
 *  `projLen` (optional, days) overrides the synthesised-slot length: when
 *  given and > 0, every projection/extrapolation uses it instead of the
 *  personal average (e.g. the atlas's projected-block-length setting, which
 *  can pin slots to the canonical 61 days = tropical year ÷ 6). It lands in
 *  ctx.avgLen — the field every downstream consumer already reads as "the
 *  slot length" — while ctx.avgLenFloat always stays the TRUE unrounded mean
 *  for display. Omitted → rounded mean, the historical behaviour. */
export function computeBlockContext(boundaries, todayMs, projLen) {
  const blockMs = boundaries.map(isoToDayMs);
  const numBlocks = Math.max(0, blockMs.length - 1);
  const pastDurations = [];
  for (let i = 0; i < numBlocks; i++) {
    if (blockMs[i + 1] <= todayMs) {
      pastDurations.push(Math.round((blockMs[i + 1] - blockMs[i]) / MS_PER_DAY));
    }
  }
  const durationBasis = pastDurations.length > 0
    ? pastDurations
    : Array.from({ length: numBlocks }, (_, i) =>
        Math.round((blockMs[i + 1] - blockMs[i]) / MS_PER_DAY));
  const avgLenFloat = durationBasis.length > 0
    ? durationBasis.reduce((a, b) => a + b, 0) / durationBasis.length
    : 0;
  const avgLen = projLen && projLen > 0 ? Math.round(projLen) : Math.round(avgLenFloat);
  const epochMs = numBlocks > 0 ? blockMs[0] : 0;
  const lastBoundaryMs = numBlocks > 0 ? blockMs[numBlocks] : 0;
  const synthesized = numBlocks > 0 && lastBoundaryMs <= todayMs && avgLen > 0;
  let syntheticEndMs = lastBoundaryMs;
  if (synthesized) {
    syntheticEndMs = lastBoundaryMs + 2 * avgLen * MS_PER_DAY;
    while (syntheticEndMs <= todayMs) syntheticEndMs += avgLen * MS_PER_DAY;
  }
  const anchorMs = synthesized ? syntheticEndMs : lastBoundaryMs;
  const anchorIdx = synthesized ? numBlocks : numBlocks - 1;
  return {
    blockMs, numBlocks, pastDurations, avgLen, avgLenFloat,
    epochMs, lastBoundaryMs, synthesized, syntheticEndMs, anchorMs, anchorIdx,
    todayMs,
  };
}

/** Map a ms timestamp to a block index. In-range dates return the closing
 *  block's index; past the last boundary every avgLen-day chunk is its own
 *  synthesised block; pre-epoch dates extrapolate backward the same way. */
export function msToBlock(ms, ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, epochMs, avgLen } = ctx;
  for (let i = 0; i < numBlocks; i++) {
    if (ms >= blockMs[i] && ms < blockMs[i + 1]) return i;
  }
  if (ms >= lastBoundaryMs && avgLen > 0) {
    return numBlocks + Math.floor((ms - lastBoundaryMs) / MS_PER_DAY / avgLen);
  }
  if (ms < epochMs && avgLen > 0) {
    return -Math.ceil((epochMs - ms) / MS_PER_DAY / avgLen);
  }
  return 0;
}

/** Like msToBlock but returns a display string. CSV-defined blocks render
 *  plainly; synthesised slots past the CSV are tilded UNLESS they contain
 *  today; pre-epoch extrapolations are always tilded. */
export function msToBlockString(ms, ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, epochMs, avgLen, todayMs } = ctx;
  for (let i = 0; i < numBlocks; i++) {
    if (ms >= blockMs[i] && ms < blockMs[i + 1]) return String(i);
  }
  if (ms >= lastBoundaryMs && avgLen > 0) {
    const slot = numBlocks + Math.floor((ms - lastBoundaryMs) / MS_PER_DAY / avgLen);
    const todaySlot = todayMs >= lastBoundaryMs
      ? numBlocks + Math.floor((todayMs - lastBoundaryMs) / MS_PER_DAY / avgLen)
      : -1;
    return slot === todaySlot ? String(slot) : `~${slot}`;
  }
  if (ms < epochMs && avgLen > 0) {
    return `~${-Math.ceil((epochMs - ms) / MS_PER_DAY / avgLen)}`;
  }
  return "?";
}

// ─── Boundary marks in a range (ms-based; ported from lib/marks.ts) ──────
// Each mark carries the boundary at the period START (startMs) and the period
// MIDPOINT (midMs) where the label centres — mirroring how month marks anchor
// on the 1st with the label at mid-month. Consumers project startMs/midMs into
// their own coordinate space.

/** Month marks for every month-start within [startTime, endTime] (ms). Starts
 *  one month early so a month whose midpoint is still in range is included. */
export function getMonthMarksInRange(startTime, endTime) {
  const d = new Date(startTime);
  d.setUTCMonth(d.getUTCMonth() - 1);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth();
  const marks = [];
  for (;;) {
    const monthTime = Date.UTC(year, month, 1);
    if (monthTime > endTime) break;
    const nextMonthTime = Date.UTC(year, month + 1, 1);
    marks.push({
      startMs: monthTime,
      midMs: (monthTime + nextMonthTime) / 2,
      endMs: nextMonthTime,
      monthIndex: month,
      calendarYear: year,
      isNewYear: month === 0,
    });
    month++;
    if (month >= 12) { month = 0; year++; }
  }
  return marks;
}

/** ISO 8601 week marks for every week within [startTime, endTime] (ms). Each
 *  anchors on Monday 00:00 UTC (boundary) with its midpoint at Thursday 12:00
 *  UTC; the ISO week number is that of the Thursday. */
export function getWeekMarksInRange(startTime, endTime) {
  const d = new Date(startTime);
  const dayOfWeek = d.getUTCDay() || 7; // 1=Mon..7=Sun
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (dayOfWeek - 1) - 7);
  const marks = [];
  for (;;) {
    const monTime = d.getTime();
    if (monTime > endTime) break;
    const midTime = monTime + 3.5 * MS_PER_DAY; // Thursday 12:00 UTC
    const thu = new Date(midTime);
    thu.setUTCHours(0, 0, 0, 0);
    const yearStart = Date.UTC(thu.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((thu.getTime() - yearStart) / MS_PER_DAY) + 1;
    const isoWeek = Math.ceil(dayOfYear / 7);
    marks.push({
      startMs: monTime,
      midMs: midTime,
      endMs: monTime + 7 * MS_PER_DAY,
      isoWeek,
      isoYear: thu.getUTCFullYear(),
    });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return marks;
}

/** One block mark per life-block whose window overlaps [startTime, endTime]
 *  (ms) — CSV-defined blocks plus avgLen-day synthesised slots before/after.
 *  Empty when the context has no blocks. */
export function getBlockMarksInRange(startTime, endTime, ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, epochMs, avgLen } = ctx;
  if (numBlocks === 0) return [];
  const blockBounds = (i) => {
    if (i >= 0 && i < numBlocks) return [blockMs[i], blockMs[i + 1]];
    if (avgLen <= 0) return null;
    if (i >= numBlocks) {
      const offset = i - numBlocks;
      const s = lastBoundaryMs + offset * avgLen * MS_PER_DAY;
      return [s, s + avgLen * MS_PER_DAY];
    }
    const s = epochMs + i * avgLen * MS_PER_DAY;
    return [s, s + avgLen * MS_PER_DAY];
  };
  let i = msToBlock(startTime, ctx);
  const marks = [];
  // Safety cap mirrors lib/marks.ts — guards a degenerate ctx (avgLen ≈ 0).
  for (let safety = 0; safety < 5000; safety++) {
    const bounds = blockBounds(i);
    if (!bounds) break;
    const [s, e] = bounds;
    if (s > endTime) break;
    marks.push({
      startMs: s,
      midMs: (s + e) / 2,
      endMs: e,
      label: msToBlockString((s + e) / 2, ctx),
      blockIndex: i,
    });
    i++;
  }
  return marks;
}

// ─── Phase (website version) marks ──────────────────────────────────────
// Phases are pre-labelled DATED boundaries (from the site roadmap) — unlike
// blocks there's no synthesis or extrapolation. `phases` is [{ startMs, label }]
// sorted ascending; each phase runs until the next phase's start, and the last
// is open (clamped to endTime for its midpoint). One mark per phase whose window
// overlaps [startTime, endTime]. Label is carried through verbatim (the caller
// owns the "p0.3" / "v1.0" formatting — see roadmap_page._stage_token).
export function getPhaseMarksInRange(startTime, endTime, phases) {
  const marks = [];
  for (let i = 0; i < phases.length; i++) {
    const s = phases[i].startMs;
    const e = i + 1 < phases.length ? phases[i + 1].startMs : endTime;
    if (e <= startTime || s >= endTime) continue; // no overlap with the window
    marks.push({ startMs: s, endMs: e, midMs: (s + Math.min(e, endTime)) / 2, label: phases[i].label });
  }
  return marks;
}
