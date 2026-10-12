import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openChannel, type CompanionChannel } from "../src/relay/channel";

/**
 * The companion's end of the channel: who may connect, and what happens when
 * something is already at the address.
 *
 * Every test here uses its own address under a temporary directory rather than
 * the user's real one. The real channel is exercised end to end in
 * `test/relay.test.ts`, which is the only file that runs the relay: the relay
 * has no option to point it anywhere, which is the point of it, so every test
 * that spawns it shares one address and has to take turns.
 */

const open: CompanionChannel[] = [];

const scratch = (): string => {
  const directory = join(tmpdir(), `spark-channel-${process.pid}-${randomSuffix()}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

const randomSuffix = (): string => Math.random().toString(36).slice(2);

/**
 * An address this platform can actually listen on.
 *
 * On Unix that is a path under a scratch directory, and the tests below assert
 * mode bits on it. On Windows it is a name in the pipe namespace, where those
 * assertions have no meaning — a pipe has no filesystem entry and no POSIX mode.
 *
 * Passing a Unix-shaped path on Windows failed with `listen EACCES`, which reads
 * like a permissions problem and is really a type problem: a file path is not a
 * pipe name, so this suite never exercised the Windows branch of the channel at
 * all. That branch is the reason this helper exists.
 */
const channelAddress = (directory: string): string =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\spark-test-${process.pid}-${randomSuffix()}`
    : join(directory, "companion.sock");

/** Whether the assertions in a block mean anything on this platform. */
const isWindows = process.platform === "win32";

const remember = (channel: CompanionChannel): CompanionChannel => {
  open.push(channel);
  return channel;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((channel) => channel.close().catch(() => {})));
});

describe("only the owning user may reach the channel", () => {
  // Mode bits are a Unix fact. On Windows the equivalent barrier is the pipe's
  // own ACL, and asserting `stat().mode` there would be asserting a fiction
  // rather than skipping a check.
  it.runIf(!isWindows)("keeps the holding directory to its owner", async () => {
    const directory = join(scratch(), "spark-1001");
    await remember(
      await openChannel({ address: channelAddress(directory), onPayload: noop })
    );

    // The barrier that does not depend on the socket's own mode: another user
    // cannot traverse into the directory, so the right path and a guessed one
    // are refused by the same rule.
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });

  it.runIf(!isWindows)("keeps the socket itself to its owner", async () => {
    const address = channelAddress(scratch());
    await remember(await openChannel({ address, onPayload: noop }));

    // The directory alone is not enough: the OS creates the socket with the
    // process umask applied, and a permissive umask would leave it connectable
    // by anyone who had the path.
    expect(statSync(address).mode & 0o777).toBe(0o600);
  });

  it("delivers a payload on this platform", async () => {
    // The Windows branch of the channel has never run anywhere: every test that
    // opened one passed a Unix path, which fails to bind there rather than
    // exercising it. This is the assertion that it works at all — and it is the
    // one the relay depends on, on whichever platform it is running.
    const address = channelAddress(scratch());
    const received: Buffer[] = [];
    await remember(await openChannel({ address, onPayload: (p) => received.push(p) }));

    expect(await canConnect(address)).toBe(true);
    await send(address, '{"hook_event_name":"SessionStart"}');
    await waitFor(() => received.length > 0);

    expect(received[0]!.toString("utf8")).toBe('{"hook_event_name":"SessionStart"}');
  });

  it.runIf(!isWindows)("refuses a connection from a process running as a different user", async () => {
    const address = channelAddress(scratch());
    const received: Buffer[] = [];
    await remember(await openChannel({ address, onPayload: (p) => received.push(p) }));

    const probe = attemptAsAnotherUser(address);

    if (!probe.attempted) {
      // A machine that will not hand this test a second identity. The refusal
      // itself is not optional and is not conditional on the machine — it is
      // the kernel's, from the mode bits asserted above — but it is not
      // *demonstrated* here, and the difference is worth stating rather than
      // hiding behind a passing assertion.
      expect(probe.reason).toBeTruthy();
      return;
    }

    expect(probe.connected, probe.reason).toBe(false);
    // The kernel's own answer, and the one that matters: the permission check
    // failed before the listener was ever reached, so there is no code in this
    // project that could be edited to let it through.
    expect(probe.code).toBe("EACCES");
    expect(received).toHaveLength(0);
  });
});

