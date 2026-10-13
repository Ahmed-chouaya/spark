# Proposal

## Why

The companion has a mascot, a state reduction, a transport and a decision surface — and
nothing puts them on screen. `npm run companion` prints what the reduction decided, so the
product today is a library with a demo attached: every requirement about what the *user*
sees is verified against a component in a test renderer, and none of it against a window.

Everything upstream of the surface is finished and verified. What is missing is the one
thing that makes it a product — the surface itself, floating above the user's work,
answering to the sessions arriving over the channel.

This is also the last thing that could not be written from what is already measured. The
platform findings are in `docs/platform-findings.md`: Windows 11 keeps a surface above
every window and does not take focus; GNOME Wayland grants no layer protocol, so the
escalate-only branch is the correct behaviour there and the code already selects it from a
runtime probe. Both answers are facts about machines rather than assumptions, so the shell
can be written against them.

## What Changes

- A native host window: transparent, undecorated, always-on-top, absent from the taskbar,
  and never focused while showing an ambient state.
- The host publishes what the platform granted to `globalThis.__SPARK_HOST_WINDOW__`, which
  is the seam `src/escalation/capability.ts` already reads and nothing yet writes.
- The companion runtime moves out of a printing script: the host opens the channel, feeds
  payloads through the existing adapter into the existing fold, and mounts the existing
  escalation surface on the result. Nothing re-derives a state.
- The window is shown and hidden by the rule `src/escalation/EscalationSurface.tsx` already
  implements, so a platform without a persistent surface has nothing on screen until
  something is blocked.
- The host is one command. `npm run companion` stops printing and becomes the app.

**Not in this change:** the decision round trip. A decision surface is mounted and rendered,
but the answer it produces has nowhere to go until `decision-transport` gives it a way
back. That is a transport concern and it gets its own change, as the relay's design
already reserved for it.

## Capabilities

### New Capabilities
- `native-shell`: the host window — creation, platform capability publication, focus
  discipline, position, and the lifecycle that shows it only when it has something to say.

### Modified Capabilities
- `escalation-surface`: one requirement changes. "The blocked state is surfaced" currently
  means the surface becomes visible; in a shell it means the *window* becomes visible, and
  the requirement gains the failure it must not have — a window that appears but is not
  actually on top is worse than no window, because it looks like it worked.

## Impact

- **New**: `shell/` — a Tauri application. Its Rust side creates the window and publishes
  the capability report; its frontend is the existing `src/escalation` surface.
- **Modified**: `scripts/spark-companion.ts` — becomes the shell's entry point rather than a
  printer. The reduction it called is now mounted.
- **New tests**: `test/shell-*.test.ts` — the window's decisions are testable without a
  window (what was requested, what was published), and that is where they are tested. The
  compositor honouring a request it agreed to is not testable here and is recorded as
  unmeasured.
- **Unchanged**: `src/state-selection`, `src/components/mascot`, `src/relay`. The shell
  consumes all three and changes none of them, which is what makes it a shell.
