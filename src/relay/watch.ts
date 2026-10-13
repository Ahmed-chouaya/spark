import { connect, type Socket } from "node:net";
import { currentCompanionAddress } from "./address";

/**
 * Read the companion's channel without owning its address.
 *
 * ## Why this exists, and why it is not `openChannel`
 *
 * The window owns the channel: it binds the address, takes it back from a stale
 * entry, and hands payloads to the document. A second process that wants to *see*
 * the same payloads must therefore **connect**, not bind — and the difference is
 * not tidiness. `openChannel` binds, and binding an address another process
 * already holds ends in `takeOwnership`, which unlinks the other process's
 * socket. A watcher built on it would not merely fail; it would break the window
 * it was watching.
 *
 * ## What it is for
 *
 * Reporting. On a platform that cannot hold a surface above other windows — GNOME
 * — correct behaviour is an empty desktop, so "is a session open, and what is it
 * doing" has no answer on the screen. This is that answer, and it is a read-only
 * second pair of eyes on the same bytes.
 *
 * It interprets nothing. The caller folds the payloads through the same adapters
 * the document uses (`shell/src/adapters.ts`), so a watcher and the window cannot
 * disagree about what a payload means.
 *
 * ## One payload per connection, because that is the channel's protocol
 *
 * The relay connects, writes, and exits. So the end of the stream is the end of
 * the payload, and the watcher reconnects for the next one. Reading a length
 * header instead would be a second opinion about a protocol this file is only
 * supposed to be watching — and getting it wrong would mean a payload split
 * across two connections is delivered as two.
 */
export interface WatchOptions {
  /** Deliver each payload received, byte for byte as it arrived. */
  readonly onPayload: (payload: Buffer) => void;
  /** Where to read from. Omitted, the address derived from the owning user. */
  readonly address?: string;
  /**
   * How many times to try before giving up. Zero is one attempt.
   *
   * Retry only because the window binds the address after this process starts, so
   * a watcher that gave up on the first miss would never see anything.
   */
  readonly attempts?: number;
  /** Milliseconds between attempts. */
  readonly retryDelayMs?: number;
  /** Called when the watcher gave up, so the caller can say so out loud. */
  readonly onUnavailable?: (reason: string) => void;
}

/** A live connection to the companion's channel. Closing it stops watching. */
export interface ChannelWatch {
  readonly address: string;
  close(): void;
}

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * The byte that declares a connection to be a reader rather than a delivery.
 *
 * `O`. Chosen to be a byte no host agent's JSON payload begins with, because the
 * relay's first byte is handed straight back as the first byte of its payload —
 * a declaration byte that could also be JSON's would make the two ambiguous.
 */
export const OBSERVER_DECLARATION = Buffer.from("O", "ascii");

/** How long to wait before attaching again after the window closed. */
const RECONNECT_MS = 1_000;

/**
 * Connect to the companion's channel and hand on whatever arrives.
 *
 * Resolves once connected. A companion that is not running resolves `null`
 * rather than throwing, because "nothing is listening" is the ordinary state of a
 * machine where the user has not started the companion — and a diagnostic that
 * reported that as a failure would be lying about the machine.
 */
export async function watchChannel({
  onPayload,
  address = currentCompanionAddress() ?? "",
  attempts = 3,
  retryDelayMs = 1_000,
  onUnavailable,
}: WatchOptions = { onPayload: () => {} }): Promise<ChannelWatch | null> {
  if (address === "") return null;

  let live = true;
  let socket: Socket | null = null;
  let settled = false;

  /** One connection: read whatever arrives, then reconnect for the next payload. */
  const connectOnce = (): Promise<boolean> =>
    new Promise((done) => {
      const current: Socket = connect(address);
      socket = current;

      // Accumulated, and framed: the companion writes `<length>\n<payload>` and
      // keeps the connection open, because it is feeding this reader every
      // payload for as long as it lasts. Delivering on `close` would therefore
      // deliver nothing at all, and delivering on `data` without a length would
      // split one payload into as many deliveries as the kernel happened to
      // choose.
      // Declare what this connection is, before anything is expected of it: one
      // byte, and the channel's own protocol is untouched because the relay never
      // declares anything.
      current.write(OBSERVER_DECLARATION);

      let buffered = Buffer.alloc(0);
      let expected: number | null = null;

      const take = (): void => {
        for (;;) {
          if (expected === null) {
            const breakAt = buffered.indexOf(0x0a);
            if (breakAt < 0) return;
            const length = Number(buffered.subarray(0, breakAt).toString("utf8"));
            if (!Number.isInteger(length) || length < 0) return;
            expected = length;
            buffered = buffered.subarray(breakAt + 1);
          }
          if (buffered.length < expected) return;

          const payload = buffered.subarray(0, expected);
          buffered = buffered.subarray(expected);
          expected = null;
          if (payload.length > 0) onPayload(payload);
        }
      };

      current.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        take();
      });

      // Failed to connect at all: one attempt is over, and the caller decides
      // whether to try again.
      current.once("error", () => {
        current.destroy();
        if (!settled) {
          settled = true;
          done(false);
        }
      });

      // Connected is a successful outcome and it resolves this attempt. Nothing
      // else does: a Unix socket is connected the moment it exists whether or not
      // anything is behind it, so waiting for a payload to resolve on would hang
      // for ever on a channel that is simply idle — which is the ordinary state of
      // a machine where the companion is running and nothing has happened yet.
      current.once("connect", () => {
        if (!settled) {
          settled = true;
          done(true);
        }
      });

      current.on("close", () => {
        // A half-delivered payload is dropped rather than completed: the companion
        // is gone, and inventing the rest of it would be a decision this file is
        // only supposed to watch.
        //
        // Reconnected, because the window restarting is ordinary — a user closing
        // it and starting it again is how it is used — and a watcher that gave up
        // at the first close would go quiet for the rest of the process's life and
        // look exactly like a companion with nothing to report.
        if (live) {
          settled = false;
          setTimeout(() => void connectOnce(), RECONNECT_MS);
        }
      });
    });

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (await connectOnce()) {
      return {
        address,
        close: () => {
          live = false;
          socket?.destroy();
        },
      };
    }
    if (attempt < attempts) await delay(retryDelayMs);
  }

  onUnavailable?.(`nothing is listening on ${address}`);
  return null;
}
