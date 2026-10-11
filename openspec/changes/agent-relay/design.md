# Design

## Context

See `proposal.md` for motivation and the two spec files for requirements. Two things shape
the approach: the companion already knows how to interpret a host agent, and this change is
the last piece that can be fully verified without a window or a second machine.

`src/state-selection/adapters/claude-code.ts` already translates the host's hook payloads
into the canonical event set, and `test/adapter.test.ts` already exercises it. Everything
here is arranged so that stays the only place a host is interpreted.

## Goals / Non-Goals

**Goals:**

- A session started in a terminal reaches the companion on its own.
- The relay is incapable of harming the host, by construction rather than by care.
- The channel is specified, because `decision-transport` will reverse it.

**Non-Goals:**

- Blocking hooks, approvals, and what happens when the companion is unreachable during one.
  Those are `decision-transport`.
- The window and capability reporting. That is `app-shell`.
- A second host agent.

## Decisions

### The relay is a pipe, not an interpreter

The single decision everything else follows from.

```
 host agent fires a hook
        |
        v
   relay:  read stdin  ->  write to the channel  ->  exit
        |                    (no parsing, no naming, no translating)
        v
 companion:  adapter translates  ->  canonical events  ->  reduction  ->  state
```

If the relay interpreted anything, the host's vocabulary would exist twice: once in
`claude-code.ts`, tested, and once in the relay, not. Two implementations of one contract,
one of which nothing exercises, is how a contract quietly rots — the exact failure the
adapter boundary was introduced to prevent.

It also makes the relay trivially auditable. Thirty lines that move bytes are reviewable in
a way that a second interpreter is not.

*Alternative considered* — translate in the relay so the companion sees canonical events
directly. Rejected for the reason above.

### Rust for the relay, and the reason is deployment rather than speed

The relay has to be invocable by the host agent as a bare command. That makes its runtime
dependencies a correctness concern, not a preference: **a relay that cannot start breaks the
host's hook configuration**, and the user discovers it as their agent failing rather than as
a companion problem.

A single static binary has nothing that can fail to resolve. A Node relay depends on a
runtime being found from whatever environment the host spawns hooks in, which is not
guaranteed to be the developer's shell.

The toolchain is also not an extra cost: `cargo` is already present on the development
machine, and Tauri needs it for `app-shell` regardless.

*Alternative considered* — a Node relay, sharing the project's language and toolchain.
Genuinely faster to write, and a defensible choice if the relay were part of the companion
process rather than a separate program. It is not: it is invoked by another program.

*The pipe decision is what makes this swappable.* A Node relay is a small substitution
because nothing above the pipe boundary changes.

### Fail-open falls out of being a pipe

The relay writes to the channel and exits. It never waits for an acknowledgement. So there
is no branch in it where "the companion did not respond" can become "the host was failed" —
the relay has already exited.

That is the entire fail-open property for non-blocking events, and it is structural rather
than defensive. It is also why blocking hooks are excluded: a blocking hook *must* wait for
a response, which reintroduces the branch, which is why it gets its own change.

### One documented address, derived from the owning user

Unix domain socket on Linux, named pipe on Windows, at a path derived from the user's own
identity so two users cannot collide and one user's companion cannot be reached by another.

The address is fixed by convention rather than negotiated, because a negotiation step is
another thing that can fail at the worst moment. Both sides derive the same address
independently and neither tells the other anything.

### Stale channels are replaced, not refused

A crash can leave a socket behind, and a companion that refuses to start because of it is a
companion that needs manual intervention to recover — the opposite of what this product is
for. The companion takes ownership of the address when it starts.

The residual risk is that a *live* other process owns the address. It is bounded rather than
eliminated by requiring ownership to be the current user, which is the same requirement the
channel has anyway.

### Hooks are installed deliberately, and the diff comes first

The host's configuration is user state that the user did not ask us to write. So: nothing is
installed until asked; the proposed change is shown before it is made; the previous file is
kept; existing hooks survive; installing twice does not duplicate.

This is the least novel part of the change and it is the part with the most user-visible
consequence if it is wrong, which is the argument for spending tasks on it.

### The non-blocking milestone is worth shipping on its own

After this change the companion watches: a session appears by itself, the surface reflects
it, a block escalates without anyone wiring it up. Approving is not possible yet.

It is tempting to add the blocking hook here because the round trip is already built and it
would complete the story in one change. The reason not to is that the blocking path is the
only place where a bug can *harm the user rather than merely disappoint them* — a hang, or a
decision made on their behalf. That deserves a change whose only job is to get it right.

## Risks / Trade-offs

**A second implementation of the host vocabulary appears anyway** → Pinned by a requirement
that the relay delivers the payload unaltered, and by a test that reads the relay's source
rather than its behaviour, since this is a property of shape.

**The relay becomes the least-tested part of the system** → It is the part with the least
logic, and a test that starts it, feeds it a payload, and asserts it exits is short. The
risk is that it gets no test at all because it looks too simple; the tasks require one.

**The channel is specified before anything reverses it** → `decision-transport` will send
decisions back over the same address. Specifying it now means that change inherits a
contract rather than inventing one, but it also means a wrong choice is discovered later.
Accepting the later cost, because the alternative — an unspecified channel — is worse.

**Host configuration could be damaged** → Backed up, shown before writing, declined changes
nothing, existing hooks preserved. Each of those is a test rather than an intention.

**Nothing here is verified against a real host agent until the relay is installed** → True
and unavoidable. The adapter is tested against payloads shaped from the host's documented
hook format; the first real invocation is the first real proof. Worth doing early and
cheaply on this machine, which needs no window.

## Migration Plan

Removing hooks restores the host to its prior configuration, and the backup is retained. The
companion without the relay remains fully functional for a caller supplying sessions, so the
relay can be uninstalled without affecting anything already built.

## Open Questions

None.

Deferred — blocking hooks and the fail-open invariant (`decision-transport`), the native
window and capability reporting (`app-shell`), and a second host agent — are separate
changes that do not alter the requirements or the pipe decision here.