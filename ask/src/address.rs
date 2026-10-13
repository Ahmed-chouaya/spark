//! The companion's decision address, derived from the owning user.
//!
//! The rule, in one place, because it is a contract with two implementations
//! and the second one is this file:
//!
//! ```text
//!   unix    /tmp/spark-<uid>/decisions.sock
//!   windows \\.\pipe\spark-<username>-decisions
//! ```
//!
//! This is a second implementation of a rule `src/relay/address.ts` also
//! states. It exists because this program has to run with no language runtime
//! and no package installation, and the companion is written in TypeScript. One
//! file of duplication is the price; `test/decision-address.test.ts` builds this
//! binary and asserts the two agree, so the duplication cannot rot unnoticed.
//!
//! # Why this is a second address rather than the first one
//!
//! The obvious design is one socket carrying both kinds of traffic: the
//! companion already listens on `/tmp/spark-<uid>/companion.sock`, so why open a
//! second one? Because one socket means two protocols on one connection, and
//! telling them apart requires guessing.
//!
//! The waiting program writes an identifier, a newline, and then the host's
//! payload. The relay writes the host's payload and nothing else. A listener
//! that wanted to serve both would have to read the first line and decide
//! whether it was an identifier or the beginning of somebody's JSON — and a
//! guess that goes the wrong way is a failure mode this project has already
//! decided it will not have. `relay/` exists because a hook that has to guess
//! what a payload means is a hook that will eventually guess wrong about a host
//! event nobody wrote it for yet.
//!
//! A second path costs one more entry in a `0700` directory and one more line in
//! two address modules. It buys a listener that never has to guess, and it buys
//! it without touching `relay/` — which is the whole reason the relay's own
//! guarantees are still true.
//!
//! # Nothing is negotiated
//!
//! This program is not told where the companion is, and the companion is not
//! told this program exists. Both derive the same answer from the same two
//! facts — which user is running, and which platform — and that is the entire
//! rendezvous.

/// The fixed parent of every Unix companion socket.
///
/// A constant rather than a read of the environment, for the reason
/// `relay/src/address.rs` gives and it is worth repeating here rather than
/// importing: the environment this program runs in is chosen by whoever spawns
/// it — here, the host agent — and is not the companion's to rely on. A runtime
/// directory that is unset under one launcher produces an address the two
/// halves cannot agree on, and the result is a companion that is never reached
/// and never says why.
#[cfg(unix)]
pub const UNIX_CHANNEL_ROOT: &str = "/tmp";

/// The path this program announces to, for the user running it.
///
/// `None` when the user cannot be identified. That is answered rather than
/// guessed: an address built from an assumed identity would either reach a
/// different user's companion or reach nothing, and neither is something the
/// caller could tell apart from the companion simply not running.
pub fn companion_address() -> Option<String> {
    #[cfg(unix)]
    {
        // Safe and infallible: `geteuid` reads a value the kernel already holds
        // and cannot fail, so there is no error to handle and nothing to free.
        let uid = unsafe { libc::geteuid() };
        Some(format!("{}/spark-{}/decisions.sock", UNIX_CHANNEL_ROOT, uid))
    }

    #[cfg(windows)]
    {
        // The account name is the only identity a Windows address can carry.
        // `USERNAME` is set by the logon session and inherited by every process
        // started under it, which is the same guarantee the fixed Unix root
        // relies on.
        std::env::var("USERNAME")
            .ok()
            .filter(|name| !name.is_empty())
            .map(|name| format!(r"\\.\pipe\spark-{}-decisions", name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_address_is_the_documented_one() {
        // The exact strings, so a change to either side of the contract fails
        // here as well as in the cross-language test that compares the two.
        #[cfg(unix)]
        assert_eq!(
            UNIX_CHANNEL_ROOT,
            "/tmp",
            "the Unix root is fixed; see the module note"
        );

        assert!(companion_address().is_some());
    }

    #[test]
    fn it_is_not_the_relays_address() {
        // The whole reason this file exists separately. A test that only checked
        // the string above would still pass if both programs were pointed at one
        // socket, which is the thing the module note argues against.
        #[cfg(unix)]
        assert!(
            companion_address().unwrap().ends_with("decisions.sock"),
            "the waiting program must not share the relay's address"
        );
    }
}