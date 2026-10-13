import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_BYTES,
  openReplyChannel,
  type CompanionChannel,
  type PendingRequestChannel,
} from "../src/relay/channel";

/**
 * The reply path, driven over a real socket with real bytes.
 *
 * Every test here opens a channel at its own address and connects to it the way
 * `ask/src/main.rs` does — which is the point. A reply path tested through a
 * stubbed transport is a stubbed transport, and the properties that matter are
 * about bytes on a connection: that a decision arrives whole, that it arrives on
 * the connection that asked, and that nothing arrives when it should not.
 *
 * ## Why the answers are written by hand
 *
 * The frames below are built inline rather than through anything in `src/`. A
 * companion that framed its answers with the same module that reads them would
 * agree with itself by construction, and the two could be wrong together — which
 * is precisely the disagreement that leaves a user's agent waiting for a reply
 * that has been sent in a shape it cannot read.
 */

const open: CompanionChannel[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(open.splice(0).map((channel) => channel.close().catch(() => {})));
});

const randomSuffix = (): string => Math.random().toString(36).slice(2);

const scratch = (): string => {
  const directory = join(tmpdir(), `spark-reply-${process.pid}-${randomSuffix()}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

/**
 * An address this platform can actually listen on.
 *
 * The same reasoning and the same helper shape as `test/relay-channel.test.ts`:
 * a Unix-shaped path on Windows fails with `listen EACCES`, which reads like a
 * permissions problem and is really a type problem, and the suite would otherwise
 * never exercise the Windows branch at all.
 */
const channelAddress = (directory: string): string =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\spark-reply-${process.pid}-${randomSuffix()}`
    : join(directory, "decisions.sock");

const isWindows = process.platform === "win32";

/**
 * Let the event loop deliver what is in flight.
 *
 * A socket write is not a delivery, and asserting on what arrived without
 * yielding first is how a test ends up reading an empty array and concluding
 * the feature does not work. Long enough that a local delivery has certainly
 * happened, short enough that a slow test is not a slow suite.
 */
const settle = (ms = 100): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The frame `ask/src/main.rs` writes. Built here so both halves are stated. */
function requestFrame(id: string, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  return Buffer.concat([Buffer.from(`${id}\n${body.length}\n`, "utf8"), body]);
}

/** One connection from the other end, with whatever came back. */
interface RoundTrip {
  /** Waits for the peer to close, then returns every byte it sent. */
  received(): Promise<string>;
  /** Returns what has arrived so far, without waiting for a close. */
  drain(): Promise<string>;
}

/** Connect, write one request, and keep the connection for the answer. */
function send(address: string, frame: Buffer): Promise<RoundTrip> {
  return new Promise((done, fail) => {
    const socket = connect(address);
    sockets.push(socket);

    const received: Buffer[] = [];
    let resolve = () => {};
    const closed = new Promise<void>((settle) => (resolve = settle));

    socket.on("data", (chunk: Buffer) => received.push(chunk));
    socket.on("error", fail);
    socket.on("end", resolve);
    socket.on("close", resolve);

    const drain = async (): Promise<string> => {
      // One yield, so anything in flight is counted. A connection that is never
      // closed is a correct state — a request that was never answered — so this
      // must not wait for one.
      await settle();
      return Buffer.concat(received).toString("utf8");
    };

    socket.once("connect", () => {
      socket.write(frame);
      done({
        drain,
        received: async () => {
          // Bounded, so a connection that is never closed fails the test rather
          // than hanging the suite. Far longer than a local reply takes, so it
          // can only be reached by something being wrong.
          await Promise.race([
            closed,
            new Promise<void>((_, giveUp) => setTimeout(giveUp, 5_000)),
          ]);
          return Buffer.concat(received).toString("utf8");
        },
      });
    });
  });
}

/** Open a reply channel and record everything it is handed. */
async function listening(
  onRequest?: (request: PendingRequestChannel) => void
): Promise<{ channel: CompanionChannel; address: string; received: PendingRequestChannel[] }> {
  const received: PendingRequestChannel[] = [];
  const channel = await openReplyChannel({
    address: channelAddress(scratch()),
    onRequest: (request) => {
      received.push(request);
      onRequest?.(request);
    },
  });
  open.push(channel);

  return { channel, address: channel.address, received };
}

describe("the reply path delivers a decision on the connection that asked", () => {
  it("carries a payload containing newlines, whole", async () => {
    // A hook payload is JSON, so it contains newlines. A reader that framed by
    // line rather than by length would deliver half of it, and the companion
    // would show the user a request for something that is not what was asked.
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_input: { command: "echo one\necho two\necho three" },
    });
    const { address, received } = await listening();

    await send(address, requestFrame("r1", payload));
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0]!.payload.toString("utf8")).toBe(payload);
    expect(received[0]!.id).toBe("r1");
  });

  it("answers with the decision's own bytes, byte for byte", async () => {
    const decision = Buffer.from(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"}}\n',
      "utf8"
    );
    const { address } = await listening((request) => request.reply(decision));

    const trip = await send(address, requestFrame("r1", "{}"));
    const answer = await trip.received();

    // Read back through the same framing the program reads it with, so what is
    // checked is what it would get rather than that something was written.
    const firstBreak = answer.indexOf("\n");
    const secondBreak = answer.indexOf("\n", firstBreak + 1);
    expect(answer.slice(0, firstBreak)).toBe("r1");
    expect(Number(answer.slice(firstBreak + 1, secondBreak))).toBe(decision.length);
    expect(Buffer.from(answer.slice(secondBreak + 1), "utf8")).toEqual(decision);
  });

  it("binds the answer to its own connection, and offers no other route", async () => {
    // The property the whole binding rule is for. Two requests open two
    // connections, and each is answered only on its own — because `reply` has
    // no argument naming a request for a caller to get wrong, and because the
    // identifier is read from the connection rather than passed in.
    const arrived: PendingRequestChannel[] = [];
    const { address } = await listening((request) => arrived.push(request));

    const first = await send(address, requestFrame("r1", '{"which":"first"}'));
    const second = await send(address, requestFrame("r2", '{"which":"second"}'));

    await settle();
    expect(arrived).toHaveLength(2);
    expect(arrived[0]!.id).toBe("r1");
    expect(arrived[1]!.id).toBe("r2");

    // Answer the second one, and the first connection learns nothing about it.
    arrived[1]!.reply(Buffer.from('{"decision":"allow"}\n'));
    expect(await second.received()).toContain("allow");
    // The first was never answered, so its connection is still open and has
    // still been told nothing. Read by draining rather than by waiting for a
    // close that is correctly never going to come.
    expect(await first.drain()).not.toContain("allow");
  });

  it("refuses a second answer on one request rather than sending two", async () => {
    let request: PendingRequestChannel | null = null;
    const { address } = await listening((arrived) => (request = arrived));

    const trip = await send(address, requestFrame("r1", "{}"));
    await settle();

    const held = request as PendingRequestChannel | null;
    expect(held).not.toBeNull();

    const first = held!.reply(Buffer.from('{"first":true}\n'));
    const second = held!.reply(Buffer.from('{"second":true}\n'));

    // A second answer is not a stronger one, and two frames on one connection is
    // a thing a reader could take as two decisions.
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await trip.received()).not.toContain("second");
  });

  it("refuses an answer larger than a payload rather than sending half of one", async () => {
    let request: PendingRequestChannel | null = null;
    const { address } = await listening((arrived) => (request = arrived));

    const trip = await send(address, requestFrame("r1", "{}"));
    await settle();

    const held = request as PendingRequestChannel | null;
    const oversized = Buffer.alloc(MAX_PAYLOAD_BYTES + 1, 0x61);

    // Half a decision is not a decision. A host handed half an object is owed the
    // same silence as one handed none, so nothing at all is what goes out.
    expect(held!.reply(oversized)).toBe(false);

    // And the connection is closed rather than left open: the requester is a
    // program on the host's critical path, and leaving it waiting for a reply
    // that is never coming would cost it its whole deadline for an outcome
    // already known here.
    expect(await trip.received()).toBe("");
    expect(await trip.received()).not.toContain("aaaa");
  });
});

