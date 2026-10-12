# Shell

The companion's window: a transparent, undecorated, always-on-top native surface
that draws the mascot and appears when something is blocked.

```
  npm run companion      derive the channel's address, build the frontend, run the window
  npm run shell:build    just the frontend Tauri embeds
  npm run shell:run      just the crate, if the address is already in the environment
```

It is a Tauri application. The Rust side opens the window, listens on the
relay's channel, and moves bytes between the channel and the webview; the
document folds those bytes and draws. Neither half interprets them — see
`src-tauri/src/main.rs` for what the Rust side is allowed to know, and
`test/shell-shape.test.ts` for how that is held.

## The window

Declared once in `src-tauri/tauri.conf.json` and built from that declaration
with `create: false`, so the settings are a document a test can read rather than
a Rust call site asserting it mentions a string.

| Setting | What it buys | What it is not |
|---|---|---|
| `transparent` | nothing behind the mascot | on Linux this needs the compositor to composite an ARGB surface |
| `decorations: false` | no title bar, no border | — |
| `skipTaskbar` | no taskbar entry | not honoured by every platform |
| `alwaysOnTop` | the request | **not the mechanism on Wayland**, and on this platform it is read back `true` and ignored |
| `focus: false` | does not take the keyboard as it appears | a request, not evidence |
| `visible: false` | shown only when it has something to say | — |

Two of those are *verified* rather than requested, because a successful call is
not evidence on this platform:

- **Focus.** `focus: false` is asked for, `set_focusable(false)` is asked for
  again, and then the window is read back once the event loop has pumped. A
  platform that took the keyboard anyway is reported on standard error — not
  raised, because a shell that exits over a platform limitation is a shell that
  does not run at all.
- **Position.** `set_position` is asked for and then read back. See below.

## Why the shell is escalate-only everywhere

The surface decides whether it can be a persistent companion from one fact: which
protocols the compositor bound to the window's surface when it bound it. That is
read back before the window is built, published by an initialisation script so
it is there for the document's first render, and published as what was *granted*.

It is an empty list on every platform this host can open a window on, and that is
a measurement rather than a default. `zwlr_layer_shell_v1` places a client in a
layer by *replacing* the role a window would otherwise have: a layer surface
comes from `get_layer_surface`, and a window that did that is not a toplevel.
Tauri's window backend creates toplevels and has no window type that binds a
layer instead — so no window this host opens was granted a layer by anybody.

**So the companion appears when something is blocked and is otherwise absent,
everywhere.** That is the platform-conditional rule `escalation-surface` already
specifies, reached through the published report rather than through an operating
system name. The persistent branch is unreachable in v0.1, and the code that
would carry it is written and tested: a host that could bind a layer would name
the protocol in `granted_protocols()` and nothing else would change.

This includes Windows 11, where `docs/platform-findings.md` records — by
observation, not by probe — that a persistent surface does work. That gap is real
and is listed below rather than papered over.

## Observed behaviour

Per machine, because "which behaviour did I get" only means something next to the
machine that produced it. Do not carry a machine's answer to another machine's
row.

| | Fedora 44, GNOME 44 Wayland | Windows 11 | macOS |
|---|---|---|---|
| builds | **yes** (`cargo build`, tauri 2.12.3, cargo 1.98.1) | not measured | not measured |
| starts and stays up | **yes**, no diagnostics | not measured | not measured |
| opens one window | process alive; not seen by eye — no display was available to this session | not measured | not measured |
| binds the channel | **yes**: `/tmp/spark-<uid>/companion.sock`, directory `0700`, socket `0600` (read back with `ls`) | not measured | not measured |
| the relay's payload reaches it | **yes**: `spark-relay` exited `0` twice against a live shell, and the shell reported nothing | not measured | not measured |
| takes the channel back after a hard kill | **yes**: the next start bound the same address with no `EADDRINUSE` | not measured | not measured |
| released on window close | implemented (`WindowEvent::Destroyed` closes the channel and waits for the reader) — **not observed** | not measured | not measured |
| granted protocol list | **`[]`** — so escalate-only | **not measured**; see below | not measured |
| stays above a maximised window | no (recorded in `docs/platform-findings.md`) | not measured by this shell | not measured |
| takes focus when it appears | no diagnostic on this run, but see "not observed" | not measured | not measured |
| `set_position` honoured | **no** (recorded in `docs/platform-findings.md`: returns `Ok`, window stays put) | not measured | not measured |

### Not verified here, and why

- **Anything needing eyes.** This session had a compositor on `WAYLAND_DISPLAY`
  but no display a human could look at, so every row above that asks "does the
  window *look* right" is recorded as unobserved rather than as passing. The
  process starting, the channel binding with the right permissions and the relay
  delivering are the rows that were actually measured.
- **Focus on appearance.** The shell asked and then read back, and reported
  nothing — which is a weaker claim than "it did not take focus", because a
  window that was never on screen had no opportunity to take it.
- **Windows.** `spikes/overlay` was run there and recorded "a persistent surface
  works"; **this shell has not been run on Windows at all.** The persistent
  branch is unreachable on that platform anyway, for the reason above, so a
  Windows run today would measure the escalate-only path.
- **macOS.** No Mac was available. Treat every cell as unknown.

### How each row was measured

- **Executed, in `npm run verify`:** the window's declared properties
  (`test/shell-window.test.ts`), the capability report and the publishing
  template — *run*, not read (`test/shell-capability.test.ts`), the placement
  arithmetic and the read-back comparison (`test/shell-placement.test.ts`), byte
  identity across a real socket and the document's seam
  (`test/shell-channel.test.ts`), the runtime's decisions
  (`test/shell-runtime.test.tsx`), the program's shape (`test/shell-shape.test.ts`).
- **Executed, in `cargo test`:** the report as a function of the grant, the
  protocol name against the surface's, the template substitution, the address
  contract and the payload bound. **11 tests.**
- **Executed, in `npm run test:e2e`:** the shell's rendered surface driven to
  blocked and back through a real browser. **10 tests.** The native window is
  *not* what that run drove — a browser engine cannot open one — so it covers
  the surface and the calls the runtime made, and says so rather than implying
  more.
- **Run by hand, once:** the build, the start, the channel's permissions, the
  relay's delivery and the takeover after a hard kill, as tabulated above.
- **Structurally guarded:** whether the Rust interprets a payload, whether the
  host shows itself, whether a failure to prevent focus is raised or reported.
  These are properties of shape; behaviour tests would pass with an
  implementation bolted on.

## Deliberately not here

- **The decision round trip.** A card is mounted when there is a request to
  offer, and its answer has nowhere to go. A hook payload says a session is
  blocked, never what the agent wants to do. `decision-transport` completes it.
- **Hook installation.** `npm run relay:install` is a separate command that shows
  a diff and asks first. Starting the app is not consent to reconfigure the
  user's agent, and `test/shell-shape.test.ts` fails if that ever changes.
- **A settings window, a tray icon, autostart, a notch.** v0.1 is one mascot and
  one escalation path.
