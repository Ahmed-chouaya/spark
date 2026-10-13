# Companion runtime

What the companion does with a question the host asked: turn it into something the user
can answer, and carry the answer back.

```
  hook payload arrives
        |
        v
  request.ts     what is this asking permission for?   -> or null, which is the
        |                                              common case and not an error
        v
  runtime.ts      which request is pending, and where its answer goes
        |
        v
  decision.ts     what an answer looks like in the host's own bytes
```

Three files and one barrel. The rule is that none of them decides anything the host has
already decided: `describeRequest` asks the existing adapter whether this is an event it
models, and `answer` asks the existing `decide` whether the request is still pending.

## The one thing here worth knowing about

**Silence is not approval and not refusal.**

```
 decision arrived   ->  permissionDecision bytes, exit 0
 nothing arrived    ->  no output at all,      exit 0
```

The second line is what every failure produces — no companion, no channel, unreadable
input, broken exchange, deadline. The hooks reference states it directly:

> "Exit code 0 with no output means the hook has no decision to report, so the tool call
> continues through the normal permission flow. The hook can deny the call, but staying
> silent doesn't approve it."

So a timeout produces the host's ordinary prompt, which is exactly what happens with no
companion installed. The forbidden alternative is printing `deny` on a timeout: the user
did not refuse that tool call, we did, because they were slow, and it is indistinguishable
from a refusal they chose.

The asymmetry is deliberate and it is the whole design:

- Uncertainty about **whether to wait** fails open.
- Uncertainty about **what the user decided** fails closed — a decision either arrives
  correctly or is refused as stale, never dropped and replaced with something else.

## The request identifier is generated, never read

The host gives every tool call its own `tool_use_id`, and it is sitting right there in the
payload. Using it would be the obvious thing to do.

It would also put the host's vocabulary in a second Rust program, which is the duplication
this repository has spent its whole adapter boundary preventing — and which
`test/relay-shape.test.ts` and `test/ask-shape.test.ts` exist to catch.

So `spark-ask` generates one, and the companion learns the correspondence from the frame:
"this opaque payload is request X". Neither side needs to know what the other meant by it.

## The reply format

`src/companion/decision.ts` is the only file in the repository that knows what a host's
*answer* looks like — the mirror of `src/state-selection/adapters` being the only one that
knows what its *input* looks like.

```
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow" | "deny" } }
```

Taken from the hooks reference, not from memory, and named in the module so the next editor
can check it. A format invented from memory does not fail visibly: the host reads output it
does not understand as *no decision*, so the feature would silently never work.

`permissionDecisionReason` is present only on a deny, because the reference says an allow's
reason goes to the debug log and nothing else. Nothing else goes in the envelope at all —
`updatedInput`, `additionalContext` and `defer` are all available and all deliberately
absent, because a hook that can put text in the model's context is a channel to the model.

## Observed behaviour

Per machine, because "which behaviour did I get" only means something next to the machine
that produced it. Do not carry one machine's answer to another machine's row.

| | Fedora 44, Linux | Windows 11 | macOS |
|---|---|---|---|
| `spark-ask` builds and links only the C runtime | **yes** | not measured | not measured |
| no companion running: nothing printed, exit 0 | **yes** — measured, and in under 2s | not measured | not measured |
| no companion running: no refusal anywhere in the output | **yes** | not measured | not measured |
| a decision reaches the host's bytes | **yes** — `hookEventName`, `permissionDecision`, no reason on an allow, nothing else in the envelope | not measured | not measured |
| a companion that never answers: nothing printed, exit 0 | **yes** | not measured | not measured |
| ...and it ended at its own bound rather than the companion's | **yes** — between 9s and 25s | not measured | not measured |
| a late answer is discarded | **yes** | not measured | not measured |
| a decision for a request that has gone away is refused | **yes** | not measured | not measured |
| **a real `claude` honours the decision** | **not measured — see below** | not measured | not measured |

### The one row that is not measured, and why it is the important one

Everything above is the right *bytes*. Nothing above proves the host *acts* on them.

The check is deliberately excluded: it costs a model call, needs the user's own `claude` on
PATH, and its result depends on which model that machine has configured. A check that
depended on it would fail for reasons that have nothing to do with the relay.

So on a machine that has the agent installed:

```
 npm run relay:install -- --yes      # with spark-ask built and askCommand set
 claude                             # ask for something that needs a tool
                                    # answer the card
```

That is the one thing that confirms the host honours a decision rather than merely reading
it. Until someone runs it, the round trip is verified up to the boundary and not across it.

### Measured, or reasoned about?

The distinction matters more than usual here, because a failure in this change is a user's
agent standing still.

**Executed** (`npm run decision:verify`, against the real binaries): every row marked yes
above. `cargo test --manifest-path ask/Cargo.toml` covers the address rule; it is not part of
`npm run verify` because it needs a Rust toolchain.

**Executed, structurally** (`test/ask-shape.test.ts`): that the waiting program names no host
event, no mascot state, no session field, generates its identifier, carries payload and reply
as opaque bytes, and has exactly one bounded wait.

**Reasoned about, and only reasoned about:**

- That `WS_EX_TOPMOST`-equivalent behaviour on Windows named pipes matches the Unix path. The
  transport is one crate's cross-platform implementation; the security barriers are ours and
  are documented in `../relay/README.md`.
- That a user perceives ten seconds as "prompt" rather than "broken". A judgement about
  wall-clock, and the only honest evidence is somebody using it. The number is one named
  constant with its reasoning attached rather than a value spread through the code, precisely
  so the next person can change it in one place having read why.
- That Claude Code honours `permissionDecision: "allow"` to skip its own prompt. Read from
  the reference, not observed.

## Deliberately not here

- **"Always allow".** Two answers: Allow and Deny. Writing a permission into the agent's
  configuration changes what a *future* session may do without asking, and edits user
  state. That is a policy decision with its own blast radius and its own undo.
  `test/decision-surface.test.tsx` surveys the rendered surface and this module's sources
  for anything that writes one.
- **A queue.** More than one blocked session presents the longest-waiting, and the rest wait
  their turn. Ordering UI is real work and a later change.
- **Answering `AskUserQuestion`.** The agent asking the user something is blocked, yes — but
  the companion cannot answer it, so it must not escalate. That rule is in
  `src/state-selection/escalation.ts` and is unchanged by anything here.
