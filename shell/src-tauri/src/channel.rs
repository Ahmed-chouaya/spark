//! The companion's end of the channel: listen, read one payload, hand the bytes on.
//!
//! # What this moves and what it does not
//!
//! Bytes. A connection carries one payload and carries it once, and the bytes go
//! from the socket to the webview without being parsed, named, decoded or
//! re-encoded on the way. Everything that knows what a payload *means* lives in
//! `src/relay/session-source.ts` and `src/state-selection/adapters`, and this
//! file is the reason that can stay true: there is nowhere here for a second
//! implementation of a host's vocabulary to hide.
//!
//! That is the same argument `relay/src/main.rs` makes about the relay, and
//! `test/shell-shape.test.ts` enforces it here for the same reason. A behaviour
//! test cannot catch it — this code would pass every functional test with an
//! interpreter bolted on the front, and the interpreter would be the copy the
//! host agent actually depends on.
//!
//! # Why this is Rust and not `src/relay/channel.ts`
//!
//! Because a webview is a browser document, and a browser document cannot open a
//! local socket. The window is the only thing in this application that can hold
//! one, so the window holds it.
//!
//! `src/relay/channel.ts` is not touched by that and is not replaced by it. The
//! rule this file follows — where the address comes from, who may connect, what
//! a stale entry means — is the rule written there, and the two are held to it
//! rather than to each other. That is the same duplication `relay/src/address.rs`
//! states, for the same reason: two languages, no shared runtime, one contract.
//!
//! # The address is handed in, not derived here
//!
//! `scripts/spark-companion.ts` derives it with `src/relay/address.ts` and passes
//! it in `SPARK_CHANNEL_ADDRESS`. That is a deliberate refusal to write a third
//! implementation of one rule in a third language: the launcher already holds the
//! answer, the relay derives the same answer independently, and
//! `test/relay-address.test.ts` compares those two. A copy here would be a third
//! answer that nothing compares, which is strictly worse than being told the one
//! that is already checked.
//!
//! Nothing is *negotiated*: the value is derived from the user's identity before
//! either side starts, and neither side can reach a different answer by asking.
//! A shell with no address in its environment refuses to start rather than
//! guessing one — a guessed address is either a different user's companion or
//! nobody's, and neither is something a user could tell apart from the companion
//! simply not running.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use interprocess::local_socket::{ListenerNonblockingMode, ListenerOptions};
use interprocess::local_socket::GenericFilePath;
use interprocess::local_socket::prelude::*;

/// The environment variable carrying the channel's address.
pub const ADDRESS_VARIABLE: &str = "SPARK_CHANNEL_ADDRESS";

/// The most this listener will accept from one connection.
///
/// The same bound, for the same reason, as `MAX_PAYLOAD_BYTES` in
/// `src/relay/channel.ts`: it bounds what is *accepted* rather than what is sent,
/// so a connection that is not the relay cannot exhaust the companion's memory.
/// Exceeding it ends the connection without a callback, which is what "nothing
/// unusable reaches state selection" means at the only place it can be enforced.
pub const MAX_PAYLOAD_BYTES: usize = 1 << 20;

/// Only the owner may read or write the socket. See `src/relay/channel.ts`.
#[cfg(unix)]
const SOCKET_MODE: u32 = 0o600;

/// And only the owner may enter the directory that holds it.
#[cfg(unix)]
const DIRECTORY_MODE: u32 = 0o700;

/// How long the reader waits before looking again.
///
/// The accept is non-blocking so that closing the channel is immediate rather
/// than a matter of whether the next connection happens to arrive — which is
/// what makes "a later start is not blocked by this one" hold on the way out and
/// not only at process exit. A tenth of a second is far below anything a person
/// notices and far above the cost of the check.
const POLL: Duration = Duration::from_millis(100);

/// How long a start will spend reclaiming an address somebody else is holding.
///
/// Bounded because an unbounded retry against a process that wants the address
/// more than this one does is a loop, not a recovery. Long enough for the common
/// case — a socket file left by a shell that has already exited — and short
/// enough that a live companion produces a refusal rather than a hang.
const TAKEOVER_SPIN: Duration = Duration::from_secs(2);

/// How long a close waits for the reader to let go of the address.
///
/// Generous against `POLL` rather than tight, because this is only ever reached
/// on the way out and a missed release shows up as a confusing `EADDRINUSE` on
/// the next start rather than as anything the user would recognise here.
const RELEASE_WAIT: Duration = Duration::from_millis(500);

