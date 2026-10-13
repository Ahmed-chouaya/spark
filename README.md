# Spark

A mascot for Claude Code. It shows you what your agent is doing, and it asks you
when the agent wants to do something.

```
  Claude Code fires a hook
        |
        v
  spark-relay ──bytes──> the companion ──> the mascot, drawn on a real window
        (60 lines)        spark-shell
        |
        and, only if you asked for it:
  spark-ask ──waits──> the companion ──> a card you answer ──> back to the agent
```

v0.1 is one mascot and one escalation path. There is no tray icon, no settings
window, no autostart, and no notch.

---

## Removing it

**This installs into your agent's own configuration.** `npm run relay:install`
writes hooks into `~/.claude/settings.json`. So here is how to undo that, before
anything else:

| what you want back | the command |
|---|---|
| the mascot — the seven hooks that only *tell* the companion things | `npm run relay:uninstall` |
| the asking — the one hook that holds a tool call until you answer | `npm run relay:uninstall:wait` |
| both | run the first, then the second |

They are separate on purpose. `relay:uninstall` removes **only** the non-blocking
hooks and says so on the way out; `relay:uninstall:wait` removes **only** the
blocking one and leaves the mascot running. Both are surgical: they remove the
entries that run this project's programs and leave everything else in the file
exactly as it is, including hooks you or somebody else configured.

Neither restores a backup. Restoring would throw away anything you have edited
since installing. The copy taken before the first install is kept at
`~/.claude/spark-backups/` and is yours to delete whenever you like.

Nothing else on your machine is touched. `npm run build` writes only inside this
checkout; `npm run doctor` writes nothing at all.

---

## What it does

Three programs, and what each one is for:

| program | what it does | when it runs |
|---|---|---|
| `spark-relay` | reads a hook payload on standard input, writes it to a local socket, exits. No parsing, no naming, no translating. | every hook event, seven of them |
| `spark-ask` | sends a request, waits for your answer, prints the host's documented decision shape, exits | `PreToolUse`, and only if you installed it |
| `spark-shell` | opens a transparent, undecorated, always-on-top window and draws the mascot on it | once, when you start the companion |

The mascot shows what the agent is doing — thinking, working, blocked, waiting for
you, done, tired. When something blocks, the window appears; when nothing is
blocked it is hidden, **unless the platform can keep a surface above unfocused
windows**, in which case it stays out and is simply quiet. Which of those happens
is decided by asking the platform, not by assuming.

On GNOME Wayland the answer is **no** — a compositor owns the stacking order and
there is no way to ask it — so the mascot appears when it has something to say
and is otherwise absent. On Windows 11 a persistent surface **has been observed
by hand**, in an earlier version of this program; this window has never been run
there, so that row is what the code *will* do rather than what it did. The
measured table further down says which is which.

## How to install

You need **Node 22 or newer** (24 is what this was built on; the scripts are run
directly by `node`, with no build step), a **Rust toolchain** (`cargo`), and the
platform's C build tools for the window. On Debian or Ubuntu:

```
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev build-essential
```

```
git clone <this repository> spark
cd spark
npm install
npm run build
```

`npm run build` builds three Rust programs in the order they depend on each other
— relay, then the wait, then the window — copies the two programs next to the
window's own executable, and then produces a platform bundle. It says which step
failed and where the full output is, rather than printing a wall of cargo output
and stopping. See `scripts/build.ts`.

**The installation is the directory it leaves behind:**

```
shell/src-tauri/target/release/
    spark-shell        the window
    spark-relay        the program your agent's hooks invoke
    spark-ask          the program that waits for your answer
```

Copy that directory anywhere you like and run `./spark-shell`; the two programs
go with it, and the hooks name them by their position next to the window rather
than by a path into this checkout. That matters because a hook is an absolute
path, and a path into a clone stops working the first time the clone moves.

