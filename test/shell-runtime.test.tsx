import { render } from "@testing-library/react";
import { act } from "react";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useCompanionShell } from "../shell/src/companion";
import { absentHost, type AbsentHost, type WorkArea } from "../shell/src/host";
import {
  HOST_WINDOW_KEY,
  SURFACE_PLACEMENTS,
  type SurfacePlacement,
} from "../src/escalation/capability";
import { createClaudeCodeSource } from "../src/relay/session-source";
import { selectState } from "../src/state-selection";
import type { AgentSession } from "../src/state-selection/session";

/**
 * The companion runtime: payloads in, a surface out, and a window told what to do.
 *
 * ## The claim being checked is a claim about what is *not* here
 *
 * "Nothing re-derives a state" is not a property a test can confirm by looking
 * for the right answer — the right answer is what a re-derived state would also
 * produce. So these are built the other way round. Every path is driven with the
 * existing adapter and the existing fold, and the rendered state is compared
 * against `selectState` run separately on the same payloads. A runtime that grew
 * its own copy of the reduction would agree with it on the easy paths and
 * disagree on the first one the two rules read differently.
 *
 * ## Why the window is a recording double
 *
 * A native window cannot be observed from jsdom, which has no compositor. So the
 * host is a double that records what it was asked — which is enough, because the
 * decision the requirement is about ("is the window on screen") is made before the
 * window is told. What the window then does with it is the platform's business,
 * recorded per machine in `shell/README.md`.
 *
 * ## The default here is a platform that cannot float
 *
 * That is the answer every platform currently gets (see `shell/README.md`), and
 * it is the branch worth testing hardest: a surface that must appear on a block
 * and disappear when the block ends has no idle state to get wrong, which is
 * exactly what makes it easy to get right by accident.
 */

const AT = 1_000;

/** A host agent's own hook payloads, as the relay would carry them. */
const payloads = {
  started: { hook_event_name: "SessionStart", session_id: "harness", timestamp: AT },
  prompted: { hook_event_name: "UserPromptSubmit", session_id: "harness", timestamp: AT + 10 },
  blocked: {
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    session_id: "harness",
    timestamp: AT + 20,
  },
  question: {
    hook_event_name: "Notification",
    notification_type: "elicitation_dialog",
    session_id: "harness",
    timestamp: AT + 20,
  },
  /** The agent got on with it, which is what a block clearing looks like from outside. */
  resumed: {
    hook_event_name: "PreToolUse",
    tool_use_id: "t1",
    session_id: "harness",
    timestamp: AT + 30,
  },
} as const;

const encode = (payload: object): Uint8Array => new TextEncoder().encode(JSON.stringify(payload));

/**
 * What the reduction makes of a payload sequence, folded independently.
 *
 * Text rather than bytes, because `applyReceivedPayload` takes `Buffer | string`
 * and a `Uint8Array` is neither: `Uint8Array.toString("utf8")` ignores its
 * argument, produces `"123,34,..."`, and parses as nothing. The shell decodes
 * before it folds, which is why this has to as well.
 */
const folded = (sequence: readonly object[]): readonly AgentSession[] => {
  const source = createClaudeCodeSource();
  for (const payload of sequence) source.receive(JSON.stringify(payload));
  return source.sessions;
};

const WORK_AREA: WorkArea = { x: 0, y: 0, width: 1920, height: 1080 };

/**
 * The report the real publishing template produces, in a real scope.
 *
 * The template is run rather than read, and it is the same file the Rust
 * `include_str!`'s, because the claim being made is end-to-end: that what the
 * host publishes reaches the surface and decides what it does. A hand-built
 * `{ placement, held }` here would let the template drift without any of these
 * tests noticing, and the template is where the bug that produced a
 * syntactically-valid-wrong-value report would live.
 */
