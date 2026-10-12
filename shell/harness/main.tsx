/**
 * The shell harness: the shell's runtime, driven by controls instead of a channel.
 *
 * ## What this page is and is not
 *
 * It mounts `useCompanionShell` — the same hook `shell/src/main.tsx` mounts —
 * and supplies two things the real window would: a host that records what it was
 * asked, and a capability report. The report can be forced with `?report=`,
 * which is how a run reaches the branch this machine's own window would not
 * produce.
 *
 * It is not a second implementation of anything. The sessions come from the same
 * adapter and the same fold the relay feeds, the visibility comes from the same
 * `surfaceVisibility`, and the surface is the same component. The only things
 * this page contributes are the controls and a readout, which is the same
 * bargain `src/dev/SurfaceHarness.tsx` strikes.
 *
 * ## Why payloads are real
 *
 * The buttons send the host agent's own hook payloads — `SessionStart`,
 * `UserPromptSubmit`, a `Notification` carrying a permission prompt — as JSON
 * text, which then goes through the adapter exactly as the relay's bytes do. A
 * harness that handed the runtime a canonical event instead would be testing the
 * wire between the fold and the surface, which already has tests, and skipping
 * the half where a payload is translated. That half is the one a real hook goes
 * through.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useCompanionShell } from "../src/companion";
import { absentHost, type HostCalls } from "../src/host";
import {
  HOST_WINDOW_KEY,
  readHostWindow,
  type SurfacePlacement,
} from "../../src/escalation/capability";
import "./harness.css";

/** The hook payloads the relay would carry, as the host agent writes them. */
const PAYLOADS = {
  /** The session begins. Nothing is blocked; on a platform that cannot float, nothing is on screen. */
  started: {
    hook_event_name: "SessionStart",
    session_id: "harness",
    timestamp: 1_000,
  },
  /** The user asks for something, so the mascot is thinking. */
  prompt: {
    hook_event_name: "UserPromptSubmit",
    session_id: "harness",
    timestamp: 1_100,
  },
  /** The agent wants permission to run something. Blocked, and resolvable, so this escalates. */
  blocked: {
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
    session_id: "harness",
    timestamp: 1_200,
  },
  /**
   * The agent is asking the user something. Blocked, and with no answer this
   * companion can give — so it must not escalate, which is the requirement the
   * page exists partly to show.
   */
  question: {
    hook_event_name: "Notification",
    notification_type: "elicitation_dialog",
    session_id: "harness",
    timestamp: 1_200,
  },
  /** The agent got on with it, which is what a block clearing looks like from outside. */
  resumed: {
    hook_event_name: "PreToolUse",
    tool_use_id: "t1",
    session_id: "harness",
    timestamp: 1_300,
  },
} as const;

const encode = (payload: object): Uint8Array => new TextEncoder().encode(JSON.stringify(payload));

/**
 * The window this page has instead of a real one.
 *
 * Built once, at module scope, and deliberately not inside the component: an
 * absent host records what it was asked, so a host built per render would be a
 * record of the last render alone. The runtime re-renders on every payload and
 * every visibility change, and a fresh host each time would leave the readout
 * showing nothing the shell had ever asked.
 */
const host = absentHost();

const mount = document.getElementById("root");
if (!mount) throw new Error("the shell harness is missing its #root mount point");

/**
 * A capability report, published where the native host publishes one.
 *
 * ## Why the harness can say it
 *
 * A machine can demonstrate only one branch of a two-branch rule at a time, so
 * the other has to be reachable or it is never looked at. That was already true
 * for `src/dev`'s surface harness and it is now equally true here.
 *
 * `?report=windows-topmost:true` writes the *same shape the native host
 * publishes* into the *same global the surface reads*, before React mounts. So
 * the end-to-end run below drives the real publish → read → decide path in a
 * real browser, and the only thing it does not drive is the measurement — which
 * needs a real window, and is recorded per machine in `shell/README.md`.
 *
 * The mechanism names are the product's vocabulary rather than literals: a report
 * naming something this build has never heard of is refused by `readHostWindow`,
 * which is a property worth being able to show rather than assume.
 */
function publishForcedReport(): void {
  const forced = new URLSearchParams(window.location.search).get("report");
  if (!forced) return;

  const [placement, held] = forced.split(":") as [SurfacePlacement, string];

  (globalThis as Record<string, unknown>)[HOST_WINDOW_KEY] = {
    placement,
    held: held === "true",
  };
}

publishForcedReport();

export function ShellHarness() {
  const shell = useCompanionShell({ host });

  const send = (payload: object) => shell.receive(encode(payload));

  const windowState: HostCalls = host.calls;
  const reported = readHostWindow();

  return (
    <main>
      <h1>Spark shell</h1>

      <div className="controls">
        <button type="button" data-testid="start" onClick={() => send(PAYLOADS.started)}>
          Start a session
        </button>
        <button type="button" data-testid="prompt" onClick={() => send(PAYLOADS.prompt)}>
          Ask for something
        </button>
        <button type="button" data-testid="block" onClick={() => send(PAYLOADS.blocked)}>
          Block on a permission
        </button>
        <button type="button" data-testid="question" onClick={() => send(PAYLOADS.question)}>
          Block on a question
        </button>
        <button type="button" data-testid="answer" onClick={() => send(PAYLOADS.resumed)}>
          Answer and continue
        </button>
      </div>

      {/*
        The window's state, as the shell asked for it rather than as the platform
        answered. On a machine with a window this is what the window was told to
        do; on this page it is the record of the calls themselves, which is the
        half a browser engine can reach.
      */}
      <p className="readout">
        state: <output data-testid="state">{shell.state}</output> · escalating:{" "}
        <output data-testid="escalating">{String(shell.escalating)}</output> · surface:{" "}
        <output data-testid="surface-visible">{String(shell.surfaceVisible)}</output> · window:{" "}
        <output data-testid="window-visible">{String(windowState.visible.at(-1) ?? false)}</output> ·
        focused: <output data-testid="window-focus-count">{windowState.focused}</output> · placed at:{" "}
        <output data-testid="placed-at">
          {shell.placedAt ? `${shell.placedAt.x},${shell.placedAt.y}` : "unknown"}
        </output>{" "}
        {/* The report, as the surface read it. On this page there is no window,
            so the answer comes from `?report=` — published into the same global
            the native host writes, so a run exercises the real read path rather
            than a harness-only branch of it. */}
        · report:{" "}
        <output data-testid="report">
          {reported ? `${reported.placement} / ${reported.held}` : "none"}
        </output>
      </p>

      {/*
        The mascot, and the decision card when there is something to decide. The
        same tree the window mounts, in the same order, so what a run sees here
        is what the window draws — minus the window.
      */}
      {shell.surface}
    </main>
  );
}

createRoot(mount).render(
  <StrictMode>
    <ShellHarness />
  </StrictMode>
);
