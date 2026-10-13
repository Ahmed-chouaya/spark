//! The wait: read a payload from standard input, announce it to the companion,
//! wait for an answer, print the answer — or print nothing at all.
//!
//! This program is the only thing in this repository that can make somebody's
//! coding agent stand still, and everything below follows from wanting that to
//! be invisible to a user who did not ask for it.
//!
//! # Why this is a second program rather than a mode of the relay
//!
//! `relay/` has a load-bearing property: it never waits. That property is
//! enforced from three sides — the module's own prose, `test/relay-shape.test.ts`
//! which reads the Rust source and fails if `sleep`, `timeout`, `spawn` or
//! `Duration` appear in it, and a behavioural test that delivers to a companion
//! that never reads and asserts the relay exits anyway.
//!
//! A flag on the relay would put every one of those at risk, because a flag is a
//! branch, and a branch is where "never waits" quietly stops being true — while
//! the default path keeps behaving perfectly, so nothing fails and the guarantee
//! erodes unnoticed. So this is its own crate. `relay/` has not changed and
//! `test/relay*.test.ts` pass without being edited.
//!
//! # What this program translates: nothing
//!
//! It writes an identifier, a length, and the host's payload. The host's event
//! names have to become the companion's canonical events somewhere, and that
//! somewhere is the companion's own adapter, which is written and tested. If
//! this program also interpreted a payload, the host's vocabulary would exist
//! twice: once where it is exercised, and once where nothing runs it.
//!
//! **The identifier is generated, never read out of the payload.** That is the
//! load-bearing decision in this file. The obvious identifier is already in the
//! bytes — the host gives every tool call its own — and using it would put the
//! host's vocabulary in a second program, which is the duplication the whole
//! adapter boundary exists to prevent. Generating one costs nothing: both sides
//! can see the frame, so the companion learns that "this opaque payload is
//! request X" without either side needing to know what the other meant by it.
//!
//! A test reads *this source* and fails if a host's field name or an event name
//! appears in it. The property is about the shape of the program, so it is
//! checked against its shape: behaviour tests would pass just as happily with a
//! payload parser bolted on the front.
//!
//! # What a reply is: bytes
//!
//! This program does not know what a permission decision looks like, because it
//! does not need to. The companion answers in whatever shape its host reads,
//! and this program prints those bytes once it has confirmed the reply names the
//! request it made. Two consequences, both required:
//!
//! - It cannot invent a decision. There is no branch here that turns "the user
//!   did not answer" into a decision, because this program holds no vocabulary
//!   in which to express one.
//! - It cannot carry anything extra. The bytes it prints are the bytes the
//!   companion wrote, and the companion writes a decision and nothing else.
//!
//! # The deadline, and who owns it
//!
//! The wait is bounded here, in the process that is making the host wait, and
//! never by the companion. That ownership is the point: if the bound lived
//! beside the answer, then a companion that stopped reading would hold a user's
//! agent hostage indefinitely, and the one component with the most ways to hang
//! would be holding the leash.
//!
//! So the reading happens on a second thread and the main thread waits with a
//! deadline. When the deadline passes this process prints nothing and exits.
//! The thread is still blocked in a read at that moment; the exit is what stops
//! it, which is the whole answer to "who stops waiting when nobody answers".
//!
//! **Ten seconds.** A judge of that number is a judge of wall-clock, and the
//! only honest evidence is somebody using it — which is why it is one named
//! constant with its reasoning attached rather than a number spread through the
//! code. It is deliberately biased towards failing early: a decision that is not
//! delivered in ten seconds was not going to be delivered at all, and at ten
//! seconds the host falls back to asking in its own terminal, which is exactly
//! what it would have done with no companion installed. The cost of guessing low
//! is a user who glanced away; the cost of guessing high is an agent that
//! stands still for a minute on every tool call, which is the failure this
//! whole program exists to be unable to cause.
//!
//! # Every exit is a success
//!
//! Including every failure. No companion running, no channel, nothing on
//! standard input, a payload past the bound, a reply that names a different
//! request, a companion that never answers: all of them mean the same thing,
//! which is to print nothing and exit `0`.
//!
//! The exit status is part of this, and it is the part that is easiest to get
//! wrong. An exit code the host reads as a failed hook is not a neutral outcome
//! — it is a way of harming the user's agent, reported as a broken plugin rather
//! than as a decision that was not made in time. So there is exactly one exit in
//! this file and it is `0`.
//!
//! And nothing is printed on any of those paths, which is a stronger claim than
//! "prints nothing parseable". The host reads standard output as JSON when the
//! whole of it is one object and as plain text otherwise, so an empty object, a
//! newline, or the word `deny` are all answers. Silence is the only thing that
//! is not one, and a deadline that denies is a refusal the user never made.