const publishedReport = (placement: SurfacePlacement, held: boolean): Record<string, unknown> => {
  const template = readFileSync(join(import.meta.dirname, "../shell/src-tauri/src/publish.js"), "utf8");
  const scope: Record<string, unknown> = {};
  createContext(scope);

  runInContext(
    template
      .replace("__SPARK_PLACEMENT__", JSON.stringify(placement))
      .replace("__SPARK_HELD__", String(held)),
    scope
  );

  return scope;
};

/** Every mechanism a host may publish, minus the one that names no platform. */
const NAMED_PLACEMENTS = SURFACE_PLACEMENTS.filter((p) => p !== "unknown");

afterEach(() => {
  // The global is process-wide and these tests publish into it, so leaving one
  // behind would decide the branch for whatever ran next.
  delete (globalThis as Record<string, unknown>)[HOST_WINDOW_KEY];
});

interface Mounted {
  readonly host: AbsentHost;
  /** Feed one payload through the runtime, as the channel would. */
  send(payload: object): void;
  /** What the mascot is drawing, or `null` when nothing is on screen. */
  rendered(): string | null;
  readonly state: ReturnType<typeof useCompanionShell>;
}

/**
 * Mount the shell's runtime, with the capability reached the way the window
 * reaches it.
 *
 * `persistent` is passed explicitly where a test is about the visibility rules
 * and only those — it keeps those tests reading as claims about escalation
 * rather than about how the answer arrives. Everything about the report itself
 * goes through `scope`, which is a real `__SPARK_HOST_WINDOW__` published by the
 * real template: `test/shell-capability.test.ts` runs that template, and this
 * runs what it produced.
 */
const mount = (options: {
  persistent?: boolean;
  host?: AbsentHost;
  scope?: Record<string, unknown>;
} = {}): Mounted => {
  const host = options.host ?? absentHost({ workArea: WORK_AREA });

  let latest!: ReturnType<typeof useCompanionShell>;
  let send!: (payload: Uint8Array) => void;

  const Probe = () => {
    // No `persistent` unless one was asked for: the default is the report the
    // host published, which is what the real document does.
    latest = useCompanionShell({ host, persistent: options.persistent });
    send = latest.receive;
    return <>{latest.surface}</>;
  };

  // Published before the first render, as an initialisation script does. In a
  // jsdom document the global is the only seam there is, and the point of these
  // tests is that the *report* is what decides, not how it got here.
  if (options.scope) {
    for (const [key, value] of Object.entries(options.scope)) {
      (globalThis as Record<string, unknown>)[key] = value;
    }
  }

  const { container } = render(<Probe />);

  return {
    host,
    send: (payload) => act(() => send(encode(payload))),
    rendered: () => container.querySelector("svg[data-state]")?.getAttribute("data-state") ?? null,
    get state() {
      return latest;
    },
  };
};