/// The running channel.
pub struct Channel {
    stop: Arc<AtomicBool>,
    /// Told when the reader has dropped the listener, which is what reclaims the
    /// address. See `close`.
    released: std::sync::mpsc::Receiver<()>,
    reader: Option<std::thread::JoinHandle<()>>,
}

impl Channel {
    /// Stop reading and wait for the address to be released.
    ///
    /// The reader owns the listener, so releasing the address means the reader
    /// has finished and dropped it. Waiting for that rather than returning
    /// immediately is the whole of the requirement: a caller that reported a
    /// release that had not happened yet would be leaving the next start to
    /// discover a leftover, and "a later start is not blocked by the previous
    /// one's channel" is a property of the moment `close` returns.
    ///
    /// Bounded, because a caller on the way out is usually also about to exit the
    /// process. The accept is non-blocking, so the reader notices within one
    /// `POLL` and the bound is generous rather than tight.
    pub fn close(&mut self) {
        self.stop.store(true, Ordering::SeqCst);

        let _ = self.released.recv_timeout(RELEASE_WAIT);

        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

/// Open the channel and deliver each payload to `on_payload`.
///
/// Errors rather than panicking: the address is derived by another program, and a
/// shell that cannot listen has nothing to show a user but the reason.
pub fn open<F>(on_payload: F) -> std::io::Result<Channel>
where
    F: Fn(Vec<u8>) + Send + 'static,
{
    let address = address().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "the companion's channel address is not in {ADDRESS_VARIABLE}; \
                 start the shell with `npm run companion`"
            ),
        )
    })?;

    prepare_address(&address)?;

    // `GenericFilePath` is the name type that maps to a Unix socket path here
    // and to `\\.\pipe\…` on Windows, with no transformation either way — which is
    // the same mapping `src/relay/address.ts` already states, so the address this
    // was handed is the address the relay will connect to. `into_owned` so the
    // name no longer borrows the path it was read from.
    let name = {
        let path = address.clone();
        path.to_fs_name::<GenericFilePath>().map_err(|error| {
            std::io::Error::other(format!("{} is not a channel name: {error}", address.display()))
        })?
    };

    // Non-blocking accept, so closing is immediate rather than a matter of when
    // the next relay happens to fire. See `POLL`.
    //
    // `try_overwrite` is the "a stale channel is replaced, not refused" half of
    // `src/relay/channel.ts`: a crash leaves a socket behind, and a companion
    // that refuses to start because of one is a companion the user has to clear
    // by hand. It is safe here for the reason that module gives for removing an
    // entry at all — `prepare_address` has already established that the holding
    // directory is `0700` and ours, so nothing in it belongs to anybody else.
    // The spin bound keeps a contended address from becoming an unbounded wait.
    let listener = ListenerOptions::new()
        .name(name)
        .nonblocking(ListenerNonblockingMode::Accept)
        .try_overwrite(true)
        .max_spin_time(TAKEOVER_SPIN)
        .create_sync()?;

    restrict_to_owner(&address);

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let (released_tx, released) = std::sync::mpsc::channel();

    // The listener is moved rather than cloned, so the thread owns the socket
    // entry outright: dropping it there is what reclaims the address, and a
    // clone held here would keep the file alive after the thread had gone.
    let reader = std::thread::spawn(move || {
        // The listener is dropped at the end of this closure, which is what
        // reclaims the address: the thread owns the socket entry outright, so a
        // clone held by the caller would keep the file alive after it had gone.
        pump(listener, thread_stop, on_payload);

        // Only now is the address released. Telling `close` before this point
        // would be reporting a release that had not happened.
        let _ = released_tx.send(());
    });

    Ok(Channel {
        stop,
        released,
        reader: Some(reader),
    })
}

