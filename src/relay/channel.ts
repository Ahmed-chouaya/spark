/**
 * The companion's end of the channel: a local socket it listens on, restricted
 * to its own user, taking ownership of its address when it starts.
 *
 * ## What this owns and what it does not
 *
 * This is transport. It moves bytes from the relay to a callback and does not
 * know what the bytes mean — no host's event names, no canonical vocabulary, no
 * session. Everything above it interprets, and the interpretation is one place
 * (see `../state-selection/adapters`).
 *
 * The one thing it does decide is **who may connect**, because that is a
 * property of the channel rather than of anything the channel carries.
 *
 * ## Two listeners, one rule
 *
 * `openChannel` is the one-way path: a relay writes a payload and leaves. It is
 * the path the relay's "never blocks the host" guarantee is about, and nothing
 * here changes it — the callback it takes, when it is called, and what it is
 * given are exactly what they were.
 *
 * `openReplyChannel` is the other one: a request arrives and an answer goes back
 * on the connection that asked. It is an *addition* rather than a mode, because
 * a mode is a branch, and a branch is where a guarantee quietly stops being
 * true — and the guarantee this file's most important consumer relies on is that
 * the one-way path has no code in it the other one can reach. Two entry points
 * sharing the directory, socket and takeover rules below is what makes that
 * structurally true rather than a matter of care.
 *
 * They listen at different addresses (see `./address`), which is what keeps
 * either of them from having to tell the other's traffic apart.
 *
 * ## The answer is bound to its request
 *
 * `PendingRequestChannel.reply` takes the decision and nothing else. It closes
 * over the socket that opened this request and over the identifier read from it,
 * so there is no argument naming a request and therefore no way to answer one
 * request with another request's decision.
 *
 * That rule is not asked of callers here; it is enforced in transport, because
 * it is the rule that `../escalation/pending` exists to protect and this is the
 * last place a mistake in it becomes a decision about what somebody's agent may
 * do.
 *
 * ## Only the owner may connect
 *
 * Two independent barriers, either of which is sufficient, and both of which are
 * needed for the failure they cover:
 *
 * - The containing directory is created `0700`. Another user cannot traverse
 *   into it, so it cannot reach the socket even if the socket's own mode were
 *   permissive. This is also what makes the identity in the path not the only
 *   thing keeping users apart — a correct path and a hostile one are refused by
 *   the same rule.
 * - The socket itself is `0600`. The directory is not enough on its own: the
 *   socket is created by the OS with the process umask applied, which on a
 *   permissive umask would be connectable by anyone who got the path right.
 *
 * On Windows a named pipe is not a filesystem entry and there is no directory
 * to lock down; the pipe's own security descriptor is the barrier, and
 * `readableAll`/`writableAll` are left off so it is the owner's alone.
 *
 * ## A stale channel is replaced, not refused
 *
 * A crash leaves a socket file behind, and a companion that refuses to start
 * because of one is a companion the user has to clear by hand. That is the
 * opposite of what this product is for, so starting takes ownership of the
 * address.
 *
 * "Takes ownership" is precise: it removes what is at the address **only if
 * that entry belongs to this user**. An entry owned by somebody else is left
 * exactly where it is and the start fails loudly instead. Removing another
 * user's entry to win a race would be the one thing here that could reach
 * across users, so it is the one thing here that is refused.
 */

