import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { currentCompanionAddress } from "../src/relay/address";
import { openChannel, type CompanionChannel } from "../src/relay/channel";

/**
 * The relay, run as the host agent runs it.
 *
 * Everything here spawns the built binary. Nothing stubs it and nothing
 * reimplements it — a stub would agree with the companion by construction, which
 * is the one thing these tests exist to rule out.
 *
 * ## Why there is one real channel
 *
 * The relay derives its address from the user running it and has no option to
 * connect somewhere else. That is deliberate: an address passed in would be an
 * address chosen by one participant and handed to the other, which is exactly
 * what this design refuses. So every test in this file shares one address, and
 * vitest runs files in parallel — which is why no other file spawns the relay,
 * and why the tests inside this file take turns on a single listener.
 */

const RELAY_DIR = join(import.meta.dirname, "../relay");
const RELAY_SOURCE = join(RELAY_DIR, "src/main.rs");
const BINARY = join(RELAY_DIR, "target/release/spark-relay");

beforeAll(() => {
  // Built once for the file. `cargo` is already needed to develop the relay, and
  // building here means the tests measure the binary rather than a fixture that
  // resembles it.
  execFileSync("cargo", ["build", "--release"], { cwd: RELAY_DIR, stdio: "pipe" });
}, 180_000);

let channel: CompanionChannel | undefined;
let received: Buffer[] = [];
let nextPayload: (payload: Buffer) => void = () => {};

/** Listen on this user's real channel, for as long as the test needs it. */
const listening = async (): Promise<CompanionChannel> => {
  channel ??= await openChannel({
    onPayload: (payload) => {
      received.push(payload);
      nextPayload(payload);
    },
  });
  return channel;
};

/** Run the relay with `payload` on standard input, and report how it exited. */
const relay = async (
  payload: string,
  env: NodeJS.ProcessEnv = {}
): Promise<ReturnType<typeof spawnSync>> => {
  await listening();
  return spawnSync(BINARY, [], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
};

/**
 * Wait for the next payload to arrive, or fail if it never does.
 *
 * Called before the relay is invoked, so there is always a wait and never a
 * buffered leftover to mistake for this invocation's delivery. `received` is a
 * record of what arrived across the test, not a queue this draws from — reading
 * it as one is how a test ends up asserting on the previous payload and passing.
 */
const nextReceived = (timeoutMs = 5_000): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`nothing was delivered within ${timeoutMs}ms`)),
      timeoutMs
    );
    nextPayload = (payload) => {
      clearTimeout(timer);
      nextPayload = () => {};
      resolve(payload);
    };
  });

afterEach(async () => {
  received = [];
  nextPayload = () => {};
  await channel?.close().catch(() => {});
  channel = undefined;
});

describe("the relay delivers the host's own payload", () => {
  it("reaches the companion without being told where it is", async () => {
    const arrival = nextReceived();
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "abc",
      cwd: "/home/someone/project",
    });

    // No address argument, no environment naming one, nothing configured. The
    // relay looks in the place it derived and the companion is listening there
    // because it derived the same place.
    expect((await relay(payload)).status).toBe(0);
    expect((await arrival).toString()).toBe(payload);
  });

  it("delivers it byte for byte", async () => {
    // The payload is the host's own, unaltered. Anything else — reordered keys,
    // reformatted JSON, a wrapper envelope — would be the relay starting to
    // interpret, which is the one thing it must never do.
    const payload = JSON.stringify({
      notification_type: "permission_prompt",
      session_id: "s-1",
      hook_event_name: "Notification",
      extra: { nested: [1, 2, { deep: true }], unicode: "héllo — ✓" },
    });

    const arrival = nextReceived();
    await relay(payload);

    const delivered = (await arrival).toString();
    expect(delivered).toBe(payload);
    expect(JSON.parse(delivered)).toEqual(JSON.parse(payload));
  });

  it("delivers every payload when the host invokes it repeatedly", async () => {
    const payloads = ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"].map(
      (event, index) => JSON.stringify({ hook_event_name: event, session_id: `s${index}` })
    );

    for (const payload of payloads) {
      const arrival = nextReceived();
      expect((await relay(payload)).status, payload).toBe(0);
      expect((await arrival).toString(), payload).toBe(payload);
    }

    // Four invocations, four deliveries, and nothing left over.
    expect(received).toHaveLength(payloads.length);
  });

  it("sends nothing at all when the host gave it nothing", async () => {
    const arrival = nextReceived();
    expect((await relay("")).status).toBe(0);

    // Silence, not an empty delivery. An empty payload is a thing the companion
    // would have to recognise and refuse, and the place to do that is the
    // adapter, not the wire.
    await expect(arrival).rejects.toThrow(/nothing was delivered/);
  });
});

