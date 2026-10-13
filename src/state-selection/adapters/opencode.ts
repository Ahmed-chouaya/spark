import type { AgentAdapter, CanonicalUpdate } from "./types";
import type { SessionEvent } from "../events";
import type { EffortSignals } from "../tool-effort";

/**
 * The OpenCode events this adapter reads.
 *
 * ## Measured, not documented
 *
 * Every field name and every event name below was taken from a running
 * `opencode v2.0.26` through a throwaway probe plugin, because the published
 * documentation for this version is wrong in every field that matters:
 *
 * | | documented | measured |
 * |---|---|---|
 * | payload | `event.properties` | **`event.data`** |
 * | turn | `session.idle`, `session.error` | `session.execution.started` / `.succeeded` |
 * | tool | `tool.execute.before` / `.after` | `session.tool.called` / `.success` |
 *
 * An adapter written from the documentation would load, register, and do
 * nothing — every payload comes back as "an event this adapter does not model",
 * which is the one answer that is always correct and therefore never wrong
 * enough to notice.
 *
 * It is declared rather than typed as `unknown` because `src/companion/
 * request.ts` needs to say what is being asked for on a card a person decides
 * on, exactly as it reads the Claude Code payload's own fields. That is a
 * different question asked by a different consumer, and keeping the shape here
 * is what stops that reader re-declaring it.
 */
export interface OpenCodeEvent {
  readonly type: string;
  readonly created?: number;
  readonly location?: { readonly directory?: string };
  /**
   * The event's body.
   *
   * The fields the adapter reads are named; everything else the host sends is
   * allowed through, because a measured payload carries a great deal this
   * adapter has no opinion about — `projectID`, `slug`, `rawFinish`, `executed`,
   * token counts — and typing them as unknown would make every fixture in the
   * tests a cast.
   *
   * Not typed as a closed record, and that is the point: a host that adds a field
   * must not be a type error here. An adapter that enumerated its host's payload
   * would go stale on every release, and would fail to compile rather than
   * quietly ignoring what it does not understand — which is the correct reading
   * of an event this adapter does not model.
   */
  readonly data?: OpenCodeEventData;
}

export interface OpenCodeEventData {
  readonly sessionID?: string;
  readonly id?: string;
  readonly assistantMessageID?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly text?: string;
  readonly finish?: string;
  readonly metadata?: { readonly status?: string; readonly exit?: number };
  readonly error?: unknown;
  /** Anything else the host sends. Never read, never rejected. */
  readonly [key: string]: unknown;
}

export interface OpenCodeAdapter extends AgentAdapter<OpenCodeEvent> {
  readonly agent: "opencode";
}

/**
 * The identifier this adapter publishes sessions under.
 *
 * One adapter is one agent, so the value is fixed rather than an option. A
 * caller that wants a second instance of the same agent gets a second session
 * namespace from the host, not from here — two adapters claiming the same name
 * would make "which agent is this session" a question with two right answers.
 */
const AGENT = "opencode" as const;

/** Best-effort size of a payload field; unknown stays unknown. */
const sizeOf = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  return JSON.stringify(value)?.length ?? 0;
};

/**
 * When the tool call each `finish` belongs to began.
 *
 * Joined by the host's own `callID`, which is the same pairing the Claude Code
 * adapter does with `tool_use_id`.
 *
 * Per adapter instance rather than per module, and the reason is the measured
 * fact that this machine loads two plugin instances: one global and one per
 * project. Module-level state would have every instance writing into the same
 * map, so a call seen by one would be paired with a completion seen by the other
 * and the elapsed time would belong to neither.
 */
const startedAtFor = (): Map<string, number> => new Map<string, number>();

/**
 * The `finish` values that mean the turn ended in trouble.
 *
 * Read from what the host reports rather than from a list of its states: a turn
 * that ran out of room, hit an error, or was stopped are all different strings
 * and all one thing to a person watching. Anything unrecognised is treated as
 * completion rather than failure, because inventing a failure from an unknown
 * string is how a mascot ends up alarmed at ordinary work.
 */
