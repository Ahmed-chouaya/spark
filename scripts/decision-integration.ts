#!/usr/bin/env node
/**
 * The decision round trip, end to end, against the real programs.
 *
 * Everything else in this change is tested against a stand-in. This runs the
 * actual `spark-ask` binary, over the actual channel, to the actual companion,
 * and reads the bytes a host would have read. The first real invocation of the
 * wait is the first real proof of it.
 *
 * ## What it does, in one pass
 *
 * 1. Builds `ask/` and `relay/`.
 * 2. Starts a companion and waits for it to be listening.
 * 3. Runs `spark-ask` with a real hook payload on standard input and a real
 *    companion to answer it.
 * 4. Asserts the bytes it printed are the host's documented decision shape.
 * 5. Runs it again with no companion at all, and asserts it printed nothing and
 *    exited successfully — the fail-open invariant, on the real binary.
 * 6. Runs it again against a companion that never answers, and asserts the same
 *    thing: nothing printed, success, and it ended at its own bound rather than
 *    when the companion decided to.
 *
 * ## What it does not do, and why
 *
 * **It does not run Claude Code.** That is the one thing here that cannot be
 * checked from a build machine, and it is the one thing worth checking on a real
 * one: it costs a model call, it needs the user's own `claude` on PATH, and its
 * result depends on which model that machine has configured. A check that
 * depended on it would fail for reasons that have nothing to do with the relay.
 *
 * So this covers the whole transport and both directions of the format, and says
 * plainly what is left:
 *
 * > Run `claude` in a directory where the waiting hook is installed, ask for
 * > something that needs a tool, and answer the card. That is the only way to
 * > confirm the host honours the decision rather than merely reading it.
 *
 * The printed format was taken from the hooks reference
 * (`docs.claude.com/en/docs/claude-code/hooks`, "PreToolUse decision control"),
 * and `src/companion/decision.ts` names the same document. That is the strongest
 * claim available without the host in the loop, and it is not the same claim.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openReplyChannel, type PendingRequestChannel } from "../src/relay/channel";
import { currentDecisionAddress } from "../src/relay/address";
import { createDecisionRuntime } from "../src/companion/runtime";
import { permissionDecision } from "../src/companion/decision";
import { createClaudeCodeAdapter } from "../src/state-selection/adapters/claude-code";
import { isNativeBinary, relayBinaryName } from "../src/relay/binary.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the waiting program is, as this platform names it.
 *
 * Built here rather than carried by `relayCommand()`, because that answers for
 * the *other* program. Both spellings come from `relayBinaryName`, so the rule
 * about cargo's extension is asked of one place rather than restated here — and
 * a restatement is how this file would come to disagree with the installer about
 * what the binary is called on Windows.
 */
const ASK = join(ROOT, "ask/target/release", relayBinaryName("spark-ask"));

let failures = 0;

const step = (title: string): void => process.stdout.write(`\n${title}\n`);
const check = (ok: boolean, description: string, detail?: string): void => {
  if (ok) {
    process.stdout.write(`  ok    ${description}\n`);
    return;
  }
  failures++;
  process.stdout.write(`  FAIL  ${description}${detail ? `\n        ${detail}` : ""}\n`);
};

/**
 * A hook payload shaped like the host's, asking for permission.
 *
 * `PreToolUse` is the event that can block, and it is the one the waiting hook is
 * installed for. The payload is the host's shape because the companion's adapter
 * reads it — this check is exercising the real interpretation, not a simplified
 * one, so that a change to the adapter shows up here.
 */
const ASKING_PAYLOAD = {
  session_id: "integration-session",
  transcript_path: "/tmp/integration.jsonl",
  cwd: "/tmp",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "rm -rf /tmp/does-not-matter" },
  tool_use_id: "toolu_integration",
};

