# Relay

How the companion learns about live host-agent activity: a local channel, a
relay process the host invokes, and the installation of that host's hooks.

```
  host agent fires a hook
        |
        v
   relay:  read stdin  ->  write to the channel  ->  exit
        |                    (no parsing, no naming, no translating)
        v
 companion:  adapter translates  ->  canonical events  ->  reduction  ->  state
```

## The relay is a pipe

`relay/` is a Rust program of about sixty lines that move bytes. It is Rust
because the host agent invokes it as a bare command, which makes its runtime a
correctness concern rather than a preference: a relay that cannot start does not
look like a companion problem, it looks like the user's agent failing.

It reads standard input, writes it to the channel, and exits. There is no parsing
and no field names, and there will not be one added.

**It translates nothing**, because the host's event names already have one
implementation — `src/state-selection/adapters/claude-code.ts` — which is written
and tested. Translating in the relay as well would mean the host's vocabulary
exists twice: once where it is exercised, and once where nothing runs it. The
untested copy is the one the host agent actually depends on.

**It never waits**, because it writes and leaves. There is no read after the
write, no acknowledgement and no timeout, so there is no branch in which "the
companion did not answer" can become "the host agent failed" — the process is
already gone before such a branch could matter. Every exit is a success,
including every failure: no companion running, no channel, unusable input.

Both claims are enforced from both ends. They are argued at the top of
`relay/src/main.rs`, where an editor meets them before deciding what to change,
and `test/relay-shape.test.ts` reads the source and fails if a name from either
vocabulary appears in it. Behaviour tests cannot catch a second implementation
here: a relay that emitted canonical events would satisfy every functional test
while quietly creating exactly the thing this design rules out.

## The channel

```
  unix     /tmp/spark-<uid>/companion.sock
  windows  \\.\pipe\spark-<username>-companion
```

Derived from the owning user's identity, and fixed by convention. Nothing is
negotiated: both sides derive the same answer independently and neither tells the
other anything. A negotiation step is another thing that can fail at the worst
moment.

The Unix root is a constant rather than `XDG_RUNTIME_DIR`, because the relay is
spawned by the host agent in an environment it does not control. That variable is
set by a session manager and inherited by whatever the agent happens to start; it
is absent under some launchers. A derivation that reads it is one whose two
halves can disagree, and that disagreement is silent.

Only the owner may connect, and two barriers are needed because each covers what
the other does not:

- the holding directory is `0700`, so nobody can traverse into it — which is
  also what makes the identity in the path not the only thing keeping users
  apart;
- the socket is `0600`, because the OS creates it with the process umask applied
  and a permissive umask would leave it connectable by anyone who had the path.

A channel left behind by a crash is replaced rather than refused, since a
companion needing manual intervention to recover is the opposite of what this is
for. "Takes ownership" is precise: it removes what is at the address **only when
that entry belongs to this user**. Removing another user's entry to win a race
would be the one thing here that could reach across users.

## The address rule exists twice

`src/relay/address.ts` and `relay/src/address.rs` are two implementations of one
rule, in two languages. That is the duplication this project has spent its
adapter boundary avoiding, and it is here for a stated reason: the relay has to
run with no runtime and no installed package, and there is no way to satisfy that
and share code with a TypeScript companion.

`test/relay-address.test.ts` builds the binary and delivers a payload to the
address the TypeScript derives, so the two answers are compared rather than
trusted. If they ever disagree the companion goes silent, and nothing else would
report it.

## Installing

```
npm run relay:install -- --dry-run   show the change, write nothing, ask nothing
npm run relay:install               show it as a diff, ask, then do as told
npm run relay:install -- --yes      do it without asking
npm run relay:install -- --wait     also install the hook that waits for an answer
npm run relay:uninstall             take the non-blocking hooks back out
npm run relay:uninstall:wait        take out only the hook that waits
```

The two removals are separate commands, and the difference is the whole reason
they are two: "remove the wait" and "remove everything" are different things a
person can mean, and one command with an optional mode makes the second quietly
become the first whenever it is handed both. `relay:uninstall` says on the way out
that the waiting hook is still installed; `relay:uninstall:wait` says the mascot
is still installed.

Both remove only the entries that run this project's programs, and neither
restores a backup — restoring would throw away edits made since installing. The
copy taken before the first install stays at `~/.claude/spark-backups/`.

`~/.claude/settings.json` is user state the user did not ask us to write, and it
is the file that decides whether their agent runs. So planning and writing are
separate calls: `planHooks` is a pure function returning the proposed bytes and a
diff, and `installHooks` is the only thing that writes. Consent is asked in the
type rather than defaulted in a caller that forgot, and anything that is not an
explicit yes declines — including an empty answer, a closed input and an error.

What gets installed is the seven events the Claude Code adapter already models,
and no others: a hook for an event the adapter does not translate would cost the
user a process spawn per occurrence and be discarded on arrival. Each is an
exec-form command hook with no arguments, so the relay is spawned directly with
no shell to tokenise a path and none to go missing at hook time.

Hooks already in the file survive — they are identified by the command they run,
so only entries invoking the relay are added or removed. Uninstalling is surgical
rather than a restore, so edits made since installing are not thrown away, and
the backup in `spark-backups/` is kept either way.

## Which path the hook names

