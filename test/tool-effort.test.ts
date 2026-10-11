import { describe, expect, it } from "vitest";
import { MASCOT_STATES } from "../src/components/mascot/types";
import {
  DEFAULT_EFFORT,
  EFFORT_BUCKETS,
  classifyToolActivity,
  estimateEffort,
  type EffortBucket,
} from "../src/state-selection/tool-effort";

describe("effort buckets", () => {
  it("defines a default bucket among the defined buckets", () => {
    expect(EFFORT_BUCKETS).toEqual(["light", "ordinary", "heavy"]);
    expect(EFFORT_BUCKETS).toContain(DEFAULT_EFFORT);
  });

  it("maps every bucket to a valid state name", () => {
    const states = EFFORT_BUCKETS.map(classifyToolActivity);
    expect(states).toHaveLength(EFFORT_BUCKETS.length);
    for (const state of states) {
      expect(MASCOT_STATES, state).toContain(state);
    }
    // Light, ordinary and heavy are three different sustained states, and none
    // of them is the resting rung: tool activity is never "nothing happened".
    expect(new Set(states).size).toBe(3);
    expect(states).not.toContain("idle");
  });
});

describe("a tool the system has never seen", () => {
  it("still produces a valid state, through the default bucket", () => {
    // A tool that arrived after the companion shipped, or that we have no
    // measurements for at all, is simply unknown activity.
    for (const signals of [{}, { elapsedMs: undefined }, { payloadBytes: undefined }]) {
      expect(estimateEffort(signals)).toBe(DEFAULT_EFFORT);
      expect(MASCOT_STATES).toContain(classifyToolActivity(estimateEffort(signals)));
    }
  });

  it("reads unknown as ordinary rather than as light", () => {
    // Fast on its own is not evidence of a read: a quick write is quick too.
    expect(estimateEffort({ elapsedMs: 10 })).toBe("ordinary");
    expect(estimateEffort({ payloadBytes: 8 })).toBe("ordinary");
  });

  it("claims light only when every available signal says so", () => {
    expect(estimateEffort({ elapsedMs: 40, payloadBytes: 64 })).toBe("light");
  });

  it("claims heavy the moment any single signal looks heavy", () => {
    expect(estimateEffort({ elapsedMs: 60_000, payloadBytes: 8 })).toBe("heavy");
    expect(estimateEffort({ elapsedMs: 8, payloadBytes: 10_000_000 })).toBe("heavy");
  });
});

describe("classification does not assert false precision", () => {
  it("permits two different tools of similar effort to render the same state", () => {
    // Two unrelated activities of comparable cost. The system has no opinion
    // about which one it was, and deliberately offers no way to find out:
    // there is nothing here to distinguish them.
    const cheapRead = estimateEffort({ elapsedMs: 120, payloadBytes: 2_048 });
    const cheapWrite = estimateEffort({ elapsedMs: 90, payloadBytes: 3_000 });

    expect(cheapRead).toBe(cheapWrite);
    expect(classifyToolActivity(cheapRead as EffortBucket)).toBe(
      classifyToolActivity(cheapWrite as EffortBucket)
    );
    expect(classifyToolActivity(cheapRead)).toBe("listening");
  });

  it("does not pretend that effort is a tool identity", () => {
    // The classifier's entire input is two measurements. There is no field in
    // which a tool name could be carried, so no mapping can be expressed.
    const effortOf = (signals: Parameters<typeof estimateEffort>[0]) => estimateEffort(signals);

    expect(effortOf({ elapsedMs: 1_000, payloadBytes: 1_000 })).toBe("ordinary");
    // Identical cost, identical answer — whatever these were.
    expect(effortOf({ elapsedMs: 1_000, payloadBytes: 1_000 })).toBe(
      effortOf({ elapsedMs: 1_000, payloadBytes: 1_000 })
    );
  });
});