import { createServer, type Server, type Socket } from "node:net";
import { chmod, mkdir, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { currentCompanionAddress, currentDecisionAddress } from "./address";

/**
 * The most this listener will accept from one connection.
 *
 * The relay already bounds what it sends; this bounds what is accepted, so a
 * connection that is not the relay cannot exhaust the companion's memory. It is
 * the same number for the same reason, and exceeding it ends the connection
 * without a callback — which is what "nothing unusable reaches state selection"
 * means at the point where the channel can enforce it.
 */
export const MAX_PAYLOAD_BYTES = 1 << 20;

/** Only the owner may read or write the socket. See the module note. */
const SOCKET_MODE = 0o600;

/** And only the owner may enter the directory that holds it. */
const DIRECTORY_MODE = 0o700;

/** How a payload arrives: the bytes, unaltered, and nothing about them. */
export type PayloadHandler = (payload: Buffer) => void;

/**
 * One request waiting for its answer, and the answer's only route home.
 *
 * Binding rather than addressing is the point: see the module note. A `reply`
 * that took a request identifier would be asking every caller to get right the
 * one rule whose violation turns a convenience into a hazard, and asking is
 * exactly how that rule would eventually be got wrong.
 */
export interface PendingRequestChannel {
  /** This request's own identifier, as the requester named it. */
  readonly id: string;
  /** The host's payload, unaltered. This channel has not read it. */
  readonly payload: Buffer;
  /** Answer on this connection. Returns whether the bytes were handed over. */
  reply(decision: Buffer): boolean;
}

export interface ReplyChannelOptions {
  /**
   * Called once per request, with the connection still open.
   *
   * Synchronous, like `onPayload` and for the same reason: the channel has
   * already accepted the request by the time it is called, and an answer that
   * has not been decided yet is not a reason to hold a connection open on the
   * host's behalf. A handler that answers at once may; one that answers later
   * finds the connection gone if the requester stopped waiting first, and that
   * is the correct outcome rather than an answer buffered for nobody.
   */
  readonly onRequest: (request: PendingRequestChannel) => void;
  /**
   * Where to listen. Omitted, the address derived from the owning user — the
   * only value the program on the other end can reach, for the reason `./address`
   * says the address is derived rather than negotiated.
   */
  readonly address?: string;
}

/**
 * Listen on the companion's decision channel: requests in, answers out.
 *
 * The frame is the one `ask/src/main.rs` writes and reads:
 *
 * ```text
 *   request   <id> LF <length> LF <payload>
 *   answer    <id> LF <length> LF <decision>
 * ```
 *
 * A length and two newlines rather than JSON, because the program on the other
 * end has no dependencies at all and cannot pay for a parser — see that file's
 * module note for the argument. Nothing here interprets either half: the
 * identifier is compared, not read, and the payload and the decision are passed
 * through byte for byte.
 *
 * Every barrier below — the `0700` directory, the `0600` socket, the ownership
 * check before anything is taken over — is the one `openChannel` applies. The
 * reply path is the most sensitive thing this module will ever carry, so it is
 * held to the same rules as the least, and the differences between the two
 * listeners are in what they do with bytes and nowhere else.
 */
export async function openReplyChannel(options: ReplyChannelOptions): Promise<CompanionChannel> {
  const address = options.address ?? currentDecisionAddress();
  if (!address) {
    throw new Error(
      "cannot derive the companion's decision address: the running user has no readable identity"
    );
  }

  await ensurePrivateDirectory(address);

  const server = createServer((socket: Socket) => readOneRequest(socket, options.onRequest));

  await bind(server, address);
  await restrictSocketToOwner(address);

  return {
    address,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/**
 * Read one request from one connection, and keep that connection for its answer.
 *
 * The opposite of `readOnePayload` in the one respect that matters: this does not
 * treat the end of the stream as the end of the payload, because the writer is
 * still there — waiting — and the thing that ends its frame is the length it
 * wrote. So the length is what this reads, and the connection stays open until
 * an answer has gone or the requester has gone.
 *
 * A requester's absence is not detected and not waited for. A requester that gave
 * up takes its socket with it, the next write fails, and `reply` reports that it
 * delivered nothing. That is the only signal there is, and it is the same signal
 * the deadline gives it: silence on the far end, noticed by trying.
 */
function readOneRequest(socket: Socket, onRequest: (request: PendingRequestChannel) => void): void {
  let received = Buffer.alloc(0);
  let handed = false;

  socket.on("data", (chunk: Buffer) => {
    // Once the request has been handed on, later bytes belong to nothing this
    // listener is waiting for. The answer goes out through `reply`, which writes
    // it, and a requester sends none.
    if (handed) return;

    received = Buffer.concat([received, chunk]);

    const frame = takeFrame(received);
    if (frame === null) {
      // Incomplete, or past what a header may be. The header bound rather than
      // the payload bound is deliberate: a requester that has not reached its
      // length line in a quarter of a kilobyte is not one that will, and this is
      // a program the host agent is waiting on.
      if (received.length > MAX_REQUEST_HEADER_BYTES) socket.destroy();
      return;
    }

    handed = true;
    // Reading stops here. Nothing more on this connection enters memory unless a
    // request asks for it, which is the property `readOnePayload` also has.
    socket.pause();
    onRequest(makeRequest(socket, frame.id, frame.payload));
  });

  socket.on("error", () => {
    socket.destroy();
  });
}

/**
 * One complete frame out of what has arrived, or `null` while there is not one.
 *
 * Binary-safe on the payload and text-only on the two header lines, which is all
 * the format claims: an identifier and a length are ASCII by construction,
 * because the program that writes them generates them (see `ask/src/main.rs`).
 *
 * The payload is taken by the length it declares rather than by where the bytes
 * happen to stop, so a payload containing newlines — and a hook payload is JSON,
 * so it does — arrives whole. A frame that claims more than `MAX_PAYLOAD_BYTES`
 * is refused rather than waited for: this is a listener on a host's critical
 * path, and a header claiming a gigabyte is not a request that is about to
 * arrive.
 */
function takeFrame(received: Buffer): { id: string; payload: Buffer } | null {
  const firstBreak = received.indexOf(0x0a);
  if (firstBreak < 0) return null;

  const secondBreak = received.indexOf(0x0a, firstBreak + 1);
  if (secondBreak < 0) return null;

  const id = received.subarray(0, firstBreak).toString("utf8");
  const length = Number(received.subarray(firstBreak + 1, secondBreak).toString("utf8"));

  if (!id || !Number.isInteger(length) || length < 0 || length > MAX_PAYLOAD_BYTES) return null;

  const body = received.subarray(secondBreak + 1);
  if (body.length < length) return null;

  return { id, payload: Buffer.from(body.subarray(0, length)) };
}

/**
 * The request, and the one way its answer can leave.
 *
 * Two refusals, both of them the safe direction. An answer larger than a payload
 * is refused rather than truncated, because half a decision is not a decision
 * and a host handed half an object is owed the same silence as one handed none.
 * A second answer is refused because a second one is not a stronger one, and
 * because two answers on one connection is a frame a reader could take as two
 * decisions.
 *
 * Both checks are before the write rather than after it, so there is no state in
 * which half an answer has gone out and the failure is discovered afterwards.
 *
 * A refusal still closes the connection. That is not tidiness: the requester is
 * a program on the host agent's critical path, and a connection left open after
 * the only answer it could have had was refused would keep the host waiting for
 * a reply that is never coming — until its own deadline, ten seconds later, for
 * an outcome already known here. Ending it lets the host fall back to asking the
 * user immediately, which is what both refusals mean.
 */
function makeRequest(socket: Socket, id: string, payload: Buffer): PendingRequestChannel {
  let answered = false;

  return {
    id,
    payload,
    reply(decision: Buffer): boolean {
      if (answered) return false;
      answered = true;

      if (decision.length > MAX_PAYLOAD_BYTES) {
        socket.end();
        return false;
      }

      const frame = Buffer.concat([
        Buffer.from(`${id}\n${decision.length}\n`, "utf8"),
        decision,
      ]);

      // One write, so a reader that reads in pieces cannot see two frames. A
      // decision split across two writes could be read as two decisions, and this
      // is the thing that decides what an agent may do.
      const delivered = socket.writable && socket.write(frame);
      socket.end();

      return delivered;
    },
  };
}

/**
 * The most a request's header may be, in bytes.
 *
 * Measured over everything received before a frame completes, so it covers the
 * two header lines and whatever payload is already in hand. Small on purpose:
 * this is a program the host agent is waiting on, and a connection that has not
 * reached its length line in a quarter of a kilobyte is not one that will.
 */
const MAX_REQUEST_HEADER_BYTES = 256;

export interface ChannelOptions {
  /**
   * Deliver each received payload here, byte for byte as it arrived.
   *
   * The handler is synchronous and its return value is ignored: the channel
   * has already accepted the payload by the time it is called, so a handler
   * that throws is the caller's problem and not a reason to hold a connection
   * open.
   */
  readonly onPayload: PayloadHandler;
  /**
   * Where to listen.
   *
   * Omitted, this is the address derived from the owning user, which is what
   * both production callers want and the only value the relay can ever reach.
   * It exists so a test does not have to use the user's real channel; there is
   * no path by which one side learns the other's choice, because the relay has
   * no corresponding option and cannot be pointed anywhere.
   */
  readonly address?: string;
}

export interface CompanionChannel {
  /** The address this listener is actually bound to. */
  readonly address: string;
  /** Stop listening and release the address. */
  close(): Promise<void>;
}

/**
 * Listen on the companion's channel, replacing a stale one.
 *
 * Rejects if the user cannot be identified and no address was given — there is
 * no address to fall back to, and inventing one would either reach a different
 * user's companion or reach nothing.
 */
export async function openChannel(options: ChannelOptions): Promise<CompanionChannel> {
  const address = options.address ?? currentCompanionAddress();
  if (!address) {
    throw new Error(
      "cannot derive the companion's address: the running user has no readable identity"
    );
  }

  await ensurePrivateDirectory(address);

  const server = createServer((socket: Socket) => readOnePayload(socket, options.onPayload));

  await bind(server, address);
  await restrictSocketToOwner(address);

  return {
    address,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/**
 * Read one payload from one connection, then close it.
 *
 * One connection carries one payload and carries it once. The relay exits after
 * writing, so waiting for a second would be waiting for something that cannot
 * arrive; and holding the connection open while the payload is handled would
 * mean the relay's write could block on a slow consumer, which is the one thing
 * this design must not do to the host agent.
 */
function readOnePayload(socket: Socket, onPayload: PayloadHandler): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let oversized = false;

  socket.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_PAYLOAD_BYTES) {
      // Stop accumulating. The connection is still finished below — it is
      // closed either way — so this cannot become a slow leak.
      oversized = true;
      return;
    }
    chunks.push(chunk);
  });

  socket.on("end", () => {
    socket.end();
    if (oversized || chunks.length === 0) return;
    onPayload(Buffer.concat(chunks));
  });

  socket.on("error", () => {
    // A relay that vanished mid-write is not the companion's problem, and
    // there is nothing to tell it: it has already gone.
    socket.destroy();
  });
}

/**
 * Create the directory that will hold the socket, `0700`, and refuse to use one
 * that belongs to somebody else.
 *
 * On a shared machine a predictable path can already exist — someone else's
 * leftover, or a planted entry. Following it would put the companion's socket
 * inside a directory another user controls, which is worth more than the socket
 * itself. So ownership is checked before the directory is used, and a directory
 * owned by anyone else is left alone.
 */
async function ensurePrivateDirectory(address: string): Promise<void> {
  // Windows: there is no holding directory. A named pipe lives in the
  // `\\.\pipe` device namespace rather than in the filesystem, so `dirname`
  // yields the namespace root and everything below would try to create it.
  //
  // Nothing is lost by skipping. The barrier this function exists to provide —
  // "a predictable path must not sit inside a directory another user controls" —
  // is a filesystem problem with no Windows equivalent, because a pipe is
  // addressed by name and the namespace is not writable. Per-user reachability
  // comes from the account name baked into the address (see ./address) and from
  // the pipe's own ACL.
  if (process.platform === "win32") return;

  const directory = dirname(address);

  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });

  // `mkdir`'s mode applies only to what it creates, so the mode is also set on
  // every path: an existing directory keeps whatever mode it had.
  await chmod(directory, DIRECTORY_MODE);

  const owner = await ownerOf(directory);
  if (owner !== null && owner !== currentUid()) {
    throw new Error(
      `refusing to use ${directory}: it belongs to uid ${owner}, not to uid ${currentUid()}`
    );
  }
}

