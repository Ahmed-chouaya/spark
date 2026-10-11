import type { MascotState } from "../components/mascot/types";

/**
 * Rough effort, not tool identity.
 *
 * The host agent's tool list is not ours, and it changes without notice. A
 * per-tool mapping would be permanent upkeep against a surface we do not
 * control — the same treadmill as an integration list — and it would also make
 * every new tool in the host a decision we have to make before the companion
 * can render anything at all.
 *
 * So activity is bucketed by rough effort and everything unrecognised falls to
 * a default. What this buys: the companion cannot be *wrong* about a tool it
 * has never seen, because it never claims to know. What it costs: it cannot
 * tell you the agent grepped rather than read. That information was never
 * going to change what you do, so its absence costs nothing.
 */
export const EFFORT_BUCKETS = ["light", "ordinary", "heavy"] as const;

export type EffortBucket = (typeof EFFORT_BUCKETS)[number];

/** Where anything unrecognised, or anything we are unsure about, lands. */
export const DEFAULT_EFFORT: EffortBucket = "ordinary";

const BUCKET_STATE: Record<EffortBucket, MascotState> = {
  light: "listening",
  ordinary: "working",
  heavy: "focused",
};

/** The state a given amount of rough effort renders. */
export function classifyToolActivity(bucket: EffortBucket): MascotState {
  return BUCKET_STATE[bucket];
}

/**
 * The two things about a piece of activity that can be measured without
 * knowing which activity it was.
 *
 * Both are optional because hosts report neither, one, or both. Anything a host
 * does not report stays unknown, and unknown is never read as "light".
 */
export interface EffortSignals {
  /** How long the activity has been running. */
  readonly elapsedMs?: number;
  /** How much data the activity moved. */
  readonly payloadBytes?: number;
}

export const HEAVY_ELAPSED_MS = 10_000;
export const HEAVY_PAYLOAD_BYTES = 512 * 1024;
export const LIGHT_ELAPSED_MS = 500;
export const LIGHT_PAYLOAD_BYTES = 16 * 1024;

const isHeavyBy = (value: number | undefined, over: number) =>
  value !== undefined && value >= over;

/**
 * Guess the bucket from cost signals alone.
 *
 * `heavy` is claimed the moment any signal looks heavy — one loud enough signal
 * is enough to stop calling something light. `light` is claimed only when every
 * signal available says so, because "quick" on its own is not evidence of a
 * read: a fast write is quick too, and claiming it was a lookup would be the
 * false precision this module refuses to assert.
 *
 * Everything else, including anything wholly unknown, is the default.
 */
export function estimateEffort(signals: EffortSignals): EffortBucket {
  const { elapsedMs, payloadBytes } = signals;

  if (isHeavyBy(elapsedMs, HEAVY_ELAPSED_MS)) return "heavy";
  if (isHeavyBy(payloadBytes, HEAVY_PAYLOAD_BYTES)) return "heavy";

  const allLight =
    elapsedMs !== undefined &&
    payloadBytes !== undefined &&
    elapsedMs < LIGHT_ELAPSED_MS &&
    payloadBytes < LIGHT_PAYLOAD_BYTES;
  if (allLight) return "light";

  return DEFAULT_EFFORT;
}