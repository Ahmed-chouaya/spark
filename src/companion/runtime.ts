/**
 * The companion's half of the round trip: a request arrives, a decision goes
 * back on the connection that asked.
 *
 * ## What this owns
 *
 * One loop over three facts, in this order, and nothing else:
 *
 * ```
 *   request arrives  ->  what is being asked, and by whom   (src/companion/request)
 *                     ->  is it worth putting in front of a person
 *   the user answers ->  which request it was made for       (src/escalation/pending)
 *                     ->  the host's own decision shape      (src/companion/decision)
 *                     ->  back on that request's connection
 * ```
 *
 * Everything it consults, it consults rather than reimplements. The pending set
 * is `../escalation/pending`, which owns the rule that a decision applies to one
 * request and to no other; the payload is read by the existing host adapter,
 * which owns what a hook event means; the two answers are `../escalation/
 * pending`'s `Decision`, which owns that there are exactly two. This module
 * holds no rule of its own about any of it, and the tests here are mostly
 * asserting that it did not grow one.
 *
 * ## The one place the host's output vocabulary lives
 *
 * `decision.ts` is where a decision becomes the bytes its host reads, and it is
 * the only file in the repository that knows what those bytes are. The same
 * boundary the input side has always had — the adapter is the only place that
 * knows what a host's *payload* is — extended to the way back out, because
 * there was no way back out before this.
 *
 * It is here and not in `src/relay/channel.ts` because the channel is transport:
 * it moves bytes and does not know what they mean, and the day it learns the
 * shape of an answer is the day a program on the host's critical path knows it
 * too. And it is here and not in `src/escalation` because escalation owns what
 * the *user* is offered, which is two buttons and no host vocabulary at all.
 *
 * ## What this does not do
 *
 * It does not wait, and neither does anything here. Every call into the channel
 * is a call that either answers now or does not happen: the request is already
 * accepted when the handler is called, and a decision made after the requester
 * has gone is a decision nobody is waiting for. The deadline belongs to the
 * program on the other end — see `ask/src/main.rs` — and this module's job is to
 * be a correct answer when one exists and no answer at all when one does not.
 */

import type { AgentAdapter } from "../state-selection/adapters/types";
import type { ClaudeCodePayload } from "../state-selection/adapters/claude-code";
import type { Decision, DecisionOutcome, PendingRequest, PendingSet } from "../escalation/pending";
import {
  decide,
  dismiss,
  longestWaiting,
  supersede,
} from "../escalation/pending";
import type { PendingRequestChannel } from "../relay/channel";
import { describeRequest } from "./request";
import { permissionDecision } from "./decision";

/**
 * How a payload is turned into text before the adapter sees it.
 *
 * UTF-8, because that is what the waiting program delivers: it writes the host
 * agent's hook payload unchanged, and a hook payload is JSON.
 */
export type Decode = (payload: Buffer) => string;

export interface DecisionRuntimeOptions {
  /**
   * The host agent's adapter, required rather than defaulted.
   *
   * For the same reason `src/relay/session-source.ts` requires one: a runtime
   * that quietly built the Claude Code adapter for you is a runtime that has
   * already decided which host it is for, and that decision is what the adapter
   * boundary exists to leave open.
   */
  readonly adapter: AgentAdapter<ClaudeCodePayload>;
  /**
   * The channel's request handler, handed straight through.
   *
   * Taken as an argument rather than opened here so that this module holds no
   * socket and can be tested against one the test made. Whoever opens the
   * channel owns it; this owns what arrives on it.
   */
  readonly onRequest: (request: PendingRequestChannel) => void;
  /** The clock, injected so a test can order two requests without waiting. */
  readonly now?: () => number;
  /** How the payload's bytes become text. UTF-8 by default. */
  readonly decode?: Decode;
}

export interface DecisionRuntime {
  /** Every request still waiting for an answer, in the order they arrived. */
  readonly pending: PendingSet;
  /** The request the surface is offering, or `null` when there is none. */
  readonly offered: PendingRequest | null;
  /**
   * What one request asked for, and whether it is worth asking about.
   *
   * `null` for a payload the host is not asking about, which is every event that
   * is not a permission request. That is the common case and it is not an error:
   * the waiting program is installed for one event and the host sends whatever
   * it sends, and a request this companion cannot answer produces no request to
   * answer.
   */
  announce(request: PendingRequestChannel): PendingRequest | null;
  /**
   * Apply an answer to exactly the request it was made for.
   *
   * The outcome is the existing one from `../escalation/pending`, including its
   * refusal: an answer for a request that has gone away is refused, resolves
   * nothing, and delivers nothing to anybody. See `answer`.
   */
  answer(decision: Decision, request: PendingRequest): DecisionOutcome;
  /** The block ended without the user answering. The request stops waiting. */
  resolve(sessionId: string): PendingSet;
  /** The surface was closed. Nothing is decided and nothing is forgotten. */
  abandon(): PendingSet;
}

