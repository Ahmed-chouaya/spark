# Proposal

## Why

The companion watches Claude Code. That was v0.1's scope and it is finished and verified.
The agent on this machine is OpenCode, so the thing cannot be tried here without a second
adapter — and "a second host agent is one more file" is a claim this repository has made in
four module headers without ever having been tested.

It is about to be tested, against a host whose vocabulary was **measured rather than
read**, because the published documentation for this version is wrong:

| | the docs say | what opencode v2.0.26 emits |
|---|---|---|
| payload | `event.properties` | **`event.data`** |
| tool activity | `tool.execute.before` / `.after` | `session.tool.input.started`, `.called`, `.success` |
| turn | `session.idle`, `session.error` | `session.execution.started` / `.succeeded` |
| step | not documented | `session.step.started` / `.ended` (`finish: "tool-calls"`) |

An adapter written from the documentation loads, registers, and silently does nothing —
because every payload comes back as "an event this adapter does not model", which is the
one answer that is always correct and therefore never wrong enough to notice. A
throwaway probe plugin run against the real binary is what makes the difference, and it is
kept out of the repository afterwards.

## What Changes

- `src/state-selection/adapters/opencode.ts`: OpenCode's events become canonical ones.
  One file, and nothing anywhere else changes — which is the claim this is here to test.
- The shell stops hardcoding one adapter and resolves **which agent a payload belongs to**
  from the payload, so a session from either host folds into the same session set.
- A plugin for OpenCode that forwards its own event stream to the companion, translating
  nothing. Its payload is OpenCode's shape; the adapter is the only thing that knows
  what it means.
- The companion reports what it sees — every session, which agent, what state, and what
  it is waiting on — on standard error, because on a platform that cannot float a
  surface the *correct* behaviour is an empty desktop and a user needs to be able to
  tell that from a broken one.
- Permission answers are **not** wired in this change. The hook exists and the values
  are real, but nothing measured has fired it, and an unmeasured decision path that can
  refuse a tool call is worse than no decision path.

## Capabilities

### New Capabilities
- `opencode-adapter`: which of OpenCode's events mean what, what is deliberately not
  modelled, and how a payload says which agent it belongs to.

### Modified Capabilities
- `mascot-state-selection`: one requirement changes. "Sessions are sourced from the host"
  currently names one host. It has to name the property instead, or the adapter's
  existence contradicts the requirement that permits it.
- `native-shell`: no requirement changes. It consumes a session set and does not care
  which agents are in it.

## Impact

- **New**: `src/state-selection/adapters/opencode.ts`, `shell/src-tauri/plugins/spark.js`.
- **Modified**: `shell/src/companion.tsx` (adapter resolution), `src/relay/session-source.ts`
  (which agent a payload belongs to).
- **Unchanged**: the reduction, the mascot, the relay, the transport, the decision path.
  An adapter that changed any of those would not be one.
