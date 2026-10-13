/**
 * The companion's entry point: work out where the relay will be, then start the
 * window that listens there.
 *
 * It used to be the whole runtime — listen, fold, print what the reduction
 * decided — because there was no window to show it on. Now the window is the
 * product and this is what launches it: the address is derived, the shell's
 * frontend is built, and `shell/src-tauri` is run with the address in its
 * environment. The reduction it used to print is drawn by
 * `shell/src/companion.tsx` instead, by the same adapter and the same fold, on a
 * surface the user can look at.
 *
 * ## Why it hands the address over rather than letting the shell derive it
 *
 * `src/relay/address.ts` is the one implementation of the companion's address
 * that a test can compare against the relay's Rust one
 * (`test/relay-address.test.ts`). Deriving it here and passing it on keeps that
 * a two-implementation contract. A third derivation inside `shell/src-tauri`
 * would be a third answer that nothing compares, which is strictly worse than
 * being told the one that is already checked — and the shell refusing to start
 * without one is a louder failure than a shell that quietly bound somewhere the
 * relay will never write.
 *
 * Nothing is negotiated. The value is derived from the running user's identity
 * before either side starts; neither side can reach a different answer by asking.
 *
 * ## What it deliberately does not do
 *
 * It does not install hooks. `npm run relay:install` is a separate command that
 * shows a diff and asks first, and starting the app is not consent to reconfigure
 * the user's agent — a file this project does not own deciding whether their
 * agent runs. `test/shell-shape.test.ts` pins that: a launcher that grew an
 * `install` import would fail there rather than in review.
 *
 *   npm run companion
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { currentCompanionAddress } from "../src/relay/address";
import { watchChannel } from "../src/relay/watch";
import { buildAdapterRegistry, describeSessions, foldAgentPayload, parse, sessionChange } from "../shell/src/adapters";
import type { AgentSession } from "../src/state-selection/session";

/** The root of this repository, from this file rather than from the cwd. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The shell's frontend entry, and the directory Tauri embeds it from. */
const UI_ENTRY = join(REPO, "shell/index.html");

/** The crate that opens the window. */
const CRATE = join(REPO, "shell/src-tauri/Cargo.toml");

/**
 * The variable the shell reads its channel address from.
 *
 * Named here rather than written into the shell's source, so the two ends are
 * checked against each other: `shell/src-tauri/src/channel.rs` asserts that this
 * file still uses this name, which is the only thing that keeps a rename on one
 * side from being a silent "the shell listens nowhere".
 */
const ADDRESS_VARIABLE = "SPARK_CHANNEL_ADDRESS";

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const note = (line: string): void => {
  process.stderr.write(`companion: ${line}\n`);
};

/**
 * Run a command, inheriting this process's streams.
 *
 * Inheriting rather than capturing is the point: the shell reports the platform's
 * answers on standard error, and a windowed program whose diagnostics went
 * through a pipe the user cannot see would be a program that cannot say when it
 * did not work.
 */
function run(command: string, args: string[], extraEnvironment: NodeJS.ProcessEnv = {}) {
  return spawn(command, args, {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, ...extraEnvironment },
  });
}

/** Run a command to completion, refusing to go on if it failed. */
async function build(command: string, args: string[]): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    run(command, args).once("error", reject).once("exit", resolve);
  });

  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${code ?? "by signal"}`);
  }
}

const address = currentCompanionAddress();

if (!address) {
  // Answered rather than guessed. An address built from an assumed identity
  // would reach a different user's companion or nobody's, and neither is
  // something the user could tell apart from the companion not running.
  note("cannot derive the companion's address: the running user has no readable identity");
  process.exit(1);
}

await build("npx", ["vite", "build", "--config", "shell/vite.config.ts"]);

note(`listening on ${address}`);
note("ready");

const shell = run("cargo", ["run", "--manifest-path", CRATE], {
  [ADDRESS_VARIABLE]: address,
});

/**
 * Watch the channel and report what the payloads made of it.
 *
 * ## Why this process does it as well as the window
 *
 * The window is the product, and the window folds these payloads through the
 * same reduction this does. But on a platform that cannot hold a surface above
 * other windows — GNOME, which is what this was built on — **correct behaviour is
 * an empty desktop**, so "is a session open, and what is it doing" has no answer
 * on the screen. This is that answer.
 *
 * It is the same adapters, the same fold and the same report function the
 * document uses (`shell/src/adapters.ts`), so the two cannot disagree about what
 * a payload means. It is a second listener rather than a second reduction: the
 * channel is a socket and more than one client may connect, exactly as the relay
 * connects to it.
 *
 * Changed-state only. A host that emits an event per token would otherwise print
 * a line per token and the signal would be the noise.
 */
const adapters = buildAdapterRegistry();
let seen: readonly AgentSession[] = [];

// The window binds the address only after `cargo run` has compiled it, which on a
// cold build is tens of seconds. Three one-second attempts would give up before
// there is anything to watch, and a watcher that gives up silently is
// indistinguishable from one that is working — so this waits for a window rather
// than reporting that there is not one.
const watching = await watchChannel({
  attempts: 90,
  retryDelayMs: 1_000,
  onPayload: (payload: Buffer) => {
    const folded = foldAgentPayload(seen, adapters, parse(payload.toString("utf8")));
    const change = sessionChange(seen, folded.sessions);
    seen = folded.sessions;

    if (change === null) return;
    for (const line of change.split("\n")) out(`companion: ${line}`);
  },
  onUnavailable: (reason) => note(`not watching: ${reason}`),
});

const stop = (): void => {
  void watching?.close().catch(() => {});
  shell.kill();
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

shell.on("exit", (code, signal) => {
  out(`companion: stopped (${signal ?? `exit ${code ?? 0}`})`);
  process.exit(code ?? 0);
});