/// The address this shell should listen on, or `None` when it was not given one.
///
/// `None` is answered rather than guessed. See the module note.
pub fn address() -> Option<PathBuf> {
    let given = std::env::var(ADDRESS_VARIABLE).ok()?;
    let trimmed = given.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

/// Accept connections until the channel is closed, handing each payload on.
///
/// One connection carries one payload and carries it once, exactly as
/// `src/relay/channel.ts` reads it: the relay writes and exits, so waiting for a
/// second payload would be waiting for something that cannot arrive, and holding
/// the connection open while the payload is handled would let a slow webview
/// block the write of a host agent's hook.
///
/// A failed connection is dropped without a callback. The relay may have gone
/// between the hook firing and the bytes arriving, and there is nothing to tell
/// it: it has already exited successfully by design.
fn pump<F>(
    listener: LocalSocketListener,
    stop: Arc<AtomicBool>,
    on_payload: F,
) where
    F: Fn(Vec<u8>),
{
    // Readers that have attached and are being fed what the relay brings. Held
    // for the life of the channel and cleared of anything that has gone away on
    // the way through, so a watcher that exits does not leave a dead socket
    // being written to on every payload forever.
    let mut observers: Vec<LocalSocketStream> = Vec::new();

    while !stop.load(Ordering::SeqCst) {
        let connection = match listener.accept() {
            Ok(connection) => connection,
            Err(_) => {
                // Nothing waiting is the ordinary case between hooks, not a
                // failure. A Windows named pipe that goes away mid-accept is
                // also ordinary and the listener stays usable, so both are a
                // wait rather than an exit: a shell that stopped listening
                // because one client hung up would not answer the next hook,
                // which is the one failure this whole design removes.
                std::thread::sleep(POLL);
                continue;
            }
        };

        // The first byte says which of two things this is, and the two are told
        // apart by a handshake rather than by a timeout.
        //
        // A reader attaching declares itself and sends nothing else. The relay
        // never declares anything, so the channel's own protocol is unchanged and
        // a payload arriving is still a payload arriving. Deciding on a timeout
        // instead would mean the relay — which runs on somebody's critical path —
        // waiting for a reader that had gone quiet, and there is no version of
        // that which is safe.
        let mut connection = connection;
        match read_handshake(&mut connection) {
            Handshake::Observer => {
                // The whole connection, not a split write half.
                //
                // `split()` drops the half that was not kept, and on this stream
                // type dropping one half closes the socket: the first forward to
                // an observer failed with a broken pipe against a reader that was
                // still connected and still waiting. An observer is fed and never
                // read, and holding the whole connection is what keeps it fed.
                observers.push(connection);
                continue;
            }
            Handshake::Payload(first) => read_one(connection, first, &on_payload, &mut observers),
        }
    }
}

/// What a connecting peer turned out to be.
enum Handshake {
    /// A reader attaching: it sent the declared byte and will send nothing more.
    Observer,
    /// The relay delivering: the first byte of its payload, already read.
    Payload(u8),
}

/// The byte a reader sends to say it is a reader.
const OBSERVER_DECLARATION: u8 = b'O';

fn read_handshake(connection: &mut LocalSocketStream) -> Handshake {
    use std::io::Read;

    let mut first = [0u8; 1];
    match connection.read(&mut first) {
        Ok(1) if first[0] == OBSERVER_DECLARATION => Handshake::Observer,
        // Anything else is the relay, and its first byte belongs to its payload.
        Ok(1) => Handshake::Payload(first[0]),
        // Closed or empty: nothing to deliver and nothing to read. Treated as an
        // observer so it is dropped, which costs nothing and is not a failure.
        _ => Handshake::Observer,
    }
}

/// Hand one payload to every attached observer.
///
/// The shell owns the address, so an observer cannot read the channel by itself:
/// this is the one-way channel, and a reader that connects gets nothing until the
/// companion decides to give it what arrived. Interpreted nowhere — the bytes go
/// out exactly as they came in, and the observer folds them through the same
/// adapters the document does, so the two cannot disagree about what they mean.
fn forward_to_observers(observers: &mut Vec<LocalSocketStream>, payload: &[u8]) {
    use std::io::Write;

    // Best effort by design, and one failure is not a failure: an observer that
    // has gone away must not delay or fail the delivery the document needs.
    // Written back through a new vector rather than removed in place: a
    // swap-remove would move a live half while the borrow is still open, and the
    // order of observers means nothing anyway.
    // Length-prefixed, so a reader knows where one payload ends without the
    // channel having to close the connection — which it must not, because the
    // same reader is fed every payload for the life of the channel and closing
    // would turn each one into a reconnect.
    //
    // The framing is the one `read_one_request` already speaks in
    // `src/relay/channel.ts`, deliberately: a second framing here would be a
    // second thing for a reader to understand, and this one already has a test
    // on the other side of the socket.
    let header = format!("{}\n", payload.len());
    let mut alive = Vec::with_capacity(observers.len());

    for observer in observers.drain(..) {
        let mut observer = observer;
        // Flushed rather than left to the buffer: the reader is waiting on a
        // connection that stays open, so bytes that never left this process are
        // bytes that never arrive — and nothing would report it.
        if observer.write_all(header.as_bytes()).is_ok()
            && observer.write_all(payload).is_ok()
            && observer.flush().is_ok()
        {
            alive.push(observer);
        }
    }

    *observers = alive;
}

/// Read one payload from one connection, then let it go.
fn read_one<F>(
    mut connection: LocalSocketStream,
    first: u8,
    on_payload: &F,
    observers: &mut Vec<LocalSocketStream>,
)
where
    F: Fn(Vec<u8>),
{
    // Seeded with the byte the handshake already read, so nothing is lost and the
    // payload is exactly what the relay wrote.
    let mut payload = vec![first];
    let taken = connection
        .by_ref()
        .take(MAX_PAYLOAD_BYTES as u64 + 1)
        .read_to_end(&mut payload);

    // Could not be read at all, was empty, or was past the bound: all three mean
    // there is no payload to hand on. Truncated delivery is not offered as an
    // alternative, because half a payload is something the companion would have
    // to recognise and refuse, and the place to recognise a payload is the
    // adapter.
    if taken.is_err() || payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
        return;
    }

    // The observers see it before the document does, because a reader that has
    // attached for reporting is waiting and the document is not.
    forward_to_observers(observers, &payload);
    on_payload(payload);
}

