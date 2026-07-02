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
  /** Average block duration in days, rounded to integer (0 when no blocks). */
  avgLen: number;
  /** Average past-block duration in days, unrounded float. */
  avgLenFloat: number;
  /** First boundary in ms (= blockMs[0]). 0 when no blocks. */
  epochMs: number;
  /** Last CSV boundary in ms (= blockMs[N]). 0 when no blocks. */
  lastBoundaryMs: number;
  /** True iff today >= last CSV boundary AND avgLen > 0. */
  synthesized: boolean;
  /** End ms of the synthetic current block (== lastBoundaryMs when not synthesised). */
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
): BlockContext;
export declare function msToBlock(ms: number, ctx: BlockContext): number;
export declare function msToBlockString(ms: number, ctx: BlockContext): string;

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
export type BlockMarkMs = {
  startMs: number;
  midMs: number;
  endMs: number;
  label: string;
  blockIndex: number;
};

export declare function getMonthMarksInRange(startTime: number, endTime: number): MonthMarkMs[];
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
};
export declare function getPhaseMarksInRange(
  startTime: number,
  endTime: number,
  phases: readonly PhaseInput[],
): PhaseMarkMs[];
