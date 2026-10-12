import { connect } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openChannel, MAX_PAYLOAD_BYTES, type CompanionChannel } from "../src/relay/channel";
import { defaultDecode } from "../shell/src/companion";
import { PAYLOAD_EVENT, subscribeToPayloads } from "../shell/src/host";

/**
 * The channel, and what crosses it.
 *
 * Two properties, and one of them is the whole design.
 *
 * **The bytes are the bytes.** A payload arrives from a program that wrote a host
 * agent's hook payload unchanged and exited. Nothing in this project decides
 * what a payload means until `src/relay/session-source.ts` hands it to an
 * adapter — and an adapter cannot recover a byte that was re-encoded on the way
 * to it. So "delivered unchanged" is checked against bytes chosen to fail a naive
 * implementation: every value 0..255, and a payload that is not valid UTF-8 at
 * all.
 *
 * **A later start is not blocked by the previous one.** `src/relay/channel.ts`
 * takes ownership of its address on start, and `shell/src-tauri/src/channel.rs`
 * follows the same rule for the same reason. What runs here is the TypeScript
 * half, over a real socket, because the Rust half is a library this suite has no
 * way to call without building the whole application — and building a Tauri app
 * to check a property is not something `npm run verify` should do. The Rust half
 * is held structurally by `test/shell-shape.test.ts`.
 */

const ROOT = join(import.meta.dirname, "..");

const open: CompanionChannel[] = [];

/** A channel at a scratch address, tracked so every test leaves nothing behind. */
const listening = (address: string, onPayload: (payload: Buffer) => void): Promise<CompanionChannel> =>
  openChannel({ address, onPayload }).then((channel) => {
    open.push(channel);
    return channel;
  });

const scratchAddress = (): string =>
  join(mkdtempSync(join(tmpdir(), "spark-shell-")), "companion.sock");

/** Write `payload` to `address` and resolve once the bytes are away. */
const deliver = (address: string, payload: Buffer): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = connect(address);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.end(payload, () => resolve());
    });
  });

/** A payload arriving from a program that does not promise it is text. */
const EVERY_BYTE = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

afterEach(async () => {
  while (open.length > 0) await open.pop()!.close().catch(() => {});
});

describe("a payload arrives as the bytes that were sent", () => {
  it("delivers a real socket's payload byte for byte", async () => {
    const address = scratchAddress();
    let arrive!: (payload: Buffer) => void;
    const arrived = new Promise<Buffer>((resolve) => {
      arrive = resolve;
    });
    await listening(address, arrive);

    await deliver(address, EVERY_BYTE);

    const payload = await arrived;
    expect(payload.length).toBe(EVERY_BYTE.length);
    expect(Buffer.compare(payload, EVERY_BYTE)).toBe(0);
  });

  it("delivers a payload that is not valid text without changing it", async () => {
    // The case a `String` round trip loses. A lone continuation byte has no
    // meaning in UTF-8, so a decoder that replaced it would hand the adapter a
    // character the host never wrote — and the payload would then fail to parse
    // for reasons that look like the relay's.
    const binary = Buffer.from([0x7b, 0x80, 0xff, 0xfe, 0x7d]);
    const address = scratchAddress();
    let arrive!: (payload: Buffer) => void;
    const arrived = new Promise<Buffer>((resolve) => {
      arrive = resolve;
    });
    await listening(address, arrive);

    await deliver(address, binary);

    expect(Buffer.compare(await arrived, binary)).toBe(0);
  });

  it("accepts a payload at the bound the channel already states", async () => {
    // Compared rather than duplicated: a second number in the shell would be a
    // second answer to a question `src/relay/channel.ts` already answers.
    const rust = readFileSync(join(ROOT, "shell/src-tauri/src/channel.rs"), "utf8");

    expect(MAX_PAYLOAD_BYTES).toBe(1 << 20);
    expect(rust).toContain("pub const MAX_PAYLOAD_BYTES: usize = 1 << 20;");
  });

  it("decodes the text a payload carries, accents and all", async () => {
    // The one place bytes become text, and the only step at which the project's
    // assumptions are stated rather than assumed: the relay writes a host agent's
    // hook payload unchanged, and a hook payload is JSON, which is UTF-8. Decoded
    // as anything else — `latin1`, a byte-per-code-unit round trip — the text is
    // mangled *before* the adapter sees it, and the adapter's failure would look
    // like a payload the host never sent.
    const payload = { hook_event_name: "SessionStart", cwd: "/home/milgraph/café ☕" };

    expect(defaultDecode(new TextEncoder().encode(JSON.stringify(payload)))).toBe(
      JSON.stringify(payload)
    );
  });

  it("does not throw on bytes that are not text at all", async () => {
    // The envelope check in `applyReceivedPayload` is where an unusable payload is
    // recognised. Throwing here instead would take the shell down over bytes a
    // relay that writes and exits produced.
    expect(() => defaultDecode(Buffer.from([0x80, 0xff]))).not.toThrow();
  });
});

