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

`canHoldPersistentSurface` reads one report from the host: **which question was
asked**, and **what it answered**.

Each platform is asked something it can answer about itself:

| | Question | Why this one |
|---|---|---|
| Wayland | did the compositor bind a layer surface to this window? | the compositor owns stacking for its clients, and the layer protocol is the only way into a stack of its own |
| Windows | is the topmost style bit set on this window's real handle? | the kernel's record of a real window, not a flag this host set |
| macOS | is this window's level a floating level? | the window server's record of a real window |

It used to ask all three the same question — did the compositor grant
`zwlr_layer_shell_v1` — which is the right question for a Wayland compositor and
a meaningless one for the other two. They have no compositor and no protocols, and
will never grant a Wayland protocol to anything. The empty answer that produced
was true, and reading it as "no platform can float" was the bug: it cost the
persistent companion on Windows 11, where it demonstrably works.

The report names the mechanism as well as the answer so it can be audited. A
reader seeing `windows-topmost` knows which question produced the boolean. A list
of protocol names on a platform that has no protocols would be a lie about the
kind of thing in it, and the next reader would reasonably ask what protocol that
is.

So the capability is read from **what the platform itself states**, never from an
OS name, a desktop environment, or a build flag. Each of those is a proxy for the
property, and every proxy is wrong somewhere.

**The runtime offers `is_always_on_top()` and this does not use it.** On Linux it
returns an `AtomicBool` the host set; on Windows a flag the host set; on macOS a
genuine query. A read-back of our own request is the host's own request with a
different name, and it is *named* like a verification, which is why it survives
review. macOS is the one platform where it would be correct and it is still not
used: a guard with a per-platform exception is a guard with a hole in it.

The failure direction is chosen: an unreadable host, a host that answered no, and
a host that could not ask all report escalate-only, which is the behaviour that
works everywhere. "The platform said no" and "no platform could be asked" both
escalate but stay distinguishable, because the first is a fact about the platform
and the second is a fact about the host.

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
| Fedora GNOME, Wayland | GNOME Mutter | asked `wayland-layer` → `false` | absent unless blocked | Does not implement the layer protocol at all; not planned to. Escalating surface stays above other windows only while it holds focus. |

### Not yet observed

The **persistent-surface path on a platform that reports holding the surface**
has not been run by this shell. Everything about it — that the surface really
does stay above unfocused windows, that the platform keeps it there, that it
survives a workspace switch — rests on a report the code now asks for and on the
hand observation recorded in `docs/platform-findings.md`, not on a run.

Run `npm run probe:capability` on such a machine and record what it finds here
before claiming that branch works. The capability check and the visibility rules
are covered by tests; what is not covered is the platform honouring a surface it
has agreed to hold.

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