/** What `spark-ask` printed, and how long it took. */
/**
 * Run `spark-ask` with a payload on standard input, and collect what it printed.
 *
 * Asynchronous rather than `spawnSync`, and that is load-bearing rather than a
 * style preference. **This check runs the companion's listener in the same
 * process**, and `spawnSync` blocks Node's only thread: the child would sit there
 * waiting for a reply from a listener whose event loop cannot run until the child
 * exits. Every run would then take the full deadline and print nothing, which
 * looks exactly like a broken product and is in fact a broken check.
 *
 * Found the hard way — three of the four steps here reported failure while the
 * same exchange, driven asynchronously, completed in twelve milliseconds.
 */
async function runAsk(
  payload: unknown
): Promise<{ status: number | null; stdout: string; stderr: string; ms: number }> {
  const started = Date.now();

  return new Promise((done) => {
    const child = spawn(ASK, [], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) =>
      done({ status, stdout, stderr, ms: Date.now() - started })
    );

    // A hang here would hold the check open rather than failing it, so the child
    // is given the same bound the check asserts about. It is longer than the
    // program's own deadline so that a program which overran is caught as an
    // overrun rather than as this timeout.
    setTimeout(() => child.kill("SIGKILL"), 40_000).unref();

    child.stdin.end(JSON.stringify(payload));
  });
}

/**
 * Remove the channel address, so a step can run with nothing listening.
 *
 * Only the entry this user's companion owns, and only at a path derived from
 * their own identity. Touching anything else would be editing a machine's state
 * from a diagnostic script, which is the one thing these scripts must never do —
 * `relay:verify` is explicit about this and so is this.
 */
