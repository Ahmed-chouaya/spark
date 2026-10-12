# Design

## The problem, stated as a hazard

Every other program in this repository fails by drawing a wrong picture or saying a wrong
thing. This one can make a user's coding agent stand still. That is a different order of
consequence: a wrong mascot is a bug report, a stalled agent is a lost afternoon and a
loss of trust in the tool.

So the design question is not "how do we return a decision". It is: **what is the smallest
thing we can add to the host's critical path that cannot become the host's problem?**

## The answer is a second program, not a mode of the first

`relay/` has a load-bearing property: it never waits. That property is enforced from three
sides — the module's own prose, `test/relay-shape.test.ts` which reads the Rust source and
fails if `sleep`, `timeout`, `spawn` or `Duration` appear, and a behavioural test that
delivers to a companion that never reads and asserts the relay exits anyway.

A mode flag on the relay would put every one of those at risk. `spark-relay --wait` is a
branch, and a branch is where "never waits" quietly stops being true — and the failure is
invisible precisely because the default path still behaves.

So `ask/` is a separate crate. The relay's guarantees are untouched, its tests keep passing
unchanged, and the program that can make a user wait is named after the fact.

## Why no dependencies, again

Same reason as the relay, and it is worth repeating because the temptation is worse here:
this program is *on the critical path*, so a start-up cost is felt immediately and a start-up
failure is felt as "my agent is broken".

It needs the same one thing the relay needs — reach the companion's address — and it gets
it the same way, by the same duplicated rule, because it cannot share code across languages
any more than the relay could. `test/decision-address.test.ts` compares the two answers by
building both binaries, for the reason `test/relay-address.test.ts` documents.

## The exchange

```
  Claude Code ──hook──> spark-ask
                          │
                          │ 1. read payload from stdin
                          │ 2. generate a request id          <- NOT read from the payload
                          │ 3. connect to the companion
                          │ 4. send { id, payload }
                          │ 5. wait for a reply, up to the deadline
                          │
                          ├─ reply arrives ──> print the host's decision shape, exit 0
                          │
                          └─ deadline / any failure ──> print nothing, exit 0
```

**Step 2 is the load-bearing design decision.** The request id is *generated*, not
extracted from the host's payload. Extracting it would mean reading `tool_use_id` — which
is the host's vocabulary, in a second program, which is the duplication this project has
spent its whole adapter boundary avoiding and which `test/relay-shape.test.ts` exists to
prevent.

Generating it costs nothing and keeps the wall intact. The companion learns the
correspondence because both sides can see the frame: the ask program says "this opaque
payload is request X", and the companion interprets the payload with the one adapter that
already exists. Neither side needs to know what the other meant by it.

## The deadline, and who owns it

The wait is bounded, and the bound is enforced by `spark-ask` — the process that is making
the host wait — never by the companion. That ownership is the point. If the bound lived in
the companion, then a hung companion would hold a user's agent hostage indefinitely, and
the one component with the most ways to hang is the one holding the leash.

A separate thread does the waiting so the main thread can enforce the deadline without a
complicated select loop. When the deadline passes, the process prints nothing and exits 0.

**What is printed on timeout: nothing.** Not `deny`, not an empty decision object. This is
the fail-open invariant in its sharpest form.

- Print nothing → the host proceeds with its own behaviour, which for a permission request
  is to ask the user in the terminal. Exactly what would have happened with no companion.
- Print `deny` → the tool is refused. The user did not refuse it. We did, on their behalf,
  because they were slow. A timeout that denies is a denial the user never made, and it
  would be indistinguishable from one.

The same reasoning covers every other failure: absent companion, unopenable channel,
unreadable stdin, broken exchange. All of them produce no output and exit 0. **The exit is
always a success**, because an exit status the host reads as a hook failure is itself a way
of harming the user's agent.

The one thing that is *not* fail-open is anything to do with a decision that was actually
made. A decision is either delivered correctly or refused as stale; it is never dropped
and replaced with something else. That asymmetry is deliberate: uncertainty about whether to
wait fails open, and uncertainty about *what the user decided* fails closed.

## A late answer is discarded

After the deadline the process is gone, so a late reply has nowhere to go. On the companion
side, the request is removed when it is resolved or abandoned, and `decide()` in
`src/escalation/pending.ts` already refuses an answer for a request that is no longer
pending. This change wires the existing rule to the transport rather than reimplementing
it — the identity rule is the UI's half of a security boundary and it does not move.

## Where the reply is shaped

`spark-ask` prints the host's documented permission-decision shape and nothing else. The
companion translates the two answers into that shape; `spark-ask` does not know it, and
does not need to, because it passes the reply through as bytes once it has confirmed which
request the reply is for.

This keeps the same boundary the whole project has: the host's output vocabulary is
interpreted in one place, next to the input vocabulary, and the Rust programs are pipes in
both directions.

## The channel gains a reply, additively

`src/relay/channel.ts` currently moves bytes from the relay to a callback and knows nothing
else. A reply needs the connection held open and a response written back, which is a new
capability rather than a change to the old one.

The design constraint is that **nothing about the existing path changes**. `listen()` keeps
its callback semantics; the new mode is a separate entry point. Every test over the
one-way path — including the 24 in `test/relay-install.test.ts` and the channel guards
pinned by source shape — continues to pass without being edited. If any of them needed
changing, this would have been a modification rather than an addition, and that is the test
for whether the boundary held.

The same user-only barrier applies to the reply path. A reply is a decision about what
someone's agent may do; it is the most sensitive thing this channel will ever carry, so the
`0700` directory and `0600` socket are not enough on their own and the reply is bound to
the request id that opened the connection.

## Installing it

`installHooks` gains the blocking hook alongside the non-blocking ones, and the proposal
diff shows both. The consent model does not change: nothing is written without an explicit
yes, the previous file is backed up, and the hooks are identified by the command they run
so uninstall is surgical.

The blocking hook is uninstallable on its own. A user who wants the mascot without the
wait — because they would rather answer in their terminal, or because they are working on
something where a stalled agent is worse than no mascot — should be able to have exactly
that, and asking them to also lose the mascot would be the wrong trade.

## Testing it

**The wait's behaviour is testable here and is where most of the testing is:**

- The companion absent: the ask program returns immediately, and *immediately* is the
  assertion — a test that only checks "returned" passes a program that slept first.
- The deadline: with a companion that never answers, the ask program exits at its bound and
  prints nothing. Tested with a real child process and a real clock, because a mocked timer
  tests the mock.
- Every failure path exits 0 with empty stdout. Asserted on the bytes, since "prints
  nothing" and "prints an empty line" are different to a host parsing JSON.
- A decision delivered: end to end, real `ask` binary, real channel, real companion, and
  the host's decision shape asserted on the bytes it would receive.
- The fail-open asymmetry: a timeout must *not* produce a refusal. Asserted by checking
  stdout is empty rather than that it parses as something deny-ish.
- Structural: `test/ask-shape.test.ts` reads the Rust source and fails on host vocabulary,
  mascot states, and any wait that outlives its bound — the same three-sided enforcement the
  relay has.

**Not testable from here, and said so:**

- Real Claude Code actually blocking on the hook and honouring the printed decision. That
  needs `claude` installed and a model call, and it is the one check that would prove the
  format is right rather than plausible. `npm run verify` does not run it;
  `scripts/decision-integration.ts` does, and it is the command to run on the Windows box.
- What a user perceives as "too slow". The deadline is defensible but it is a judgement
  about wall-clock, and the only honest evidence is someone using it.
