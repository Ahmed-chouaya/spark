import type { MascotState } from "../components/mascot/types";
import { selectPrimary, type AgentSession } from "./session";

/**
 * The reduction: a set of live sessions in, exactly one state out.
 *
 *   blocked := sessions whose state is needsYou
 *   if blocked is non-empty    -> needsYou
 *   if the primary is alert     -> alert
 *   otherwise                  -> the primary's own state
 *
 * Two rules, and both are attention routing rather than bookkeeping.
 *
 * A blocked session outranks everything, including a primary that is mid-task,
 * because a blocked session has stopped and costs wall-clock until the user
 * answers it. Nothing else on the screen competes with that.
 *
 * Otherwise the mascot speaks for the primary session alone. A background
 * session that is busy says nothing actionable — you are not waiting on it and
 * it will finish on its own — and rendering it would train the user to glance
 * past the mascot.
 *
 * There is no second code path for ambient states. Every other state in the
 * vocabulary reaches the screen through `primary.state` unchanged, which is what
 * keeps the mascot honest: it never invents a state, and it never has an
 * opinion about a session it is not speaking for.
 *
 * The fault rung has no branch of its own, because a fault on the primary is
 * already `primary.state`; it is the second rung of the ladder in
 * ./classification and it does not need a line here to work. What does need a
 * line is the cost, and it is deliberate: **a background session that fails
 * will not be noticed.** That is accepted, because the session has already ended
 * and there is no decision attached to it — but it is a real loss, which is why
 * it is written down here rather than left as an accident waiting to be
 * "fixed".
 *
 * With no sessions at all there is nothing to speak for, so the companion
 * rests.
 */
export function selectState(sessions: readonly AgentSession[]): MascotState {
  const blocked = sessions.find((session) => session.state === "needsYou");
  if (blocked) return "needsYou";

  const primary = selectPrimary(sessions);
  if (!primary) return "idle";

  return primary.state;
}