function clearAddress(): void {
  const address = currentDecisionAddress();
  if (!address) return;
  // A pipe is not a filesystem entry, so there is nothing to remove on Windows.
  if (process.platform === "win32") return;
  // Already gone is the desired state, not a failure — the previous run cleaned
  // up after itself, and a second consecutive run must not depend on that.
  try {
    unlinkSync(address);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/* ------------------------------------------------------------------ 1. build */

step("1. the waiting program is a program this machine can run");
if (!existsSync(ASK)) {
  process.stdout.write(`  FAIL  not built: ${ASK}\n`);
  process.stdout.write("        run: cargo build --release --manifest-path ask/Cargo.toml\n");
  process.exit(1);
}
check(isNativeBinary(readFileSync(ASK)), "it is a binary, not a script needing an interpreter");

/* --------------------------------------------------- 2. nothing is listening */

step("2. with no companion running, nothing is printed and the exit is a success");
{
  // A socket file left by an earlier run would be connected to and written into
  // by a kernel with nobody behind it, so `connect` would succeed and the wait
  // would run to its full bound. That is the product behaving correctly — a
  // stale address is a real thing, and the companion takes it back on start — but
  // it is not the case this step is about, so the address is cleared first.
  clearAddress();

  const run = await runAsk(ASKING_PAYLOAD);

  // Empty bytes rather than "parseable": silence is not approval and not refusal,
  // it is the host doing exactly what it would do with no companion installed.
  check(run.stdout === "", "nothing at all is printed", JSON.stringify(run.stdout));
  check(run.status === 0, "the exit is a success", `status ${run.status}`);
  check(!/deny|allow|permissionDecision/i.test(run.stdout), "and in particular no refusal");

  // "Immediately" is the assertion, not "eventually". A program that slept for
  // its whole bound before noticing nobody was there would pass a test that only
  // checked that it returned.
  check(run.ms < 2_000, "and it noticed rather than waiting out the bound", `${run.ms}ms`);
}

/* -------------------------------------------------------- 3. the full trip */

step("3. a decision travels from a card to the bytes a host reads");

const address = currentDecisionAddress();
if (!address) {
  process.stdout.write("  FAIL  this machine has no readable identity to derive an address from\n");
  process.exit(1);
}

// One runtime for the whole run, built here rather than inside the handler.
//
// The handler is called once per request and the run makes one, so building it
// per call would work by accident — and would hide the thing worth checking,
// which is that the *same* set of pending requests is what a surface would offer
// from. A companion that forgot a request between receiving it and answering it
// is the failure this whole check exists to find, and a fresh runtime per call
// could not express that question at all.
const runtime = createDecisionRuntime({
  // The adapter is passed in rather than built here, which is the same boundary
  // `createClaudeCodeSource` draws: a second host agent is a second adapter and
  // nothing else changes.
  adapter: createClaudeCodeAdapter(),
  onRequest: () => {
    /* the surface is not under test; `announce` is called directly below */
  },
});

const channel = await openReplyChannel({
  onRequest: (request: PendingRequestChannel) => {
    // The companion's own half: interpret the payload with the one adapter that
    // exists, and if it is something the user can answer, answer it.
    const pending = runtime.announce(request);
    check(pending !== null, "the request was understood as something answerable");
    check(
      runtime.offered?.id === request.id,
      "and it is the request the surface would offer",
      `offered ${runtime.offered?.id}, asked about ${request.id}`
    );

    if (!pending) {
      // Nothing this companion can answer. The wait ends with silence, which is
      // the host falling back to its own prompt rather than a refusal nobody made.
      request.reply(Buffer.alloc(0));
      return;
    }

    // The user's answer, taken through the same `decide` the surface uses, so a
    // decision for a request that has gone away is refused here for the same
    // reason it would be refused there.
    const outcome = runtime.answer("allow", pending);
    check(outcome.applied, "the answer applied to the request it was made for");
    check(
      runtime.pending.length === 0,
      "and it resolved that request and no other"
    );

    request.reply(permissionDecision("allow"));
  },
});

try {
  const run = await runAsk(ASKING_PAYLOAD);

  check(run.status === 0, "the exit is a success", `status ${run.status}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = undefined;
  }

  const output = (parsed as { hookSpecificOutput?: Record<string, string> })?.hookSpecificOutput;
  check(output !== undefined, "the host's documented shape came out", run.stdout);

  // Field by field against the reference, because a shape that is nearly right
  // reads as no decision at all and the feature silently never works.
  check(output?.["hookEventName"] === "PreToolUse", "hookEventName is PreToolUse");
  check(output?.["permissionDecision"] === "allow", "the decision is the one chosen");
  check(
    output?.["permissionDecisionReason"] === undefined,
    "no reason on an allow, because the reference sends one to the debug log only"
  );

  // Nothing else in the envelope. A hook that can put text in the model's context
  // is a channel to the model, and this one offers two buttons.
  check(
    Object.keys(parsed as object).length === 1,
    "and nothing else in the envelope",
    JSON.stringify(Object.keys(parsed as object))
  );
} finally {
  await channel.close();
}

/* ------------------------------------------------------------ 4. no answer */

step("4. a companion that never answers ends at the program's own bound");
{
  // A companion that receives the request and does not reply. The bound is the
  // claim: a wait that ends when the companion decides to is a wait with no bound,
  // and the companion is the component with the most ways to hang.
  const silent = await openReplyChannel({
    onPayload: () => {},
    onRequest: () => {
      /* deliberately silent */
    },
  });

  try {
    const run = await runAsk(ASKING_PAYLOAD);

    check(run.stdout === "", "nothing is printed", JSON.stringify(run.stdout));
    check(run.status === 0, "the exit is a success", `status ${run.status}`);
    check(run.ms >= 9_000, "it waited for its own bound", `${run.ms}ms`);
    check(run.ms < 25_000, "and not much longer", `${run.ms}ms`);
  } finally {
    await silent.close();
  }
}

/* ------------------------------------------------------------ 5. the rest */

step("5. what this does not cover");
process.stdout.write(
  "  A real `claude` run is NOT included, and it is the one thing worth doing by\n" +
    "  hand on a machine that has the agent installed:\n\n" +
    "      npm run relay:install -- --yes     (with the wait built and askCommand set)\n" +
    "      claude                            ask for something needing a tool\n" +
    "      answer the card\n\n" +
    "  That confirms the host honours the decision. Everything above confirms the\n" +
    "  bytes are right and that every failure leaves the host untouched.\n"
);

process.stdout.write(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
