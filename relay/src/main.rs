//! The relay: read a payload from standard input, deliver it to the companion,
//! exit.
//!
//! # Why this program translates nothing
//!
//! It reads bytes, writes bytes, and stops. There is no parsing, no field
//! names, and no mapping from one vocabulary to another here, and there will
//! not be one added.
//!
//! The host agent's events have to become the companion's canonical events
//! somewhere. That somewhere is the companion's own adapter, which is already
//! written and already tested against real payload shapes. If the translation
//! also lived here, the host's vocabulary would exist twice: once where it is
//! exercised, and once where nothing runs it. Two implementations of one
//! contract, one of which no test touches, is how a contract quietly rots — and
//! the second copy would be the copy the host agent actually depends on.
//!
//! So the rule is enforced from both ends. This file stays small enough to read
//! in full, and a test reads *this source* and fails if a host's event names
//! appear in it. The property is about the shape of the program, so it is
//! checked against its shape: behaviour tests would pass just as happily with
//! an interpreter bolted on the front.
//!
//! # Why this program never waits
//!
//! It writes the payload and exits. There is no read after the write, no
//! acknowledgement to wait for, and no timeout — because there is nothing to
//! wait *for*.
//!
//! That is the whole of this program's contribution to the host agent being
//! unharmed by an absent companion. No branch exists here in which "the
//! companion did not answer" can turn into "the user's agent failed", because
//! by the time such a branch would matter this process has already exited with
//! success. The property is structural rather than defensive, which is why it
//! holds under the conditions nobody thought to test.
//!
//! It is also why blocking hooks are *not* installed here. A hook that must
//! wait for a response reintroduces exactly the branch this design removes, and
//! that is a change with its own name and its own review.
//!
//! Every exit from this program is a success, including every failure. If the
//! companion is not running, the channel does not exist, or the payload on
//! standard input is not usable, the answer is the same: deliver nothing, tell
//! the host nothing, exit `0`.

mod address;

use std::io::{Read, Write};

/// The most this program will read from standard input, in bytes.
///
/// A hook payload is a small JSON object. This bound is not a guess about that
/// size — it is there so that a process which never closes its standard input
/// cannot make this one grow without limit, in a program the host agent spawns
/// and expects to exit.
///
/// Past the bound the payload is *unusable*, and unusable means exactly what it
/// means anywhere else in this program: nothing is delivered and the exit is
/// still `0`. Truncated delivery is not offered as an alternative, because half
/// a payload is something the companion would have to recognise and refuse, and
/// the place to recognise a payload is the adapter.
const MAX_PAYLOAD_BYTES: usize = 1 << 20;

/// Deliver whatever arrived on standard input to the companion.
///
/// Returns nothing on every path. The caller exits `0` either way; that is the
/// contract with the host agent, and it is enforced here by this function
/// having no error to propagate.
fn deliver_to_companion() {
    let mut payload = Vec::new();
    // `take` rather than `read_to_end` so an endless standard input stops at the
    // bound instead of at EOF.
    let read = std::io::stdin()
        .lock()
        .take(MAX_PAYLOAD_BYTES as u64 + 1)
        .read_to_end(&mut payload);

    // Standard input could not be read at all, or kept going past the bound.
    // Both mean there is no payload to deliver, which is a normal outcome.
    if read.is_err() || payload.len() > MAX_PAYLOAD_BYTES {
        return;
    }

    // Nothing to deliver, and no companion to deliver it to. An empty hook
    // payload is silence, not an error.
    if payload.is_empty() {
        return;
    }

    let Some(path) = address::companion_address() else {
        return;
    };

    write_to_companion(&path, &payload);
}

/// Open the companion's channel and write the payload to it.
///
/// Connection and write failures are dropped here. The companion may not be
/// running; if it is running it may not be reading; either way this program has
/// finished its job the moment the bytes are away, and the host agent must not
/// be told about any of it.
fn write_to_companion(path: &str, payload: &[u8]) {
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;

        // Connected, not listening: this side is the one that leaves.
        let Ok(mut stream) = UnixStream::connect(path) else {
            return;
        };
        let _ = stream.write_all(payload);
        // Explicitly closed rather than left to drop, so the companion sees end
        // of payload before this process is reaped. `write_all` has already
        // handed every byte to the kernel; nothing here waits for the far end.
    }

    #[cfg(windows)]
    {
        use std::fs::OpenOptions;

        // A named pipe is reached through the filesystem namespace as a file.
        // Reading as well as writing is not for a reply — it is because the
        // pipe's access mask has to be bidirectional for a client to connect.
        let Ok(pipe) = OpenOptions::new().read(true).write(true).open(path) else {
            return;
        };
        let mut pipe = pipe;
        let _ = pipe.write_all(payload);
    }
}

fn main() {
    deliver_to_companion();
    std::process::exit(0);
}