mod address;

use std::io::{Read, Write};

/// The most this program will read from standard input, in bytes.
///
/// A hook payload is a small JSON object. This bound is not a guess about that
/// size — it is there so that a process which never closes its standard input
/// cannot make this one grow without limit, in a program the host agent spawns
/// on the critical path of a tool call and expects to finish.
const MAX_PAYLOAD_BYTES: usize = 1 << 20;

/// The most this program will read from a reply, in bytes.
///
/// The same bound for the same reason, in the other direction: a companion that
/// has stopped making sense must not be able to make this process allocate
/// without limit while the host waits.
const MAX_REPLY_BYTES: usize = 1 << 20;

/// The most an identifier may be, in bytes.
///
/// Short enough that a reply naming something enormous is refused rather than
/// accumulated, and long enough that the generated identifier fits with room to
/// spare.
const MAX_ID_BYTES: usize = 64;

/// How long this program will wait for an answer.
///
/// See the module note. One constant, named, argued, and used in exactly one
/// place — which is what makes it a bound rather than a suggestion.
const DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// What the thread that does the exchange reports back.
enum Answer {
    /// The reply's body, confirmed to name the request this program made.
    Decision(Vec<u8>),
    /// The exchange produced nothing this program may print.
    Nothing,
}

/// Read the payload, announce it, and print the reply. Or print nothing.
///
/// Every path out of here ends in one `exit(0)`. The reasons are in the module
/// note and there are many of them; the shape of this function is the argument.
fn ask_the_companion() {
    let Some(payload) = read_payload() else {
        return;
    };
    let Some(path) = address::companion_address() else {
        return;
    };

    let id = request_id();

    // The thread does the waiting so that this one does not have to. A single
    // `recv_timeout` below is a bound with no loop in it, no select, and no
    // state in which the deadline can be missed because something else was
    // being read at the time.
    let (report, waiting) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = report.send(exchange(&path, &id, &payload));
    });

    // The deadline is enforced here, by the process that is making the host
    // wait. If the companion is still reading, still thinking, or has hung
    // outright, this returns anyway — and on the way out the thread is still
    // blocked in a read, which the exit below is what stops.
    let answer = match waiting.recv_timeout(DEADLINE) {
        Ok(Answer::Decision(decision)) => Answer::Decision(decision),
        // A channel that ended without an answer is the same as a deadline: the
        // companion is gone, so there is nothing to print and no reason to wait
        // out the rest of the bound.
        _ => Answer::Nothing,
    };

    if let Answer::Decision(decision) = answer {
        print(&decision);
    }
}

/// The payload from standard input, or `None` when there is nothing usable.
///
/// `None` covers a standard input that could not be read, one that kept going
/// past the bound, and one that was empty. All three mean the same thing, which
/// is that there is nothing to announce: an empty hook payload is silence, not
/// an error, and delivering one would be asking the companion to recognise
/// something that is not there.
fn read_payload() -> Option<Vec<u8>> {
    let mut payload = Vec::new();
    // `take` rather than `read_to_end` so an endless standard input stops at the
    // bound instead of at EOF.
    let read = std::io::stdin()
        .lock()
        .take(MAX_PAYLOAD_BYTES as u64 + 1)
        .read_to_end(&mut payload);

    match read {
        Err(_) => None,
        Ok(_) if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES => None,
        Ok(_) => Some(payload),
    }
}

/// An identifier for this request, made here and read nowhere.
///
/// The process's own id and the clock's reading of this instant, which together
/// are unique: two invocations that share a process id are the same process, and
/// two that share a nanosecond are not distinguishable by anything either of them
/// could observe. Hex, because it cannot contain the newline the frame is
/// separated by — a generated identifier that could break its own framing would
/// be a vocabulary this program has for itself, which is the thing the module
/// note says it does not have.
///
/// Deliberately not derived from the payload. See the module note.
fn request_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since_epoch| since_epoch.as_nanos())
        .unwrap_or_default();

    format!("{:x}-{:x}", std::process::id(), now)
}