`npm run build` then also produces a platform bundle under
`shell/src-tauri/target/release/bundle/` — `.deb`, `.rpm` and an AppImage on
Linux; `.msi` and an NSIS installer on Windows. **The bundle carries the window,
not the two programs.** On Linux a package manager is free to put them wherever
its own layout says; on Windows they land beside the executable. If you install
from a bundle rather than copying the directory, run `npm run doctor` afterwards
and it will tell you which paths the hooks ended up on.

## How to run it

```
npm run companion
```

That derives the channel's address, builds the shell's page, and opens the window.
Leave it running — Ctrl-C stops it. It prints the address it is listening on.

Then, **in a second terminal**, install the hooks:

```
npm run relay:install -- --dry-run    # show the change, write nothing, ask nothing
npm run relay:install -- --wait        # show it, ask, and apply it if you say yes
```

`--dry-run` is worth running first every time. It prints a diff of your
`~/.claude/settings.json` and writes nothing. Without `--dry-run` it prints the
same diff and then asks; typing anything but `y` or `yes` — including closing the
terminal — leaves the file byte for byte as it was.

`--wait` installs the second program too: the hook that holds a tool call until
you answer. It goes into its own matcher group on its own event, so it can be
added and removed without touching the mascot. If you only want the mascot,
install without it.

Now use Claude Code. The mascot appears when the agent blocks, and — if you
installed the wait — a card comes up when the agent wants to do something.

## How to tell it is working

```
npm run doctor
```

It reads; it never writes. It reports:

- whether the hooks are in `~/.claude/settings.json`, and which of the two kinds
- whether the programs those hooks name exist on this machine
- whether they are *this* install's, or paths left behind by another one
- whether the companion is listening where it says it will be
- what the platform reports about a surface that can float, and **which question
  was asked**

It exits non-zero only when something is actually broken. A companion that is not
running is a report, not a fault — it is what your machine looks like before
anything has blocked the agent.

To see the whole thing move without an agent in the loop:

```
npm run decision:verify
```

That builds the waiting program, starts a real companion, runs the real binary
against the real channel, and asserts the bytes a host would read — then runs it
again with nothing listening and again with a companion that never answers, and
asserts that every one of those prints nothing, exits successfully, and leaves
your agent alone. This is the check `packaging` was written against: it is the
round trip, end to end, on real programs.

## Trying each piece on its own

| what you want to see | the command |
|---|---|
| every state the mascot can draw, each labelled with its own name | `npm run dev` → <http://localhost:3000/> |
| the escalation surface driven from a browser | <http://localhost:3000/surface.html> (with `npm run dev` running) |
| the same surface driven automatically | `npm run test:e2e` |
| what this platform says about a floating surface | `npm run probe:capability` |
| the relay, against a real agent | `npm run relay:verify` |
| the companion, with its channel | `npm run companion` |
| the decision round trip, on the real binaries | `npm run decision:verify` |
| what is installed, and whether it is yours | `npm run doctor` |
| the whole suite | `npm run verify` |

`npm run dev` is the development harness: every state in the product's vocabulary
on one page, each labelled with its own name. It is the quickest way to see what
"working" looks like without waiting for an agent to block.

`npm run relay:verify` is the only command here that needs Claude Code itself on
`PATH` with a model that works on your machine. It installs into a scratch
directory rather than your own settings, so it is safe, but it does make one real
call. `npm run decision:verify` needs no agent at all.

## On Windows

Everything above is the same on Windows, with one difference in the shell. In
PowerShell:

```
npm install
npm run build
npm run relay:install -- --dry-run
npm run relay:install -- --yes --wait
npm run companion
npm run doctor
```

`npm run build` produces an NSIS installer and an MSI under
`shell/src-tauri/target/release/bundle/`. Run `shell\src-tauri\target\release\spark-shell.exe`
directly for the directory installation; `npm run relay:install` resolves the two
programs beside it, with the `.exe` on the end, from the same rule every other
caller uses.

