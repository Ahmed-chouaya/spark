//! What the platform granted, published at the seam the surface reads.
//!
//! # The whole of this module's job
//!
//! Three functions, in order:
//!
//! ```
//!   granted_protocols()          what the platform bound to this window's surface
//!     -> capability_report()    what the document is told, given what was asked for
//!       -> initialization_script()   the text that assigns it, before the page runs
//! ```
//!
//! Nothing else lives here, because the correctness of the whole shell rests on
//! one of these three being wrong in a particular way. Step 2 is a function of
//! the *grant*; if it were a function of the request instead, the surface would
//! believe it is floating on a compositor that never agreed, which is the one
//! failure this module exists to prevent. `test/shell-capability.test.ts` pins
//! the step-2 contract from both sides, and `test/shell-shape.test.ts` pins that
//! nothing here or in `main.rs` derives a report from anything but the read-back.
//!
//! # Why the grant is empty on every platform this host can build on
//!
//! `zwlr_layer_shell_v1` places a client in a layer of its own, and it does so
//! by *replacing* the role a window would otherwise have: a layer surface is
//! created from `get_layer_surface`, and a window that did that is not a
//! toplevel. Tauri's window backend creates toplevels — `xdg_surface` plus
//! `xdg_toplevel` on Wayland, `WS_OVERLAPPED` on Windows — and has no window
//! type that binds a layer instead. So no window this host opens was granted a
//! layer by anybody, on any compositor, and the honest report is the empty
//! list.
//!
//! That is a measurement rather than a default, and the distinction is the
//! whole point. The list is empty because the read-back found nothing bound,
//! not because the host decided emptiness was the safe thing to say. A host
//! that could bind a layer would name the protocol here and the rest of the
//! shell would carry it without changing.
//!
//! The consequence is stated rather than worked around: **this shell runs
//! escalate-only.** It appears when something is blocked and is otherwise
//! absent, on every platform, because it cannot yet demonstrate that a
//! persistent surface survives. `docs/platform-findings.md` records that a
//! persistent surface does work on Windows 11 — observed, not probed — and that
//! gap is real and is recorded in `shell/README.md` rather than papered over by
//! publishing a protocol name the platform never bound.

use std::collections::BTreeSet;

use serde::Serialize;

/// The protocol whose presence is what makes a persistent surface possible.
///
/// The same string `src/escalation/capability.ts` names, for the same reason:
/// it is the deciding fact rather than a proxy for it. `test/shell-capability`
/// compares the two, because a report built against a differently spelled
/// protocol is a report that silently says no.
pub const LAYER_SHELL: &str = "zwlr_layer_shell_v1";

/// The protocols the host asks the platform for, before it opens anything.
///
/// Carried only so the report can say what it declined to publish. A protocol
/// nobody asked for is a protocol no surface of ours was bound to, and
/// publishing one would be the same mistake as publishing a request: reporting
/// the host's own words back as the platform's.
pub const REQUESTED: [&str; 1] = [LAYER_SHELL];

/// The report, as the document reads it: a list of protocols, never a boolean.
///
/// Modelled in Rust as well as in `src/escalation/capability.ts` because this
/// is the value that crosses the seam and the two ends have to agree about its
/// shape. The agreement is checked by reading both, not by hoping.
#[derive(Serialize)]
pub struct Report {
    /// Protocols the platform bound to this window's surface.
    pub protocols: Vec<String>,
}

/// What the platform bound to this window's surface.
///
/// See the module note for why this is empty everywhere at the moment. It stays
/// a function rather than a constant so that "the platform granted nothing" and
/// "the host never looked" remain different answers: the first is what this
/// returns, the second is what removing the read-back would produce, and only
/// one of them may ever be published.
pub fn granted_protocols() -> Vec<String> {
    Vec::new()
}

/// The protocols to publish, given what was asked for and what was granted.
///
/// The grant is the answer. The request exists here only to be subtracted, so
/// that the two halves of the mistake cannot be confused: a host that reported
/// its own request would produce a surface that believes it is floating while
/// it is not, and the failure direction is chosen rather than incidental —
/// reporting no layer is correct on every platform and the opposite is correct
/// on none.
///
/// Ordering is a set, so the same grant produces the same report on every run
/// and a diff between two machines' startup logs is a difference in what was
/// granted rather than in how a hash map happened to iterate.
pub fn capability_report(requested: &[&str], granted: &[String]) -> Report {
    let asked: BTreeSet<&str> = requested.iter().copied().collect();

    // Collected into a set rather than filtered in place, so the report is
    // sorted and deduplicated. The platform enumerated the protocols in
    // whatever order its registry handed them over, and a report that carried
    // that order would differ between two runs on one machine — which is the
    // sort of difference that gets read as a platform difference.
    let published: BTreeSet<String> = granted
        .iter()
        .filter(|protocol| asked.contains(protocol.as_str()))
        .cloned()
        .collect();

    Report {
        protocols: published.into_iter().collect(),
    }
}

/// The text that publishes `report`, substituted into `publish.js`.
///
/// The template is `include_str!`'d rather than written here so there is one
/// copy of it in the repository: this file's, `src/publish.js`, and
/// `test/shell-capability.test.ts` reads that same file and runs what this
/// produces. A hand-written second copy of the assignment would be a second
/// claim about what the document reads at first render, and nothing would check
/// the two agreed.
pub fn initialization_script(report: &Report) -> String {
    publish::TEMPLATE.replace(publish::PLACEHOLDER, &serialise(&report.protocols))
}

