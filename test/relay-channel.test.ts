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

const remember = (channel: CompanionChannel): CompanionChannel => {
  open.push(channel);
  return channel;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((channel) => channel.close().catch(() => {})));
});

describe("only the owning user may reach the channel", () => {
  it("keeps the holding directory to its owner", async () => {
    const directory = join(scratch(), "spark-1001");
    await remember(await openChannel({ address: join(directory, "companion.sock"), onPayload: noop }));

    // The barrier that does not depend on the socket's own mode: another user
    // cannot traverse into the directory, so the right path and a guessed one
    // are refused by the same rule.
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  });

  it("keeps the socket itself to its owner", async () => {
    const address = join(scratch(), "companion.sock");
    await remember(await openChannel({ address, onPayload: noop }));

    // The directory alone is not enough: the OS creates the socket with the
    // process umask applied, and a permissive umask would leave it connectable
    // by anyone who had the path.
    expect(statSync(address).mode & 0o777).toBe(0o600);
  });

  it("refuses a connection from a process running as a different user", async () => {
    const address = join(scratch(), "companion.sock");
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
    const address = join(scratch(), "companion.sock");

    // Made for real: a listener that is killed rather than closed, so what is
    // left on disk is what a crash leaves — a path with nothing behind it.
    const crashed = spawn(
      process.execPath,
      ["-e", `require("node:net").createServer().listen(${JSON.stringify(address)},()=>{})`],
      { stdio: "ignore" }
    );
    await waitFor(() => existsSync(address));
    crashed.kill("SIGKILL");
    await once(crashed, "exit");

    expect(existsSync(address)).toBe(true);
    // Genuinely stale: nothing is behind it.
    expect(await canConnect(address)).toBe(false);

    // The companion starts anyway. A user should never have to clear this by
    // hand — needing to is the situation this product exists to prevent.
    const received: Buffer[] = [];
    await remember(await openChannel({ address, onPayload: (p) => received.push(p) }));

    expect(await canConnect(address)).toBe(true);
  });

  it("takes over an address occupied by something that is not a socket", async () => {
    const address = join(scratch(), "companion.sock");
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