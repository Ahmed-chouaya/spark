# Design

## The shape of it

A Tauri application whose Rust side owns the window and whose frontend is the surface that
already exists.

```
  Claude Code ──hook──> spark-relay ──pipe──> shell (Rust)
                                                   │  opens the channel
                                                   │  publishes what the platform granted
                                                   v
                                            src/escalation  (existing)
                                                   │  selectState + escalates
                                                   v
                                            Mascot + DecisionSurface
```

The Rust side does three things and no more: create a window, listen on the channel, and
move bytes between the channel and the webview. It interprets no payload, names no event,
and derives no state. That restraint is not modesty — it is what keeps
`src/state-selection/adapters/claude-code.ts` the single implementation of the host's
vocabulary, which is the same argument `relay/src/main.rs` makes about the relay and which
`test/relay-shape.test.ts` already enforces for the relay. The shell gets the same
structural test.

## Why the surface is not a second window

The escalation surface and the decision card are one React tree. Rendering them in two
windows would mean two always-on-top surfaces racing, and the card would appear
somewhere other than where the mascot is — which is where the user's eye already is. The
card is inside the surface's fragment for exactly this reason, and the shell mounts one
element tree.

## Window creation

Translating `tauri.conf.json`'s window config into the requirements, and what each one is
buying:

| Setting | Requirement it serves | What it is not |
|---|---|---|
| `transparent` | unadorned | On Linux this needs the compositor to composite an ARGB surface. GNOME does; a compositor that does not will show a rectangle. Recorded as unmeasured on that path. |
| `decorations: false` | unadorned | — |
| `skipTaskbar` | unadorned | Not honoured by every platform; see below. |
| `alwaysOnTop` | on top of other windows | **Not the mechanism on Wayland.** The flag is accepted and discarded by compositors that own stacking. On Windows it is honoured. |
| `focus: false` | never takes focus | Whether this is honoured is a fact about the platform, not a fact about Tauri. |
| `visible: false` initially | shown only when it has something to say | See "The visibility loop" below. |

**`alwaysOnTop` is not how a Wayland window floats.** That is the finding that shaped
`src/escalation/capability.ts`: a compositor owns stacking for its clients, "keep this
window on top" is not a request it honours, and the only protocol that places a client in
a layer of its own is `zwlr_layer_shell_v1`. GNOME does not implement it. So on a platform
without the protocol, the shell does not attempt to float — it runs escalate-only, and
the mascot appears only when something is blocked and disappears when it is not. That is
the same rule `EscalationSurface` already implements, reached through the published report
rather than through an operating-system name.

The consequence worth stating plainly: **this shell will not be a persistent companion on
GNOME.** That is not a defect to work around here. It is the platform-conditional rule
that `escalation-surface` already specifies, and a build that tried to float anyway would
be the product that "works on Linux" turns out to sink on the third desktop.

## Publishing the capability

The seam already exists and nothing writes it: `HOST_WINDOW_KEY = "__SPARK_HOST_WINDOW__"`
in `src/escalation/capability.ts`, read by `readHostWindow()`. The host writes it.

Timing is the whole problem. The webview document does not exist when `setup` runs, so a
write from Rust at setup time would be a write into nothing. Tauri's answer is an init
script: `WebviewWindowBuilder::initialization_script`, which runs in the document before any
of the page's own JavaScript. The host therefore:

1. Creates the window with the layer requested if the platform can grant one.
2. Reads back what was actually granted.
3. Passes *that* into the init script, which assigns `__SPARK_HOST_WINDOW__` before the
   surface's first render.

Step 2 is the part that matters and the part that is easy to get wrong. The host does not
publish what it *asked for*; it publishes what it *got*. A host that reported its own
request as though it were a grant would produce a surface that believes it is floating on
a compositor that never agreed — which is the specific failure the probe's module note
warns about, and the reason the report is a protocol list rather than a boolean.

On a platform with no layer protocol to grant, the list is empty and the surface reads
`false`. That is correct everywhere and the inverse is correct nowhere, so the failure
direction is chosen rather than incidental.

## The visibility loop

The rule already exists: `surfaceVisibility(escalating, persistent)` in
`EscalationSurface.tsx`. The shell does not re-derive it. The loop is:

```
payload arrives
  -> adapter -> canonical event -> applyEvent -> sessions
  -> selectState(sessions), sessions.some(escalates)
  -> surfaceVisibility(escalating, persistent)
  -> visible ? show : hide
```

One rule, consulted on every event, so a session that blocks changes what is on screen
without anything having to remember to clear a flag. The shell's only contribution is
mapping `visible` onto `window.show()` / `window.hide()`.

The window is created with `visible: false` and shown only when the rule says so. A window
created visible would flash on every start, including the majority of starts where nothing
is blocked and it should never appear — which on a platform that cannot float means it
should never exist at all.

## Position

`docs/platform-findings.md` records `set_position` as a silent no-op on GNOME Wayland: the
call returns `Ok` and the window does not move. A shell that trusted the return value would
place a mascot at 0,0, call it positioned, and be wrong.

So placement is verified rather than requested: set the position, read it back, and report
a mismatch. On a platform where positioning does not work, the shell says so at startup
rather than leaving something stuck in a corner.

Work-area bounds come from the monitor the cursor is on, falling back to a documented
corner. A companion that cannot determine where to be places itself somewhere and says so
rather than refusing to start — the user gets a mascot in a known place, not no mascot.

## Testing what can be tested here

The hard part of this change is that the interesting failures are compositor behaviour, and
this machine's compositor is one of the two that cannot float. So the split is explicit:

**Tested here, as pure functions and as source shape:**

- What the host publishes, given a granted protocol list — including the case where the
  list is empty, absent, or names something else.
- That the shell publishes the *grant* rather than the request. This is a pure function
  over (requested, granted) and it is exactly the bug the design is written against.
- The visibility decision, given a state and a capability — already covered in
  `test/surface.test.tsx`, and re-checked through the shell's path rather than beside it.
- That the Rust side names no host event and no mascot state. Same structural test as the
  relay, for the same reason: behaviour tests would pass just as happily with
  interpretation bolted on.
- That the window config carries each setting the requirements name.

**Not testable here, and said so rather than assumed:**

- Whether the compositor honours `alwaysOnTop`. Measured on Windows 11 by observation; not
  measurable from Linux for any platform.
- Whether `transparent` composites. Depends on the compositor.
- Whether `focus: false` is honoured.
- Whether `skipTaskbar` is honoured.

Each is recorded in `shell/README.md` in the same table format `spikes/overlay/README.md`
and `docs/platform-findings.md` already use, with the platform it was measured on. A
machine's answer is never carried to another machine's row.

## Why the shell does not install hooks

`npm run relay:install` already does that, deliberately, showing a diff and asking first.
The shell starts and draws; it does not edit the user's agent configuration as a side
effect of being launched. Two commands with two purposes, and starting the app is not
consent to reconfigure their agent.

## What is deliberately not here

- **The decision round trip.** A card is mounted and its answer goes to `onDecision`. It
  has nowhere to go until `decision-transport`. Deliberately last: a blocking hook is a
  correctness risk in the user's agent, and it should not land in the same change as a
  window.
- **A settings window, a tray icon, autostart.** v0.1 is one mascot and one escalation
  path. A settings window is a preferences UI with no preferences behind it yet.
- **A notch.** macOS gets a plain floating `NSPanel`. The notch is v0.2.
- **A second host agent.** One more file in `src/state-selection/adapters`.
- **Cross-platform verification.** The shell builds and runs on Linux; the persistent
  surface is verified on Windows. macOS is unmeasured and will stay labelled that way.
