# Escalation surface

What the user sees when an agent is blocked, and what they can do about it.

## Two behaviours, one build

```
  something actionable is blocked  -> visible, escalating
  nothing is blocked
    platform can hold a surface    -> visible, ambient, never takes focus
    platform cannot               -> not visible
```

The second branch is not a degraded version of the first. It is the
attention-routing rule with nothing left to strip. On a platform that cannot
float, a surface which is invisible unless it is actionable is the purest
expression of what this is for, and the only variant that does not fight the
window the user is trying to work in.

The alternative — detect the platform and switch the feature off — was rejected
because it ships a product that does nothing on a large and reasonable desktop.

## The capability probe, and what it is not

`canHoldPersistentSurface` asks one question: did the compositor grant this
window `zwlr_layer_shell_v1`?

Compositors own stacking for Wayland clients, so "keep this window on top" is
not a request a client can make of them. It is accepted and discarded. The layer
protocol is the only thing that places a client in a stack of its own, and
compositors differ on whether they implement it — for reasons that have nothing
to do with one another.

So the capability is read from **what the compositor actually granted**, never
from an OS name, a desktop environment, or a build flag. Each of those is a
proxy for the property, and every proxy is wrong somewhere.

The failure direction is chosen: an unreadable host reports no layer, which
selects the escalate-only behaviour that works everywhere. The opposite mistake
would report a layer never granted, producing a surface that believes it is
floating while it is not.

Run it on this machine:

```
npm run probe:capability
```

## Observed behaviour

Recorded per machine, because "which behaviour did I get" is only meaningful
next to the compositor that produced it. Add a line when you run it somewhere
else — **do not** carry a machine's answer forward to another.

| Machine | Compositor | Probe | Idle behaviour | Notes |
|---|---|---|---|---|
| Fedora GNOME, Wayland | GNOME Mutter | `zwlr_layer_shell_v1` not granted → `false` | absent unless blocked | Does not implement the layer protocol at all; not planned to. Escalating surface stays above other windows only while it holds focus. |

### Not yet observed

The **persistent-surface path on a compositor that grants the layer protocol**
has not been run. Everything about it — that the surface really does stay above
unfocused windows, that the compositor places it where the shell asked, that it
survives a workspace switch — rests on the protocol's documented behaviour and on
prior art, not on measurement.

Run `npm run probe:capability` on a machine whose compositor grants
`zwlr_layer_shell_v1` and record what it finds here before claiming that branch
works. The capability check and the visibility rules are covered by tests; what
is not covered is the compositor honouring a request it has agreed to.

## No persistent permission

Two answers: **Allow** and **Deny**. Not "always allow".

Writing a permission into the agent's configuration changes what a *future*
session may do without asking, and edits user configuration. That is a
permissions-policy decision with its own blast radius, and it belongs in its own
change with its own review and its own undo. Bundling it into an approval card
would hide a policy decision inside a convenience feature.

`test/decision-surface.test.tsx` surveys the rendered surface and the module's
sources for anything that writes one.

## One decision, bound to one request

A decision is bound to a specific pending request, not to "whatever is blocked
now". Two consequences, both required:

- A decision for a request that has gone away is **refused**, not applied to
  whatever is pending now. Silently re-pointing an old answer at new work is the
  failure mode that turns a convenience into a hazard.
- Deciding one request resolves that request and no other. No batching.

Closing the surface without deciding is not an answer. No timeout, no default: a
default decision on a security-relevant request is indistinguishable from having
been given one.

`agent-relay` will deliver decisions through this shape. The transport can be
swapped; the identity rule is the UI's half of a security boundary and it does
not move.

## No queue

Where more than one session is blocked, the **longest-waiting** is offered and
the rest are not shown. That is the request whose answer has been costing
wall-clock the most time.

A queue is real work — ordering UI, per-item state, a story for what happens to
the others while the first is being answered — and it is a later change.

## Sizing

The surface is sized by its content and its stylesheet. It **never requests a
window size**, because a requested size is a suggestion the platform may decline,
and does: the same 140x150 request came back as 200x239 on one rendering path
and 200x200 on the other.

Whatever dimensions the surface is handed are a viewport, not a specification.
`Mascot` states its canvas ratio rather than a pixel height, so an unexpected
viewport neither letterboxes nor clips.

## Escalation is not colour-only

Escalation changes **scale and motion as well as colour**: the character lifts
and scales up, and the floor glow pulses.

Hue alone is not a signal anyone can rely on — it fails for anyone who does not
separate the colours, and this mascot's own vocabulary is already colour-coded,
so amber alone risks colliding with a state that already means something else.
Colour is reinforcement; the transform carries the signal.

## Boundaries

This module consumes `selectState`, `escalates` and `Mascot` unchanged. Neither
the mascot library nor state selection gains a requirement or a code path from
this work, and neither imports anything from here —
`test/roundtrip.test.tsx` and `test/dev-harness-isolation.test.ts` hold that.

Nothing here reaches for a window, a socket or a transport. `agent-relay` owns
the transport; this owns what the user sees and what a decision applies to.