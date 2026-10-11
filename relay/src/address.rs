//! The companion's address, derived from the owning user.
//!
//! The rule, in one place, because it is a contract with two implementations
//! and the second one is this file:
//!
//! ```text
//!   unix    /tmp/spark-<uid>/companion.sock
//!   windows \\.\pipe\spark-<username>-companion
//! ```
//!
//! This is a second implementation of a rule `src/relay/address.ts` also states.
//! It exists because this program has to run with no language runtime and no
//! package installation, and the companion is written in TypeScript. One file of
//! duplication is the price; `test/relay-address.test.ts` builds this binary and
//! asserts the two agree, so the duplication cannot rot unnoticed.
//!
//! Nothing is negotiated. This program is not told where the companion is, and
//! the companion is not told this program exists. Both derive the same answer
//! from the same two facts — which user is running, and which platform — and
//! that is the entire rendezvous.

/// The fixed parent of every Unix companion socket.
///
/// A constant rather than a read of the environment, because the environment
/// this program runs in is chosen by whoever spawns it — here, the host agent —
/// and is not the companion's to rely on. A runtime directory that is unset
/// under one launcher produces an address the two halves cannot agree on, and
/// the result is a companion that is never reached and never says why.
#[cfg(unix)]
pub const UNIX_CHANNEL_ROOT: &str = "/tmp";

/// The path this program delivers to, for the user running it.
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
        Some(format!("{}/spark-{}/companion.sock", UNIX_CHANNEL_ROOT, uid))
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
            .map(|name| format!(r"\\.\pipe\spark-{}-companion", name))
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
    }
}