describe("the reduction reaches the screen", () => {
  it("shows a session that started with nothing supplying it", () => {
    // The requirement's own scenario: a session becomes active and no session is
    // blocked, so the mascot is on the window rather than the reduction being
    // reported as text. That is the persistent branch, reached by handing the
    // runtime the other answer.
    const shell = mount({ persistent: true });

    shell.send(payloads.started);

    expect(shell.state.state).toBe(selectState(folded([payloads.started])));
    expect(shell.rendered()).toBe("idle");
    expect(shell.host.calls.visible).toEqual([true]);
  });

  it("shows the idle mascot before any session has started at all", () => {
    // Zero sessions reduces to `idle`, and on a platform that can hold a surface
    // that is what the window carries: a companion that has nothing to say yet,
    // sitting there. The point of the persistent branch is that this is not an
    // empty window waiting for permission to exist.
    const shell = mount({ persistent: true });

    expect(shell.rendered()).toBe("idle");
    expect(shell.state.escalating).toBe(false);
    expect(shell.host.calls.visible).toEqual([true]);
  });

  it("folds what arrives even where the mascot is not shown", () => {
    // The other branch. The state is folded either way — what differs is whether
    // there is a window to draw it on, and that difference is the platform's, not
    // the reduction's.
    const shell = mount();
    shell.send(payloads.started);

    expect(shell.state.state).toBe("idle");
    expect(shell.rendered()).toBeNull();
    expect(shell.host.calls.visible).not.toContain(true);
  });

  it("renders the reduction's answer on every path", () => {
    const paths: readonly (readonly object[])[] = [
      [payloads.started],
      [payloads.started, payloads.prompted],
      [payloads.started, payloads.blocked],
      [payloads.started, payloads.blocked, payloads.resumed],
      [payloads.started, payloads.question],
    ];

    for (const sequence of paths) {
      const shell = mount({ persistent: true });
      for (const payload of sequence) shell.send(payload);

      const expected = selectState(folded(sequence));
      const name = sequence
        .map((payload) => (payload as { hook_event_name: string }).hook_event_name)
        .join(",");

      expect(shell.state.state, name).toBe(expected);
      expect(shell.rendered(), name).toBe(expected);
    }
  });

  it("ignores a payload it cannot read rather than acting on part of it", () => {
    const shell = mount();
    shell.send(payloads.started);

    act(() => shell.state.receive(new TextEncoder().encode("{not json")));
    expect(shell.state.state).toBe("idle");

    act(() => shell.state.receive(new TextEncoder().encode("[1,2,3]")));
    expect(shell.state.state).toBe("idle");

    // And an event the adapter does not model: the host firing a hook this project
    // has no vocabulary for must not move the mascot.
    act(() => shell.state.receive(encode({ hook_event_name: "PreCompact", session_id: "harness" })));
    expect(shell.state.state).toBe("idle");
  });
});

describe("the window is shown and hidden by the rule, not by the shell", () => {
  it("appears when a block arrives on a platform that cannot float", () => {
    const shell = mount();
    shell.send(payloads.started);

    expect(shell.state.surfaceVisible).toBe(false);
    expect(shell.host.calls.visible).not.toContain(true);

    shell.send(payloads.blocked);

    expect(shell.state.escalating).toBe(true);
    expect(shell.state.surfaceVisible).toBe(true);
    expect(shell.host.calls.visible.at(-1)).toBe(true);
  });

  it("goes back to absent when the block resolves", () => {
    const shell = mount();
    shell.send(payloads.blocked);
    expect(shell.state.surfaceVisible).toBe(true);

    shell.send(payloads.resumed);

    expect(shell.state.escalating).toBe(false);
    expect(shell.state.surfaceVisible).toBe(false);
    expect(shell.host.calls.visible.at(-1)).toBe(false);
  });

  it("stays on screen and ambient where the platform can hold a surface", () => {
    const shell = mount({ persistent: true });

    expect(shell.state.surfaceVisible).toBe(true);
    expect(shell.state.escalating).toBe(false);
    expect(shell.rendered()).toBe("idle");
  });

  it("does not escalate a block it cannot help the user resolve", () => {
    // An elicitation dialog is a block with no answer the companion can give. The
    // window must not open for it, because a surface with nothing on it to do
    // teaches the user that answering is sometimes pointless.
    const shell = mount();
    shell.send(payloads.question);

    expect(shell.state.escalating).toBe(false);
    expect(shell.state.surfaceVisible).toBe(false);
    expect(shell.host.calls.visible).not.toContain(true);
  });

  it("tells the window once per change, not once per render", () => {
    const shell = mount();
    shell.send(payloads.blocked);
    shell.send(payloads.blocked);
    shell.send(payloads.blocked);

    // The runtime re-renders on every payload, and a document that asked the
    // window the same thing three times would be indistinguishable, from the
    // window's side, from one that changed its mind twice.
    expect(shell.host.calls.visible).toEqual([true]);
  });

  it("only interrupts where the surface cannot float", () => {
    // `surfaceVisibility` says an interruption is only warranted where appearing
    // *is* the escalation. The shell's job is to carry that answer over; asking
    // for the keyboard on the other branch would be a second opinion.
    const escalateOnly = mount();
    escalateOnly.send(payloads.blocked);
    expect(escalateOnly.host.calls.focused).toBe(1);

    const floating = mount({ persistent: true });
    floating.send(payloads.blocked);

    expect(floating.state.escalating).toBe(true);
    expect(floating.host.calls.focused).toBe(0);
    expect(floating.host.calls.visible).toEqual([true]);
  });

  it("never asks for the keyboard while ambient", () => {
    for (const persistent of [true, false]) {
      const shell = mount({ persistent });
      shell.send(payloads.started);
      expect(shell.host.calls.focused, String(persistent)).toBe(0);
    }
  });
});

