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
import { currentCompanionAddress } from "./address";

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