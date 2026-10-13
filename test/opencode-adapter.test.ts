import { describe, expect, it } from "vitest";
import {
  createOpenCodeAdapter,
  type OpenCodeEvent,
  type OpenCodeEventData,
} from "../src/state-selection/adapters/opencode";

/**
 * The OpenCode adapter, against events a real host emitted.
 *
 * Every fixture below was copied from a probe plugin run against
 * `opencode v2.0.26` — the field names, the nesting, the `finish` strings. Not
 * invented, and not taken from the documentation, which for this version is
 * wrong about `event.properties` versus `event.data` and about every event name
 * that matters here.
 *
 * That matters more than it might look. An adapter tested against invented
 * payloads proves it agrees with the shape its author imagined, and the whole
 * reason for the probe was that the author's imagination was wrong.
 */

const AT = 1_700_000_000_000;
const clock = () => AT;

/**
 * The shape every fixture shares, as the host emits it.
 *
 * `at` is settable because the host's own `created` timestamp is what elapsed
 * time is measured against — not this machine's clock. A fixture that pinned it
 * would make every pairing below read as zero milliseconds and every test that
 * checks elapsed time would be asserting against a fixture that cannot express
 * the thing it is testing.
 */
const event = (
  type: string,
  data: OpenCodeEventData,
  at: number = AT
): OpenCodeEvent => ({
  type,
  created: at,
  location: { directory: "/home/me/project" },
  data: { sessionID: "ses_ecbe353d9ffexYmDQjStmEekGO", ...data },
});

/** Elapsed time an event's signals carry, or `undefined` when they carry none. */
const elapsedOf = (update: { event: unknown } | null): unknown =>
  (update?.event as { signals?: { elapsedMs?: unknown } } | undefined)?.signals?.elapsedMs;

describe("a session appears", () => {
  it("reads session.created as a session starting", () => {
    const update = createOpenCodeAdapter(clock).translate(
      // The measured payload carries more than this adapter reads, and a fixture
      // trimmed to the fields used would stop being evidence that the extra ones
      // are harmless.
      event("session.created", {
        sessionID: "ses_abc",
        projectID: "a4d002e3",
        slug: "brave-rocket",
        version: "2.0.26",
      })
    );

    expect(update).toEqual({
      sessionId: "ses_abc",
      event: { type: "session-started", at: AT },
    });
  });

  it("ignores an event with no session, because it concerns nothing", () => {
    const update = createOpenCodeAdapter(clock).translate({
      type: "session.created",
      created: AT,
      data: {},
    });

    expect(update).toBeNull();
  });
});

describe("the user hands over work", () => {
  it("reads session.execution.started as a prompt", () => {
    const update = createOpenCodeAdapter(clock).translate(event("session.execution.started", {}));

    // `session.idle` is what the documentation says this is. It is not: measured,
    // `session.idle` does not appear at all, and `session.execution.started` is
    // what arrives instead. A test written against the docs would have passed
    // against a string no host emits.
    expect(update?.event).toEqual({ type: "prompt-submitted", at: AT });
  });

  it("reads the end of an execution as completion", () => {
    const update = createOpenCodeAdapter(clock).translate(
      event("session.execution.succeeded", {})
    );

    expect(update?.event).toEqual({ type: "completed", at: AT });
  });
});

describe("a tool call, joined by the host's own call id", () => {
  it("reads the call as work starting, at the default effort", () => {
    const update = createOpenCodeAdapter(clock).translate(
      event("session.tool.called", {
        id: "call-36e84a87-2010-4422-9ba4-5a219027c905",
        input: { command: "ls" },
        executed: false,
      })
    );

    expect(update?.event).toMatchObject({ type: "tool-activity" });
    // Effort unknown at the start, so the default bucket. The same answer the
    // Claude Code adapter gives `PreToolUse`, for the same reason.
    expect(update?.event).toHaveProperty("signals.payloadBytes");
  });

  it("gives elapsed time when both ends are on one adapter", () => {
    const adapter = createOpenCodeAdapter(clock);
    const callId = "call-36e84a87-2010-4422-9ba4-5a219027c905";

    adapter.translate(event("session.tool.called", { id: callId, input: { command: "ls" } }));
    const done = adapter.translate(
      event(
        "session.tool.success",
        { id: callId, metadata: { status: "completed", exit: 0 } },
        AT + 1_500
      )
    );

    expect(elapsedOf(done)).toBe(1_500);
  });

  it("does not treat an unpaired completion as instant", () => {
    // Unknown must not read as "quick", or every unmatched completion would be
    // classified as a trivial tool call and the mascot would never look busy.
    const done = createOpenCodeAdapter(clock).translate(
      event("session.tool.success", { id: "call-never-seen", metadata: { status: "completed" } })
    );

    expect(elapsedOf(done)).toBeUndefined();
  });

  it("keeps two calls apart", () => {
    const adapter = createOpenCodeAdapter(clock);

    adapter.translate(event("session.tool.called", { id: "call-a", input: { command: "ls" } }, AT));
    adapter.translate(
      event("session.tool.called", { id: "call-b", input: { command: "sleep 5" } }, AT + 500)
    );
    const second = adapter.translate(event("session.tool.success", { id: "call-b" }, AT + 3_000));

    // 2500ms for the second call, not 3000 — pairing by the host's id rather than
    // by arrival order is the whole reason the id is used.
    expect(elapsedOf(second)).toBe(2_500);
  });

  it("gives the first call its own time when it is the first to finish", () => {
    // The case the test above does not reach, and the one that tells pairing by
    // id apart from pairing by arrival. Two calls start; the *first* finishes
    // three seconds in. Pairing by arrival would hand it the second call's start
    // and report 2500ms; pairing by id reports 3000.
    //
    // Found by breaking the adapter to pair by arrival and watching every test
    // still pass — the other ordering never completed the earlier call, so no
    // fixture could tell the two implementations apart.
    const adapter = createOpenCodeAdapter(clock);

    adapter.translate(event("session.tool.called", { id: "call-a" }, AT));
    adapter.translate(event("session.tool.called", { id: "call-b" }, AT + 500));
    const first = adapter.translate(event("session.tool.success", { id: "call-a" }, AT + 3_000));

    expect(elapsedOf(first)).toBe(3_000);
  });

  it("keeps two adapters' calls apart", () => {
    // Measured: this machine loads two plugin instances — one global, one per
    // project — so the same event arrives twice. If the pairing lived at module
    // scope, one instance's start would be paired with the other instance's
    // completion and the elapsed time would belong to neither.
    const globalInstance = createOpenCodeAdapter(clock);
    const projectInstance = createOpenCodeAdapter(clock);

    globalInstance.translate(event("session.tool.called", { id: "call-x" }, AT));
    const crossed = projectInstance.translate(
      event("session.tool.success", { id: "call-x" }, AT + 9_000)
    );

    expect(elapsedOf(crossed)).toBeUndefined();
  });
});

