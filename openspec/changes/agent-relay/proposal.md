# Proposal

## Why

The companion has nine states, a reduction that decides which one applies, a surface that
knows when to escalate, and a decision round trip. It learns nothing, because nothing feeds
it. Every session it knows about is one a caller handed it.

What is missing is the thing that turns a mascot into a companion: the host agent's own
event stream arriving on its own. A user starts a session in their terminal and the
companion should already know — without being told, without a window being opened first.

This is also the most verifiable piece of the remaining work. It is pure transport with no
window and no platform behaviour, so it can be built and proven end to end on the machine
it is being written on.

## What Changes

- A relay process invoked by the host agent, which reads the agent's hook payload and
  forwards it to the companion over a local channel, then exits.
- **The relay translates nothing.** It reads a payload, delivers it, and exits. Every
  translation from a host's event names to the canonical vocabulary stays in the companion,
  where the adapter already exists and is tested. A relay that translated would mean the
  adapter contract has two implementations, one of which nothing exercises.
- Deliver the companion's canonical event source from a caller-supplied value to a live
  host stream.
- Install the relay's hooks, backing up the agent's configuration first, showing the
  proposed change before writing it, and leaving the existing file intact when the user
  declines.
- Specify the local channel rather than improvising one, because it is a contract with
  security weight — who may connect, what happens to a stale channel — and because the
  later decision transport will reverse the same channel.

### Explicitly out of scope

- **Blocking hooks, approvals and the fail-open invariant.** Those are
  `decision-transport`, deliberately separate: if the companion is unreachable, blocking
  hooks must either hang the agent or decide for it, and both answers are bad enough to
  deserve their own change, written last by someone with nothing else left to do.
- The native window and capability reporting — `app-shell`.
- Other host agents. The adapter boundary exists so a second one adds a file, and v0.1 has
  exactly one.

## The intermediate state this produces

After this change the companion watches: a session started in a terminal appears on its
own, the mascot reflects it, and a blocked session surfaces the escalation without anyone
telling the surface about it. Approving from the surface is not yet possible.

That is a real milestone and it is deliberately shippable in that form — *watches*, then
*unblocks*.

## Capabilities

### New Capabilities

- `agent-relay`: the relay process, the local channel between it and the companion, and
  the installation of the host agent's hooks.

### Modified Capabilities

- `mascot-state-selection`: sessions are now sourced from a live host event stream rather
  than supplied by a caller. The reduction, the precedence rules, the classification and
  the escalation rule are all unchanged — only where sessions come from changes.

## Impact

- New relay program, invoked by the host agent, and the channel it speaks over.
- `src/state-selection` gains the wiring that feeds a host stream into the reduction. No
  requirement of `mascot-state-selection` changes, and its reduction is untouched.
- The host agent's configuration file is read and, on approval, written. It is backed up
  first and the proposed change is shown before anything is written.
- No new runtime dependency for the companion. The relay is a separate program with its own
  toolchain.
- Development-only tooling is not affected; the existing harness continues to drive the
  surface without a host.