import type { MascotState } from "../components/mascot/types";

/**
 * The pending request the decision surface is offering.
 *
 * Three things and nothing else, and the third one is the load-bearing part.
 *
 * - `operation` — what the agent wants to do, in terms the user can decide on
 *   without going to look. The surface has to be enough to answer; a surface
 *   that says "a session is blocked" has made the user do the work it exists to
 *   save them from.
 * - `sessionId` — which session it belongs to, so two blocked sessions are
 *   distinguishable and the answer lands on the right one.
 * - `id` — the request's own identity, which outlives every presentation of it.
 *
 * That last field is the whole reason this type is here. A decision is bound to
 * *a request*, not to "whatever is blocked at the moment the button is
 * pressed". Two things follow, and both are required rather than tidy:
 *
 * - A decision for a request that has since gone away is refused, not applied to
 *   whatever is pending now. Silently re-pointing an old answer at new work is
 *   the failure mode that turns a convenience into a hazard, and it is not
 *   recoverable once the wrong thing has been allowed.
 * - Deciding one request resolves that request and no other. No batching, no
 *   "apply to all", because "all" is a decision the user did not make.
 */
export interface PendingRequest {
  /** Identity of this request, stable until it is resolved or superseded. */
  readonly id: string;
  /** What the agent is asking for, in the user's terms. */
  readonly operation: string;
  /** The session this request belongs to. */
  readonly sessionId: string;
  /** When the request arrived, used only to order the offer. */
  readonly requestedAt: number;
}

/** The two answers. There is no third, and that is a decision, not an omission. */
export type Decision = "allow" | "deny";

/**
 * A request waiting for an answer, and the two answers it can receive.
 *
 * The outcome is returned rather than thrown. A refused decision is a normal
 * result — the agent moved on, which the design treats as a real possibility —
 * and a caller that has to catch an exception to find that out will get it
 * wrong. Nothing is resolved on a refusal, and that is the point of the
 * `pending` it carries: a caller that ignored the outcome would still see an
 * unchanged set and could not act on something that was not there.
 */
export type DecisionOutcome =
  | {
      readonly applied: true;
      readonly decision: Decision;
      /** The request the decision resolved, and the only one it resolved. */
      readonly resolved: PendingRequest;
      /** What is still pending afterwards. */
      readonly pending: readonly PendingRequest[];
    }
  | {
      readonly applied: false;
      readonly decision: Decision;
      /** The request the decision was made for, which is no longer pending. */
      readonly refusedFor: PendingRequest | null;
      /** Unchanged. A refusal decides nothing, least of all something else. */
      readonly pending: readonly PendingRequest[];
    };

/** The set of requests waiting to be answered. */
export type PendingSet = readonly PendingRequest[];

/**
 * The request the surface offers: the one that has been waiting longest.
 *
 * Longest-waiting rather than newest, arbitrarily, or first-to-arrive in a
 * convenient order, because that is the request whose answer has been costing
 * wall-clock the most time. Where more than one session is blocked, the rest
 * wait their turn and are not shown.
 *
 * Ties keep the earlier-listed request, for the same reason `selectPrimary`
 * does: equal timestamps mean the host gave us nothing to order by, so taking
 * the first makes the answer a function of the input rather than of a sort's
 * stability.
 *
 * There is no queue. Ordering UI, per-item state, and a story for what happens
 * to the other two while the first is being answered are real work, and they
 * are a later change. Offering the longest-waiting is correct regardless.
 */
export function longestWaiting(pending: PendingSet): PendingRequest | null {
  let offered: PendingRequest | null = null;

  for (const request of pending) {
    const waitsLonger = offered === null || request.requestedAt < offered.requestedAt;
    if (waitsLonger) offered = request;
  }

  return offered;
}

/**
 * Whether a decision was made for a request that is still waiting.
 *
 * A refusal is total: nothing is resolved, and in particular nothing is
 * resolved that happens to be pending. This is what stops a decision arriving
 * late — the agent finished on its own while the card was on screen — from
 * being applied to the next thing that blocks.
 */
export function decide(
  pending: PendingSet,
  requestId: string,
  decision: Decision
): DecisionOutcome {
  const target = pending.find((request) => request.id === requestId);

  if (!target) {
    return { applied: false, decision, refusedFor: null, pending };
  }

  return {
    applied: true,
    decision,
    resolved: target,
    pending: pending.filter((request) => request.id !== requestId),
  };
}

/**
 * The requests still waiting after a session has answered or moved on.
 *
 * A block ends two ways and this handles both: the user answered, or the agent
 * went ahead without them. Either way the request is no longer pending, and a
 * decision still in flight for it must be refused rather than re-pointed — which
 * is why this drops the entry rather than marking it done.
 */
export function supersede(pending: PendingSet, sessionId: string): PendingSet {
  return pending.filter((request) => request.sessionId !== sessionId);
}

/**
 * Drop a request without deciding anything.
 *
 * Dismissing the surface is not an answer. The block stays exactly as it was,
 * there is no timeout, and there is no default — a default decision on a
 * security-relevant request is indistinguishable from having been given one, so
 * the only thing a dismissal can do is put the request back where it was.
 */
export function dismiss(pending: PendingSet): PendingSet {
  return pending;
}