describe("a turn ends", () => {
  it("reads an ordinary finish as completion", () => {
    const update = createOpenCodeAdapter(clock).translate(
      event("session.step.ended", {
        finish: "tool-calls",
        rawFinish: "tool_calls",
        cost: 0,
        tokens: { input: 33, output: 12, reasoning: 42 },
        files: "[0]",
      })
    );

    expect(update?.event).toEqual({ type: "completed", at: AT });
  });

  it("reads a stop as a stop, and not as ordinary work", () => {
    for (const finish of ["error", "aborted", "cancelled", "length"]) {
      const update = createOpenCodeAdapter(clock).translate(event("session.step.ended", { finish }));
      expect(update?.event, finish).toEqual({ type: "failed", at: AT });
    }
  });

  it("treats an unrecognised finish as completion rather than inventing a failure", () => {
    // A host that grows a new finish string should not make the mascot alarmed at
    // ordinary work. Erring towards "finished" is the safe direction: a missed
    // failure is a quieter mascot, and an invented one is noise the user learns
    // to ignore.
    const update = createOpenCodeAdapter(clock).translate(
      event("session.step.ended", { finish: "some-new-thing-v2" })
    );

    expect(update?.event).toEqual({ type: "completed", at: AT });
  });

  it("reads a step's own metadata as a failure", () => {
    const update = createOpenCodeAdapter(clock).translate(
      event("session.step.ended", { finish: "stop", metadata: { status: "error", exit: 1 } })
    );

    expect(update?.event).toEqual({ type: "failed", at: AT });
  });
});

describe("what is deliberately not mapped", () => {
  it("ignores the per-token streams, because a mascot is not a token counter", () => {
    for (const type of [
      "session.reasoning.delta",
      "session.text.delta",
      "session.reasoning.started",
      "session.text.started",
    ]) {
      expect(createOpenCodeAdapter(clock).translate(event(type, {})), type).toBeNull();
    }
  });

  it("does not escalate on permission.asked, because there is no measured answer", () => {
    // This is the one that looks like an oversight and is not. The event exists,
    // it is exactly the shape of "the agent wants something", and mapping it
    // would put the mascot in `needsYou` with no card on it — a loud state with
    // nothing to act on, which teaches the user that being summoned is sometimes
    // pointless. The permission hook was never observed firing, and an unmeasured
    // decision path could refuse a tool call wrongly.
    const update = createOpenCodeAdapter(clock).translate(
      event("permission.asked", { id: "call-x", input: { command: "rm -rf /" } })
    );

    expect(update).toBeNull();
  });

  it("ignores everything it does not model, as silence", () => {
    for (const type of [
      "session.inbox.enqueued",
      "session.inbox.delivered",
      "session.usage.updated",
      "session.instructions.updated",
      "session.tool.progress",
      "session.step.streamed",
      "shell.created",
      "shell.exited",
      "project.updated",
    ]) {
      expect(createOpenCodeAdapter(clock).translate(event(type, {})), type).toBeNull();
    }
  });
});

describe("the identity the adapter publishes", () => {
  it("is one agent, so sessions are namespaced by it", () => {
    // The prefix on the session id is what keeps two agents' sessions apart when
    // both are folding into one set.
    expect(createOpenCodeAdapter(clock).agent).toBe("opencode");
  });
});

describe("what happens when the same event arrives twice", () => {
  it("folds to the same session rather than counting twice", () => {
    // Measured: two plugin instances are loaded on this machine — one global and
    // one per project — so every event is delivered to both. An adapter that
    // counted events would show every tool call twice.
    const update = createOpenCodeAdapter(clock).translate(
      event("session.tool.called", { id: "call-a", input: { command: "ls" } })
    );

    expect(update).toEqual(
      createOpenCodeAdapter(clock).translate(
        event("session.tool.called", { id: "call-a", input: { command: "ls" } })
      )
    );
  });
});
