/**
 * What a payload is asking for, in the user's terms.
 *
 * ## The one question this answers
 *
 * A hook payload says a session is *about to do something*. It does not say
 * what, in any vocabulary a person would use: `{"hook_event_name":"PreToolUse",
 * "tool_name":"Bash","tool_input":{"command":"rm -rf build"}}` says the host is
 * running a shell command, and only the host's own documentation says the rest.
 *
 * `approval-roundtrip` requires that the user "can determine what would happen
 * if they agreed, without consulting another window". So the description is
 * built here, in the one file that is allowed to know what a Claude Code hook
 * payload's fields mean, and nowhere else.
 *
 * ## Why this reads `tool_name`, when the adapter does not
 *
 * `src/state-selection/adapters/claude-code.ts` deliberately does not read
 * `tool_name`, and `test/selection-source.test.ts` holds it to that. That is
 * right for it: the reduction decides which *state* a session is in from what a
 * tool call **cost**, and a per-tool table there would be a step from "the
 * mascot knows which tools exist" to "the mascot behaves differently on
 * `Bash`".
 *
 * This is a different question asked by a different consumer. Nothing here
 * decides a state, escalates anything, or branches on a tool's identity for any
 * purpose other than saying what is about to happen. It is the difference
 * between *which state is this session in* and *what is this user being asked to
 * allow* — and the second question has to be answered in the host's vocabulary
 * or not at all, because the payload is the only place it appears.
 *
 * ## Why the session is asked of the adapter rather than read here
 *
 * `session_id` is not read from the payload in this file. The adapter already
 * reads it, already validates that the payload is something it models, and
 * already answers "which session does this concern". Reading it a second time
 * here would be a second answer to that question in a file that does not have to
 * have one — and a request that named a session the adapter had never heard of
 * would be a request the surface could offer and nothing could resolve.
 */

import type { AgentAdapter } from "../state-selection/adapters/types";
import type { ClaudeCodePayload } from "../state-selection/adapters/claude-code";
import type { PendingRequest } from "../escalation/pending";

/** How much of a payload's own text is repeated back at the user, in bytes. */
const MAX_SUMMARY_BYTES = 200;

/**
 * The permission request this payload asks about, or `null` for one it does not.
 *
 * `null` is the common and unremarkable answer. The host sends every event it
 * sends, and this is installed for one of them; a payload that is not asking
 * about permission produces nothing to answer, and the requester falls back to
 * its own behaviour — which is exactly what it would have done with no companion
 * installed.
 */
export function describeRequest({
  adapter,
  payload,
  id,
  at,
}: {
  readonly adapter: AgentAdapter<ClaudeCodePayload>;
  readonly payload: string;
  /** The identifier the waiting program generated. Carried, never derived. */
  readonly id: string;
  readonly at: number;
}): PendingRequest | null {
  const parsed = asObject(payload);
  if (!parsed) return null;

  // Through the adapter, because it is the only thing that knows whether this is
  // an event it models and which session it concerns. A payload it does not
  // model has no session, and a request with no session is a request that could
  // not be resolved to anything.
  const update = adapter.translate(parsed);
  if (!update) return null;

  const asking = askingFor(parsed);
  if (!asking) return null;

  return {
    id,
    operation: asking,
    sessionId: update.sessionId,
    requestedAt: at,
  };
}

/**
 * Whether this payload is asking permission for a tool call, and what it is.
 *
 * `PreToolUse` is the event: it fires after the host has decided a tool call
 * needs permission and before it runs. The other events a host sends do not
 * carry an answer back — several of them have no decision control at all — so
 * this asks for the one whose answer the host will read.
 */
function askingFor(payload: ClaudeCodePayload): string | null {
  if (payload.hook_event_name !== "PreToolUse") return null;

  const tool = typeof payload.tool_name === "string" ? payload.tool_name : null;
  if (!tool) return null;

  // The detail, when there is any. A tool call with no arguments (`TodoWrite`
  // with an empty list, a `Read` the host has already filled in) still says
  // which tool it is, which is enough to decide on and is better than nothing.
  const detail = summarise(payload.tool_input);
  return detail === null ? tool : `${tool}: ${detail}`;
}

/**
 * The most a person needs of a tool's arguments to decide on them.
 *
 * A bounded, readable rendering rather than the arguments themselves: a `Bash`
 * input carrying a thousand characters of command is not more decidable than
 * the command it contains, and the surface has a fixed amount of room. JSON
 * because it is what the payload carries and a person reading `{"command":"ls"}`
 * knows what it is, and because a hand-written renderer per tool is the
 * per-tool table this project has twice refused to build.
 */
function summarise(toolInput: unknown): string | null {
  if (toolInput === undefined || toolInput === null) return null;

  let rendered: string;
  try {
    rendered = JSON.stringify(toolInput);
  } catch {
    // Circular, or something `JSON.stringify` will not name. There is nothing
    // to show, and the tool's name alone is still an answerable question.
    return null;
  }

  if (rendered === undefined) return null;
  if (rendered === "{}") return null;

  // Truncated *at a character boundary of the rendered text*, not of the bytes,
  // so the cut cannot land inside a multi-byte sequence and leave a broken one
  // on the card.
  return rendered.length <= MAX_SUMMARY_BYTES
    ? rendered
    : `${rendered.slice(0, MAX_SUMMARY_BYTES)}…`;
}

/**
 * The payload, if it is a JSON object, and `null` otherwise.
 *
 * The envelope and nothing more, for the reason `src/relay/session-source.ts`
 * states the same check: anything more would be a second opinion about what a
 * host's payload looks like, and the adapter already has one.
 */
function asObject(payload: string): ClaudeCodePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as ClaudeCodePayload)
    : null;
}