describe("the document receives those bytes, and re-encodes none of them", () => {
  /** A document that looks like a webview, delivering one event on subscribe. */
  const asWebview = (payload: unknown) => {
    (globalThis as Record<string, unknown>)["__TAURI_INTERNALS__"] = {
      core: { invoke: async () => undefined },
      event: {
        listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
          if (event === PAYLOAD_EVENT) handler({ payload });
          return () => {};
        },
      },
    };
  };

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)["__TAURI_INTERNALS__"];
  });

  it("hands the host's bytes over untouched", async () => {
    // What crosses Tauri's IPC boundary is a JSON array of byte values. That is
    // a transport encoding, not an interpretation, and the document has to
    // reassemble the same bytes out of it.
    asWebview(Array.from(EVERY_BYTE));

    const received: Uint8Array[] = [];
    subscribeToPayloads((payload) => received.push(payload));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toHaveLength(1);
    expect(Buffer.compare(Buffer.from(received[0]!), EVERY_BYTE)).toBe(0);
  });

  it("refuses a value that is not a byte rather than wrapping it", async () => {
    // `new Uint8Array([256])` is 0 and `new Uint8Array([-1])` is 255, both
    // silently. A payload changed by being received is the one thing this seam
    // exists to prevent, so a value it cannot represent is dropped rather than
    // mangled — and dropped visibly, by not arriving at all.
    asWebview([1, 256, 3]);

    const received: Uint8Array[] = [];
    subscribeToPayloads((payload) => received.push(payload));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toHaveLength(0);
  });

  it("subscribes to nothing in a document with no window behind it", async () => {
    // The same document, served to a browser for the harness and the end-to-end
    // run. There is no host there, and reaching for one anyway would throw on
    // load rather than render.
    expect(() => subscribeToPayloads(() => {})()).not.toThrow();
  });
});

describe("a later start is not blocked by the previous one's channel", () => {
  it("takes the address back after a clean stop", async () => {
    const address = scratchAddress();

    const first = await listening(address, () => {});
    await first.close();

    const second = await listening(address, () => {});
    expect(second.address).toBe(address);
    await expect(second.close()).resolves.toBeUndefined();
  });

  it("takes the address back after a crash left one behind", async () => {
    // A companion needing manual intervention to recover from a crash is the
    // opposite of what this product is for, so a leftover socket is replaced
    // rather than refused.
    const address = scratchAddress();

    await listening(address, () => {});
    const replacement = await listening(address, () => {});

    expect(replacement.address).toBe(address);
  });

  it("answers on the address a second time round, so the relay is not left shouting", async () => {
    // The property the takeover exists for: after the replacement, a payload
    // actually arrives. A channel that bound without answering would look
    // identical to one that worked, from the outside.
    const address = scratchAddress();

    await listening(address, () => {});
    let arrive!: (payload: Buffer) => void;
    const arrived = new Promise<Buffer>((resolve) => {
      arrive = resolve;
    });
    await listening(address, arrive);

    await deliver(address, Buffer.from("relayed"));

    expect((await arrived).toString()).toBe("relayed");
  });
});
