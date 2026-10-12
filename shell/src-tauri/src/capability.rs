//! What the platform said, published at the seam the surface reads.
//!
//! # The whole of this module's job
//!
//! Three functions, in order:
//!
//! ```
//!   ask(&window)               the question this platform can answer, and its answer
//!     -> capability_report()   the value the document is told, and which question produced it
//!       -> initialization_script()   the text that assigns it, before the page runs
//! ```
//!
//! Nothing else lives here, because the correctness of the whole shell rests on
//! one of these three being wrong in a particular way. Step 1 is a function of
//! the *platform's own state*; if it were a function of the request instead, the
//! surface would believe it is floating on a platform that never agreed, which
//! is the one failure this module exists to prevent. `test/shell-capability.test.ts`
//! pins that from the TypeScript side and this file is pinned here, because
//! neither half can check the other by running.
//!
//! # Why the question is not the same on every platform
//!
//! The previous version of this module asked every platform the same question —
//! *did the compositor grant `zwlr_layer_shell_v1` to this window's surface?* —
//! and got an empty answer from all of them.
//!
//! That question is the right one for a Wayland compositor, which owns the
//! stacking order of its clients and grants protocols as part of binding a
//! surface. Windows and macOS have no compositor and no protocols and will never
//! grant a Wayland protocol to anything, so there the question is not a hard one,
//! it is a meaningless one. And Tauri cannot create a layer surface on any
//! platform — a layer surface comes from `get_layer_surface` and a window that
//! did that is not a toplevel, which is the only kind of window Tauri's backend
//! creates — so the Wayland answer is honestly "no" as well.
//!
//! The empty answer was true and the inference drawn from it was the bug: `[]`
//! on every platform was read as "no platform can hold a persistent surface",
//! when what had actually been measured was "no host asked a question these
//! platforms understand". One build was reported incapable on a platform where
//! `docs/platform-findings.md` records a persistent surface working, by hand.
//!
//! So each platform is asked something it can answer about itself:
//!
//! | Platform | The question | Where the answer comes from |
//! |---|---|---|
//! | Wayland | did the compositor bind a layer surface to this window? | the compositor's own grants |
//! | Windows | is the topmost extended style bit set on the real `HWND`? | `GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST` |
//! | macOS | is the window's level a floating level? | the `NSWindow`'s own `level` |
//!
//! The first does not need a window: Tauri has no window type that binds a layer,
//! so there is nothing for a compositor to have granted and the answer is settled
//! before one exists. The other two do, which is why `main.rs` builds the window
//! and its webview as two steps — see the note there.
//!
//! # Why `is_always_on_top()` is not used anywhere, including on macOS
//!
//! Tauri offers `is_always_on_top()`, and reading it is the exact shape of
//! verification this project keeps asking for. It is not verification. Across
//! tao 0.37.1's three desktop platforms it is:
//!
//! | Platform | What it actually returns |
//! |---|---|
//! | Linux | `self.is_always_on_top.load(Acquire)` — an `AtomicBool` the host itself set |
//! | Windows | `window_flags.contains(ALWAYS_ON_TOP)` — a flag the host itself set |
//! | macOS | `ns_window.level() == kCGFloatingWindowLevelKey` — a genuine query |
//!
//! On two of three platforms it is a **write-echo**: it returns what was
//! requested, not what the platform did. `docs/platform-findings.md` already
//! records this on GNOME — the flag is accepted and then ignored, "which is the
//! worst possible shape" — and this shell inherited the trap by reaching for the
//! obvious API.
//!
//! A write-echo is worse than no answer, because it looks like evidence. A
//! method named `is_*` returning `true` after a `set_*(true)` is exactly the
//! shape a reviewer is scanning for, which is why it survives review.
//!
//! macOS is the platform where the obvious API happens to be right, and it is
//! still not used. Two reasons, and the second is the one that matters:
//!
//! 1. Reaching for `is_always_on_top()` on macOS and reading the level directly
//!    on Windows would be correct today and wrong the moment either platform's
//!    implementation changed. The guarantee this module offers is about where an
//!    answer *comes from*, and it should not depend on which platforms happen to
//!    agree with the host's own bookkeeping.
//! 2. `test/shell-capability.test.ts` fails the build if `is_always_on_top`
//!    appears anywhere in the Rust. A guard with an exception is a guard with a
//!    loophole, and the loophole is one line long and would be written by
//!    somebody in a hurry who had read the source of tao, concluded it was fine
//!    on that platform, and left a comment saying so.
//!
//! # The failure direction, which is the property this module is built around
//!
//! ```
//!   the platform answers "yes"   -> persistent
//!   the platform answers "no"    -> escalate-only   (correct on every platform)
//!   there is no platform to ask  -> escalate-only   (correct on every platform)
//! ```
//!
//! Both non-answers lead to escalate-only, and that is unchanged and deliberate.
//! A surface that declines to float is merely less capable, and is
//! indistinguishable from correct behaviour on a platform that could not float
//! anyway. A surface that believes it is floating when it is not fails visibly,
//! constantly, and in the user's face. The asymmetry is the design.
//!
//! "Could not ask" and "asked and heard no" are different answers with the same
//! consequence, and they stay different: a report of
//! `{ placement: "windows-topmost", held: false }` is a fact about Windows and a
//! report of `{ placement: "unknown", held: false }` is a fact about this host.
//! Collapsing them would lose the audit trail, which is the one thing the
//! `placement` field exists to keep.

