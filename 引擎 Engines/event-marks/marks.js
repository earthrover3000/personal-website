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
 *  virtual current block past the last CSV boundary, running through the slot
 *  AFTER today's (see currentBlocks — the Blocks view's Current section).
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
  const genesisMs = numBlocks > 0 ? blockMs[0] : 0;
  const lastBoundaryMs = numBlocks > 0 ? blockMs[numBlocks] : 0;
  const synthesized = numBlocks > 0 && lastBoundaryMs <= todayMs && avgLen > 0;
  let syntheticEndMs = lastBoundaryMs;
  if (synthesized) {
    // Today's slot k, then k + 1: the end of the Current section. Until
    // 2026-09-30 this was "2 slots, stepped until past today", which agrees
    // only while today sits in the FIRST slot past the file — one slot
    // further out, it ended at today's own slot and the Blocks view's
    // "Block *N+1" line hung past the end of its own bar.
    const k = Math.floor((todayMs - lastBoundaryMs) / (avgLen * MS_PER_DAY));
    syntheticEndMs = lastBoundaryMs + (k + 2) * avgLen * MS_PER_DAY;
  }
  const anchorMs = synthesized ? syntheticEndMs : lastBoundaryMs;
  const anchorIdx = synthesized ? numBlocks : numBlocks - 1;
  return {
    blockMs, numBlocks, pastDurations, avgLen, avgLenFloat,
    genesisMs, lastBoundaryMs, synthesized, syntheticEndMs, anchorMs, anchorIdx,
    todayMs,
  };
}

/** Map a ms timestamp to a block index. In-range dates return the closing
 *  block's index; past the last boundary every avgLen-day chunk is its own
 *  synthesised block; pre-genesis dates extrapolate backward the same way. */
export function msToBlock(ms, ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, genesisMs, avgLen } = ctx;
  for (let i = 0; i < numBlocks; i++) {
    if (ms >= blockMs[i] && ms < blockMs[i + 1]) return i;
  }
  if (ms >= lastBoundaryMs && avgLen > 0) {
    return numBlocks + Math.floor((ms - lastBoundaryMs) / MS_PER_DAY / avgLen);
  }
  if (ms < genesisMs && avgLen > 0) {
    return -Math.ceil((genesisMs - ms) / MS_PER_DAY / avgLen);
  }
  return 0;
}

/** Like msToBlock but returns a display string. CSV-defined blocks render
 *  plainly; synthesised slots past the CSV are tilded UNLESS they contain
 *  today; pre-genesis extrapolations are always tilded. */
export function msToBlockString(ms, ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, genesisMs, avgLen, todayMs } = ctx;
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
  if (ms < genesisMs && avgLen > 0) {
    return `~${-Math.ceil((genesisMs - ms) / MS_PER_DAY / avgLen)}`;
  }
  return "?";
}

// ─── Position within a block (lifted from the atlas's lib/pointReadout) ──

/** Position of the day `ms` inside the block that contains it — the row every
 *  readout of "where in the cycle am I" prints: the atlas probe / dashboard
 *  ("Block 20, Day 16/55 · 29%"), the Blocks view's current-block "Nd+", and
 *  the Origin statusline's "📅 B20 D16/55 · 29%". Moved here from
 *  lib/pointReadout.ts on 2026-09-26, the day the statusline's own Python port
 *  was caught dividing by the AVERAGE while the atlas divided by the block's
 *  real length (D47/54 vs D47/57): two copies of the same arithmetic, one
 *  reader. Now there is one copy and every surface, JS or not, runs it.
 *
 *  `day` is the INCLUSIVE 1-based day-of-block (day 1 on the block's first
 *  day — `today − start + 1`). `lenDays` is the block's REAL length for
 *  CSV-defined blocks and ctx.avgLen (the projected slot length) for
 *  synthesised / pre-genesis slots, so this can never disagree with the
 *  `~Nd` slots msToBlockString labels. Block starts mirror msToBlock's slot
 *  math exactly (its inverse), so `day` never exceeds `lenDays`.
 *  `pct = Math.round(day / lenDays · 100)` — half rounds up. Returns null
 *  when the context has no usable length (no blocks and no projection). */
