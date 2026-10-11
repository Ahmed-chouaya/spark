/**
 * Where a payload from the relay becomes a session.
 *
 * ## The whole of this module
 *
 * ```
 *   bytes off the channel -> JSON -> the host's adapter -> canonical event
 *                                                        -> fold -> sessions
 * ```
 *
 * One step of that belongs here and it is the smallest one: deciding whether
 * the bytes are a JSON object at all. Everything after it is the existing
 * pipeline, unchanged — `applyPayload` from `../state-selection/track`, which
 * calls the adapter and folds the result into the session set. Nothing in this
 * file decides a state, ranks a session, or knows what a hook event is.
 *
 * ## Why nothing else was added
 *
 * It is tempting for this to be where the host's event names get mapped, since
 * this is the code that first sees a payload. It is not, and the reason is the
 * one the whole design turns on: the vocabulary of a host agent lives in that
 * agent's adapter, which is already written and already tested. If it also
 * lived here, there would be two implementations and only one of them under
 * test — and the untested one is the one the host agent actually depends on.
 *
 * So the adapter is passed in rather than constructed, and a second host agent
 * is a second adapter handed to this same source. The relay does not change,
 * this file does not change, and the reduction does not change.
 *
 * ## What an unusable payload is
 *
 * Something the companion cannot read: bytes that are not JSON, or JSON that
 * is not an object. That is a decision about the *envelope*, not about the
 * host's events, which is why it lives here rather than in the adapter — and it
 * is the only thing that can fail here, because the fold itself is total.
 *
 * An unusable payload changes nothing and is not reported. The host agent was
 * never told, by design, and the companion is not the place to start.
 */

import { createClaudeCodeAdapter } from "../state-selection/adapters/claude-code";
import type { ClaudeCodePayload } from "../state-selection/adapters/claude-code";
import type { AgentAdapter } from "../state-selection/adapters/types";
import type { AgentSession } from "../state-selection/session";
import { applyPayload } from "../state-selection/track";

export interface SessionSourceOptions {
  /**
   * The host agent's adapter.
   *
   * Required rather than defaulted, because a source that quietly built the
   * Claude Code adapter for you is a source that has already decided which host
   * it is for — and that decision is what the adapter boundary exists to leave
   * open. `createClaudeCodeSource` is the shorthand for the one host v0.1 has.
   */
  readonly adapter: AgentAdapter<ClaudeCodePayload>;
  /** Sessions the caller already had, before any payload arrived. */
  readonly initial?: readonly AgentSession[];
}

/**
 * The live sessions, and the one way a new one arrives.
 *
 * Deliberately not a hook and not a component: this is a fold, and the surface
 * consumes it the same way it consumes a caller-supplied list. What changed in
 * this change is where the sessions come from, not how they are decided.
 */
export interface SessionSource {
  /** The sessions as they stand. What the reduction is given. */
  readonly sessions: readonly AgentSession[];
  /**
   * Fold in one payload received from the relay.
   *
   * Returns the sessions afterwards. Nothing is thrown and nothing is logged:
   * an unusable payload is silence, which is the same answer the adapter gives
   * to an event it does not model.
   */
  receive(payload: Buffer | string): readonly AgentSession[];
  /** Forget everything, including sessions a caller supplied. */
  reset(): readonly AgentSession[];
}

/** A source fed by one host agent's payloads. */
export function createSessionSource({
  adapter,
  initial = [],
}: SessionSourceOptions): SessionSource {
  let sessions: readonly AgentSession[] = initial;

  return {
    get sessions() {
      return sessions;
    },
    receive(payload) {
      sessions = applyReceivedPayload(sessions, adapter, payload);
      return sessions;
    },
    reset() {
      sessions = [];
      return sessions;
    },
  };
}

/** The one host agent v0.1 supports, wired to a source. */
export function createClaudeCodeSource(
  initial: readonly AgentSession[] = [],
  now?: () => number
): SessionSource {
  return createSessionSource({ adapter: createClaudeCodeAdapter(now), initial });
}

/**
 * One payload, folded into a set of sessions.
 *
 * The payload arrives as the host wrote it and is checked only for being a JSON
 * object. From there it is the host adapter's, and the adapter is the only code
 * that knows what the fields mean.
 */
export function applyReceivedPayload(
  sessions: readonly AgentSession[],
  adapter: AgentAdapter<ClaudeCodePayload>,
  payload: Buffer | string
): readonly AgentSession[] {
  const parsed = asObject(payload);
  // Not something to hand on. Whatever it was, it never reaches the adapter,
  // which is what "nothing unusable reaches state selection" means here.
  if (!parsed) return sessions;

  return applyPayload(sessions, adapter, parsed);
}

/**
 * The payload, if it is a JSON object, and `null` otherwise.
 *
 * The envelope and nothing more. There is no field check, no required key, and
 * no version: anything more would be a second opinion about what a host's
 * payload looks like, and the adapter already has one.
 */
function asObject(payload: Buffer | string): ClaudeCodePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"));
  } catch {
    // Not JSON at all. Bytes, a truncated object, a host's plain-text failure
    // notice — all of them silence.
    return null;
  }

  // A JSON array, a number, a string, or `null` is valid JSON and not a
  // payload. Handing those to an adapter that reads properties off them would
  // be asking the adapter to defend against a shape its contract never had.
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as ClaudeCodePayload)
    : null;
}