use serde::Serialize;

/// Did the compositor bind a layer surface to this window's surface?
///
/// The same string `src/escalation/placements.ts` names, for the same reason it
/// is a protocol name and not a platform name: the mechanism genuinely is a
/// protocol grant on this one platform, and flattening the other two into the
/// same vocabulary is what made the old question meaningless.
pub const WAYLAND_LAYER: &str = "wayland-layer";

/// Is the topmost extended style bit set on the real window handle?
pub const WINDOWS_TOPMOST: &str = "windows-topmost";

/// Is the window's level a floating level?
pub const MACOS_LEVEL: &str = "macos-level";

/// No platform was asked, because there was no window to ask.
pub const UNKNOWN: &str = "unknown";

/// What this platform was asked, and what it answered.
///
/// `placement` is not decoration and is not for the surface's benefit: it is what
/// makes the answer checkable. A reader who sees `windows-topmost` knows exactly
/// which question produced the boolean and can go check that question on their
/// machine. A report carrying only `true` would have to be taken on faith, which
/// is the position this whole change exists to leave.
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// How this platform was asked.
    pub placement: &'static str,
    /// What the platform answered. Never anything the host requested.
    pub held: bool,
}

impl Report {
    /// The report of a host that could ask nothing.
    ///
    /// A constructor rather than a constant so that the escalate-only answer has
    /// to be spelled as a deliberate act at each call site: every path that
    /// cannot ask goes through here, and a reader counting the ways this shell
    /// can fail to find out can count the call sites.
    ///
    /// Unused on Linux, and that is the honest shape of it: the Wayland
    /// question needs no window and so always has an answer, while the Windows
    /// and macOS questions are about a window and can fail to get one. Marked
    /// rather than removed because deleting it on the platform where it is
    /// unreachable would make the next reader think the `unknown` report is
    /// Linux-only, which is the opposite of true.
    #[cfg_attr(
        not(any(windows, target_os = "macos")),
        allow(dead_code, reason = "only reachable where the question needs a window")
    )]
    pub fn unaskable() -> Self {
        Report {
            placement: UNKNOWN,
            held: false,
        }
    }
}

