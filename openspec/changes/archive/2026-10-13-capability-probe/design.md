# Design

## The bug, exactly

The probe asked one question to three platforms that do not share an answer:

```
 "did the compositor grant zwlr_layer_shell_v1 to this window's surface?"
```

| Platform | Has a compositor? | Has protocols? | Can grant a layer? |
|---|---|---|---|
| GNOME Wayland | yes | yes | no — Mutter does not implement it |
| Windows 11 | no | no | **no — and the question is meaningless here** |
| macOS | no | no | **no — and the question is meaningless here** |

Tauri cannot create a layer surface on any platform. It creates toplevels. So
`granted_protocols()` returns `[]` on all three, and the empty list was read as "no
platform can float a persistent surface."

The empty list was true. The inference from it was not.

## The root cause, one level down

There is a second finding here, and it is the more dangerous one, because it is a trap
rather than a bug.

Tauri offers `is_always_on_top()`, and reading it looks like the verification this whole
project insists on. It is not. Across its three desktop platforms:

| Platform | `is_always_on_top()` actually returns |
|---|---|
| Linux | `self.is_always_on_top.load(Acquire)` — an `AtomicBool` **the host itself set** |
| Windows | `window_flags.contains(ALWAYS_ON_TOP)` — a flag **the host itself set** |
| macOS | `ns_window.level() == kCGFloatingWindowLevelKey` — **a real query** |

On two of three platforms it is a **write-echo**: it returns what was requested, not what
the platform did. `docs/platform-findings.md` already recorded this on GNOME — "the flag is
accepted and ignored, which is the worst possible shape" — and the shell inherited the
same trap by reaching for the obvious API.

A write-echo is worse than no answer, because it *looks* like verification. A method named
`is_…` returning `true` after a `set_…(true)` is exactly the shape of evidence, which is
why it survives review.

**So: the report may only contain something the platform itself states.** A value the host
wrote and then read back is the host's own request with a different name.

## The fix: ask each platform about itself

```
 Wayland    did the compositor bind a layer surface to this window?
              -> the layer protocol, if a layer surface exists at all.
              -> Tauri cannot make one, so this is honestly "no", and on
                 GNOME that is also the truth.

 Windows    is the topmost extended style bit set on the real HWND?
              -> GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST
              -> a fact the kernel holds about a real window.

 macOS      is the window's level a floating level?
              -> already a genuine query; the only platform where the
                 obvious API was right all along.
```

Each is a fact about the platform's own state. None is a read-back of our own request.

`windows-sys` is already in `Cargo.lock` as a transitive dependency of Tauri, so the
Windows read is reachable without a new dependency in the tree — but it will be declared
explicitly rather than relied on transitively, because a direct use of a transitive crate is
a dependency that is one `cargo update` away from vanishing.

## Why the report changes shape

The current report is `{ protocols: string[] }` — a list of protocol names, because on
Wayland that is what there is to report.

On Windows there are no protocols. The fact is a style bit. Putting `"WS_EX_TOPMOST"` into
a list of protocol names would be a lie about the type of the thing, and the next reader
would reasonably ask what protocol that is.

So the report names the mechanism:

```ts
interface HostWindow {
  readonly placement: SurfacePlacement;   // how the platform was asked
  readonly held: boolean;                 // what the platform answered
}
```

`placement` is not decoration — it is what makes the report auditable. A reader seeing
`{ placement: "windows-topmost", held: true }` knows exactly which question was asked and
can go check that question. A reader seeing `{ protocols: ["zwlr_layer_shell_v1"] }` on a
Windows machine has to take it on faith.

`held: false` and `placement: <whatever we asked>` is the honest report of a platform that
did not do it. `placement: "unknown"` with `held: false` is the honest report of a platform
we could not ask. **They must stay distinguishable**, and they do: the second is what
`readHostWindow()` returns when there is no host at all.

## The failure direction, unchanged

```
 platform answers "no"          -> escalate-only   (correct everywhere)
 platform cannot be asked       -> escalate-only   (correct everywhere)
 platform answers "yes"         -> persistent
```

Both non-answers lead to escalate-only. This is unchanged from before and remains the most
important property of the module: it is right on every platform, including the ones nobody
has tested.

The asymmetry is deliberate. A surface that believes it is floating when it is not fails
visibly and constantly. A surface that declines to float is merely less capable, and is
indistinguishable from correct behaviour on a platform that could not float anyway.

## What this changes for the user

**Windows 11 becomes persistent.** The companion is a companion there: present while idle,
present while working, present when blocked, escalating when it needs attention. That is the
experience `docs/platform-findings.md` observed by hand and `app-shell` could not reach.

**GNOME stays escalate-only.** Correct, and it is the branch everything else in this project
was designed around.

**macOS becomes persistent**, on the strength of Tauri querying `ns_window.level()`
genuinely. It has never been run, so it is recorded as unmeasured rather than as working —
the code path will ask, and the answer is whatever a Mac says.

## Testing it

**Testable here, and mostly is:**

- The decision as a pure function of `(placement, held)`. Every combination, including
  `unknown`.
- The failure direction: every non-affirmative answer produces escalate-only.
- `unknown` and `no` stay distinguishable, because conflating them loses the audit trail.
- The report round-trips: what the host writes is what the surface reads.
- The **write-echo guard**, which is the one worth the most attention: a test that fails if
  the host publishes anything derived from a value it set itself. This is the bug that
  nearly shipped, and the guard for it is worth more than the rest of the file combined.
- Structural: the Rust side contains no `is_always_on_top()` call. That single line is the
  write-echo, and it must not come back.

**Not testable from Linux, and said so:**

- Whether Windows actually keeps the window on top. The probe will read the style bit
  honestly, and reading a bit correctly is not the same as the compositor honouring it. The
  observation in `docs/platform-findings.md` is what makes this credible, and re-running it
  on the real shell is the check.
- Whether macOS floats. Never run.

## Why not keep the protocol list

It would have been a smaller change: keep `{ protocols: string[] }`, and on Windows publish
`["windows-topmost"]`.

That is a list whose entries are not protocols, read by code that checks for a protocol
name, on a platform that has no protocols. The next person to touch it would reasonably
assume the entries are things a compositor grants, and would be wrong. The shape change is
small; the confusion it prevents is not.