describe("the window is placed, and the placement is checked", () => {
  it("asks where to go, and reports a window that would not say", async () => {
    const shell = mount();
    await act(async () => {});

    expect(shell.host.calls.workArea).toBe(1);
    expect(shell.host.calls.placed).toHaveLength(1);
    expect(shell.state.placedAt).toBeNull();
    expect(shell.state.placementFailed).not.toBeNull();
    expect(shell.state.placementFailed).toMatch(/could not be placed/);
  });

  it("says nothing about a placement that worked", async () => {
    const host = absentHost({ workArea: WORK_AREA, placedAt: { x: 24, y: 876 } });
    const shell = mount({ host });
    await act(async () => {});

    expect(shell.state.placedAt).toEqual({ x: 24, y: 876 });
    expect(shell.state.placementFailed).toBeNull();
  });

  it("reports a window that moved somewhere else rather than claiming it did not", async () => {
    // The measured failure, exactly as recorded: `set_position` returned `Ok` and
    // the window stayed where it was. Believing the call is how a mascot ends up in
    // a corner with a log line saying otherwise.
    const host = absentHost({ workArea: WORK_AREA, placedAt: { x: 0, y: 0 } });
    const shell = mount({ host });
    await act(async () => {});

    expect(shell.state.placementFailed).toMatch(/asked for 24,876 and it is at 0,0/);
  });

  it("falls back to the documented corner rather than refusing to start", async () => {
    const host = absentHost({ workArea: null });
    const shell = mount({ host });
    await act(async () => {});

    expect(host.calls.placed).toEqual([{ x: 24, y: 24 }]);
    expect(shell.state.state).toBe("idle");
  });

  it("places once, however many payloads arrive afterwards", async () => {
    const shell = mount();
    shell.send(payloads.blocked);
    await act(async () => {});

    expect(shell.host.calls.placed).toHaveLength(1);
  });
});

