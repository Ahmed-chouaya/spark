/**
 * The companion's decisions: what a host asked, and what the user decided.
 *
 * Four pieces, each owning one question:
 *
 *   request.ts   what is this payload asking permission for
 *   decision.ts  what a decision looks like in the host's own bytes
 *   runtime.ts   which request is pending, and where its answer goes
 *   index.ts     this barrel
 *
 * Nothing here reaches into `src/state-selection` to decide a state, or into
 * `src/escalation` to decide whether to offer a card. Those modules own those
 * answers, and the only thing taken from the escalation module is the rule that
 * a decision applies to one request — which is asked of `decide` rather than
 * restated, so that rule has one implementation in this codebase no matter how
 * many ways a decision arrives.
 */

export { createDecisionRuntime } from "./runtime";
export type {
  Decode,
  DecisionRuntime,
  DecisionRuntimeOptions,
} from "./runtime";

export { describeRequest } from "./request";

export { permissionDecision } from "./decision";