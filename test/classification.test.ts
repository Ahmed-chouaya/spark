import { describe, expect, it } from "vitest";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";
import {
  IDLE_RUNG,
  PRECEDENCE,
  STATE_CLASSES,
  STATE_CLASSIFICATION,
  classify,
  outranks,
  rankOfRung,
  revertsOnItsOwn,
  type PrecedenceRung,
} from "../src/state-selection/classification";

/** The classification this design commits to, written out by hand. */
const EXPECTED_CLASS: Record<MascotState, (typeof STATE_CLASSES)[number]> = {
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

/** `block > fault > transient > sustained > idle`, written out by hand. */
const EXPECTED_PRECEDENCE: PrecedenceRung[] = [
  "block",
  "fault",
  "transient",
  "sustained",
  IDLE_RUNG,
];

/** One state per class, to compare classes through the states that carry them. */
const REPRESENTATIVE: Record<(typeof STATE_CLASSES)[number], MascotState> = {
  block: "needsYou",
  fault: "alert",
  transient: "success",
  sustained: "working",
};

describe("states are classified by lifetime", () => {
  it("resolves all nine states to exactly one class", () => {
    expect(Object.keys(STATE_CLASSIFICATION).sort()).toEqual([...MASCOT_STATES].sort());

    for (const state of MASCOT_STATES) {
      const resolved = classify(state);
      expect(STATE_CLASSES, state).toContain(resolved);
      expect(resolved, state).toBe(EXPECTED_CLASS[state]);
    }
  });

  it("puts every class to work", () => {
    const used = new Set(MASCOT_STATES.map(classify));
    expect([...used].sort()).toEqual([...STATE_CLASSES].sort());
  });

  it("marks exactly the transient states as reverting on their own", () => {
    const reverting = MASCOT_STATES.filter(revertsOnItsOwn);
    expect(reverting.sort()).toEqual(["success", "thinking"]);
  });
});

describe("precedence is derived from the classification", () => {
  it("derives exactly the documented ladder", () => {
    expect([...PRECEDENCE]).toEqual(EXPECTED_PRECEDENCE);
  });

  it("ranks every rung once, with no ties", () => {
    const ranks = PRECEDENCE.map(rankOfRung);
    expect(new Set(ranks).size).toBe(PRECEDENCE.length);
  });

  it("orders every pair of classes the way the rule says", () => {
    const classes = EXPECTED_PRECEDENCE.filter(
      (rung): rung is Exclude<PrecedenceRung, typeof IDLE_RUNG> => rung !== IDLE_RUNG
    );

    for (let i = 0; i < classes.length; i += 1) {
      for (let j = i + 1; j < classes.length; j += 1) {
        const higher = classes[i] as Exclude<PrecedenceRung, typeof IDLE_RUNG>;
        const lower = classes[j] as Exclude<PrecedenceRung, typeof IDLE_RUNG>;
        expect(rankOfRung(higher), `${higher} vs ${lower}`).toBeLessThan(
          rankOfRung(lower)
        );
        expect(outranks(REPRESENTATIVE[higher], REPRESENTATIVE[lower])).toBe(true);
        expect(outranks(REPRESENTATIVE[lower], REPRESENTATIVE[higher])).toBe(false);
      }
    }
  });

  it("ranks idle below the sustained states it shares a class with", () => {
    // idle is sustained by lifetime, but it is the resting rung: it makes no
    // claim, so anything that does beats it.
    const sustained = MASCOT_STATES.filter(
      (state) => state !== IDLE_RUNG && classify(state) === "sustained"
    );

    expect(sustained.sort()).toEqual(["focused", "listening", "tired", "working"]);
    for (const state of sustained) {
      expect(outranks(state, IDLE_RUNG), state).toBe(true);
    }
    expect(outranks(IDLE_RUNG, IDLE_RUNG)).toBe(false);
  });
});