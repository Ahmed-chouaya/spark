import type { MascotState } from "../components/mascot/types";
import { classify } from "./classification";
import type { AgentSession, BlockReason } from "./session";

export type { BlockReason };

/**
 * Whether the companion can complete what the session is asking for.
 *
 * The host agent blocks on a question as well as on an authorisation request,
 * and the two must not be treated alike. An authorisation can be granted from
 * the companion; a question the agent asked cannot be, and escalating to it
 * would pull the user to a dead end.
 */
export function canResolve(reason: BlockReason | null): boolean {
  return reason === "authorization";
}

/**
 * The only state that escalates.
 *
 * `alert` is loud and `needsYou` is loud, and exactly one of them escalates.
 * The distinction is whether the user has anything to *do*: an agent that
 * failed has already failed, so the news is over and interrupting the user
 * about it is an interruption with no payoff, while an agent that is blocked
 * will stay blocked indefinitely and every second costs wall-clock.
 *
 * Two escalations would also mean two sources contending for one channel, which
 * is a queue problem this change should not have to solve.
 */
export const ESCALATING_STATE: MascotState = "needsYou";

export function escalatesState(state: MascotState): boolean {
  return state === ESCALATING_STATE;
}

/**
 * Whether this session should be brought to the user's attention now.
 *
 * Escalating is not the same as being loud, and the second condition is the one
 * that is easy to forget. Before a state escalates, ask whether the companion
 * can complete what it is asking for: an agent question it has no way to answer
 * must stay quiet, because a loud card with no action on it teaches the lesson
 * that sometimes there is nothing to do about the mascot calling — and that
 * lesson costs us the one escalation we actually have.
 */
export function escalates(session: AgentSession): boolean {
  return escalatesState(session.state) && canResolve(session.block);
}

/**
 * Whether a state is loud, escalating or not.
 *
 * Derived from lifetime rather than listed: fault and block are the two classes
 * that cost the user something, so they are the two that are loud. A fault is
 * loud *and* does not escalate, which is the whole of the distinction.
 */
export function isLoud(state: MascotState): boolean {
  const stateClass = classify(state);
  return stateClass === "fault" || stateClass === "block";
}