/**
 * The companion's decisions, and the one loop that connects them to a channel.
 *
 * Mutable state held in one object rather than in React, because the thing being
 * modelled is a set of requests that outlive any render: the user can be looking
 * at something else entirely while one is pending. `usePendingDecisions` in
 * `../escalation` holds the same thing in a component, and the two are kept
 * honest by the rule they both go through — `decide`, from `../escalation/
 * pending`, which is the only implementation of "a decision applies to one
 * request" in this codebase.
 */
export function createDecisionRuntime({
  adapter,
  onRequest,
  now = () => Date.now(),
  decode = (payload) => payload.toString("utf8"),
}: DecisionRuntimeOptions): DecisionRuntime {
  let pending: PendingSet = [];

  /**
   * Where each waiting request's answer has to go.
   *
   * Held beside the pending set rather than inside it, because it is transport
   * state: `PendingRequest` is the user's model of what they are being asked,
   * and a socket in it would put an implementation detail into the type the
   * surface renders from. Keyed by the same identifier, so the two cannot fall
   * out of step — and removed together, which is what makes a request whose
   * answer was never sent simply stop existing.
   */
  const routes = new Map<string, PendingRequestChannel>();

  const drop = (requestId: string): PendingSet => {
    routes.delete(requestId);
    return (pending = pending.filter((request) => request.id !== requestId));
  };

  return {
    get pending() {
      return pending;
    },

    // A getter rather than a method, so the value is read at the moment it is
    // asked for. The surface renders from this and the user can answer between
    // one render and the next, so a captured value would go stale in exactly the
    // window where a stale answer is least recoverable.
    get offered() {
      return longestWaiting(pending);
    },

    announce(channelRequest): PendingRequest | null {
      const request = describeRequest({
        adapter,
        payload: decode(channelRequest.payload),
        id: channelRequest.id,
        at: now(),
      });
      if (!request) return null;

      // Re-announcing a request that is still waiting is not a second request.
      // The same tool call can be offered for permission twice by a host that
      // re-asks after a declined attempt, and the second one is the *same*
      // question: two cards for one pending thing would be two chances to answer
      // it, and the second answer has nowhere correct to go.
      const already = pending.some((existing) => existing.id === request.id);
      if (already) return null;

      routes.set(request.id, channelRequest);
      pending = [...pending, request];

      return request;
    },

    answer(decision, request): DecisionOutcome {
      // Through the existing rule rather than a filter-and-forget. It is the
      // same function `usePendingDecisions` calls, so the identity rule — a
      // decision applies to the request it was made for or to none — has one
      // implementation in this codebase rather than one per transport.
      const outcome = decide(pending, request.id, decision);

      if (!outcome.applied) {
        // Refused. The route goes with it, so a decision that arrived for a
        // request the host has stopped waiting for cannot be delivered late: it
        // is dropped here rather than held, because holding it would be a
        // decision waiting for a request that is gone.
        routes.delete(request.id);
        return outcome;
      }

      const route = routes.get(request.id);
      routes.delete(request.id);
      pending = outcome.pending;

      // The reply, and only for a decision that was applied. The shape is the
      // host's own, produced in one place (./decision), and `permissionDecision`
      // knows both answers and nothing else — so a reply can carry a decision
      // and cannot carry anything alongside it.
      route?.reply(permissionDecision(decision));

      return outcome;
    },

    resolve(sessionId) {
      // The session's requests are gone — the agent moved on, or the user
      // answered in the terminal. `supersede` drops them, and their routes with
      // them, so a card still on screen cannot produce an answer for work that
      // is no longer waiting. It decides nothing: the user answering elsewhere is
      // not this surface answering for them.
      const leaving = new Set(
        pending.filter((request) => request.sessionId === sessionId).map((request) => request.id)
      );
      for (const id of leaving) routes.delete(id);

      return (pending = supersede(pending, sessionId));
    },

    abandon() {
      // Closing the surface is not an answer. It resolves nothing and defaults
      // nothing, and the requests keep their routes so the decision can still
      // arrive — the user closed the card and opened it again, and an answer
      // then is the same answer as an answer before.
      return (pending = dismiss(pending));
    },
  };
}