describe("a channel left behind does not stop the companion", () => {
  it("takes over a socket left by an unclean exit and becomes available", async () => {
    const address = channelAddress(scratch());

    // Made for real: a listener that is killed rather than closed, so what is
    // left behind is what a crash leaves.
    const crashed = spawn(
      process.execPath,
      [
        "-e",
        `require("node:net").createServer().listen(${JSON.stringify(
          isWindows ? address : address
        )},()=>{})`,
      ],
      { stdio: "ignore" }
    );
    await waitFor(() => (isWindows ? true : existsSync(address)));
    crashed.kill(isWindows ? undefined : "SIGKILL");
    await once(crashed, "exit");

    if (!isWindows) {
      expect(existsSync(address)).toBe(true);
      // Genuinely stale: nothing is behind it.
      expect(await canConnect(address)).toBe(false);
    }

    // The companion starts anyway. A user should never have to clear this by
    // hand — needing to is the situation this product exists to prevent.
    await remember(await openChannel({ address, onPayload: noop }));

    expect(await canConnect(address)).toBe(true);
  });

  it.runIf(!isWindows)("takes over an address occupied by something that is not a socket", async () => {
    const address = channelAddress(scratch());
    writeFileSync(address, "");
    chmodSync(address, 0o600);

    // A predictable path in a shared directory can already be taken, and a
    // plain file there is not a live companion. Refusing to start over it would
    // be exactly the manual intervention this design refuses.
    const channel = await openChannel({ address, onPayload: noop });
    expect(statSync(address).isSocket()).toBe(true);
    expect(await canConnect(channel.address)).toBe(true);
    remember(channel);
  });

  it("checks ownership before it removes anything", () => {
    // Taken over, not taken away: an entry owned by another user is left exactly
    // where it is and the start fails loudly instead. That check runs against
    // this process's own uid, and it runs before the removal — a version that
    // unlinked first and checked afterwards would be a race, not a check.
    const source = readFileSync(
      join(import.meta.dirname, "../src/relay/channel.ts"),
      "utf8"
    );
    expect(source).toMatch(
      /takeOwnership[\s\S]*?ownerOf\(address\)[\s\S]*?owner !== currentUid\(\)[\s\S]*?unlink\(address\)/
    );
  });
});

describe("the Windows branch is guarded in source, not only at runtime", () => {
  // These assertions exist because a Windows-only defect cannot be caught by
  // running the suite on Linux: the code path is unreachable here, so every
  // test passes whether the guard is present or not. That is exactly how
  // `ensurePrivateDirectory` came to try to `mkdir` the `\\.\pipe` device
  // namespace on Windows, and how this suite spent its first Windows run
  // reporting `listen EACCES` — a permissions error that was really a type
  // error, produced by handing the module a file path where it wanted a pipe
  // name.
  //
  // So each guard is pinned by reading the source. A guard that is deleted
  // fails here, on the machine that cannot execute it.

  const source = readFileSync(
    join(import.meta.dirname, "../src/relay/channel.ts"),
    "utf8"
  );

  /** The body of a named function, so a match cannot be satisfied by a comment. */
  const bodyOf = (name: string): string => {
    const start = source.indexOf(`function ${name}`);
    expect(start, `${name} exists`).toBeGreaterThan(-1);
    const rest = source.slice(start);
    const end = rest.indexOf("\n}\n");
    return rest.slice(0, end === -1 ? rest.length : end);
  };

  it("does not treat a pipe name as a filesystem path", () => {
    // `dirname("\\\\.\\pipe\\spark-x")` is the pipe namespace, not a
    // directory. Everything this function does to a path is meaningless there,
    // and creating the namespace root is not something the user asked for.
    const body = bodyOf("ensurePrivateDirectory");
    const guard = body.indexOf('if (process.platform === "win32") return;');

    expect(guard, "ensurePrivateDirectory returns early on Windows").toBeGreaterThan(-1);
    // And the guard comes first, before the first filesystem call.
    const firstFilesystemCall = Math.min(
      ...["mkdir(", "chmod(", "dirname("]
        .map((call) => body.indexOf(call))
        .filter((at) => at > -1)
    );
    expect(guard, "the guard precedes any path handling").toBeLessThan(firstFilesystemCall);
  });

  it("does not chmod a pipe, which has no mode to narrow", () => {
    const body = bodyOf("restrictSocketToOwner");
    const guard = body.indexOf('if (process.platform === "win32") return;');
    const chmod = body.indexOf("chmod(");

    expect(guard, "restrictSocketToOwner returns early on Windows").toBeGreaterThan(-1);
    expect(guard, "the guard precedes the chmod").toBeLessThan(chmod);
  });

  it("asks for no mode bits on a platform that has none", () => {
    // `stat().uid` and `process.getuid` do not exist on Windows, and returning
    // `null` is what makes "owner unknown" mean "do not refuse" rather than
    // "compare undefined against undefined and refuse everything".
    expect(bodyOf("ownerOf")).toContain('if (process.platform === "win32") return null;');
    expect(bodyOf("currentUid")).toContain('typeof process.getuid === "function"');
  });

  it("opens a pipe with the options a pipe needs", () => {
    // Without `readableAll`/`writableAll` false, Node's default pipe ACL lets
    // any local account connect — which would make a per-user channel a
    // per-machine one.
    expect(source).toMatch(
      /server\.listen\(\{\s*path: address,\s*readableAll: false,\s*writableAll: false\s*\}\s*\)/
    );
  });
});

