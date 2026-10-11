# Proposal

## Why

`mascot-rig` delivers nine correctly-rendered states and a way to address their parts. It
does not decide which state to show. Nothing yet connects a running agent session to a
face, so the component library is a gallery rather than a companion.

Deciding this well is what stops the mascot becoming decorative. The governing rule is
attention routing: the companion never escalates for information, and escalates exactly
once for the condition that costs the user wall-clock — an agent that has stopped and is
waiting on them. Getting selection right is what makes that rule enforceable rather than
aspirational.

## What Changes

- Introduce state selection: the rule that reduces a set of live agent sessions to the
  single state the mascot renders.
- A single aggregate mascot serves all sessions in v0.1. Per-session mascots are
  deferred; the reduction function is the seam they fan out from.
- **A blocked session takes precedence over everything.** If any session is waiting on the
  user, the mascot is `needsYou`, regardless of what the primary session is doing.
- **Only the primary session drives ambient state.** The primary is the most recently
  active session. A background session that is busy does not make the mascot busy — but a
  background session that is blocked still escalates. This is the attention-routing rule
  applied to session selection: the mascot speaks for what needs the user, and reflects
  one relationship otherwise.
- **`needsYou` is the only escalating state.** `alert` is loud but not actionable: the
  agent has already died and there is nothing to do about it. Making `alert` escalate
  would train the user to ignore the mascot.
- **Never escalate to a state the app cannot resolve.** An agent question the companion
  cannot answer must not become loud, because a loud card the user cannot act on is worse
  than silence.
- **Agent-tool classification is soft, not a per-tool mapping.** States reflect rough
  effort and fall back to a default bucket, rather than asserting what each individual
  tool means. A new tool arriving in the host agent must not require a mapping decision,
  because that turns the companion into permanent upkeep against a surface it does not
  control.
- Classify states by lifetime — transient, sustained, fault, block — which determines
  transition behaviour and makes precedence derivable rather than arbitrary.

## Position in v0.1

v0.1 is defined as: **a small always-on-top companion that watches Claude Code sessions
and lets you unblock a blocked one without going to the terminal.** Every part of it
serves that sentence.

```
 IN THIS CHANGE                    LATER CHANGES
 --------------------------------- ----------------------------------------
 the state reduction               mascot-escalation  floating panel, amber
 agent-event to state mapping                        pulse, approval card
 nine states reachable from                         Allow/Deny round trip
 a single agent adapter           agent-relay        hook binary, socket,
                                                      canonical events,
                                                      fail-open invariant
 NOT v0.1: per-session mascots, other agents, the notch, settings window,
 motion beyond a crossfade, distributed builds
```

The pieces deliberately stay separate: this change is pure logic, verifiable with no
window, no socket and no UI, so it can prove itself before the two genuinely hard
platform pieces are attempted.

## Capabilities

### New Capabilities

- `mascot-state-selection`: which state the mascot shows, given a set of live agent
  sessions — the reduction, the precedence rule, primary selection, the classification of
  states by lifetime, and the mapping from agent events to states.

### Modified Capabilities

None. `mascot-rig` owns the vocabulary as a rendering contract and is unchanged by this
work; selection adds behaviour alongside it rather than altering how a state renders.

## Impact

- New module under `src/` owning session state, the reduction and the event mapping. It
  consumes the state names defined by `mascot-rig` and holds no rendering concerns.
- `mascot-rig` is a prerequisite; this change adds no requirement to it and does not
  alter its specs.
- Reads the host agent's hook event stream through an adapter boundary, so that later
  agents are added as adapters rather than as branches in the reduction.
- No new runtime dependencies.