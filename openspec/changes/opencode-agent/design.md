# Design

## The measurement came first

The adapter is written against events dumped from a real `opencode run`, not against its
documentation. That is not fussiness — the documentation is wrong for the installed
version in every field that matters:

| | documented | measured on v2.0.26 |
|---|---|---|
| payload field | `event.properties` | **`event.data`** |
| session start | `session.created` | `session.created` ✓ |
| turn start | `session.idle`, `session.error` | `session.execution.started`, `session.execution.succeeded` |
| tool activity | `tool.execute.before` / `.after` | `session.tool.input.started` → `session.tool.called` → `session.tool.success` |
| per step | not documented | `session.step.started` / `.ended` with `finish` |
| permission | `permission.ask` hook returning `{status}` | `ctx.permission.hook` exists; **never fired** |

Written from the documentation, the adapter would load, register, and do nothing — because
every payload comes back as "not an event this adapter models", which is the one answer
that is always correct and therefore never wrong enough to notice.

The other measured surprise: **every event arrives twice.** Two plugin instances are
loaded — one global, one per project — so the same event is delivered to both. An adapter
that counts events would see every tool call twice.

## Which events map, and which deliberately do not

Mapped, because each one means something a person watching a mascot would recognise:

| OpenCode | canonical | why |
|---|---|---|
| `session.created` | `session-started` | a session exists |
| `session.execution.started` | `prompt-submitted` | the user handed over work |
| `session.step.started` | — | a step begins; it does not become a state of its own |
| `session.tool.called` | `tool-activity` | work started |
| `session.tool.input.ended` | — | the arguments finished streaming; the call is already known |
| `session.tool.success` | `tool-activity` (paired) | work finished, with the elapsed time |
| `session.step.ended` (`finish`) | `completed` or `failed` | the turn ended |
| `session.execution.succeeded` | `completed` | the execution is over |
| `permission.asked` | `authorization-requested` | **not mapped — see below** |

Not mapped, and the reason matters more than the mapping:

- **`session.reasoning.*` and `session.text.delta`** — one event per token. A mascot that
  redraws several hundred times a minute is not a companion, and the state it would carry
  is `thinking`, which `session.step.started` already establishes.
- **`permission.asked`** — it *looks* like the escalation event, and mapping it would put
  the mascot in `needsYou` with no card, because there is no way to answer it. A loud
  state with nothing to act on teaches the user that being summoned is sometimes
  pointless. This is the same reason `agent-question` does not escalate, in
  `src/state-selection/escalation.ts`, and it is why an unmapped permission event is
  correct rather than a gap.
- **`session.inbox.*`, `shell.*`, `session.usage.*`, `project.updated`** — the session's
  state does not depend on any of them.

The tool pair is joined by `data.id`, the same `callID` the host gave the call, exactly as
the Claude Code adapter joins `PreToolUse` to `PostToolUse` by `tool_use_id`. Effort
signals come out the same way, so `src/state-selection/classification.ts` needs no change
and no test is written for it.

## Which agent a payload belongs to

The channel is a pipe and must stay one. Two agents on one channel means something has to
say whose payload it is, and there are three ways to do that:

1. **A second channel per agent.** Rejected: it multiplies the address rule — already
   implemented in two languages and compared by a test — by the number of agents, for a
   distinction that one field carries.
2. **A guess from the payload's shape.** Rejected, and it is the dangerous one. Guessing
   means "if it has `hook_event_name` it is Claude Code", which is a rule that silently
   misroutes the first host that emits a field name someone else also uses.
3. **The payload says.** The envelope is `{ agent, event }`. The host plugin — which knows
   who it is — writes it, and the companion looks the agent up.

The envelope is a routing fact, not an interpretation, which is what keeps it honest: the
plugin does not decide what `session.tool.called` *means*, and the adapter does not care
what wrote the envelope. Neither has the other's vocabulary.

A payload with no envelope is Claude Code's, because that is what the relay delivers today
and changing the relay to add one would put a host's routing in a program whose whole
property is that it has none.

## Why permissions are not wired

`ctx.permission.hook` exists in the installed binary and `allow`/`deny`/`ask` are real
values. It was never observed firing — no run in this change requested a permission.

An unmeasured decision path is the one thing in this repository that could refuse a user's
tool call wrongly. `spark-ask` prints nothing on every failure path precisely because a
wrong answer here is indistinguishable from a right one. So: not mapped, documented as not
mapped, and the reason written where the next reader of the adapter will find it.

This is the difference between the mascot being *wrong* and the companion being
*dangerous*, and it is the whole reason the change is scoped this way.

## Seeing it work

The problem: on a platform that cannot float a surface, correct behaviour is an empty
desktop. A user cannot tell that from a broken companion, and neither can a test.

So the shell reports on standard error — which `npm run companion` already inherits, so it
appears in the terminal with nothing new to configure:

```
 sessions  claude-code/ses_abc  working     tool: shell
           opencode/ses_def    needsYou    waiting on: permission
```

Every session, its agent, its state, and what it is waiting on. That is what makes
"a session is open in OpenCode and here is what it is doing" answerable on a machine where
the window is correctly hidden — which is what the person testing this is standing in front
of.

## Testing it

**Against measured payloads.** Every event in the table above is a fixture copied from the
probe, not a shape invented for the test. A test whose payloads are invented proves the
adapter agrees with the test author's imagination.

**Proven to fail.** Each mapping broken in turn: return `null` for an event that matters,
map `session.tool.success` without pairing it so elapsed time is lost, treat
`permission.asked` as an escalation. Each has to fail a named test.

**The duplication.** A test that the same event delivered twice folds to the same session,
because two plugin instances are loaded on this machine and a double-counted tool call
would render as visibly wrong.

**Structural.** The plugin is a dumb pipe: a test that reads it and fails if it names a
canonical event, a mascot state, or a session field. The same guard the relay has, for the
same reason — behaviour tests pass just as happily with interpretation bolted on.

**Not tested here, and said so:** whether a real OpenCode turn moves the mascot, end to
end, with a person watching. That needs a session and an eye, and it is the check that
confirms this.
