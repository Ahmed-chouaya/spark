/**
 * The shell's runtime: bytes in, a surface out, and one rule consulted on the way.
 *
 * ## The loop, and the fact that it is borrowed whole
 *
 * ```
 *   payload arrives
 *     -> applyReceivedPayload  (src/relay/session-source: the adapter, the fold)
 *       -> useCompanionSurface (src/escalation: selectState, escalates, surfaceVisibility)
 *         -> show() / hide()   (this file, and nothing else)
 * ```
 *
 * Nothing in this file re-derives a state, re-judges a block, or re-decides when
 * the window is visible. Every one of those has one answer in this codebase and
 * the answer is not re-computed here: a second copy of `surfaceVisibility` would
 * be a second opinion about the one rule that decides whether the user is
 * interrupted, and it would be the copy nothing runs.
 *
 * ## Where the window goes is decided here too
 *
 * Because the same argument applies to it. The native host can move a window and
 * can say where it ended up; it cannot decide where a window belongs. So the
 * arithmetic lives in `placement.ts`, next to the tests that can run it, and the
 * host is asked to carry out an answer rather than to produce one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { canHoldPersistentSurface, readHostWindow } from "../../src/escalation/capability";
import { useCompanionSurface, usePendingDecisions } from "../../src/escalation/useCompanionSurface";

import {
  buildAdapterRegistry,
  describeSessions,
  foldAgentPayload,
  parse,
  sessionChange,
} from "./adapters";
import type { AgentSession } from "../../src/state-selection/session";
import type { Position, ShellHost } from "./host";
import { placementFor, positionTookEffect } from "./placement";

/** How a payload's bytes are decoded before the adapter sees them. */
export type Decode = (payload: Uint8Array) => string;

export interface CompanionShellProps {
  /** The window this document is drawn on. */
  readonly host: ShellHost;
  /**
   * What the platform granted, when the host published it.
   *
   * Read from `globalThis` by default, because that is where the native host
   * writes it and reading it from anywhere else would be reading a copy. Passed
   * explicitly only where there is no host to read one — a document in a
   * browser, which cannot hold a surface either way.
   */
  readonly persistent?: boolean;
  readonly decode?: Decode;
}

/**
 * Everything the shell learned from its window, as one value.
 *
 * Derived rather than stored, so it cannot disagree with the render beside it:
 * `escalating` is what the surface is escalating on, and `windowVisible` is what
 * it was last asked to do. The second is the only half that is remembered, and it
 * is remembered only so the window is not told the same thing twice.
 */
export interface ShellState {
  /** What the reduction made of the payloads, as `selectState` produced it. */
  readonly state: ReturnType<typeof useCompanionSurface>["state"];
  /** Whether anything actionable is waiting on the user. */
  readonly escalating: boolean;
  /** Whether the surface is on screen, as `surfaceVisibility` decided. */
  readonly surfaceVisible: boolean;
  /** What the window was last asked to do. */
  readonly windowVisible: boolean;
  /** Where the window ended up, when it said. */
  readonly placedAt: Position | null;
  /** Why the window could not be placed, when it could not be. */
  readonly placementFailed: string | null;
}