describe("the published report decides what the companion does", () => {
  // These are the end-to-end claims, and they are separate from the visibility
  // rules above on purpose. Everything above passes `persistent` explicitly, so
  // it is all a claim about escalation. This is the claim about *how the
  // platform's answer gets here* — through the report the host publishes, not
  // through a flag anybody set.

  it("is persistent when the report says the platform held the surface", () => {
    // One build, two platforms, two behaviours — which is the whole point of
    // detecting this at runtime rather than switching a feature off per OS.
    for (const placement of NAMED_PLACEMENTS) {
      const shell = mount({ scope: publishedReport(placement, true) });

      expect(shell.state.surfaceVisible, placement).toBe(true);
      expect(shell.host.calls.visible, placement).toEqual([true]);
      expect(shell.rendered(), placement).toBe("idle");
    }
  });

  it("is escalate-only when the report says the platform did not", () => {
    for (const placement of NAMED_PLACEMENTS) {
      const shell = mount({ scope: publishedReport(placement, false) });

      expect(shell.state.surfaceVisible, placement).toBe(false);
      expect(shell.host.calls.visible, placement).toEqual([]);
      expect(shell.rendered(), placement).toBeNull();
    }
  });

  it("is escalate-only when no platform could be asked, whatever it claims to hold", () => {
    // The browser case and the no-window case, and they have to land in the
    // behaviour that works everywhere rather than in a throw.
    const shell = mount({ scope: publishedReport("unknown", false) });

    expect(shell.state.surfaceVisible).toBe(false);
    expect(shell.host.calls.visible).toEqual([]);
  });

  it("still escalates on the persistent branch, because a block is a block", () => {
    // The capability decides the *idle* behaviour and nothing else. A platform
    // that can float does not stop surfacing blocks; it stops needing to
    // interrupt to do it.
    const shell = mount({ scope: publishedReport("windows-topmost", true) });
    shell.send(payloads.blocked);

    expect(shell.rendered()).toBe("needsYou");
    expect(shell.host.calls.focused).toBe(0);
    expect(shell.host.calls.visible).toEqual([true]);
  });

  it("still escalates on the escalate-only branch, and does interrupt", () => {
    const shell = mount({ scope: publishedReport("wayland-layer", false) });
    shell.send(payloads.blocked);

    expect(shell.rendered()).toBe("needsYou");
    expect(shell.host.calls.focused).toBe(1);
    expect(shell.host.calls.visible).toEqual([true]);
  });

  it("is escalate-only where the host published nothing at all", () => {
    // A document with no host behind it — a browser tab — has no surface of its
    // own, and that is a real answer rather than a failure. Both are the same
    // branch here and neither is an error.
    const shell = mount();

    expect(shell.state.surfaceVisible).toBe(false);
    expect(shell.rendered()).toBeNull();
  });

  it("does not read the report as a platform name, so one report cannot span platforms", () => {
    // The mechanism and the answer are separate fields precisely so a report
    // cannot be half-right. `held: true` beside `placement: "unknown"` is a host
    // that could not ask claiming an answer, and it escalates — asserted here
    // through the template rather than through a literal, because that is the
    // shape a host would actually publish.
    const shell = mount({ scope: publishedReport("unknown", true) });

    expect(shell.state.surfaceVisible).toBe(false);
    expect(shell.host.calls.visible).toEqual([]);
  });
});

describe("what consumed the capability is unchanged by its shape", () => {
  // Task 4.3 in test form. The visibility rule, the focus rule and the sizing
  // rule consume a boolean and must not have learned anything about mechanisms.
  // This is asserted by checking they still behave identically when the report
  // gains a field it does not read — the most likely way a rule could start
  // depending on the report's shape without any of its own tests noticing.

  it("renders identically whether the report names a mechanism or not", () => {
    const withMechanism = mount({ scope: publishedReport("macos-level", false) });
    const withoutMechanism = mount({ persistent: false });

    withMechanism.send(payloads.blocked);
    withoutMechanism.send(payloads.blocked);

    expect(withMechanism.rendered()).toBe(withoutMechanism.rendered());
    expect(withMechanism.state.state).toBe(withoutMechanism.state.state);
    expect(withMechanism.state.escalating).toBe(withoutMechanism.state.escalating);
    expect(withMechanism.host.calls).toEqual(withoutMechanism.host.calls);
  });

  it("sizes from its content, with no window size asked for", () => {
    // The sizing rule predates the report and must not have started consulting
    // it: whatever the platform said, the surface is sized by what it contains.
    //
    // Read after the block, so the stage exists — on the escalate-only branch it
    // is not in the document at all while idle, and reading it before would be
    // asserting about `null`.
    for (const placement of SURFACE_PLACEMENTS) {
      const shell = mount({ scope: publishedReport(placement, false) });

      shell.send(payloads.blocked);

      const stage = document.querySelector('[data-testid="escalation-stage"]');
      expect(stage?.getAttribute("style") ?? "", placement).not.toMatch(/width|height/);
    }
  });
});
