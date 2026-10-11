import { expectTypeOf } from "vitest";
import type { MascotState } from "../src/components/mascot/types";
import type { AgentSession, BlockReason } from "../src/state-selection/session";
import type { SessionEvent, stateForEvent } from "../src/state-selection/events";
import type { EffortBucket } from "../src/state-selection/tool-effort";

/**
 * The session model against the vocabulary it is defined in terms of.
 *
 * These are compile-time checks: the canonical shape is pinned to the nine state
 * names `mascot-rig` exports, so a state added to the vocabulary cannot be
 * stored in a session without the failure being visible here.
 */

describe("the canonical session shape", () => {
  it("carries exactly the state names the vocabulary exports", () => {
    expectTypeOf<AgentSession["state"]>().toEqualTypeOf<MascotState>();
    expectTypeOf<AgentSession["ambient"]>().toEqualTypeOf<MascotState>();
    expectTypeOf<AgentSession["block"]>().toEqualTypeOf<BlockReason | null>();
  });

  it("rejects a state name outside the vocabulary", () => {
    expectTypeOf<"thinking">().toMatchTypeOf<AgentSession["state"]>();
    expectTypeOf<"shy">().not.toMatchTypeOf<AgentSession["state"]>();
  });

  it("holds an agent identity, a current state and an activity timestamp", () => {
    expectTypeOf<AgentSession["agent"]>().toEqualTypeOf<string>();
    expectTypeOf<AgentSession["sessionId"]>().toEqualTypeOf<string>();
    expectTypeOf<AgentSession["state"]>().toEqualTypeOf<MascotState>();
    // `number | null`, because a session can exist before the user has ever
    // given it work.
    expectTypeOf<AgentSession["lastActiveAt"]>().toEqualTypeOf<number | null>();
  });

  it("maps every canonical event onto a vocabulary state", () => {
    expectTypeOf<ReturnType<typeof stateForEvent>>().toEqualTypeOf<MascotState>();
  });

  it("keeps effort buckets to the three defined ones", () => {
    expectTypeOf<EffortBucket>().toEqualTypeOf<"light" | "ordinary" | "heavy">();
  });

  it("gives every event the time it happened", () => {
    expectTypeOf<SessionEvent>().toExtend<{ at: number }>();
  });
});