export function useCompanionShell({
  host,
  persistent = canHoldPersistentSurface(readHostWindow()),
  decode = defaultDecode,
}: CompanionShellProps) {
  const [sessions, setSessions] = useState<readonly AgentSession[]>([]);
  const [windowVisible, setWindowVisible] = useState(false);
  const [placedAt, setPlacedAt] = useState<Position | null>(null);
  const [placementFailed, setPlacementFailed] = useState<string | null>(null);

  const decisions = usePendingDecisions();
  const surface = useCompanionSurface({
    sessions,
    pending: decisions.pending,
    persistent,
    onDecision: (_decision, resolved) => decisions.answer(_decision, resolved),
  });

  /**
   * One payload, folded in, through whichever adapter owns it.
   *
   * `foldAgentPayload` resolves the agent from the payload itself and hands the
   * event to that agent's adapter, then folds with `applyPayload` — the same
   * fold, the same `applyEvent`, the same reduction. A second host therefore
   * costs a registry entry and nothing else, which is the claim
   * `adapters/types.ts` had been making since the first adapter existed and this
   * is the first time anything has checked it.
   *
   * The registry is built once per shell rather than per payload so the in-flight
   * tool timings each adapter keeps survive from one event to the next — which is
   * the state that makes a tool's end mean "that tool took this long". The lazy
   * initialiser is what makes "once" true: `useRef(build())` would *evaluate* the
   * build on every render and throw all but the first away, and a plain module
   * constant would be shared by every shell on the page.
   */
  const [adapters] = useState(buildAdapterRegistry);
  const receive = useCallback(
    (payload: Uint8Array) => {
      setSessions((current) => {
        const folded = foldAgentPayload(current, adapters, parse(decode(payload)));
        return folded.sessions as readonly AgentSession[];
      });
    },
    [adapters, decode]
  );

  // What the companion is holding, said out loud.
  //
  // On a platform that cannot keep a surface on screen — GNOME, which is what
  // this was built on — correct behaviour is an empty desktop, and a working
  // companion is indistinguishable from a broken one by looking at the screen.
  // So this is how you tell. It writes nothing and decides nothing; it reports
  // what the reduction already made of the payloads.
  //
  // Changed-state only. A companion receiving a tool's per-token events would
  // otherwise print a line for each one, and the signal would be the noise.
  const reportedRef = useRef<readonly AgentSession[]>([]);
  useEffect(() => {
    const change = sessionChange(reportedRef.current, sessions);
    reportedRef.current = sessions;

    if (change === null) return;
    void host.report(change);
  }, [host, sessions]);

  // The full set, once there is something to show. A session that arrives and
  // never changes again would otherwise report once and then look like a
  // companion that had lost it.
  useEffect(() => {
    if (sessions.length === 0) return;
    void host.report(`sessions:\n${describeSessions(sessions)}`);
  }, [host, sessions.length]);

  // The window's visibility is the surface's visibility, asked rather than
  // re-decided. `visibility` comes from `surfaceVisibility` inside
  // `useCompanionSurface`, so this is a mapping and not a rule.
  useEffect(() => {
    const visible = surface.visibility.visible;
    if (visible === windowVisible) return;

    setWindowVisible(visible);
    void host.setVisible(visible);
  }, [host, surface.visibility.visible, windowVisible]);

  // Focus is asked for on the same rule's own answer, and only when it is true.
  // An ambient surface has no path to `focus()` at all, which is a stronger
  // statement than "it usually does not" and is the one the requirement means.
  useEffect(() => {
    if (surface.visibility.takesFocus) void host.focus();
  }, [host, surface.visibility.takesFocus]);

  // Place the window once. Asked, then read back, and a mismatch is reported
  // rather than retried: a platform where the call is a no-op would otherwise be
  // retried forever, and a mascot in a corner with the log claiming otherwise is
  // the failure this exists to prevent.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const requested = placementFor(await host.workArea());

      const actual = await host.place(requested.x, requested.y);
      if (cancelled) return;

      setPlacedAt(actual);
      setPlacementFailed(
        positionTookEffect(requested, actual)
          ? null
          : `the surface could not be placed: asked for ${requested.x},${requested.y}` +
            (actual ? ` and it is at ${actual.x},${actual.y}` : " and the window would not say")
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [host]);

  const state: ShellState = {
    state: surface.state,
    escalating: surface.escalating,
    surfaceVisible: surface.visibility.visible,
    windowVisible,
    placedAt,
    placementFailed,
  };

  const element: ReactElement = <>{surface.surface}</>;

  return { ...state, surface: element, receive, decisions };
}

/**
 * Bytes to the text the adapter parses.
 *
 * UTF-8, because that is what the relay delivers: it writes the host agent's
 * hook payload unchanged and exits, and a hook payload is JSON. An invalid
 * sequence becomes U+FFFD rather than throwing, which is the same silence
 * `applyReceivedPayload` gives a payload that is not an object — the envelope
 * check downstream is the place that decides whether these bytes are usable.
 */
export const defaultDecode: Decode = (payload) => new TextDecoder().decode(payload);
