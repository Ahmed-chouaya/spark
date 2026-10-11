/**
 * State selection: which state the mascot shows, given a set of live agent
 * sessions.
 *
 * Pure logic, no rendering concerns, no window, no socket, no IPC. It consumes
 * the state names `mascot-rig` defines and nothing else from it, so the
 * vocabulary stays owned by the component library and this module only decides
 * which of the nine is on screen.
 *
 * The pipeline, in order:
 *
 *   host payload -> adapter -> canonical event -> session -> reduction -> state
 *   (claude-code)  (adapters/)   (events.ts)      (session.ts) (reduce.ts)
 *
 * Everything left of the reduction is agent-specific and lives behind the
 * adapter; everything right of it is agent-agnostic. A second agent is one file
 * in ./adapters and no change anywhere else.
 *
 * Three guarantees this module makes on purpose:
 *
 * - **One state, always.** A set of sessions reduces to exactly one state.
 * - **Attention routing.** A blocked session outranks everything; a background
 *   session never drives ambient state. The cost — a background failure is not
 *   surfaced — is written into ./reduce rather than left implicit.
 * - **Soft classification.** Tool activity is bucketed by rough effort with a
 *   default, never mapped per tool. The system does not claim to tell you which
 *   tool ran, and two tools of similar effort are allowed to render the same
 *   face. Do not "fix" that vagueness with a per-tool table; see ./tool-effort.
 */
export {
  STATE_CLASSES,
  STATE_CLASSIFICATION,
  IDLE_RUNG,
  PRECEDENCE,
  classify,
  revertsOnItsOwn,
  rankOfRung,
  rankOfState,
  outranks,
} from "./classification";
export type { StateClass, PrecedenceRung } from "./classification";

export { createSession, selectPrimary } from "./session";
export type { AgentId, AgentSession, BlockReason } from "./session";

export { selectState } from "./reduce";

export {
  EFFORT_BUCKETS,
  DEFAULT_EFFORT,
  HEAVY_ELAPSED_MS,
  HEAVY_PAYLOAD_BYTES,
  LIGHT_ELAPSED_MS,
  LIGHT_PAYLOAD_BYTES,
  classifyToolActivity,
  estimateEffort,
} from "./tool-effort";
export type { EffortBucket, EffortSignals } from "./tool-effort";

export {
  TRANSIENT_WINDOW_MS,
  REST_AFTER_MS,
  stateForEvent,
  applyEvent,
} from "./events";
export type { SessionEvent } from "./events";

export { ESCALATING_STATE, canResolve, escalates, escalatesState, isLoud } from "./escalation";

export { applyPayload, applyUpdate } from "./track";

export type { AgentAdapter, CanonicalUpdate } from "./adapters/types";
export { createClaudeCodeAdapter } from "./adapters/claude-code";
export type { ClaudeCodeAdapter, ClaudeCodePayload } from "./adapters/claude-code";