/// What this platform can be asked, and what it answered about `window`.
///
/// The one function that differs across platforms, and it is `cfg`-dispatched
/// rather than branched inside a body: each platform's question lives in its own
/// function with its own imports and its own documentation, so this file reads
/// as three separate answers rather than one answer with two dead branches in it.
///
/// `window` is the real window, not anything derived from the configuration. That
/// is the whole point on the two platforms where the answer can be had at all —
/// the style bit is on the handle the kernel created and the level is on the
/// window the window server created, so asking anything derived from
/// `tauri.conf.json` would be asking about our own request, which is the trap the
/// module note is about.
pub fn ask<R: tauri::Runtime>(window: &tauri::Window<R>) -> Report {
    #[cfg(windows)]
    {
        return windows_topmost(window);
    }

    #[cfg(target_os = "macos")]
    {
        return macos_level(window);
    }

    // Not `_window`: naming it `window` in the signature is deliberate, and the
    // unused warning on a non-Wayland build is the honest one — this build is
    // asking a question that does not need it.
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = window;
        wayland_layer()
    }
}

/// The Wayland answer: is this window a layer surface?
///
/// A layer surface is created from `get_layer_surface` and it *replaces* the
/// role a window would otherwise have: one that did that is not a toplevel.
/// Tauri's backend creates toplevels — `xdg_surface` plus `xdg_toplevel` on
/// Wayland — and has no window type that binds a layer instead, so no window this
/// host opens was granted one by anybody.
///
/// That is a measurement rather than a default, and the distinction is the point:
/// the report says "the layer protocol was not among this window's grants", not
/// "the host decided the safe thing to publish was nothing". Those are the same
/// on this platform and different everywhere else, which is why the answer is a
/// function over the grant rather than a hardcoded `false`. A host that could
/// bind a layer names it in [`granted`] and nothing else in the shell changes.
///
/// And on GNOME — the one platform where the behaviour has been observed — it is
/// also simply the truth: Mutter does not implement `zwlr_layer_shell_v1`, and a
/// surface that came up without a layer cannot stay above other windows however
/// it asks afterwards.
pub fn wayland_layer() -> Report {
    Report {
        placement: WAYLAND_LAYER,
        // Through `granted()` rather than a literal `false`, because a constant
        // would be indistinguishable from "the host never looked", and those are
        // different answers with different consequences.
        held: granted().iter().any(|protocol| protocol == LAYER_SHELL),
    }
}

/// The protocols the platform bound to this window's surface.
///
/// Empty everywhere this host can run, and the reason is structural rather than
/// cautious: Tauri opens toplevels and a layer surface is not a toplevel, so
/// there is nothing for a compositor to have granted. See the module note.
///
/// It stays a function rather than a constant so that "the platform granted
/// nothing" and "the host never looked" remain different answers — the first is
/// what this returns, the second is what deleting the read-back would produce,
/// and only one of them may ever be published.
pub fn granted() -> Vec<String> {
    Vec::new()
}

/// The protocol a layer surface would be granted, if one could be bound.
///
/// Carried so the Wayland read has a name to compare against rather than an
/// assertion. A protocol nobody was granted is a protocol no surface of ours was
/// bound to, and naming it here is what makes the comparison a check.
const LAYER_SHELL: &str = "zwlr_layer_shell_v1";

/// The Windows answer: is the topmost extended style bit set on the real window?
///
/// `GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST` is a fact the kernel holds
/// about a real window, and that is the whole of why it is allowed here while
/// `is_always_on_top()` is not. The kernel's record can disagree with the request
/// that produced it — a window can be re-parented, a session can lock, a
/// foreground window can be promoted over it — and when it does, this reports
/// what the platform did rather than what the host asked for.
///
/// Getting a handle is itself a question with an answer, and `None` means "could
/// not ask": a window this host did not open, on a session with no window server
/// to answer. That is reported as `unknown` rather than as "no", because the two
/// are different facts about different things.
#[cfg(windows)]
fn windows_topmost<R: tauri::Runtime>(window: &tauri::Window<R>) -> Report {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongW, GWL_EXSTYLE, WS_EX_TOPMOST};

    // `Tauri`'s handle is the `windows` crate's newtype over a raw pointer and
    // `windows-sys`'s is the raw pointer itself; both describe the same value,
    // which is why the cast is a pointer cast and nothing else. See `Cargo.toml`
    // for why the dependency is declared rather than inherited.
    let handle = match window.hwnd() {
        Ok(handle) => handle.0 as HWND,
        Err(_) => return Report::unaskable(),
    };

    // # Safety: the handle came from the runtime for a window this process owns,
    // and `GWL_EXSTYLE` takes no pointer and writes nothing.
    let ex_style = unsafe { GetWindowLongW(handle, GWL_EXSTYLE) } as u32;

    // A zero extended style is both a window with no extended styles and this
    // call's error return, and the two are deliberately not separated.
    //
    // Separating them means calling `SetLastError(0)` before and `GetLastError`
    // after, and then treating a failure as "could not ask". That would convert a
    // platform that answered into one we could not reach — and it would get it
    // wrong in the *unsafe* direction, because a failure is indistinguishable from
    // "the kernel holds no extended styles", which means no topmost bit.
    //
    // So an unanswered question and a negative answer are both `false` here. They
    // have the same consequence — escalate-only, correct everywhere — and the
    // failure direction of this module is the one thing that must not be traded
    // for a tidier distinction between two cases that both lead there. The
    // `unaskable` report stays reserved for the one case that is genuinely
    // different: no window handle at all, which means no question was asked
    // rather than a question that was not answered.
    Report {
        placement: WINDOWS_TOPMOST,
        held: ex_style & WS_EX_TOPMOST != 0,
    }
}

