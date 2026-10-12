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
| `alwaysOnTop` | the request | **not the mechanism on Wayland**, and on this platform it is read back `true` and ignored. It is also never read *as* the answer — see below |
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

## How each platform is asked, and what it answered

The surface decides whether it can be a persistent companion from one report,
published by an initialisation script so it is there for the document's first
render. The report names **which question was asked** alongside what it answered:

| | Question | What the answer means |
|---|---|---|
| Wayland | did the compositor bind a layer surface to this window? | `false` — Tauri opens toplevels, and a layer surface is not a toplevel, so nothing was granted |
| Windows | is `WS_EX_TOPMOST` set on this window's real `HWND`? | a bit the kernel holds about a real window |
| macOS | is this window's level a floating level? | a level the window server holds about a real window |

The report is a `{ placement, held }` pair rather than a list of protocol names
because two of the three platforms have no protocols, and a list of protocol
names on a machine that has none is a lie about the kind of thing in it. Naming
the mechanism is also what makes the answer checkable: a reader seeing
`windows-topmost` knows which question produced the boolean.

**The value is only ever something the platform itself states.** Tauri offers
`is_always_on_top()` and reading it looks like the verification this project
insists on. It is not: on Linux it returns an `AtomicBool` the host set, on
Windows a flag the host set, and on macOS a genuine query — see
`src-tauri/src/capability.rs`. `test/shell-capability.test.ts` fails the build if
the Rust reaches for it anywhere, including on macOS where it would be correct.

**Reading a style bit correctly is not the same as the platform honouring it.**
The Windows read confirms the kernel granted a topmost style to a real window.
It cannot confirm the window then stayed above other windows, because no API
reports that. So the Windows claim below rests on the observation already
recorded by hand, and this probe neither strengthens nor weakens it.

**The window is built before it is asked, and the webview after.** A single
`WebviewWindowBuilder::build()` attaches the initialisation script before any
window exists, so `main.rs` builds the window, measures it, and attaches the
webview with the report. The alternative — build in one step and `eval` the
report afterwards — is a race: on WebView2 `eval` runs against whatever document
is current, which before the page has loaded is not the page.

**The failure direction is unchanged and is the most important property here.**
Every non-affirmative answer selects escalate-only — including "there was no
platform to ask", which is correct everywhere and whose opposite is correct
nowhere. "The platform said no" and "no platform could be asked" both escalate
but stay distinguishable, because the first is a fact about Windows and the
second is a fact about the host.

**Windows 11 becomes persistent.** That is what the code will now do there, and
it is the branch `docs/platform-findings.md` records working by hand. It is not a
new measurement: this shell has still not been run on Windows, and the check
that would confirm it is the same one that confirmed it by hand.

**macOS becomes persistent on the strength of a query that has never run.** The
level read is a real query on that platform, so the code will ask, and the answer
will be whatever a Mac says. No Mac was available, so it is recorded as
unmeasured rather than as working.

## Observed behaviour

Per machine, because "which behaviour did I get" only means something next to the
machine that produced it. Do not carry a machine's answer to another machine's
row.

| | Fedora 44, GNOME 44 Wayland | Windows 11 | macOS |
|---|---|---|---|
| builds | **yes** (`cargo build`, tauri 2.12.3, cargo 1.98.1) | **yes** (`cargo check --target x86_64-pc-windows-msvc`, rustc 1.98.1) | not measured |
| starts and stays up | **yes**, no diagnostics | not measured | not measured |
| opens one window | process alive; not seen by eye — no display was available to this session | not measured | not measured |
| binds the channel | **yes**: `/tmp/spark-<uid>/companion.sock`, directory `0700`, socket `0600` (read back with `ls`) | not measured | not measured |
| the relay's payload reaches it | **yes**: `spark-relay` exited `0` twice against a live shell, and the shell reported nothing | not measured | not measured |
| takes the channel back after a hard kill | **yes**: the next start bound the same address with no `EADDRINUSE` | not measured | not measured |
| released on window close | implemented (`WindowEvent::Destroyed` closes the channel and waits for the reader) — **not observed** | not measured | not measured |
| report published | **`{placement: "wayland-layer", held: false}`** — so escalate-only | **not measured**; will be `windows-topmost` per the probe and the observation below | not measured |
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
  works"; **this shell has not been run on Windows at all.** It compiles for
  Windows — `cargo check --target x86_64-pc-windows-msvc` passes, and the
  `GetWindowLongW` read was checked against `windows-sys` 0.61 for that target —
  but compiling is not running. **Re-running the shell on Windows is the check
  that confirms the persistent branch**, and it is the same check that produced
  the observation in `docs/platform-findings.md` in the first place.
- **macOS.** No Mac was available, and `cargo check --target x86_64-apple-darwin`
  could not be run here either — it needs a C toolchain for `objc2`'s Objective-C
  sources. The `NSWindow::level` read was checked against `objc2-app-kit` 0.3
  for that target in isolation. Treat every cell as unknown.

### How each row was measured

- **Executed, in `npm run verify`:** the window's declared properties
  (`test/shell-window.test.ts`), the capability report and the publishing
  template — *run*, not read (`test/shell-capability.test.ts`), the placement
  arithmetic and the read-back comparison (`test/shell-placement.test.ts`), byte
  identity across a real socket and the document's seam
  (`test/shell-channel.test.ts`), the runtime's decisions including both
  capability branches end to end (`test/shell-runtime.test.tsx`), the program's
  shape (`test/shell-shape.test.ts`).
- **Executed, in `cargo test`:** the report as a function of the measurement, the
  mechanism names against the surface's, the template substitution and its
  refusal to publish something unsubstituted, the address contract and the
  payload bound. **15 tests.** This is *not* part of `npm run verify` — it needs
  a Rust toolchain — and it covers the side vitest cannot reach at all: the
  per-platform reads, the `cfg` dispatch, and the template the host ships.
- **Executed, in `npm run test:e2e`:** the shell's rendered surface driven to
  blocked and back through a real browser, plus the capability report driving
  both branches through the real global the native host writes. **17 tests** for
  this file, 32 in the run. The native window is *not* what that run drove — a
  browser engine cannot open one, and cannot be one whose style bit this host
  reads — so it covers the surface, the calls the runtime made, and the read and
  the decision, and says so rather than implying more.
- **Cross-compiled, on this machine:** `cargo check --target x86_64-pc-windows-msvc`
  for the Windows read. The full crate could not be linked here — its build
  script needs `llvm-rc` for the resource file — so the `GetWindowLongW` call and
  the handle cast were checked against their real crates in a scratch crate.
- **Run by hand, once:** the build, the start, the channel's permissions, the
  relay's delivery and the takeover after a hard kill, as tabulated above.
- **Structurally guarded:** whether the Rust interprets a payload, whether the
  host shows itself, whether a failure to prevent focus is raised or reported,
  whether the report is read from the window *before* the webview is attached,
  and whether the Rust reaches for `is_always_on_top` at all. These are
  properties of shape; behaviour tests would pass with an implementation bolted
  on.

## Deliberately not here

- **The decision round trip.** A card is mounted when there is a request to
  offer, and its answer has nowhere to go. A hook payload says a session is
  blocked, never what the agent wants to do. `decision-transport` completes it.
- **Hook installation.** `npm run relay:install` is a separate command that shows
  a diff and asks first. Starting the app is not consent to reconfigure the
  user's agent, and `test/shell-shape.test.ts` fails if that ever changes.
- **A settings window, a tray icon, autostart, a notch.** v0.1 is one mascot and
  one escalation path.
