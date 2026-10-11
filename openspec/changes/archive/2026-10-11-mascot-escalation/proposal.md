# Proposal

## Why

`mascot-rig` renders nine states. `mascot-states` decides which one. Nothing yet reaches
the user, so `needsYou` — the only state in the vocabulary that exists to be acted on —
cannot be acted on. The product's promise ("unblock a blocked agent without going to the
terminal") has no mechanism behind it.

The mechanism is also not the one originally assumed. An empirical spike established that
a floating always-on-top surface **cannot be made to float on GNOME Wayland**: the
compositor controls stacking for Wayland clients, and without the layer-shell protocol
there is no way to ask to be raised. A request to stay on top is accepted and ignored —
the surface sits above other windows only while it holds focus, and falls behind the
moment the user looks elsewhere.

## What Changes

- Add the escalation surface: what the user sees, when they see it, and what it looks
  like.
- **Platform-conditional visibility, and this is the central design decision.** Where the
  platform can keep a persistent surface above other windows, the companion is always
  present and glanceable. Where it cannot, the surface exists only while something is
  actionable, and appears when that happens.
- The second form is not a degraded fallback. It is the attention-routing rule taken
  literally: a surface that is invisible unless it has something actionable, and which
  takes focus only at the moment the user asked to be interrupted. On those platforms it
  is arguably the purer expression of the design.
- Add the approval round trip: the pending request is shown with enough context to decide
  it, exactly two decisions are offered, and the decision is applied to the exact request
  it was made for.
- Surface size follows the content and the stylesheet, never a requested window size. The
  spike found requested sizes are not reliably honoured, and the same request was
  answered with different dimensions on the two rendering paths.
- Honour the existing escalation rule: a block the companion cannot resolve never
  presents a card, so the surface never calls the user to a dead end.

### Explicitly out of scope

- The notch, per-session mascots, other agents, agent-question answering, a settings
  window, motion beyond a crossfade and one idle breathe.
- **"Always allow"** — writing an allowlist is a permissions-policy decision with its own
  review, not a companion feature. Two decisions only.
- A queue of pending approvals. Where more than one session is blocked, the longest-waiting
  is offered; the rest wait their turn and are not shown.

## Position in v0.1

v0.1 is: **a companion that watches your Claude Code sessions and lets you unblock a
blocked one without going to the terminal.** This change is the third piece, following the
character (`mascot-rig`), the state reduction (`mascot-states`) and the development harness
(`dev-harness`).

What remains is three changes, ordered so each is verifiable where it is built rather than
where it cannot be:

- `agent-relay` — the hook binary and the socket that turn a host's event stream into
  sessions. Pure logic, testable here with no window.
- `app-shell` — the native window that mounts the surface and publishes the capability
  report this change reads. Its only real test is a human on real hardware, so it waits
  until there is one.
- `decision-transport` — decisions back to the host, and the fail-open invariant. Last,
  because it is the security-relevant piece and it should be written by someone with
  nothing else left to do.

## Capabilities

### New Capabilities

- `escalation-surface`: what the escalation surface is, when it is visible, and how its
  visibility differs by platform capability.
- `approval-roundtrip`: presenting a pending agent request, capturing the user's decision,
  and applying it to the exact request it was made for.

### Modified Capabilities

None. `mascot-rig` owns the rendering contract and `mascot-states` owns which state is
selected; both are consumed unchanged. This change is the first to read a state and act on
it, and neither gains a requirement.

## Impact

- New modules owning surface presentation and the pending-decision flow. These consume
  `selectState` and `escalates` from `mascot-states` and `Mascot` from `mascot-rig`;
  neither gains a requirement or a code path through this work.
- Platform capability is detected at runtime and decides visibility. Detection is a
  concern of this change alone.
- The pending-decision model is the interface the transport will later deliver decisions
  through, so its shape is fixed here deliberately. That transport is split: `agent-relay`
  carries events and decisions, and `decision-transport` owns the fail-open invariant.
- No new runtime dependency. **This change does not introduce an application shell** —
  it was written assuming one would arrive here, and it did not. What ships is a
  browser-testable surface module: the visibility rules, the capability probe, and the
  decision round trip. Nothing is mounted in a native window yet.

  The consequence is concrete. The capability probe reads a protocol report that a native
  host publishes, and nothing in this repository writes it, so
  `canHoldPersistentSurface()` returns `false` everywhere today. That is the correct
  answer for a plain browser document and the safe failure direction, but it means only
  the escalate-only branch is reachable until a shell exists — the ambient companion is
  currently observable only through the harness's `?platform=persistent` override.

  Creating that shell is deliberately **not** folded in here. A throwaway window built now
  would be replaced by the one the transport work needs, and the shell's only real test is
  a human eye on real hardware, which is a different kind of change with a different test
  strategy. It is scoped separately, as `app-shell`.