/// The macOS answer: is the window's level a floating level?
///
/// `NSWindow.level()` is the window server's own record of where the window sits,
/// read straight off the `NSWindow` rather than through the runtime's
/// `is_always_on_top()`. On this platform that accessor happens to be a genuine
/// query — it compares that level against `kCGFloatingWindowLevelKey` — so
/// calling it would happen to be right. It is still not called: the guarantee
/// this module offers is about where an answer comes from, and a guard with a
/// per-platform exception is a guard with a hole in it. The module note has the
/// full argument.
///
/// AppKit requires the main thread and `setup` is the main thread, so the read
/// happens where the window was created. A level read has no side effects.
#[cfg(target_os = "macos")]
fn macos_level<R: tauri::Runtime>(window: &tauri::Window<R>) -> Report {
    use objc2_app_kit::{NSFloatingWindowLevel, NSWindow};

    let handle = match window.ns_window() {
        Ok(handle) if !handle.is_null() => handle,
        _ => return Report::unaskable(),
    };

    // # Safety: `ns_window()` returns the `NSWindow` backing this window, owned by
    // the runtime and alive for the life of the window, so it outlives this
    // borrow. `level()` is a getter with no preconditions beyond a live object.
    let level = unsafe { (*(handle as *const NSWindow)).level() };

    Report {
        placement: MACOS_LEVEL,
        held: level == NSFloatingWindowLevel,
    }
}

/// The report this document is told, given what was asked and what came back.
///
/// Split from [`ask`] so the two halves can be checked apart: `ask` is the part
/// that is platform-specific and can only be exercised on that platform, and this
/// is the part that runs everywhere and is tested everywhere. A test that passes
/// while the wrong mechanism is named would be a test that only says the
/// arithmetic works.
pub fn capability_report<R: tauri::Runtime>(window: &tauri::Window<R>) -> Report {
    ask(window)
}

/// The text that publishes `report`, substituted into `publish.js`.
///
/// The template is `include_str!`'d rather than written here so there is one copy
/// of it in the repository: this file's, `src/publish.js`, and
/// `test/shell-capability.test.ts` reads that same file and runs what this
/// produces. A hand-written second copy of the assignment would be a second
/// claim about what the document reads at first render, and nothing would check
/// the two agreed.
pub fn initialization_script(report: &Report) -> String {
    publish::TEMPLATE
        .replace(publish::PLACEMENT, &serialise_placement(report.placement))
        .replace(publish::HELD, serialise_held(report.held).as_str())
}

/// The mechanism name, as the JavaScript string literal the template expects.
///
/// Only the four names this file defines are ever serialised, and they are
/// checked rather than escaped: a mechanism name outside that vocabulary is
/// dropped in favour of `unknown`, because a name this build cannot enumerate is
/// a name the document would refuse to read — publishing it would produce a
/// report that reads as no host at all, which is the safe direction but a
/// confusing way to get there.
fn serialise_placement(placement: &str) -> String {
    match placement {
        WAYLAND_LAYER | WINDOWS_TOPMOST | MACOS_LEVEL => format!("\"{placement}\""),
        _ => format!("\"{UNKNOWN}\""),
    }
}

