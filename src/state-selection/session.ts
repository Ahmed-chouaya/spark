import type { MascotState } from "../components/mascot/types";

/** Which host agent owns a session, e.g. `claude-code`. */
export type AgentId = string;

/**
 * Why a session is waiting on the user.
 *
 * The two are not interchangeable. An authorisation request can be completed
 * from the companion; a question the agent asked cannot, and one that becomes
 * loud is a card with no action on it. See `canResolve` in ./escalation.
 */
export type BlockReason = "authorization" | "question";

/**
 * A live agent session, in the canonical shape every host agent is translated
 * into.
 *
 * The reduction in ./reduce consumes this and nothing else, which is what lets
 * a second agent be added as an adapter rather than as a branch in the
 * reduction.
 */
export interface AgentSession {
  /** The host agent that owns this session. */
  readonly agent: AgentId;
  /** Stable identity of the session within that agent. */
  readonly sessionId: string;
  /** What the companion would render for this session right now. */
  readonly state: MascotState;
  /** The state held before the current transient; where a transient returns to. */
  readonly ambient: MascotState;
  /**
   * When the user last submitted work here, or `null` if they never have.
   *
   * This — and only this — picks the primary session. Answering an
   * authorisation request deliberately leaves it untouched: the answer
   * finishes the session the user stepped over to, it does not make that
   * session the one they were driving.
   */
  readonly lastActiveAt: number | null;
  /**
   * When any event last arrived, or `null` before the session was ever seen
   * move. Prolonged silence is what rests the companion, and a clock tick does
   * not count as activity — see the `time-passed` event in ./events.
   */
  readonly lastEventAt: number;
  /** Why this session is blocked, while it is. */
  readonly block: BlockReason | null;
  /** When `state` was entered; starts the transient display window. */
  readonly enteredAt: number;
}

/** A session that has started and nothing has happened to it yet. */
export function createSession(agent: AgentId, sessionId: string, at: number): AgentSession {
  return {
    agent,
    sessionId,
    state: "idle",
    ambient: "idle",
    lastActiveAt: null,
    lastEventAt: at,
    block: null,
    enteredAt: at,
  };
}

/**
 * The session the companion speaks for: the one the user most recently gave
 * work to.
 *
 * A session that has never been given work (`lastActiveAt: null`) ranks below
 * every session that has, and is still the primary when it is the only one —
 * which is the common single-session case, and needs no special case here.
 *
 * Ties keep the earlier-listed session. Equal timestamps mean the host gave us
 * nothing to order by, so taking the first makes the answer a function of the
 * input rather than of a sort's stability.
 */
export function selectPrimary(
  sessions: readonly AgentSession[]
): AgentSession | undefined {
  let primary: AgentSession | undefined;
  for (const session of sessions) {
    const isMoreRecent =
      (session.lastActiveAt ?? -Infinity) > (primary?.lastActiveAt ?? -Infinity);
    if (!primary || isMoreRecent) primary = session;
  }
  return primary;
}