describe("the reply path is held to the same barriers as the one-way path", () => {
  it.runIf(!isWindows)("keeps the holding directory to its owner", async () => {
    const directory = join(scratch(), "spark-1001");
    const channel = await openReplyChannel({
      address: channelAddress(directory),
      onRequest: () => {},
    });
    open.push(channel);

    // The same barrier, because the reply is the most sensitive thing this
    // module carries: another user cannot traverse into the directory, so they
    // cannot reach the socket even if its own mode were permissive.
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });

  it.runIf(!isWindows)("keeps the socket itself to its owner", async () => {
    const { channel } = await listening();

    // The directory alone is not enough: the OS creates the socket with the
    // process umask applied, and a permissive umask would leave it connectable
    // by anyone who had the path.
    expect(statSync(channel.address).mode & 0o777).toBe(0o600);
  });

  it("reaches the derived address when none is given, and not the relay's", async () => {
    const { currentCompanionAddress, currentDecisionAddress } = await import(
      "../src/relay/address"
    );

    const channel = await openReplyChannel({ onRequest: () => {} });
    open.push(channel);

    // Two sockets, one directory. A single address would mean one listener
    // guessing which of two protocols it was speaking, and a listener that
    // guesses is what `relay/` was created to avoid.
    expect(channel.address).toBe(currentDecisionAddress());
    expect(channel.address).not.toBe(currentCompanionAddress());
  });

  it("takes over an address left behind rather than refusing to start", async () => {
    const address = channelAddress(scratch());

    // Made for real: a listener killed rather than closed, so what is left behind
    // is what a crash leaves — a socket entry with nothing behind it.
    const crashed = spawn(
      process.execPath,
      ["-e", `require("node:net").createServer().listen(${JSON.stringify(address)})`],
      { stdio: "ignore" }
    );
    await new Promise<void>((done) => {
      const poll = setInterval(() => {
        if (isWindows || existsSync(address)) {
          clearInterval(poll);
          done();
        }
      }, 20);
    });
    crashed.kill(isWindows ? undefined : "SIGKILL");
    await new Promise<void>((done) => crashed.once("exit", () => done()));

    if (!isWindows) expect(existsSync(address)).toBe(true);

    // A companion needing manual intervention to recover is the opposite of what
    // this is for, and the reply path is not exempt from it. It starts, and it
    // serves.
    const arrived: PendingRequestChannel[] = [];
    const channel = await openReplyChannel({
      address,
      onRequest: (request) => arrived.push(request),
    });
    open.push(channel);

    await send(address, requestFrame("r1", "{}"));
    await settle();

    expect(arrived).toHaveLength(1);
    expect(arrived[0]!.id).toBe("r1");
  });
});

