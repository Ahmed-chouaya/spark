import type { MascotState } from "../components/mascot/types";

/**
 * What a state does when nothing else happens.
 *
 * These four lifetimes are the whole of the vocabulary's behaviour. A transient
 * reverts to whatever the companion held before it; a sustained state holds
 * until the next event; a fault holds, and is loud, and there is nothing to be
 * done about it; a block holds, is loud, and can be acted on.
 *
 * Classifying first and deriving precedence from the classification is the
 * point. The alternative is a precedence table somebody has to maintain by hand,
 * and it drifts the first time a state is added to the vocabulary.
 */
export const STATE_CLASSES = ["transient", "sustained", "fault", "block"] as const;

export type StateClass = (typeof STATE_CLASSES)[number];

/**
 * Every state, exactly once.
 *
 * `Record<MascotState, StateClass>` makes the mapping exhaustive in both
 * directions: a state added to `mascot-rig` will not typecheck until it is
 * classified here, and a state that no longer exists will not typecheck either.
 *
 * `idle` is sustained — it holds, and it is where a session sits between
 * prompts — even though it also gets a rung of its own on the precedence ladder
 * below. Lifetime and precedence are different questions and they answer
 * differently for that one state.
 */
export const STATE_CLASSIFICATION: Record<MascotState, StateClass> = {
  idle: "sustained",
  thinking: "transient",
  working: "sustained",
  success: "transient",
  focused: "sustained",
  alert: "fault",
  listening: "sustained",
  tired: "sustained",
  needsYou: "block",
};

export function classify(state: MascotState): StateClass {
  return STATE_CLASSIFICATION[state];
}

/** Whether the state reverts on its own when nothing further happens. */
export function revertsOnItsOwn(state: MascotState): boolean {
  return classify(state) === "transient";
}

/** The resting rung: what the companion shows when nothing claims the screen. */
export const IDLE_RUNG = "idle";

/**
 * How strongly each class claims the screen, ordered by what the claim costs
 * the user rather than by how interesting the state looks.
 *
 * - `block` — the session has stopped, and it costs wall-clock until answered.
 * - `fault` — the news is over. Loud, but there is no decision to bring the
 *   user to.
 * - `transient` — briefly on screen and already on its way back out.
 * - `sustained` — the ambient baseline: true, quiet, and always replaceable.
 *
 * The numbers only have to be distinct and ordered. The ladder below is derived
 * from them rather than written out as a list of its own, so it cannot come to
 * disagree with the classification it comes from.
 */
const ATTENTION_CLAIM: Record<StateClass, number> = {
  block: 3,
  fault: 2,
  transient: 1,
  sustained: 0,
};

export type PrecedenceRung = StateClass | typeof IDLE_RUNG;

const RANKED_CLASSES: PrecedenceRung[] = (
  Object.keys(ATTENTION_CLAIM) as StateClass[]
).sort((a, b) => ATTENTION_CLAIM[b] - ATTENTION_CLAIM[a]);

/**
 * `block > fault > transient > sustained > idle`
 *
 * Derived from `ATTENTION_CLAIM`, with `idle` appended as the resting rung:
 * it is a sustained state by lifetime, but it makes no claim at all, so it
 * ranks below every sustained state that does.
 */
export const PRECEDENCE: readonly PrecedenceRung[] = [...RANKED_CLASSES, IDLE_RUNG];

/** Where a rung sits on the ladder. Smaller wins. */
export function rankOfRung(rung: PrecedenceRung): number {
  const rank = PRECEDENCE.indexOf(rung);
  if (rank < 0) throw new Error(`unranked precedence rung: ${rung}`);
  return rank;
}

/**
 * Where a state sits on the ladder. Smaller wins.
 *
 * `idle` resolves to the resting rung rather than to its own class, which is
 * what makes "sustained beats idle" true of the ladder while `idle` stays a
 * sustained state.
 */
export function rankOfState(state: MascotState): number {
  return rankOfRung(state === IDLE_RUNG ? IDLE_RUNG : classify(state));
}

/** Whether `a` outranks `b`. Strict: a state never outranks itself. */
export function outranks(a: MascotState, b: MascotState): boolean {
  return rankOfState(a) < rankOfState(b);
}