/// One exchange: announce, then read the answer. Returns `Nothing` on every path
/// that does not produce a decision this program may print.
///
/// This is the whole of what happens on the other thread. It never blocks the
/// main thread, never prints, and never decides anything.
fn exchange(path: &str, id: &str, payload: &[u8]) -> Answer {
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;

        // Connected, not listening: this side is the one that leaves.
        let Ok(mut stream) = UnixStream::connect(path) else {
            return Answer::Nothing;
        };
        let reader = exchange_over(&mut stream, id, payload);
        drop(stream);
        reader
    }

    #[cfg(windows)]
    {
        use std::fs::OpenOptions;

        // A named pipe is reached through the filesystem namespace as a file.
        // Read as well as write for the reply; the access mask has to be
        // bidirectional for a client to connect at all.
        let Ok(pipe) = OpenOptions::new().read(true).write(true).open(path) else {
            return Answer::Nothing;
        };
        let mut pipe = pipe;
        exchange_over(&mut pipe, id, payload)
    }
}

/// The frame exchange itself, over any readable and writable connection.
///
/// ```text
///   announce   <id> LF <length> LF <payload>
///   reply      <id> LF <length> LF <decision>
/// ```
///
/// Two newlines and a length, not JSON, and the reason is the dependency list:
/// this program has none, and a frame format is the one place a hand-written
/// parser is cheaper than a crate. The length is there because the announce
/// side cannot close its end of the connection — it has to stay open to read the
/// answer, and on at least one platform there is no way to close only the
/// writing half — so the reader needs to be told where the payload ends rather
/// than left to wait for an end that is not coming.
///
/// The reply is read by exactly `length` bytes, which means the reader never
/// depends on the companion closing the connection either. That matters on the
/// critical path: a wait that ends only when the far end hangs up is a wait
/// whose bound is somebody else's.
fn exchange_over<S>(stream: &mut S, id: &str, payload: &[u8]) -> Answer
where
    S: Read + Write,
{
    let announce = format!("{id}\n{}\n", payload.len());
    let Ok(_) = stream.write_all(announce.as_bytes()) else {
        return Answer::Nothing;
    };
    let Ok(_) = stream.write_all(payload) else {
        return Answer::Nothing;
    };
    let Ok(_) = stream.flush() else {
        return Answer::Nothing;
    };

    let Some(reply_id) = read_line(stream, MAX_ID_BYTES) else {
        return Answer::Nothing;
    };
    // The reply has to name the request it is answering. A companion that
    // answers with somebody else's identifier has answered a different
    // question, and printing it would be answering this one with a decision
    // made for another.
    if reply_id != id {
        return Answer::Nothing;
    }

    let Some(length) = read_line(stream, MAX_ID_BYTES).and_then(|line| line.parse::<usize>().ok()) else {
        return Answer::Nothing;
    };
    // Refused rather than truncated. Half a decision is not a decision, and a
    // host reading half an object is owed the same silence as one reading none.
    if length == 0 || length > MAX_REPLY_BYTES {
        return Answer::Nothing;
    }

    let mut decision = vec![0u8; length];
    match stream.read_exact(&mut decision) {
        Ok(()) => Answer::Decision(decision),
        Err(_) => Answer::Nothing,
    }
}

/// One newline-terminated line, without the newline, or `None`.
///
/// `None` on end of stream, on a read error, on a line that is not text, and on
/// a line longer than `limit`. All four mean the same thing: whatever is on the
/// far end is not the frame this program was promised.
fn read_line<S: Read>(stream: &mut S, limit: usize) -> Option<String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];

    loop {
        match stream.read(&mut byte) {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        if byte[0] == b'\n' {
            return String::from_utf8(line).ok();
        }
        line.push(byte[0]);
        // Checked after the push so a line of exactly `limit` bytes is allowed
        // and the one after it is not.
        if line.len() > limit {
            return None;
        }
    }
}

/// Write the decision to standard output, and nothing else ever.
///
/// There is no newline, no prefix, and no "here is your answer" framing. The
/// bytes are the companion's, byte for byte, because a byte this program added
/// on the way out would be a byte the companion's host did not agree to read.
fn print(decision: &[u8]) {
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(decision);
    let _ = stdout.flush();
}

fn main() {
    ask_the_companion();
    std::process::exit(0);
}