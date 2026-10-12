/**
 * The escalation surface: what the user sees when an agent is blocked, and what
 * they can do about it.
 *
 * Four pieces, each owning one question:
 *
 *   capability.ts           can this platform keep a surface above others, and
 *                           which question was it asked?
 *   pending.ts              which request is being offered, and what a decision
 *                           applies to
 *   EscalationSurface.tsx   is it on screen, and does it look escalated
 *   DecisionSurface.tsx     the request, and the two answers
 *
 * `useCompanionSurface.ts` binds them to the session set. Nothing here reaches
 * into `src/state-selection` to re-derive a state or re-judge a block: that
 * module owns those questions and this one consumes the answers, so the
 * mascot's rendering contract and the state vocabulary both gain no requirement
 * and no code path from this work.
 */
export {
  HOST_WINDOW_KEY,
  SURFACE_PLACEMENTS,
  UNKNOWN_HOST_WINDOW,
  canHoldPersistentSurface,
  readHostWindow,
} from "./capability";
export type { HostWindow } from "./capability";
export type { SurfacePlacement } from "./placements";

export {
  ESCALATION_LIFT,
  ESCALATION_PULSE_MS,
  EscalationSurface,
  escalationStyle,
  surfaceVisibility,
} from "./EscalationSurface";
export type {
  EscalationStyle,
  EscalationSurfaceProps,
  SurfaceVisibility,
} from "./EscalationSurface";

export { DECISIONS, DecisionSurface } from "./DecisionSurface";
export type { DecisionSurfaceProps } from "./DecisionSurface";

export { decide, dismiss, longestWaiting, supersede } from "./pending";
export type { Decision, DecisionOutcome, PendingRequest, PendingSet } from "./pending";

export { useCompanionSurface, usePendingDecisions, useSessions } from "./useCompanionSurface";
export type { CompanionSurfaceProps } from "./useCompanionSurface";