describe("what it will not accept is refused rather than guessed at", () => {
  it("ends a connection whose header never arrives", async () => {
    let called = 0;
    const channel = await openReplyChannel({
      address: channelAddress(scratch()),
      onRequest: () => (called += 1),
    });
    open.push(channel);

    const socket = connect(channel.address);
    sockets.push(socket);
    await new Promise<void>((done) => socket.once("connect", () => done()));
    socket.write("x".repeat(4096));

    // No length line, ever. The header bound ends it rather than the buffer
    // growing: this is a listener on a host's critical path.
    await new Promise((done) => setTimeout(done, 300));
    expect(called).toBe(0);
  });

  it("ends a connection claiming more than a payload", async () => {
    let called = 0;
    const channel = await openReplyChannel({
      address: channelAddress(scratch()),
      onRequest: () => (called += 1),
    });
    open.push(channel);

    const socket = connect(channel.address);
    sockets.push(socket);
    await new Promise<void>((done) => socket.once("connect", () => done()));
    socket.write(`r1\n${MAX_PAYLOAD_BYTES + 1}\n`);

    await new Promise((done) => setTimeout(done, 300));
    // Not waited for. A header claiming a gigabyte is not a request that is
    // about to arrive, and this program is on the host's critical path.
    expect(called).toBe(0);
  });

  it("ends a connection whose length is not a number", async () => {
    let called = 0;
    const channel = await openReplyChannel({
      address: channelAddress(scratch()),
      onRequest: () => (called += 1),
    });
    open.push(channel);

    const socket = connect(channel.address);
    sockets.push(socket);
    await new Promise<void>((done) => socket.once("connect", () => done()));
    socket.write("r1\nnot-a-number\n{}");

    await new Promise((done) => setTimeout(done, 300));
    expect(called).toBe(0);
  });
});