/// Create the directory that will hold the socket, and refuse one we do not own.
///
/// Two barriers, both of them already stated in `src/relay/channel.ts`: the
/// holding directory is `0700` so nobody can traverse into it, and the socket
/// itself is `0600` because the OS creates it with the process umask applied.
///
/// Ownership is checked *before* the directory is used rather than after. A
/// predictable path on a shared machine can already exist — somebody else's
/// leftover, or a planted entry — and following it would put the companion's
/// socket inside a directory another user controls, which is worth more than the
/// socket itself.
#[cfg(unix)]
fn prepare_address(address: &Path) -> std::io::Result<()> {
    let Some(directory) = address.parent() else {
        return Ok(());
    };

    std::fs::create_dir_all(directory)?;

    // `create_dir_all`'s mode applies only to what it creates, so it is also set
    // on every path: an existing directory keeps whatever mode it already had.
    set_mode(directory, DIRECTORY_MODE)?;

    if let (Some(owner), Some(ours)) = (owner_of(directory), current_uid()) {
        if owner != ours {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!(
                    "refusing to use {}: it belongs to uid {owner}, not to uid {ours}",
                    directory.display()
                ),
            ));
        }
    }

    Ok(())
}

/// A named pipe is not a filesystem entry and there is no directory to lock down:
/// it lives in the `\\.\pipe` device namespace, and its own security descriptor
/// is the barrier. Nothing is lost by skipping — the same reasoning
/// `src/relay/channel.ts` gives for the same call.
#[cfg(not(unix))]
fn prepare_address(_address: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Narrow the socket to the owner, once it exists.
///
/// Runs after the listener is bound and before `open` returns, so it happens
/// before any caller can act on the channel — and the directory is already
/// `0700`, so no other user could have reached the socket in between regardless.
#[cfg(unix)]
fn restrict_to_owner(address: &Path) {
    // Deliberately not reported to anyone who could act on it. The directory
    // barrier already holds, so the worst case here is a socket that is more
    // reachable than intended *inside a directory only its owner can enter*,
    // and a startup warning about it would be noise on every launch.
    let _ = set_mode(address, SOCKET_MODE);
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

/// The uid that owns a path, or `None` where the platform or path has none.
#[cfg(unix)]
fn owner_of(path: &Path) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path).ok().map(|metadata| metadata.uid())
}

/// This process's uid, or `None` if the platform has none.
#[cfg(unix)]
fn current_uid() -> Option<u32> {
    // Safe and infallible: reads a value the kernel already holds and cannot
    // fail, so there is no error to handle and nothing to free.
    Some(unsafe { libc::geteuid() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_address_comes_from_the_environment_it_was_named_in() {
        // Pinned against the launcher rather than duplicated: `scripts/
        // spark-companion.ts` sets this exact name, and a change on either side
        // has to change both.
        let launcher = include_str!("../../../scripts/spark-companion.ts");

        assert!(
            launcher.contains(ADDRESS_VARIABLE),
            "the launcher no longer hands the shell its channel address"
        );
    }

    #[test]
    fn an_absent_address_is_refused_rather_than_guessed() {
        // A guessed address reaches a different user's companion or nobody's,
        // and neither is something a user could tell apart from the companion
        // not running. So there is no guess to make.
        assert!(address().is_none(), "the suite must not inherit an address");
    }

    #[test]
    fn the_payload_bound_is_the_one_the_channel_module_already_states() {
        // Compared rather than duplicated: a second number here would be a
        // second answer to a question `src/relay/channel.ts` already answers,
        // and only one of the two would be tested.
        let channel = include_str!("../../../src/relay/channel.ts");

        assert!(channel.contains("MAX_PAYLOAD_BYTES = 1 << 20"));
    }
}
