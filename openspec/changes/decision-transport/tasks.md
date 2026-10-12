# Tasks

## 1. The waiting program

- [ ] 1.1 Scaffold `ask/` as a Rust crate with no dependencies beyond `libc` on Unix, and verify the built binary links nothing that has to be installed
- [ ] 1.2 Read the payload from standard input and bound it, and verify an unreadable or empty input produces no output and a successful exit
- [ ] 1.3 Generate a request id rather than reading one from the payload, so the host's vocabulary does not come to exist in this program
- [ ] 1.4 Derive the companion's address with the same rule the relay uses, and verify both programs agree by building both and comparing what each resolves to
- [ ] 1.5 Open the channel, announce the request, and wait for a reply on a thread that is not the one that enforces the deadline
- [ ] 1.6 Enforce the deadline in the program making the host wait, and verify that with a companion that never answers it exits at its bound
- [ ] 1.7 Print the host's documented permission-decision shape for an allow and for a deny, and verify the bytes on standard output are what the host would parse
- [ ] 1.8 Print nothing and exit successfully on every failure path — absent companion, unopenable channel, unreadable input, broken exchange — and verify stdout is empty rather than merely parseable
- [ ] 1.9 Verify a timeout produces no decision at all rather than a refusal, because a deadline that denies is a denial the user never made

## 2. The channel's reply

- [ ] 2.1 Add a request/reply mode to `src/relay/channel.ts` as a separate entry point, leaving `listen` and its callback semantics untouched
- [ ] 2.2 Verify every existing channel test passes without being edited — a change here rather than an addition is the signal that the boundary did not hold
- [ ] 2.3 Apply the same user-only barrier to the reply path, and verify the reply is bound to the request that opened the connection
- [ ] 2.4 Verify a reply larger than the payload bound ends the exchange without delivering a partial decision

## 3. The companion's half

- [ ] 3.1 Derive a pending request from the payload the companion already receives, through the existing adapter, with no new event vocabulary
- [ ] 3.2 Present the request through the existing surface, offering the operation and the session in terms the user can decide on without leaving the window
- [ ] 3.3 Apply the answer through the existing `decide` rule rather than a second implementation, and verify an answer for a request that is no longer pending is refused and decides nothing else
- [ ] 3.4 Send the answer back on the connection that opened the request, in the host's decision shape, and verify a surface whose answer is never sent leaves the host unaffected
- [ ] 3.5 Discard a request when its session resolves or moves on, and verify no later answer is applied to whatever is pending at the time

## 4. Installing the wait

- [ ] 4.1 Install the blocking hook alongside the non-blocking ones through the existing consent path, and verify nothing is written without an explicit request
- [ ] 4.2 Show both hooks and both programs in the proposed diff before writing, and verify declining leaves the file exactly as it was
- [ ] 4.3 Make the blocking hook removable on its own, and verify uninstalling it leaves the non-blocking hooks as they were
- [ ] 4.4 Verify neither hook is installed as a side effect of starting the companion

## 5. Keeping it a pipe

- [ ] 5.1 Add a test that reads `ask/`'s source and asserts it names no host event, no mascot state and no session field, so a second implementation of the host's vocabulary cannot be added quietly
- [ ] 5.2 Add a source-shape assertion that the relay's own guarantees are untouched, so weakening "never waits" is a visible act rather than a drift
- [ ] 5.3 Verify `src/state-selection` and `src/components/mascot` gain no requirement and no code path from this change, and that neither imports anything from `ask/` or the companion runtime

## 6. Verification and record

- [ ] 6.1 Write `scripts/decision-integration.ts` — a real `ask` binary, a real channel, a real companion, asserting the host's decision bytes end to end, and reporting rather than asserting the model's exit status
- [ ] 6.2 Record in the README which failure paths were measured and which were reasoned about, including that a real Claude Code run is unverified until someone runs it
- [ ] 6.3 Run the full suite and record the count, and confirm the relay's own tests are unchanged from before this change