export function blockPosition(ms, ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, genesisMs, avgLen } = ctx;
  const idx = msToBlock(ms, ctx);
  let startMs;
  let lenDays;
  if (idx >= 0 && idx < numBlocks) {
    startMs = blockMs[idx];
    lenDays = Math.round((blockMs[idx + 1] - startMs) / MS_PER_DAY);
  } else if (idx >= numBlocks) {
    startMs = lastBoundaryMs + (idx - numBlocks) * avgLen * MS_PER_DAY;
    lenDays = avgLen;
  } else {
    startMs = genesisMs + idx * avgLen * MS_PER_DAY;
    lenDays = avgLen;
  }
  if (lenDays <= 0) return null;
  const day = Math.round((ms - startMs) / MS_PER_DAY) + 1;
  return { day, lenDays, pct: Math.round((day / lenDays) * 100) };
}

// ─── The CURRENT blocks (the atlas Blocks view's "Current" section) ─────

/** The blocks the atlas Blocks view files under CURRENT, in order — THE
 *  segmenting rule, shared by every surface that shows "the current blocks"
 *  (the Blocks view's rows and count, the atlas near-future tint, the
 *  site-stats chart's right edge). Each is { blockIndex, startMs, endMs,
 *  recorded }.
 *
 *    • Today inside the file — ONE block, the one containing today, its end
 *      a recorded boundary (recorded: true).
 *    • Today past the file — the current block's end is not recorded yet, so
 *      TWO: today's avgLen-day slot N and the projected slot N+1 after it
 *      (recorded: false). The Blocks view shows them as "Block N" and
 *      "Block *N+1"; ctx.syntheticEndMs is the end of N+1.
 *    • No block contains today (no blocks, today before genesis, or past the
 *      file with no slot length) — [].
 *
 *  Slot N starts on the avgLen grid from lastBoundaryMs, the same grid
 *  msToBlock and getBlockMarksInRange walk, so blockIndex matches their
 *  numbering. */
export function currentBlocks(ctx) {
  const { blockMs, numBlocks, lastBoundaryMs, synthesized, avgLen, todayMs } = ctx;
  if (synthesized) {
    const slotMs = avgLen * MS_PER_DAY;
    const k = Math.floor((todayMs - lastBoundaryMs) / slotMs);
    const s = lastBoundaryMs + k * slotMs;
    return [
      { blockIndex: numBlocks + k, startMs: s, endMs: s + slotMs, recorded: false },
      { blockIndex: numBlocks + k + 1, startMs: s + slotMs, endMs: s + 2 * slotMs, recorded: false },
    ];
  }
  for (let i = 0; i < numBlocks; i++) {
    if (todayMs >= blockMs[i] && todayMs < blockMs[i + 1]) {
      return [{ blockIndex: i, startMs: blockMs[i], endMs: blockMs[i + 1], recorded: true }];
    }
  }
  return [];
}

/** Whether the boundary that OPENS block `blockIndex` gets a drawn mark —
 *  the Clock ring's radial tick (lifespan-atlas BlockLabels.tsx), the
 *  site-stats chart's boundary gridline (page-widgets/stats-table.js). One
 *  rule, here, so the two surfaces can never disagree about a line.
 *
 *  Every boundary is drawn except the one between TODAY'S block and the next
 *  when that boundary is synthesised: past the file (today's block has no
 *  recorded end yet — its close is the user's nearest forward projection) or
 *  before genesis. A mark there would assert a transition nobody has dated;
 *  the two labels stand either side of the unmarked boundary instead. The
 *  last RECORDED boundary is drawn even when it is today's: it opens block
 *  numBlocks, and only indices beyond that are projected. */
export function boundaryTickShown(blockIndex, ctx) {
  if (blockIndex !== msToBlock(ctx.todayMs, ctx) + 1) return true;
  return blockIndex <= ctx.numBlocks && blockIndex >= 0;
}

/** currentBlocks as one window [startMs, endMs) — first block's start to the
 *  last one's end — or null when there are none. The end is where the
 *  site-stats Line & Word Counts chart stops, closing on a boundary line: the
 *  first block boundary after today that the Blocks view shows. */