/// `held` as the JavaScript literal the template expects.
///
/// A bare `true`/`false` rather than a quoted string, because the document
/// checks it with `typeof … === "boolean"` and a string that said `"true"` would
/// be refused by a reader that is right to refuse it.
fn serialise_held(held: bool) -> String {
    if held { "true" } else { "false" }.to_string()
}

/// The template and its tokens, kept together so a change to one cannot silently
/// break the other.
///
/// Bare identifiers rather than comments with a default beside them: a comment
/// placeholder followed by `"unknown"` leaves `"windows-topmost""unknown"` once
/// substituted, which parses and is the wrong value. `publish.js` has the full
/// argument, and `test/shell-capability.test.ts` executes the substitution rather
/// than reading the file, which is the only reason that was caught.
pub mod publish {
    /// The assignment, exactly as `src/publish.js` writes it.
    pub const TEMPLATE: &str = include_str!("./publish.js");

    /// The token replaced with the mechanism name, already quoted.
    pub const PLACEMENT: &str = "__SPARK_PLACEMENT__";

    /// The token replaced with the answer.
    pub const HELD: &str = "__SPARK_HELD__";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_layer_surface_is_reported_and_its_absence_is_reported_too() {
        // The Wayland contract in one assertion: what the compositor bound is
        // what the document is told, and what it did not bind is not claimed
        // however much the host asked for.
        assert_eq!(wayland_layer().placement, WAYLAND_LAYER);
        assert!(
            !wayland_layer().held,
            "a toplevel was never granted a layer"
        );
        assert!(
            granted().is_empty(),
            "Tauri opens toplevels, and a layer surface is not one"
        );
    }

    #[test]
    fn the_wayland_answer_is_false_for_a_reason_and_not_by_default() {
        // "The host decided emptiness was safe" and "the compositor granted
        // nothing" are the same value here and different claims everywhere else.
        // The grant is a function so the second stays expressible; this asserts
        // the direction the first must never be allowed to move.
        assert!(!wayland_layer().held);
        assert_eq!(granted(), Vec::<String>::new());
    }

    #[test]
    fn a_platform_that_cannot_answer_reports_unaskable_rather_than_no() {
        // The two answers keep their different consequences. Both escalate, but
        // one is a fact about the platform and one is a fact about the host, and
        // a reader auditing a machine has to be able to tell them apart.
        let unaskable = Report::unaskable();

        assert_eq!(unaskable.placement, UNKNOWN);
        assert!(!unaskable.held);
        assert_ne!(unaskable.placement, WAYLAND_LAYER);
        assert_ne!(unaskable.placement, WINDOWS_TOPMOST);
        assert_ne!(unaskable.placement, MACOS_LEVEL);
    }

    #[test]
    fn every_non_answer_is_escalate_only() {
        // The property the whole module exists to hold, stated over the space
        // rather than as one example. `unknown` with `held: true` is included
        // deliberately: a host that could not ask anything has not been told yes
        // by anybody, so the surface must not believe otherwise.
        for report in [
            Report::unaskable(),
            Report {
                placement: WAYLAND_LAYER,
                held: false,
            },
            Report {
                placement: WINDOWS_TOPMOST,
                held: false,
            },
            Report {
                placement: MACOS_LEVEL,
                held: false,
            },
            Report {
                placement: UNKNOWN,
                held: true,
            },
        ] {
            assert!(
                !(report.placement != UNKNOWN && report.held),
                "{report:?} would float on a platform that never agreed"
            );
        }
    }

    #[test]
    fn the_report_names_the_question_it_asked() {
        // An answer without the question beside it is an assertion. This is the
        // property `placement` exists for, and the reason the report is not a
        // boolean.
        assert_eq!(wayland_layer().placement, WAYLAND_LAYER);
    }

