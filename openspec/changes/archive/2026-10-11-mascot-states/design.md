# Design

## Context

See `proposal.md` for motivation and `specs/mascot-state-selection/spec.md` for the
requirements. Two things shape the approach: the state vocabulary already exists as a
rendering contract in `mascot-rig`, and the host agent's tool surface is owned by someone
else and changes without notice.

This change is pure logic. It holds no rendering concerns, opens no window, and talks to
no socket, so it can be built and proven before the two genuinely difficult platform
pieces are attempted.

## Goals / Non-Goals

**Goals:**

- A reduction from a set of live sessions to exactly one state.
- Precedence that is derivable from a rule rather than hand-listed.
- An adapter boundary so later agents add as adapters, not as branches in the reduction.

**Non-Goals:**

- Rendering, animation and the approval card — separate changes.
- Transport. How events arrive is the relay's problem, not this one's.
- The three unused vocabulary states, which need OS integration and are deferred.

## Decisions

### The reduction

The whole state machine is four lines:

```
 reduce(sessions):
   blocked := sessions where state is needsYou
   if blocked is non-empty    -> needsYou
   if primary.state is alert  -> alert
   otherwise                  -> primary.state
```

Everything else in the vocabulary — `thinking`, `success`, `listening`, `working`,
`focused`, `tired`, `idle` — reaches the screen through `primary.state` unchanged. There
is no second code path for ambient states, which is what keeps the mascot honest.

### Attention routing implies primary-for-ambient

The rule that only the primary drives ambient state is not a simplification. It is the
attention-routing principle applied one level up, and it falls out of asking what a
background session is for.

A background session that is *busy* is telling you nothing actionable — you are not
waiting on it, and it will finish on its own. Rendering its state would train you to
glance past the mascot.

A background session that is *blocked* is different: it has stopped, and it will stay
stopped until you answer. That must come through regardless of what you are doing.

So the asymmetry is not a rule someone chose; it is what "escalates only when it costs you
wall-clock" means when applied across sessions.

**The cost, stated plainly:** a background session that *fails* will not be noticed. That
is accepted — the session has already ended and there is no decision attached to it — but
it is a real loss, and it is why the spec carries it as an explicit scenario rather than
leaving it implicit.

### Primary is most-recently-active, not foreground

Defining "foreground" would need to know which terminal window has OS focus, which means
platform-specific window introspection on three platforms. Most-recently-active needs one
timestamp per session and no platform work.

It also degrades correctly: with a single session, which is the common v0.1 case, it is
trivially correct with no special case at all.

Note the asymmetry it introduces — answering a blocked session does not make it primary,
so the companion returns to whatever session you were actually driving. That is the
desired behaviour and it falls out for free.

### Precedence is derived from lifetime classification, not listed

States are classified by what the companion does when nothing else happens:

```
 TRANSIENT   thinking, success              reverts to the previous state
 SUSTAINED   idle, listening, working,      holds until the next event
             focused, tired
 FAULT       alert                          holds, loud, not actionable
 BLOCK       needsYou                       holds, loud, actionable
```

Classification answers three questions at once — does the state revert, how loud is it,
and what outranks what. Precedence then falls out as block > fault > transient >
sustained > idle rather than being a table someone maintains.

The classification also settles a question the vocabulary alone could not: `thinking` is a
~2-second event between a prompt and the first tool call, so it is a transient. Treating
it as a mode would have made it a state the companion sits in, which it never does.

### Exactly one escalating state

`alert` is loud and `needsYou` is loud, but only one of them escalates.

The distinction is whether the user has anything to *do*. An agent that failed has already
failed — the news is over, and interrupting the user for it is an interruption with no
payoff. An agent that is blocked will remain blocked indefinitely and each second costs
wall-clock.

Escalating on both would also mean two sources contending for one channel, which is a
queue problem this change should not have to solve.

### Never escalate to a state you cannot resolve

A condition the companion cannot act on must not become loud.

The host agent can block on a question, not only on an authorisation request. If that
became loud, the user would be pulled to a card with no way to complete it — a dead end
that teaches the lesson "when the mascot calls me, sometimes there is nothing I can do."

The rule generalises past this one case: before a state escalates, ask whether the
companion can complete what it is asking for.

### Tool classification is soft, by effort, with a default

The host agent's tool list is not ours. A per-tool mapping is permanent upkeep against a
surface that changes without notice, and it is the same treadmill as the integration list
we deliberately cut — twelve service integrations that most users never enable, each one a
standing obligation.

So activity is bucketed by rough effort, and anything unrecognised falls to a default:

```
 light, read-only lookups        -> the searching sustained state
 ordinary edits and actions      -> the working sustained state
 long-running or heavy work      -> the focused sustained state
 anything unrecognised           -> the working sustained state (default)
```

Every state is reachable, no tool is individually named, and a tool we have never seen
still produces a valid state.

**What this buys:** the companion cannot be *wrong* about a tool it has never seen, because
it never claims to know. **What it costs:** it cannot tell you the agent grepped rather
than read. That information was never going to change what you do, so its absence costs
nothing.

### Adapter boundary for agent events

The reduction consumes session objects, not agent payloads. Agent-specific event shapes are
translated by an adapter into the canonical session shape before the reduction sees them.

Later agents therefore add an adapter rather than a branch in the reduction. This is the
part of Coucou's integration contract worth keeping: what was genuinely reusable there was
the canonical event set, not the twelve adapters built on top of it.

## Risks / Trade-offs

**The reduction is small enough to look trivial** → That is the point, and it is the reason
it can be exhaustively tested. The complexity lives in the vocabulary and the rendering,
which `mascot-rig` already covers.

**Soft classification could read as vague later** → Guard it with the explicit spec
requirement that the system must not claim to distinguish tools of similar effort. Without
that, someone will "fix" the vagueness by adding a per-tool map and reintroduce the
treadmill.

**Suppressed background failures may annoy power users** → Reconsider when a second agent
is supported and the failure becomes actionable through a different route. Changing this
would alter the specs, so it is deliberately not deferred here.

**Most-recently-active is wrong for genuine multi-window work** → Accepted for v0.1. It
only misbehaves when two sessions are being actively driven in alternation, which is a
multi-agent scenario and therefore a v0.2 concern.

## Migration Plan

None. Additive, no persisted state, no API surface. It introduces a new module and
consumes the state names already defined by `mascot-rig`.

## Open Questions

None.

Deferred items — the notch, per-session mascots, motion beyond a crossfade, the three
OS-driven states, and additional agents — are all separate changes that do not alter the
requirements, the approach, or the reduction decided here.