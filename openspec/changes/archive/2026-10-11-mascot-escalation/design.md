# Design

## Context

See `proposal.md` for motivation and the two spec files for requirements. The constraint
that shapes everything here came from an empirical spike rather than from documentation,
and it is worth stating in full because it is the reason this design does not look like the
original plan.

**On GNOME Wayland a floating window cannot be kept above other windows.** The compositor
owns stacking for Wayland clients; without the layer-shell protocol there is no way to ask
to be raised. A request to stay on top is accepted — the flag reads back `true` — and
ignored. Observed behaviour: the surface sits above other windows only while it holds
focus, and falls behind the moment the user looks elsewhere.

The same spike found that a requested window size is not reliably honoured (a request of
140x150 came back as 200x239 on one rendering path and 200x200 on the other), and that
`set_position` on the native Wayland path returns success and does nothing.

Everything below follows from accepting those three facts rather than working around them.

## Goals / Non-Goals

**Goals:**

- The blocked agent is reachable on every platform, including the one it cannot float on.
- Never call the user to a surface with nothing they can do.
- One build, two behaviours, decided at runtime.

**Non-Goals:**

- The notch. Placement inside the screen furniture is what survives this platform
  constraint, and the notch is a large piece of work that would need its own spike.
- Persisting permissions. Two decisions only.
- More than one pending approval at a time.

## Decisions

### Visibility is a function of platform capability, not a constant

The central decision. Rather than one visibility rule, there are two, and the platform picks:

```
 platform can hold a persistent surface above other windows
   -> always visible. Ambient state, glanceable, never takes focus.

 platform cannot
   -> invisible when nothing is actionable. Appears on a block, and taking
      focus at that moment is correct because it is the one thing the user
      asked to be interrupted for.
```

The second is not a fallback. It is the attention-routing rule with nothing left to strip:
the surface exists only when it has something to say, which is the whole thesis. On a
platform where that is the only option, it is the purest form of the design rather than a
diminished one.

The alternative — detect the platform and disable the feature — was rejected because it
would ship a product that does nothing on a large and entirely reasonable desktop.

### Capability is detected at runtime, per platform property

Not "is this Linux", and not a build flag. The question is narrow and mechanical: *can this
platform keep a window above others that are not focused?* That is answerable, and it is
the property that actually matters. A future platform that gains the capability gets the
persistent behaviour with no code change.

### Ambient never takes focus; escalation may

Two different rules, because the situations are different.

Ambient is a status indicator. A window that grabs focus to tell you nothing is doing is
the thing this product exists to avoid, so on every platform an ambient surface must not
take focus, and a failure to do so is not an error — some platforms simply cannot.

Escalation is the opposite case. On a platform without a persistent surface, appearing *is*
the escalation, and focus follows from it. That is correct: the user asked to be interrupted
when an agent blocks, and this is that moment.

### Size is owned by the stylesheet, and never requested

The spike answered a 140x150 request with 200x239 and, on the other path, 200x200. A
requested size is a suggestion the platform may decline. So the surface is sized by its own
content and styling, and treats whatever dimensions it is given as a viewport rather than a
specification.

*Alternative considered* — clamp to a minimum. Rejected: it cannot help on a platform that
gave us a size we did not ask for and will not change, and it adds a magic number that
would be wrong on the next platform.

### Escalation is distinguishable by more than hue

The amber pulse is the obvious signal and it is weak on its own: it fails for anyone who
does not separate the colours, and the mascot's own vocabulary is already colour-coded, so
amber alone risks colliding with the existing semantic palette.

Escalation therefore changes **motion and scale as well as colour** — the floor glow pulses
and the character lifts slightly. The colour is reinforcement, not the signal. This is also
why the requirement says so explicitly rather than leaving it to implementation taste.

### Exactly two decisions, and "always allow" is deliberately absent

Allow and Deny. Nothing that persists.

An "always allow" writes a permission into the agent's configuration, which is a
permissions-policy decision with its own blast radius: it changes what a future session may
do without asking, and it edits user configuration. That deserves its own change, its own
review, and its own undo. Bundling it into a companion's approval card would hide a policy
decision inside a convenience feature.

### The decision carries the identity of the request it was made for

A decision is bound to a specific pending request, not to "whatever is blocked now". Two
consequences, both required rather than incidental:

- A decision made for a request that has since gone away is **refused**, not applied to the
  next thing. Silently applying an old decision to new work is the failure mode that turns
  a convenience into a hazard.
- Deciding one request resolves exactly that request. No batching.

This is why the transport that delivers the decision is left to a later change: it can be
swapped, but this identity rule is the UI's half of a security boundary and it does not
move. That transport is split in two — `agent-relay` carries events and decisions to and
from the host, and `decision-transport` owns the fail-open invariant, which is the half
that must never be rushed.

### No queue; the longest-waiting is offered

`mascot-states` renders `needsYou` if *any* session is blocked, so more than one can be.
v0.1 offers the longest-waiting and shows nothing about the others.

A queue is real work — ordering UI, per-item state, a story for what happens to the other
two while the first is being answered — and it is a v0.2 concern. Offering the
longest-waiting is right regardless: it is the request that has been costing wall-clock
longest, so it is the one whose answer matters most.

### Decisions are refused, never guessed, when nothing is pending

Closing a decision surface without deciding leaves the block exactly as it was. The
surface has no timeout and no default, because a default decision on a security-relevant
request is indistinguishable from having been given.

## Risks / Trade-offs

**Two behaviours is a product that is not the same everywhere** → Accepted deliberately.
The alternative is one behaviour that works on two platforms and does nothing on the third.
The platform split is stated in the requirements, so it is a documented property rather than
a surprise.

**Escalate-only surfaces are less charming** → Accepted. The charm of a persistent companion
is real and it survives on the platforms that can hold one. On the platforms that cannot,
the alternative is a companion that is either hidden or a window the user fights.

**A platform might report capability wrongly** → Detection is narrow and mechanical, and the
failure direction is safe: a platform that claims it can float and then does not produces
the behaviour a user would get from an ordinary window, not a broken product.

**Two decisions may feel restrictive** → "Always allow" is deliberately deferred, not
refused. When it arrives it is a separate decision with its own reasoning, not a check on
this card.

**Nothing has been verified on macOS or Windows** → The spike ran only on Linux, and the
claim that a persistent surface works there rests on the platform's documented behaviour
and on prior art, not on measurement. Both paths are cheap to re-run; neither is assumed to
work without being run.

## Migration Plan

None. Additive; consumes `Mascot`, `selectState` and `escalates` unchanged. Removing the
surface removes the change.

## Open Questions

None.

Deferred — the notch, a queue of pending approvals, persisting permissions, per-session
mascots, and answering an agent's questions — are all separate changes that do not alter the
requirements or the decisions here.