An installation's, not a checkout's. `src/relay/binary.ts` owns both answers —
where the build puts the two programs, and where an installed companion keeps
them — and `resolvePrograms` prefers the second: the directory beside the
window's own executable, or the `resources` directory a packaged install keeps
them in. The build output when there is no installation, which is what a
developer has before a full build.

That preference is the whole point. A hook carries an absolute path, and an
absolute path into a clone works only while the clone stays exactly where it is;
when it moves the hook fails once per event, silently, because a hook that fails
is indistinguishable from an agent with nothing to report. Resolving against the
installation means the answer travels with the files it names.

`npm run relay:install` prints which answer it used before it prints the diff,
and `npm run doctor` reports both — so "it installed the wrong one" is answerable
without reading any of this.

## Out of scope

- **Blocking hooks, approvals, and the fail-open invariant under one.** Those are
  `decision-transport`. A hook that must wait for a response reintroduces the
  branch this design removes, which is why it gets its own change.
- **The window.** That was `app-shell`, and it is now `shell/`: `npm run
  companion` opens a window and the reduction is drawn on it. The relay is
  unchanged, and it still writes bytes and exits — the shell reads them and hands
  them on unchanged, which `test/shell-channel.test.ts` checks over a real socket.
- **A second host agent.** It is one more file in `src/state-selection/adapters`
  and no change anywhere else. The adapter boundary is what makes that true, and
  it was true before the relay existed.

## Observed behaviour

Recorded per machine, because "which behaviour did I get" is only meaningful next
to the machine that produced it. Do not carry a machine's answer forward to
another.

| Machine | Companion | Relay | Host agent |
|---|---|---|---|
| Fedora 44, GNOME Wayland | `/tmp/spark-<uid>/companion.sock`, no window | 300 KB ELF, links only the C runtime | Claude Code 2.1.296, hooks fire for `-p` and interactive sessions alike |

### Verified on this machine

Run with:

```
npx vite-node scripts/relay-integration.ts
```

- The real agent fired `SessionStart` and `UserPromptSubmit`, both reached the
  companion with nothing supplied them, and the reduction rendered `thinking`.
  This is the first real invocation of the relay and the first real proof of it.
- A relayed authorisation request produced a session in `needsYou` with
  `block: "authorization"`, which the surface escalates.
- No decision card was offered for it, and that is the documented edge of this
  change: a pending request says what the agent wants to *do*, a hook payload
  never does, and `decision-transport` is what completes the round trip.
- With the companion stopped, the real agent fired real hooks and surfaced
  nothing from the relay, was not delayed, and nothing reached state selection.
- Uninstalling restored the settings file byte for byte, with the backup intact.

The run installs into a **project-scoped** settings file in a scratch directory
rather than `~/.claude/settings.json`, so the install is real without the check
writing to the user's own configuration. `--no-agent` skips the one step that
makes a model call.

### Not verified here

- **The interactive terminal session.** A `-p` run exercises the same hook
  machinery, but a session started in a terminal and watched on a surface has not
  been. It needs someone looking at the window, and `shell/README.md` records
  that nobody has yet on any platform.
- **The companion stopped while the host was already running.** The companion
  takes over its own address on start; what happens to a host agent that is
  mid-turn when it stops has not been observed.

### Verified on Windows

Measured on a Windows 11 machine, running the suite against a release build:

- The named-pipe channel carried a payload end to end, and the suite's address
  rule agrees on both platforms: `\\.\pipe\spark-<name>-companion` there,
  `/tmp/spark-<uid>/companion.sock` here. Both spellings come from one function
  and one Rust branch, compared rather than trusted.
- `test/relay.test.ts` ran the real binary and the real interpreter-free claim
  against it: the process started with an empty `PATH`, no `NODE_PATH` and no
  `node_modules` above it, and delivered.
- The import table was read and every entry checked against the system directory
  rather than against a list, so a build that vendored anything would fail.
- A real bug was found and fixed from this: `ensurePrivateDirectory` had no
  `win32` guard, so it would have called `mkdir` on the `\\.\pipe` device
  namespace. It is guarded now, and pinned by tests that read the source —
  because a Windows-only defect cannot be reached by running the suite on Linux,
  which was proved by removing the guards and watching seven tests still pass.

Two things that could not be checked from a Linux machine were wrong anyway, and
are now pinned structurally rather than by running them:

- **The built binary's name.** `target/release/spark-relay` resolves here and
  does not exist on Windows, where cargo appends `.exe`. Both scripts that
  resolve the path had their own hardcoded copy, so `relay:install` would have
  written hooks pointing at a file that is not there — and reported success.
  `src/relay/binary.ts` is now the only place that knows where the binary is, and
  `test/relay-binary-wiring.test.ts` fails if a copy grows back.
- **What counts as a binary.** The integration check tested for an ELF header
  alone, so on Windows it would have reported the build as a script needing an
  interpreter — the opposite of the truth, about the one file the check exists to
  look at.

Still unmeasured on Windows: the full `relay:verify` run, which is the next
command to try there.

### Known on this machine, unrelated to this change

The configured model (`nemotron-3-ultra-free`, via an opencode.ai proxy) is
unavailable to Claude Code 2.1.296, so a `-p` run exits 1 after the session has
started and its hooks have fired. A clean directory with no hooks installed fails
identically. The session starts before the model call, which is what the check
relies on; the exit status is reported rather than asserted for that reason.