const FAILED_FINISHES = new Set(["error", "aborted", "cancelled", "canceled", "length"]);

const turnFailed = (finish: string | undefined, metadata: unknown): boolean => {
  if (metadata !== undefined && metadata !== null) return true;
  return finish !== undefined && FAILED_FINISHES.has(finish.toLowerCase());
};

/**
 * The OpenCode adapter.
 *
 * It measures and translates; it never decides, and it never names a tool. It
 * is one file, and the reduction, the mascot and the transport are unchanged —
 * which is the claim `src/state-selection/adapters/types.ts` has been making
 * since the first one existed, and this is the first time it has been tested.
 *
 * ## What is deliberately not mapped
 *
 * **`session.reasoning.*` and `session.text.delta`** are one event per token.
 * Redrawing a mascot several hundred times a minute is not a companion, and the
 * state they would carry is `thinking`, which `session.step.started` already
 * establishes.
 *
 * **`permission.asked` is not mapped, and that is the important one.** It looks
 * exactly like the event that should escalate the companion, and mapping it
 * would put the mascot in `needsYou` with no card on it — because there is no
 * measured way to answer it. A loud state with nothing to act on teaches the
 * user that being summoned is sometimes pointless, which is the same reason
 * `agent-question` does not escalate in `../escalation.ts`.
 *
 * The permission hook exists in the installed host (`ctx.permission.hook`,
 * answering `allow`/`deny`/`ask`) and was never observed firing. An unmeasured
 * decision path is the one thing here that could refuse a user's tool call
 * wrongly, and `ask/` prints nothing on every failure path precisely because a
 * wrong answer to a permission request is indistinguishable from a right one.
 * Wiring it needs a run in which it fires.
 */
export function createOpenCodeAdapter(now: () => number = Date.now): OpenCodeAdapter {
  const startedAt = startedAtFor();

  const translate = (event: OpenCodeEvent): CanonicalUpdate | null => {
    const data = event.data ?? {};
    const sessionId = data.sessionID;
    if (!sessionId) return null;

    const at = event.created ?? now();
    const update = (value: SessionEvent): CanonicalUpdate => ({ sessionId, event: value });

    switch (event.type) {
      case "session.created":
        return update({ type: "session-started", at });

      case "session.execution.started":
        // The user handed work over. Everything since then is work on that one
        // request, which is what `lastActiveAt` is for and why this is the only
        // event that moves it.
        return update({ type: "prompt-submitted", at });

      case "session.tool.called": {
        const callId = data.id;
        if (callId) startedAt.set(callId, at);
        // Work has started and nothing about its cost is known yet, so this
        // lands on the default bucket: ordinary effort. The same choice the
        // Claude Code adapter makes for `PreToolUse`, for the same reason.
        const signals: EffortSignals = { payloadBytes: sizeOf(data.input) };
        return update({ type: "tool-activity", at, signals });
      }

      case "session.tool.success": {
        const callId = data.id;
        const began = callId ? startedAt.get(callId) : undefined;
        if (callId) startedAt.delete(callId);

        // Unpaired is not zero. A start this adapter never saw leaves elapsed
        // unknown, and unknown must not read as "quick" — the default bucket is
        // the honest answer, and the same one the Claude Code adapter gives a
        // `PostToolUse` with no matching `PreToolUse`.
        const signals: EffortSignals = {
          elapsedMs: began === undefined ? undefined : at - began,
          payloadBytes: sizeOf(data.metadata) ?? 0,
        };
        return update({ type: "tool-activity", at, signals });
      }

      case "session.step.ended":
        return update(
          turnFailed(data.finish, data.metadata) ? { type: "failed", at } : { type: "completed", at }
        );

      case "session.execution.succeeded":
        return update({ type: "completed", at });

      default:
        // Everything else is an event this adapter does not model, and silence
        // is the correct reading of one. That includes `permission.asked`; see
        // the module note for why that is a decision rather than a gap.
        return null;
    }
  };

  return { agent: AGENT, translate };
}