/* ------------------------------------------------------------------ helpers */

function noop(): void {
  /* nothing to receive in this test */
}

async function canConnect(address: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect(address);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Write one payload to the channel, the way the relay does. */
async function send(address: string, payload: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(address);
    socket.once("error", reject);
    socket.once("connect", () => socket.end(payload, resolve));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the socket to appear");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function once(child: ReturnType<typeof spawn>, event: string): Promise<void> {
  return new Promise((resolve) => child.once(event, () => resolve()));
}

/**
 * Try to connect to the channel as a user who is not this one.
 *
 * A second real account is needed, and this machine has none it can hand out
 * without a password. What it does have is a subordinate uid range and
 * `newuidmap`, so the test builds a user namespace holding exactly two ids —
 * this user, and one borrowed from the subuid range — and makes the connection
 * as the borrowed one. The connection that results is refused by the same kernel
 * check that would refuse it for a genuinely different account, because inside
 * that namespace it is genuinely a different uid and the socket is genuinely
 * owned by another one.
 *
 * Returns `attempted: false` when the machine will not provide that, which is a
 * real answer about this machine rather than a passing test standing in for one.
 */
function attemptAsAnotherUser(address: string): {
  readonly attempted: boolean;
  readonly connected: boolean;
  readonly code?: string;
  readonly reason?: string;
} {
  if (process.platform === "win32") {
    return { attempted: false, connected: false, reason: "user namespaces are a Unix facility" };
  }

  const uid = process.getuid?.();
  const subuid = firstSubordinateUid();
  if (uid === undefined || subuid === null) {
    return { attempted: false, connected: false, reason: "no subordinate uid range is allocated" };
  }

  const script = `
    const net = require("node:net");
    const socket = net.connect(${JSON.stringify(address)});
    socket.on("connect", () => process.exit(0));
    socket.on("error", (e) => { console.log(e.code); process.exit(1); });
  `;

  const result = spawnSync(
    "unshare",
    [
      // Outer `uid` -> inner 0, so the socket's owner is one id inside...
      `--map-users=${uid},0,1`,
      // ...and a borrowed outer uid -> inner 1, so the connector is another.
      `--map-users=${subuid},1,1`,
      `--map-groups=${uid},0,1`,
      `--map-groups=${subuid},1,1`,
      "--",
      "setpriv",
      "--reuid", "1",
      "--regid", "1",
      "--keep-groups",
      process.execPath,
      "-e",
      script,
    ],
    { encoding: "utf8", timeout: 20_000 }
  );

  if (result.error) return { attempted: false, connected: false, reason: result.error.message };
  if (result.status !== 0 && result.status !== 1) {
    return { attempted: false, connected: false, reason: result.stderr || `exit ${result.status}` };
  }

  return { attempted: true, connected: result.status === 0, code: result.stdout.trim() };
}

/** The first uid this user is allowed to act as, or `null` if none is allocated. */
function firstSubordinateUid(): number | null {
  const username = process.env.USER ?? process.env.LOGNAME;
  if (!username) return null;

  const file = readFileSync("/etc/subuid", "utf8");
  const line = file.split("\n").find((entry) => entry.startsWith(`${username}:`));
  if (!line) return null;

  const start = Number(line.split(":")[1]);
  return Number.isFinite(start) ? start : null;
}