describe("the relay never waits for the companion", () => {
  it("exits promptly even though nothing acknowledges the payload", async () => {
    await listening();

    // No handler reads anything, no reply is sent, and no timer is set anywhere
    // in the relay. It writes and leaves; there is no branch in which "the
    // companion did not respond" can become "the host agent failed", because the
    // process is already gone before such a branch could matter.
    const started = process.hrtime.bigint();
    const result = spawnSync(BINARY, [], {
      input: JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }),
      encoding: "utf8",
      timeout: 5_000,
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    expect(result.status).toBe(0);
    expect(elapsedMs).toBeLessThan(2_000);
    // Nothing was said to the host. Silence is the whole fail-open property.
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("is not delayed by a companion that never reads what it was given", async () => {
    // A listener that accepts the connection, keeps it open, and reads nothing
    // at all — the worst case for a relay that waited for a reader.
    const address = currentCompanionAddress();
    expect(address).not.toBeNull();

    const net = await import("node:net");
    const blackHole = net.createServer(() => {
      /* accept, and never read */
    });
    await new Promise<void>((resolve) => blackHole.listen(address!, () => resolve()));

    try {
      const started = process.hrtime.bigint();
      const result = spawnSync(BINARY, [], {
        input: JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }),
        encoding: "utf8",
        // A timeout that would kill it rather than let a hang pass as a pass.
        timeout: 5_000,
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(elapsedMs).toBeLessThan(2_000);
    } finally {
      await new Promise<void>((resolve) => blackHole.close(() => resolve()));
    }
  });
});

describe("an unreachable companion never harms the host", () => {
  it("exits successfully when no companion is listening", async () => {
    // Nothing is bound: the channel the relay would connect to does not exist.
    const result = spawnSync(BINARY, [], {
      input: JSON.stringify({ hook_event_name: "Stop", session_id: "s1" }),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("exits successfully when the companion is not yet installed", async () => {
    // The first invocation on a machine where the companion has never run, and
    // where no directory holds the address. Still a success: the host agent
    // behaves exactly as it would with no companion installed.
    const result = spawnSync(BINARY, [], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "s1" }),
      encoding: "utf8",
      env: { ...process.env, XDG_RUNTIME_DIR: "/nonexistent" },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("exits successfully when the payload is not usable", async () => {
    // Binary noise, truncated JSON, an empty object, and a payload larger than
    // the bound. None of them is the relay's to interpret, so none of them is
    // the relay's to fail on.
    for (const input of [
      "not json at all",
      '{"hook_event_name":',
      " binary",
      JSON.stringify({ padding: "x".repeat(2 << 20) }),
    ]) {
      const result = spawnSync(BINARY, [], { input, encoding: "utf8", timeout: 20_000 });
      expect(result.status, input.slice(0, 40)).toBe(0);
      expect(result.stderr, input.slice(0, 40)).toBe("");
    }
  });
});

describe("the relay needs nothing on the machine", () => {
  it("is a program, not a script that needs an interpreter", () => {
    const header = readFileSync(BINARY).subarray(0, 4);

    // An ELF or a PE, not `#!`. A relay that needs a shebang is a relay whose
    // interpreter has to be found from whatever environment the host agent
    // spawns hooks in, which is not guaranteed to be the developer's shell.
    const isElf = header[0] === 0x7f && header.toString("latin1", 1, 4) === "ELF";
    const isPe = header.toString("latin1", 0, 2) === "MZ";
    expect(isElf || isPe, "the relay must be a binary, not a script").toBe(true);
  });

  it("runs and delivers with no project dependencies present", async () => {
    await listening();
    const arrival = nextReceived();
    const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "clean" });

    // An empty PATH, no NODE_PATH, and a working directory with no
    // `node_modules` anywhere above it. Whatever the relay resolves has to come
    // from the kernel, because that is all there is.
    const result = spawnSync(BINARY, [], {
      input: payload,
      encoding: "utf8",
      cwd: "/",
      env: { PATH: "", NODE_PATH: "", HOME: process.env.HOME ?? "/tmp" },
      timeout: 20_000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect((await arrival).toString()).toBe(payload);
  });

  it("links nothing that has to be installed", () => {
    // The property rather than a list of versions: whatever this machine's libc
    // happens to be called, the only things linked must be the C runtime and
    // the loader. A language runtime, or anything a package manager put there,
    // would mean a machine without project dependencies installed could not run
    // this — which is the whole reason it is a Rust binary and not a script.
    const ldd = spawnSync("ldd", [BINARY], { encoding: "utf8" });
    if (ldd.error || ldd.status !== 0) return; // A static build reports nothing.

    const linked = (ldd.stdout ?? "")
      .split("\n")
      // `linux-vdso.so.1` is a mapping the kernel synthesises, not a file on
      // disk, so it is nothing anybody has to install.
      .filter((line) => !line.includes("vdso"))
      .map((line) => line.trim().split(/\s+/)[0] ?? "")
      .filter((entry) => entry.includes(".so"))
      .map((entry) => entry.split("/").pop() ?? "")
      .sort();

    expect(linked.length, "the relay links shared objects at all").toBeGreaterThan(0);

    for (const library of linked) {
      // The C library, the compiler support library the C runtime pulls in, and
      // the dynamic loader that starts the program. Nothing else.
      expect(library, "only the C runtime may be linked").toMatch(
        /^(libc|libgcc_s|ld-linux).*\.so/
      );
    }
  });
});