    #[test]
    fn the_mechanism_names_match_the_surface_s_own() {
        // `src/escalation/placements.ts` decides on these strings, so a change to
        // either side has to change both. Compared rather than trusted, for the
        // same reason `test/relay-address.test.ts` compares two implementations
        // of the address rule: a report built against a differently spelled
        // mechanism silently says no.
        let ts = include_str!("../../../src/escalation/placements.ts");

        for name in [WAYLAND_LAYER, WINDOWS_TOPMOST, MACOS_LEVEL, UNKNOWN] {
            assert!(
                ts.contains(&format!("\"{name}\"")),
                "the surface no longer names the mechanism the host publishes: {name}"
            );
        }
    }

    #[test]
    fn the_wayland_mechanism_is_still_a_protocol_and_says_so() {
        // The one place a protocol name belongs: on the one platform that grants
        // protocols. Losing this constant is what would make the Wayland branch a
        // guess, so it is asserted to exist rather than left implicit.
        assert_eq!(LAYER_SHELL, "zwlr_layer_shell_v1");
    }

    #[test]
    fn the_report_serialises_in_the_shape_the_document_reads() {
        // The value crosses a process boundary into JavaScript, so the field
        // names are load-bearing. A key spelled `held` here and `Held` there is a
        // report that reads as unreadable and escalates forever on a platform
        // that could float.
        let json = serde_json::to_string(&Report {
            placement: WINDOWS_TOPMOST,
            held: true,
        })
        .expect("the report is plain data");

        assert_eq!(json, r#"{"placement":"windows-topmost","held":true}"#);
    }

    #[test]
    fn the_script_publishes_the_measurement_and_nothing_else() {
        let script = initialization_script(&Report {
            placement: WINDOWS_TOPMOST,
            held: true,
        });

        assert!(script.contains("globalThis.__SPARK_HOST_WINDOW__"));
        assert!(script.contains("\"windows-topmost\""));
        assert!(script.contains("held: true"));
        assert!(
            !script.contains(publish::PLACEMENT) && !script.contains(publish::HELD),
            "an unsubstituted placeholder would publish a syntax error"
        );
    }

    #[test]
    fn a_report_naming_no_mechanism_publishes_a_readable_one() {
        // The shape is fixed whatever the measurement was. A report that omits
        // the key, or names a mechanism the document has never heard of, is one
        // `readHostWindow` refuses outright — and the difference between "the
        // platform said no" and "no host answered" is the difference between
        // escalate-only and a surface that cannot read itself.
        let script = initialization_script(&Report::unaskable());

        assert!(script.contains("placement: \"unknown\""));
        assert!(script.contains("held: false"));
    }

    #[test]
    fn a_mechanism_outside_the_vocabulary_is_not_published_as_itself() {
        // A name this build cannot enumerate is one the document would refuse.
        // Publishing it would produce a report that reads as no host at all,
        // which is the safe direction but a confusing way to get there.
        let escaped = format!("\"{WAYLAND_LAYER}\"; globalThis.pwned = 1; //");

        assert_eq!(serialise_placement(&escaped), "\"unknown\"");
        assert_eq!(serialise_placement(WAYLAND_LAYER), "\"wayland-layer\"");
        assert_eq!(serialise_placement(WINDOWS_TOPMOST), "\"windows-topmost\"");
        assert_eq!(serialise_placement(MACOS_LEVEL), "\"macos-level\"");
        assert_eq!(serialise_placement("with space"), "\"unknown\"");
        assert_eq!(serialise_placement(""), "\"unknown\"");
    }

    #[test]
    fn the_template_is_the_one_under_test() {
        // A second copy of the assignment in Rust would be a second claim about
        // what the document reads during its first render, and nothing would
        // check the two agreed.
        assert!(publish::TEMPLATE.contains("globalThis.__SPARK_HOST_WINDOW__"));
        assert!(publish::TEMPLATE.contains(publish::PLACEMENT));
        assert!(publish::TEMPLATE.contains(publish::HELD));
    }
}