**This shell has not been run on Windows.** It compiles for Windows
(`cargo check --target x86_64-pc-windows-msvc` passes), the per-platform
capability read is written against `windows-sys`, and the relay and the wait have
both been run there. The window has not. What is known about Windows is in
`docs/platform-findings.md`, and it says which parts came from a person looking
at a screen and which are what the code *will* do.

## What has been measured

Per machine, because "which behaviour did I get" only means something next to the
machine that produced it. **Do not carry a machine's answer to another machine's
row.**

| | Fedora 44, GNOME Wayland | Windows 11 | macOS |
|---|---|---|---|
| builds | **yes** (`npm run build`; cargo 1.98.1) | **yes** (`cargo check --target x86_64-pc-windows-msvc`) | not measured |
| the window starts and stays up | **yes**, no diagnostics | not measured | not measured |
| binds the channel | **yes**: `/tmp/spark-<uid>/companion.sock`, directory `0700`, socket `0600` | **yes**: `\\.\pipe\spark-<name>-companion` | not measured |
| the relay's payload reaches the window | **yes**: `spark-relay` exited 0 twice against a live shell | **yes**: the named pipe carried a payload end to end | not measured |
| the wait returns a decision | **yes**: `npm run decision:verify`, real binaries | not measured | not measured |
| can hold a surface above unfocused windows | **no** | **yes** — observed by hand, in an earlier spike | not measured |
| what the window reports | `{placement: "wayland-layer", held: false}` → appears only when blocked | will be `windows-topmost`; **not measured here** | will be `macos-level`; not measured |
| visible to a person | not observed — this build had no display | not measured | not measured |

### Not verified, and why

- **The window has never been seen by a person.** Every build machine this
  project has had had no display a human could look at. The rows above that ask
  "does it *look* right" are recorded as unobserved rather than as passing. What
  was measured is the process starting, the channel binding with the right
  permissions, the relay delivering and the decision returning.
- **macOS.** No Mac was available and it cannot be built for from Linux without a
  C toolchain for `objc2`'s Objective-C sources. Every cell is unknown. Treat it
  as untested rather than as working.
- **Windows.** The persistent-surface row rests on an observation somebody made
  by hand with an earlier program. The probe the window uses now asks Windows
  whether `WS_EX_TOPMOST` is set on the real handle, which is a real query, but
  **reading a style bit correctly is not the same as the platform honouring it** —
  no API reports that a window then stayed above other windows. Re-running the
  shell on Windows is the check that confirms it, and it is the same check that
  produced the observation.
- **The platform bundle.** Linux bundles were built here and `rpm -qlp` was read
  on the result. No Windows bundle has been built.

`docs/platform-findings.md` has the long version with how each row was measured.
`shell/README.md` and `src/relay/README.md` have the per-component detail.

## The suite

```
npm run verify     # typecheck plus 659 tests
npm run test:e2e   # the rendered surface, driven through a real browser (32)
```

The browser run drives the *surface*, not the native window: a browser engine
cannot open one, and cannot be one whose window handle this host reads. It covers
the surface, the calls the runtime made, the capability report driving both
branches, and the decision round trip, and says so rather than implying more.

`cargo test` also exists in `shell/src-tauri` (15 tests) and is **not** part of
`npm run verify`, because it needs a Rust toolchain. It covers the per-platform
capability reads, the `cfg` dispatch and the template the host ships — the side
vitest cannot reach at all.

## What is deliberately not here

- **Code signing or notarisation.** An unsigned macOS build will not open without
  a right-click. That is honest and is one step for you to take; a self-signed
  certificate that expires is neither.
- **Auto-update.** It needs a server and a signing key. Out of scope for a v0.1
  that has never been installed by anyone but its author.
- **Homebrew, winget, scoop, a `.deb` in a tap.** Each implies a platform tested
  on that platform's package tooling. Windows and Linux are; macOS is not.
- **A second host agent.** It is one more adapter and no change anywhere else.
- **The notch, a settings window, a tray icon, autostart.** v0.1 is one mascot and
  one escalation path.