import { applyPayload } from "../../src/state-selection/track";
import type { AgentSession } from "../../src/state-selection/session";
import type { AgentAdapter } from "../../src/state-selection/adapters/types";
import { createClaudeCodeAdapter } from "../../src/state-selection/adapters/claude-code";
import { createOpenCodeAdapter } from "../../src/state-selection/adapters/opencode";

/**
 * The adapters this companion can read, and what it says about what it holds.
 *
 * ## One registry, so a second host costs one line
 *
 * The reduction has never heard of any host, and the claim that adding one is a
 * single file is only true if the wiring has exactly one place a host can appear.
 * That place is this object.
 *
 * Built per shell rather than shared as a module constant, because each adapter
 * holds the start times of the tool calls it has seen — state that must not be
 * shared between two windows on the same page, or one window's events would be
 * paired with the other's timings.
 */

/**
 * Every adapter this companion knows, keyed by the agent it serves.
 *
 * A record rather than a list because the lookup is by name: a list would invite
 * picking the first adapter that accepts a payload, and that is the guess the
 * `{ agent, event }` envelope exists to avoid.
 */
export type AdapterRegistry = Readonly<Record<string, AgentAdapter<never>>>;

/**
 * The agent this build was written for, used when a payload names none.
 *
 * A payload with no envelope is this agent's, because that is what the relay
 * delivers today and it delivers it unaltered. Adding the envelope at the relay
 * would put a host's idea of which host it is into a program whose whole property
 * is that it has no vocabulary at all.
 */
export const DEFAULT_AGENT = "claude-code";

/** One registry per shell, built on first render. */
export function buildAdapterRegistry(): AdapterRegistry {
  return {
    "claude-code": createClaudeCodeAdapter() as unknown as AgentAdapter<never>,
    opencode: createOpenCodeAdapter() as unknown as AgentAdapter<never>,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Which agent a payload belongs to, and the payload itself.
 *
 * A payload naming no agent is the one this build was written for, because that
 * is what the relay delivers today and it delivers it unaltered — putting the
 * routing in the relay would give a program whose whole property is that it has
 * no vocabulary a host's idea of which host it is.
 *
 * A payload naming an agent this companion has no adapter for is dropped rather
 * than guessed at: feeding it an adapter that does not understand it produces
 * "not an event this adapter models" for everything, which is always correct and
 * therefore never wrong enough to notice.
 */
export function resolveAgent<P>(
  payload: unknown,
  adapters: AdapterRegistry
): { readonly agent: string; readonly event: P } | null {
  if (!isRecord(payload)) return null;

  const agent =
    typeof payload.agent === "string" && payload.agent.length > 0 ? payload.agent : null;

  if (agent === null) {
    return adapters[DEFAULT_AGENT] ? { agent: DEFAULT_AGENT, event: payload as P } : null;
  }
  if (!adapters[agent]) return null;

  return { agent, event: (payload as { event: P }).event };
}

/** The payload, if it is a JSON object, and `null` otherwise. */
export function parse(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fold one received payload into a session set, through whichever adapter owns it.
 *
 * The fold is `applyPayload` — the one that already existed, for one agent — so
 * the reduction's rules cannot differ by which agent a session came from. They
 * are not consulted differently here; they are the same function.
 */
export function foldAgentPayload(
  sessions: readonly AgentSession[],
  adapters: AdapterRegistry,
  payload: unknown
): { readonly sessions: readonly AgentSession[]; readonly agent: string | null } {
  const resolved = resolveAgent<unknown>(payload, adapters);
  if (!resolved) return { sessions, agent: null };

  const adapter = adapters[resolved.agent] as unknown as AgentAdapter<unknown>;

  return {
    sessions: applyPayload(sessions, adapter, resolved.event),
    agent: resolved.agent,
  };
}

/**
 * A line a person can read, per session, saying who it belongs to and what it is
 * doing.
 *
 * ## Why this exists at all
 *
 * On a platform that cannot hold a surface above other windows — GNOME, which is
 * what this was built on — **correct behaviour is an empty desktop**. The window
 * is created hidden and shown only while something is blocked, so a working
 * companion and a broken one look identical to somebody sitting in front of the
 * screen. That is not a defect in the visibility rule; it is the rule.
 *
 * So the companion says what it holds. This is the only way to answer "is a
 * session open in OpenCode, and what is it doing", on the machine where the
 * mascot is correctly invisible.
 *
 * Only the fields the session actually carries. There is no tool name on
 * `AgentSession` — the reduction deliberately does not keep one, because a
 * session that remembered which tool it was running would be a second place that
 * knows about tools, and the state is what matters.
 */
export function describeSessions(sessions: readonly AgentSession[]): string {
  if (sessions.length === 0) return "no sessions yet";

  return sessions
    .map((session) => {
      const waiting = session.block ? `  waiting on: ${session.block}` : "";
      const quiet = idleFor(session.lastEventAt);

      return `  ${session.agent}/${session.sessionId}  ${session.state}${waiting}${quiet}`;
    })
    .join("\n");
}

/** How long a session has been silent, which is what rests the mascot. */
const idleFor = (lastEventAt: number, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - lastEventAt) / 1000));
  return seconds > 2 ? `  quiet ${seconds}s` : "";
};

/**
 * What changed since the last time this was asked, or `null` if nothing did.
 *
 * Changed-state only, so the output is a thing to read rather than something to
 * scroll past: a companion receiving a tool's per-token events would otherwise
 * print a line for every one of them and the signal would be the noise.
 */
export function sessionChange(
  before: readonly AgentSession[],
  after: readonly AgentSession[]
): string | null {
  const keyOf = (session: AgentSession): string => `${session.agent}/${session.sessionId}`;
  const previous = new Map(before.map((session) => [keyOf(session), session]));
  const changed: string[] = [];

  for (const session of after) {
    const key = keyOf(session);
    const was = previous.get(key);

    if (!was) {
      changed.push(
        `+ ${key}  ${session.state}${session.block ? `  waiting on: ${session.block}` : ""}`
      );
      continue;
    }
    if (was.state !== session.state || was.block !== session.block) {
      const move =
        was.state === session.state
          ? `${was.block ?? "nothing"} -> ${session.block ?? "nothing"}`
          : `${was.state} -> ${session.state}`;
      changed.push(`~ ${key}  ${move}`);
    }
  }

  for (const [key, session] of previous) {
    if (!after.some((now) => keyOf(now) === key)) {
      changed.push(`- ${key}  ${session.state}  gone`);
    }
  }

  return changed.length > 0 ? changed.join("\n") : null;
}