/// The report's protocol list as the JSON array the template expects.
///
/// Hand-serialised rather than derived from `serde_json`, for one reason: the
/// output is JavaScript source that runs before the page's own code, and the
/// only strings in it are protocol names the host chose from a fixed vocabulary.
/// `protocol_names_are_json_safe` in the tests below is the guard that keeps
/// that true, and it fails the build rather than trusting it.
fn serialise(protocols: &[String]) -> String {
    let quoted: Vec<String> = protocols
        .iter()
        .filter_map(|protocol| {
            if protocol.is_ascii()
                && protocol
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                && !protocol.is_empty()
            {
                Some(format!("\"{protocol}\""))
            } else {
                None
            }
        })
        .collect();

    format!("[{}]", quoted.join(", "))
}

/// The template and the placeholder inside it, kept together so a change to one
/// cannot silently break the other.
pub mod publish {
    /// The assignment, exactly as `src/publish.js` writes it.
    pub const TEMPLATE: &str = include_str!("./publish.js");

    /// The token replaced with the JSON protocol list.
    pub const PLACEHOLDER: &str = "/*__SPARK_PROTOCOLS__*/";
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPTY: Vec<String> = Vec::new();

    fn names(protocols: &[String]) -> Vec<&str> {
        protocols.iter().map(String::as_str).collect()
    }

    #[test]
    fn a_grant_is_published_and_an_absent_one_is_not() {
        // The whole of the contract in one assertion: what the platform bound is
        // what the document is told, and what it did not bind is not in the list
        // however much it was asked for.
        let granted = vec![LAYER_SHELL.to_string()];

        assert_eq!(
            names(&capability_report(&REQUESTED, &granted).protocols),
            vec![LAYER_SHELL]
        );
        assert!(capability_report(&REQUESTED, &EMPTY).protocols.is_empty());
    }

    #[test]
    fn a_protocol_that_was_never_asked_for_is_not_published() {
        // The other direction of the same rule. The platform may bind protocols
        // for reasons of its own; a surface of ours was not bound to them, and
        // naming them would be the host reporting its own words as the
        // platform's.
        let granted = vec!["wl_compositor".to_string(), LAYER_SHELL.to_string()];

        assert_eq!(
            names(&capability_report(&REQUESTED, &granted).protocols),
            vec![LAYER_SHELL]
        );
    }

    #[test]
    fn nothing_is_published_from_an_empty_grant() {
        // The answer every platform currently gets, stated as an assertion so a
        // change that starts inventing protocols has to change this line too.
        assert!(capability_report(&REQUESTED, &EMPTY).protocols.is_empty());
        assert!(capability_report(&[], &vec![LAYER_SHELL.to_string()])
            .protocols
            .is_empty());
    }

    #[test]
    fn the_same_grant_publishes_in_the_same_order_every_time() {
        let granted = vec![
            LAYER_SHELL.to_string(),
            "wl_shm".to_string(),
            "xdg_wm_base".to_string(),
        ];
        let requested = ["xdg_wm_base", "wl_shm", LAYER_SHELL];

        let first = capability_report(&requested, &granted);
        let second = capability_report(&requested, &granted);

        assert_eq!(first.protocols, second.protocols);
        assert_eq!(
            names(&first.protocols),
            vec!["wl_shm", "xdg_wm_base", LAYER_SHELL],
            "sorted, so two machines' reports differ only when the grant does"
        );
    }

    #[test]
    fn the_script_publishes_the_grant_and_nothing_else() {
        let script = initialization_script(&capability_report(
            &REQUESTED,
            &vec![LAYER_SHELL.to_string()],
        ));

        assert!(script.contains("globalThis.__SPARK_HOST_WINDOW__"));
        assert!(script.contains("["));
        assert!(
            !script.contains(publish::PLACEHOLDER),
            "an unsubstituted placeholder would publish a syntax error"
        );
    }

    #[test]
    fn an_empty_grant_publishes_an_empty_list_rather_than_nothing() {
        // The shape is fixed whatever the grant is. A report that omits the key
        // is a report `readHostWindow` rejects outright, and the difference
        // between "no layer" and "no host at all" is the difference between
        // escalate-only and a surface that cannot read itself.
        let script = initialization_script(&capability_report(&REQUESTED, &EMPTY));

        assert!(script.contains("protocols: []"));
    }

    #[test]
    fn protocol_names_are_json_safe() {
        // Every name the host could ever publish comes from the platform, and
        // this is the only thing standing between a name containing a quote and
        // JavaScript that does not parse. Anything not obviously safe is dropped
        // rather than escaped, because a protocol name that needs escaping is a
        // protocol name this host should not be reporting anyway.
        assert_eq!(serialise(&[LAYER_SHELL.to_string()]), "[\"zwlr_layer_shell_v1\"]");
        assert_eq!(serialise(&EMPTY), "[]");
        assert_eq!(serialise(&["a\"]; globalThis.pwned = 1; //".to_string()]), "[]");
        assert_eq!(serialise(&["with space".to_string()]), "[]");
        assert_eq!(serialise(&["".to_string()]), "[]");
    }

    #[test]
    fn the_protocol_name_matches_the_one_the_surface_checks_for() {
        // `src/escalation/capability.ts` decides on a literal string, so a
        // change to either side has to change both. Compared here rather than
        // trusted, for the same reason `test/relay-address.test.ts` compares two
        // implementations of the address rule.
        let ts = include_str!("../../../../src/escalation/capability.ts");

        assert!(
            ts.contains(&format!("\"{LAYER_SHELL}\"")),
            "the surface no longer names the protocol the host publishes"
        );
    }
}