export function currentBlocksWindow(ctx) {
  const blocks = currentBlocks(ctx);
  if (blocks.length === 0) return null;
  return { startMs: blocks[0].startMs, endMs: blocks[blocks.length - 1].endMs };
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

// ─── The MONTH LABEL MODE's own conventions ───────────────────────────────
// Which month boundaries are drawn EMPHATICALLY, and which of them carry the
// year number. One place, because the same tier is drawn on four surfaces —
// the Clock's event ring, the Log's Rings spiral, the site's Site Log rings,
// and the linear strip — and until 2026-09-05 only ClockEventRing implemented
// it, so the spiral drew twelve identical ticks and never said which year you
// were looking at.
//
// These are DECISIONS about the calendar, not geometry or i18n, so they sit
// with the marks rather than violating this module's numbers-only rule: the
// answer is "which mark", and each surface still owns how long its long tick
// is and where it puts the text. `isNewYear` was already here on the same
// reasoning.

/** Months whose OPENING boundary carries the year number: Feb, Jul and Dec
 *  (0-indexed), i.e. the Jan/Feb, Jun/Jul and Nov/Dec boundaries.
 *
 *  THREE PER YEAR, and off the year seam on purpose. The year boundary itself
 *  is already the loudest mark on the ring (it gets the long tick), so putting
 *  the number there too stacks two statements on one line and leaves the rest
 *  of the revolution unlabelled — on a spiral, where a full turn is a year,
 *  that means most of the wheel cannot be dated without counting round to the
 *  seam. Spacing them ~5 months apart puts a year number within a season's
 *  reach of any point on the ring. */
export const YEAR_LABEL_MONTHS = [1, 6, 11];

/** The year number a month mark should carry, or null for the nine months
 *  that carry none. Takes the mark so a caller cannot get the index/year
 *  pairing wrong, and returns a STRING because it is a label. */
export function yearLabelForMonth(mark) {
  return YEAR_LABEL_MONTHS.includes(mark.monthIndex) ? String(mark.calendarYear) : null;
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
  const { blockMs, numBlocks, lastBoundaryMs, genesisMs, avgLen } = ctx;
  if (numBlocks === 0) return [];
  const blockBounds = (i) => {
    if (i >= 0 && i < numBlocks) return [blockMs[i], blockMs[i + 1]];
    if (avgLen <= 0) return null;
    if (i >= numBlocks) {
      const offset = i - numBlocks;
      const s = lastBoundaryMs + offset * avgLen * MS_PER_DAY;
      return [s, s + avgLen * MS_PER_DAY];
    }
    const s = genesisMs + i * avgLen * MS_PER_DAY;
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
      // Both boundaries on file — a synthesised slot before genesis or past
      // the file is not (periodDays reads this).
      recorded: i >= 0 && i < numBlocks,
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
    // The last phase has no dated end: `open` says its endMs is the clamp,
    // not a boundary (periodDays reads this).
    marks.push({ startMs: s, endMs: e, midMs: (s + Math.min(e, endTime)) / 2, label: phases[i].label, open: i + 1 >= phases.length });
  }
  return marks;
}

// ─── How long a period is ───────────────────────────────────────────────

/** The day count to print under a period's mark, as { days, kind }:
 *
 *    • "length"  — a period with both ends known: endMs − startMs in whole
 *                  days (the boundary day opens the next period, so a block
 *                  2026-08-11 → 2026-10-07 is 57, not 58). Every month and
 *                  week; a recorded block; a phase that a later phase closed.
 *    • "elapsed" — a period still running with no end on file: days from its
 *                  start through today INCLUSIVE (today is its own first day
 *                  on the day it opens, so never 0). The open phase, and
 *                  today's block when its end is not recorded yet.
 *    • "projected" — a synthesised block that does not contain today: its
 *                  length on the projected grid.
 *
 *  The two counting rules differ on purpose — a length is a half-open
 *  difference between two starts, an elapsed count is "how many days have I
 *  been in it" — and they are the ones the atlas Blocks view prints
 *  (blockSeries.durationDays, lib/blocks elapsedDaysInclusive). The "d",
 *  "+" and "~" are the consumer's. */
export function periodDays(period, nowMs) {
  const length = Math.round((period.endMs - period.startMs) / MS_PER_DAY);
  const elapsed = Math.max(1, Math.round((nowMs - period.startMs) / MS_PER_DAY) + 1);
  if (period.open) return { days: elapsed, kind: "elapsed" };
  if (period.recorded === false) {
    const containsNow = nowMs >= period.startMs && nowMs < period.endMs;
    return containsNow ? { days: elapsed, kind: "elapsed" } : { days: length, kind: "projected" };
  }
  return { days: length, kind: "length" };
}
