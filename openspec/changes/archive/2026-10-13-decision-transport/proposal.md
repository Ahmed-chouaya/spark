# Proposal

## Why

The decision surface exists, renders, and offers two answers. Pressing one does nothing,
because nothing carries it back. This is the last gap between "the companion can show you
that it is blocked" and "the companion can unblock it".

It is also the most dangerous change in the project, and it is dangerous in a way nothing
else here is. Every other component fails by being wrong about a picture. This one runs
inside the user's agent, on the critical path of a tool call, and can make their agent
wait. The entire design problem is: **how do you add a wait to someone's agent without
ever making it their agent's problem?**

## What Changes

- A second Rust program, `spark-ask`, installed as a **blocking** hook. It announces a
  pending request to the companion, waits for an answer, and prints the host's own
  permission-decision format on standard output.
- The companion derives a pending request from the hook payload it already receives — the
  same payload the non-blocking relay delivers — so no new event vocabulary is introduced.
- The channel gains a request/reply mode. It is additive: the one-way path the relay uses
  is untouched, and `test/relay*.test.ts` continue to pass unchanged.
- A decision made on the surface travels back down that reply and is printed in the format
  the host reads. This completes the round trip in `openspec/specs/approval-roundtrip`.
- Every failure mode of the wait fails **open**: the host is told nothing, immediately or
  at the deadline, and proceeds with whatever it would have done had the companion not
  existed.

**Not in this change:** any persistent permission. The surface offers Allow and Deny and
nothing else, and `test/decision-surface.test.tsx` holds that. Writing a lasting permission
edits the user's agent configuration and is a policy decision with its own review.

## Capabilities

### New Capabilities
- `decision-transport`: the blocking wait — what it announces, how long it waits, what it
  prints, and the fail-open invariant that governs every path through it.

### Modified Capabilities
- `agent-relay`: one requirement changes. "The relay never blocks the host" is about
  `spark-relay`, and it stays true — but the companion now has a second program installed
  as a hook, so the spec has to say that the non-blocking guarantee belongs to that program
  specifically and does not extend to the other one.
- `approval-roundtrip`: no requirement changes. This change makes its existing
  requirements reachable; it does not alter what they say.

## Impact

- **New**: `ask/` — a second Rust crate, no dependencies beyond `libc` on Unix, for the
  same reason `relay/` has none.
- **Modified**: `src/relay/channel.ts` — gains a reply mode. The existing listen path and
  every test over it are unchanged.
- **Modified**: `src/relay/install.ts` — installs the blocking hook. It still asks first,
  still shows a diff, and still backs up. It now installs two programs rather than one, and
  the diff has to show both.
- **New**: `src/companion/` — the runtime that turns a received payload into a pending
  request and a decision into a reply.
- **The risk, stated**: this adds a wait to the user's agent. Everything about the design
  follows from wanting that wait to be invisible to a user who has not asked for it.
