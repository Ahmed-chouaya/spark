import type { AgentAdapter, CanonicalUpdate } from "./types";
import type { SessionEvent } from "../events";
import type { EffortSignals } from "../tool-effort";

/**
 * The Claude Code hook fields this adapter reads.
 *
 * `tool_name` is deliberately absent. It is the field a per-tool mapping would
 * key off, and an adapter that reads it is one refactor away from being one.
 * What it reads instead is what the work *cost*: how long it ran and how much it
 * moved. See ./tool-effort for why that is enough.
 */
export interface ClaudeCodePayload {
  readonly hook_event_name: string;
  readonly session_id: string;
  readonly timestamp?: number;
  readonly tool_use_id?: string;
  readonly tool_input?: unknown;
  readonly tool_response?: unknown;
  readonly notification_type?: string;
  readonly error?: unknown;
}

export interface ClaudeCodeAdapter extends AgentAdapter<ClaudeCodePayload> {
  readonly agent: "claude-code";
}

/** Best-effort size of a payload field; unknown stays unknown. */
const sizeOf = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  return JSON.stringify(value)?.length ?? 0;
};

const failed = (payload: ClaudeCodePayload): boolean =>
  payload.error !== undefined && payload.error !== null;

/**
 * The Claude Code adapter.
 *
 * It is the only file in this module that knows what a Claude Code hook is. It
 * measures and translates; it never decides, and it never names a tool.
 *
 * Two of the nine states need nothing from the operating system to reach:
 * `tired` comes from the host telling us the session has gone quiet, and every
 * other state comes from a lifecycle hook. Nothing here inspects a window, asks
 * the OS which terminal has focus, or reaches outside the payload it was given.
 *
 * `now` is injected rather than read from the clock so the adapter stays a pure
 * function of its inputs, plus the one piece of state it genuinely has to keep:
 * when each in-flight tool started.
 */
export function createClaudeCodeAdapter(
  now: () => number = () => Date.now()
): ClaudeCodeAdapter {
  const startedAt = new Map<string, number>();

  const translate = (payload: ClaudeCodePayload): CanonicalUpdate | null => {
    const at = payload.timestamp ?? now();

    const update = (event: SessionEvent): CanonicalUpdate => ({
      sessionId: payload.session_id,
      event,
    });

    const toolId = payload.tool_use_id;

    switch (payload.hook_event_name) {
      case "SessionStart":
        return update({ type: "session-started", at });

      case "UserPromptSubmit":
        return update({ type: "prompt-submitted", at });

      case "PreToolUse": {
        if (toolId) startedAt.set(toolId, at);
        // Work has started and we know nothing about how heavy it is yet, so
        // this lands on the default bucket: ordinary effort.
        const signals: EffortSignals = { payloadBytes: sizeOf(payload.tool_input) };
        return update({ type: "tool-activity", at, signals });
      }

      case "PostToolUse": {
        const started = toolId ? startedAt.get(toolId) : undefined;
        if (toolId) startedAt.delete(toolId);
        const signals: EffortSignals = {
          // Unknown without a matching start, and unknown must not read as
          // "quick": the default bucket is the honest answer.
          elapsedMs: started === undefined ? undefined : at - started,
          payloadBytes:
            (sizeOf(payload.tool_input) ?? 0) + (sizeOf(payload.tool_response) ?? 0),
        };
        return update({ type: "tool-activity", at, signals });
      }

      case "Stop":
        return update({ type: failed(payload) ? "failed" : "completed", at });

      case "PostToolUseFailure":
        return update({ type: "failed", at });

      case "Notification":
        switch (payload.notification_type) {
          case "permission_prompt":
            return update({ type: "authorization-requested", at });
          case "elicitation_dialog":
            // The agent is asking the user something. Blocked, yes — but the
            // companion has no way to answer it, so it must not escalate.
            return update({ type: "agent-question", at });
          case "idle_prompt":
            return update({ type: "time-passed", at });
          default:
            return null;
        }

      default:
        return null;
    }
  };

  return { agent: "claude-code", translate };
}