/**
 * Bind, taking ownership of the address if something is already there.
 *
 * A leftover from a crash is removed and the address is taken. An entry owned
 * by another user is not: that is the one case where "takes ownership" stops,
 * and it is checked before anything is deleted.
 *
 * Taking over happens at most once. An address that is still occupied after its
 * entry has been removed is being recreated by something else, and retrying
 * would be a loop against a process that wants the address more than this one
 * does — so the second failure is reported instead.
 */
function bind(server: Server, address: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const attempt = (mayTakeOver: boolean): void => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        if (error.code !== "EADDRINUSE" || !mayTakeOver) {
          reject(error);
          return;
        }
        takeOwnership(address).then(() => attempt(false), reject);
      };

      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      listen(server, address);
    };

    attempt(true);
  });
}

function listen(server: Server, address: string): void {
  if (process.platform === "win32") {
    // Left off deliberately: a named pipe that other users may open is not a
    // per-user channel. See the module note.
    server.listen({ path: address, readableAll: false, writableAll: false });
  } else {
    server.listen(address);
  }
}

/**
 * Remove what is at the address, if it is ours to remove.
 *
 * Whether it is alive is not asked. A socket file left by a crash and one being
 * listened on right now look the same from here, and probing to tell them apart
 * races: the probe would have to connect, which is exactly what a live companion
 * would answer and a dead one would refuse, so the answer describes the instant
 * it was asked rather than the instant the decision is used.
 *
 * What is checked instead is ownership, which does not change under a race.
 */
async function takeOwnership(address: string): Promise<void> {
  const owner = await ownerOf(address);
  if (owner !== null && owner !== currentUid()) {
    throw new Error(
      `refusing to replace ${address}: it belongs to uid ${owner}, not to uid ${currentUid()}`
    );
  }
  await unlink(address).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/**
 * Narrow the socket to the owner.
 *
 * The OS created it with the process umask applied, which is not necessarily
 * restrictive, so this is done rather than assumed. It runs before `openChannel`
 * resolves, which means before any caller can act on the channel — and the
 * directory is already `0700`, so no other user could have reached the socket in
 * the window between the bind and here regardless of its mode.
 *
 * A failure is thrown rather than logged: it is the failure of a guarantee this
 * module exists to make, and continuing would leave a channel that looks
 * private and is not.
 */
async function restrictSocketToOwner(address: string): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(address, SOCKET_MODE);
}

/** The uid that owns a path, or `null` where the platform or path has no uid. */
async function ownerOf(path: string): Promise<number | null> {
  if (process.platform === "win32") return null;
  try {
    return (await stat(path)).uid;
  } catch {
    return null;
  }
}

/** This process's uid, or `null` if the platform has none. */
function currentUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}