import type { MascotState } from "../components/mascot/types";
import { classify, outranks, revertsOnItsOwn } from "./classification";
import type { AgentSession, BlockReason } from "./session";
import { classifyToolActivity, estimateEffort, type EffortSignals } from "./tool-effort";

export type { EffortSignals };

/**
 * How long a transient state stays on screen before it gives way.
 *
 * `thinking` is the ~2-second gap between a prompt and the first tool call, and
 * it is a transient precisely because the companion never sits in it.
 */
export const TRANSIENT_WINDOW_MS = 2_000;

/** How long nothing may happen before the companion rests. */
export const REST_AFTER_MS = 5 * 60_000;

/**
 * The canonical event set, the vocabulary every host agent is translated into.
 *
 * Every event carries the time it happened. Time is an input rather than
 * something read from the clock, so the whole module stays a pure function of
 * its arguments and a test can run a week of silence in one assertion.
 */
export type SessionEvent =
  /** A session exists and nothing has happened to it. */
  | { readonly type: "session-started"; readonly at: number }
  /** The user submitted work; no tool has run yet. */
  | { readonly type: "prompt-submitted"; readonly at: number }
  /** A tool is running, described only by what it costs. */
  | { readonly type: "tool-activity"; readonly at: number; readonly signals: EffortSignals }
  /** The turn ended cleanly. */
  | { readonly type: "completed"; readonly at: number }
  /** The turn ended in failure. */
  | { readonly type: "failed"; readonly at: number }
  /** The agent is waiting on a decision the user can give. */
  | { readonly type: "authorization-requested"; readonly at: number }
  /** The agent is waiting on an answer the companion has no way to give. */
  | { readonly type: "agent-question"; readonly at: number }
  /** The user answered whatever the session was blocked on. */
  | { readonly type: "answered"; readonly at: number }
  /**
   * The clock advanced.
   *
   * Deliberately not activity: a tick must not reset the silence that the
   * resting state is derived from, or the companion could never rest.
   */
  | { readonly type: "time-passed"; readonly at: number };

/** The state one event maps to, for the events that map unconditionally. */
export function stateForEvent(event: SessionEvent): MascotState {
  switch (event.type) {
    case "session-started":
      return "idle";
    case "prompt-submitted":
      return "thinking";
    case "tool-activity":
      return classifyToolActivity(estimateEffort(event.signals));
    case "completed":
      return "success";
    case "failed":
      return "alert";
    case "authorization-requested":
    case "agent-question":
      return "needsYou";
    case "answered":
    case "time-passed":
      throw new Error(`${event.type} carries no state of its own; it is handled in place`);
  }
}

const blockReasonFor = (event: SessionEvent): BlockReason | null => {
  if (event.type === "authorization-requested") return "authorization";
  if (event.type === "agent-question") return "question";
  return null;
};

/**
 * Whether a newly mapped state displaces the one a session is already holding.
 *
 * Lifetime decides it. Fault and block states hold: a late tool response, a
 * stray tick or a background poll must not talk the user out of a failure or an
 * unanswered authorisation, so one of those is only replaced by a state that
 * outranks it — which is the ladder from ./classification doing its job. A
 * sustained state holds only until the next event, and a transient has already
 * committed to reverting, so for both the newest event simply wins.
 *
 * Note what the ladder is deliberately *not* used for: ordering states by how
 * recently they arrived. `success` outranks `working`, but work that starts
 * after a finished turn is not a competing claim, it is later.
 */
function displaces(current: MascotState, next: MascotState): boolean {
  const currentClass = classify(current);
  if (currentClass !== "fault" && currentClass !== "block") return true;
  return !outranks(current, next);
}

/** The block has been answered: it clears, and the agent resumes. */
function onAnswered(session: AgentSession, at: number): AgentSession {
  // Nothing was pending, so there is nothing to answer.
  if (session.block === null) return session;

  return {
    ...session,
    // The agent has its answer and no tool has run yet.
    state: "thinking",
    block: null,
    lastEventAt: at,
    enteredAt: at,
    // `lastActiveAt` is deliberately left alone. Answering finishes the
    // session the user stepped over to; it does not make that session the one
    // they were driving, and the companion returns to whatever they were.
  };
}

/** The clock moved: transients expire, and long silence rests the companion. */
function onTimePassed(session: AgentSession, at: number): AgentSession {
  let next = session;

  if (revertsOnItsOwn(session.state) && at - session.enteredAt >= TRANSIENT_WINDOW_MS) {
    next = { ...next, state: session.ambient, enteredAt: at };
  }

  // Silence does not rest a session that is blocked or failed. Both of those
  // hold against whatever comes later, and a resting companion over an
  // unanswered authorisation would be the system quietly saying it is not
  // waiting after all.
  const silentLongEnough = at - session.lastEventAt >= REST_AFTER_MS;
  if (silentLongEnough && next.state !== "tired" && displaces(next.state, "tired")) {
    next = { ...next, state: "tired", ambient: "tired", enteredAt: at };
  }

  return next;
}

/**
 * Fold one canonical event into a session, returning the session it becomes.
 *
 * Pure: the caller holds the set of sessions and decides what to do with it.
 * See ./track for the set-level wrapper.
 */
export function applyEvent(session: AgentSession, event: SessionEvent): AgentSession {
  if (event.type === "answered") return onAnswered(session, event.at);
  if (event.type === "time-passed") return onTimePassed(session, event.at);

  const next = stateForEvent(event);

  // A tool running again means the wait is over. Whichever host reports it,
  // "the agent is working" is the same statement as "nothing is pending", and
  // without this a blocked session would hold `needsYou` for ever: the thing
  // that unblocks it is the very work it was waiting to do.
  const resumed = session.block !== null && event.type === "tool-activity";

  if (!resumed && !displaces(session.state, next)) {
    // The session holds what it had. Still activity, so the silence clock
    // restarts — but nothing about the rendered state changed.
    return { ...session, lastEventAt: event.at };
  }

  return {
    ...session,
    state: next,
    // A transient returns to whatever came before it; anything else becomes
    // the new ambient.
    ambient: revertsOnItsOwn(next) ? session.ambient : next,
    block: blockReasonFor(event),
    // Becoming active is submitting work. Nothing else the host reports is the
    // user giving the session their attention.
    lastActiveAt: event.type === "prompt-submitted" ? event.at : session.lastActiveAt,
    lastEventAt: event.at,
    enteredAt: event.at,
  };
}