// Type declarations for the framework-agnostic event-marks engine (marks.js).
// The lifespan-atlas TS app imports this via the `event-marks` path alias
// (vite.config.ts resolve.alias + tsconfig paths); it is the single source of
// truth for the BlockContext shape and the month/week/block mark math.

export declare const MS_PER_DAY: number;
export declare function isoToDayMs(iso: string): number;

/** Resolved life-block context — boundary timestamps plus the synthesised
 *  current/future-slot metadata every block lookup needs. */
export type BlockContext = {
  /** Boundary timestamps in ms, sorted ascending. N+1 entries → N blocks. */
  blockMs: number[];
  /** CSV-defined block count (= blockMs.length - 1). */
  numBlocks: number;
  /** Day-counts of each completed past block. */
  pastDurations: number[];
  /** Effective synthesised-slot length in days: the rounded average, or the
   *  caller's projLen override verbatim (0 when no blocks and no override).
   *  Every projection/extrapolation consumer reads this. */
  avgLen: number;
  /** Average past-block duration in days, unrounded float — always the TRUE
   *  mean, never the projLen override; use for display statistics. */
  avgLenFloat: number;
  /** First boundary in ms (= blockMs[0]). 0 when no blocks. */
  genesisMs: number;
  /** Last CSV boundary in ms (= blockMs[N]). 0 when no blocks. */
  lastBoundaryMs: number;
  /** True iff today >= last CSV boundary AND avgLen > 0. */
  synthesized: boolean;
  /** End ms of the synthetic current block — the end of the slot after
   *  today's (== lastBoundaryMs when not synthesised). */
  syntheticEndMs: number;
  /** Anchor ms used by extrapolation past the synthetic/last block. */
  anchorMs: number;
  /** Anchor block index used by extrapolation. */
  anchorIdx: number;
  /** The "today" timestamp passed in. */
  todayMs: number;
};

export declare function computeBlockContext(
  boundaries: readonly string[],
  todayMs: number,
  /** Override for the synthesised-slot length in days (see BlockContext.avgLen).
   *  Omitted/undefined → the personal average (historical behaviour). */
  projLen?: number,
): BlockContext;
export declare function msToBlock(ms: number, ctx: BlockContext): number;
export declare function msToBlockString(ms: number, ctx: BlockContext): string;

/** Where a day sits inside its block — see marks.js blockPosition. */
export type BlockPosition = {
  /** Inclusive 1-based day-of-block: 1 on the block's first day. */
  day: number;
  /** The block's real length for CSV-defined blocks; avgLen for synthesised
   *  / pre-genesis slots. */
  lenDays: number;
  /** Math.round(day / lenDays × 100). */
  pct: number;
};
/** Position of `ms` within its block; null when the context has no usable
 *  length (no blocks and no projection). The ONE implementation behind the
 *  atlas readouts and the Origin statusline's 📅 segment. */
export declare function blockPosition(ms: number, ctx: BlockContext): BlockPosition | null;

/** One block of the atlas Blocks view's CURRENT section. */
export type CurrentBlock = {
  /** Block number on the msToBlock grid (synthesised slots continue past numBlocks). */
  blockIndex: number;
  startMs: number;
  endMs: number;
  /** True when endMs is a recorded boundary; false for synthesised slots. */
  recorded: boolean;
};
/** The CURRENT section's blocks: [the recorded block containing today], or
 *  past the file [today's slot N, projected N+1]; [] when none contains
 *  today. See marks.js currentBlocks. */
export declare function currentBlocks(ctx: BlockContext): CurrentBlock[];
/** currentBlocks as one window [startMs, endMs); null when empty. */
export declare function currentBlocksWindow(ctx: BlockContext): { startMs: number; endMs: number } | null;

export type MonthMarkMs = {
  startMs: number;
  midMs: number;
  endMs: number;
  monthIndex: number;
  calendarYear: number;
  isNewYear: boolean;
};
export type WeekMarkMs = {
  startMs: number;
  midMs: number;
  endMs: number;
  isoWeek: number;
  isoYear: number;
};
/** How long a period is — see marks.js periodDays. */
export type PeriodDays = { days: number; kind: "length" | "elapsed" | "projected" };
export declare function periodDays(
  period: { startMs: number; endMs: number; open?: boolean; recorded?: boolean },
  nowMs: number,
): PeriodDays;

export type BlockMarkMs = {
  startMs: number;
  midMs: number;
  endMs: number;
  label: string;
  blockIndex: number;
  /** Both boundaries on file (false for synthesised slots). */
  recorded: boolean;
};

export declare function getMonthMarksInRange(startTime: number, endTime: number): MonthMarkMs[];
/** Months whose OPENING boundary carries the year number — Feb, Jul, Dec
 *  (0-indexed): the Jan/Feb, Jun/Jul and Nov/Dec boundaries. */
export declare const YEAR_LABEL_MONTHS: number[];
/** The year number a month mark carries, or null. */
export declare function yearLabelForMonth(
  mark: { monthIndex: number; calendarYear: number },
): string | null;
export declare function getWeekMarksInRange(startTime: number, endTime: number): WeekMarkMs[];
export declare function getBlockMarksInRange(
  startTime: number,
  endTime: number,
  ctx: BlockContext,
): BlockMarkMs[];

export type PhaseInput = { startMs: number; label: string };
export type PhaseMarkMs = {
  startMs: number;
  endMs: number;
  midMs: number;
  label: string;
  /** The last phase: its endMs is the range clamp, not a dated boundary. */
  open: boolean;
};
export declare function getPhaseMarksInRange(
  startTime: number,
  endTime: number,
  phases: readonly PhaseInput[],
): PhaseMarkMs[];
