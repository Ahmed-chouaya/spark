import { useCallback, useState, type ReactElement } from "react";
import { escalates, selectState } from "../state-selection";
import type { AgentId, AgentSession } from "../state-selection";
import { applyEvent, type SessionEvent } from "../state-selection/events";
import { createSession } from "../state-selection/session";
import { canHoldPersistentSurface, readHostWindow } from "./capability";
import { DecisionSurface } from "./DecisionSurface";
import { EscalationSurface, surfaceVisibility } from "./EscalationSurface";
import {
  decide,
  dismiss,
  longestWaiting,
  supersede,
  type Decision,
  type PendingRequest,
  type PendingSet,
} from "./pending";

/**
 * The companion surface: one mascot, and a decision when there is one to make.
 *
 * This is where the two halves meet. `src/state-selection` owns *which* state a
 * set of sessions implies and *whether* a block is actionable; this owns what
 * the user is shown about it, and when. Neither is re-decided here — the surface
 * asks `selectState` and `escalates` and renders the answers.
 *
 * The pending set is passed in rather than derived here, because what the agent
 * is asking for is not in a session: a session knows it is blocked, not what for.
 * That is the half `agent-relay` will supply, and the shape of it is fixed in
 * ./pending because the decision has to be bound to a request.
 */
export interface CompanionSurfaceProps {
  /** The live sessions, as the adapters produced them. */
  readonly sessions: readonly AgentSession[];
  /** Requests waiting for an answer. */
  readonly pending?: PendingSet;
  /** Whether this platform can keep the surface above unfocused windows. */
  readonly persistent?: boolean;
  /** Called when the user answers the request the surface was showing. */
  readonly onDecision?: (decision: Decision, request: PendingRequest) => void;
  /** Rendered width for the mascot. */
  readonly width?: number;
}

/**
 * Everything the surface does, as one value.
 *
 * Derived rather than stored so it cannot disagree with itself: `selectState`
 * and `escalates` are consulted on every render, so a session that blocks or
 * unblocks changes what is on screen without anything having to remember to
 * clear a flag.
 */
export function useCompanionSurface({
  sessions,
  pending = [],
  persistent = canHoldPersistentSurface(readHostWindow()),
  onDecision,
  width,
}: CompanionSurfaceProps) {
  // Both answers come from state-selection. Neither is re-derived here: one
  // question has one answer in this codebase.
  const state = selectState(sessions);
  const escalating = sessions.some(escalates);

  const visibility = surfaceVisibility(escalating, persistent);

  // A decision surface is offered only for a block that is actually actionable.
  // `escalates` already requires both conditions — the session is in the
  // blocking state *and* the companion can resolve it — so an agent question
  // produces no card at all, and the user is never brought to a surface with
  // nothing on it to do.
  const offered = escalating ? longestWaiting(pending) : null;

  const answer = useCallback(
    (decision: Decision, request: PendingRequest) => {
      onDecision?.(decision, request);
    },
    [onDecision]
  );

  const close = useCallback(() => {
    // A dismissal changes nothing. Deliberately a no-op with respect to the
    // pending set: see `dismiss` in ./pending.
  }, []);

  // The surface, and a decision card when there is a request to put on it.
  //
  // The card is rendered inside the surface's own fragment rather than beside
  // it, so "what is on screen" is one element tree that a caller mounts once
  // and a test can read once.
  const surface: ReactElement = (
    <>
      <EscalationSurface
        state={state}
        escalating={escalating}
        canHoldPersistentSurface={persistent}
        width={width}
      />
      {offered ? (
        <DecisionSurface request={offered} onDecision={answer} onDismiss={close} />
      ) : null}
    </>
  );

  return { state, escalating, visibility, offered, surface };
}

/**
 * A pending set that answers decisions against itself.
 *
 * The pure model in ./pending, held in state so the surface can answer and the
 * caller does not have to own the bookkeeping. This is the half that will move
 * to `agent-relay`; keeping it here means the identity rule has one
 * implementation in the same change that introduces it, and the transport that
 * eventually carries decisions is free to be anything.
 */
export function usePendingDecisions(initial: PendingSet = []) {
  const [pending, setPending] = useState<PendingSet>(initial);

  const add = useCallback((request: PendingRequest) => {
    setPending((current) =>
      current.some((existing) => existing.id === request.id) ? current : [...current, request]
    );
  }, []);

  /**
   * Answer the request the decision was made for, and only that one.
   *
   * The identity check happens here rather than in the callback, so a decision
   * arriving for a request that has gone away is refused by the model itself
   * rather than by whoever happened to be listening.
   */
  const answer = useCallback(
    (decision: Decision, request: PendingRequest) => {
      setPending((current) => decide(current, request.id, decision).pending);
    },
    []
  );

  /** The block ended without the user answering; the request stops being pending. */
  const resolve = useCallback((sessionId: string) => {
    setPending((current) => supersede(current, sessionId));
  }, []);

  /** Closing the surface decides nothing and forgets nothing. */
  const abandon = useCallback(() => {
    setPending((current) => dismiss(current));
  }, []);

  return { pending, add, answer, resolve, abandon };
}

/**
 * The live sessions, driven by canonical events.
 *
 * `agent-relay` will own this — it is the half that receives the host's stream —
 * but it belongs in this module until then so that a host event and the request
 * it carries can move together. Keeping them apart is what produces a card for a
 * request nobody has seen or a block with nothing to answer, and the rule that a
 * decision resolves exactly one request only holds if both halves move as one.
 *
 * The fold is `applyEvent` and nothing here re-derives a state, so the reduction
 * keeps its single home. One session is addressed because v0.1 has one: the
 * longest-waiting rule and the per-session mascots that would make several
 * meaningful are both out of scope for this change.
 */
export function useSessions(
  initial: readonly AgentSession[] = [],
  agent: AgentId = "claude-code"
) {
  const [sessions, setSessions] = useState<readonly AgentSession[]>(initial);

  const deliver = useCallback(
    (event: SessionEvent) => {
      setSessions((current) => {
        const existing = current.find((session) => session.agent === agent);
        const target = existing ?? createSession(agent, "spark", event.at);
        const next = applyEvent(target, event);

        return existing
          ? current.map((session) => (session === existing ? next : session))
          : [...current, next];
      });
    },
    [agent]
  );

  return { sessions, deliver };
}