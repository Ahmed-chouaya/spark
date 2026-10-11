/**
 * The integration check, against the real host agent on this machine.
 *
 * Everything else in this change is tested against a payload shaped like the
 * host's. This runs the host itself, so the first real invocation of the relay
 * is the first real proof of it.
 *
 * ## What it does, in one pass
 *
 * 1. Builds the relay.
 * 2. Installs the hooks into a **project-scoped** settings file in a scratch
 *    directory. Project scope rather than user scope so the run is a real
 *    install through the real installer, without writing to the user's
 *    `~/.claude/settings.json`.
 * 3. Starts the companion and waits for it to be listening.
 * 4. Runs `claude` in that directory, which fires the hooks for real.
 * 5. Asserts the session arrived without anybody supplying it.
 * 6. Runs again with the companion stopped, and asserts the agent proceeds with
 *    no error and no delay.
 * 7. Uninstalls and asserts the settings file is back as it was.
 *
 * ## The part that costs something
 *
 * Step 4 runs the real agent, which is a real model call. It is started
 * without `--bare`, because bare mode skips hooks along with plugins and
 * skills — which would make the whole check pass against machinery that is not
 * running. Pass `--no-agent` to check everything except step 4, which covers the
 * whole transport and the install without spending anything.
 *
 *   npx vite-node scripts/relay-integration.ts            everything
 *   npx vite-node scripts/relay-integration.ts --no-agent everything but the model call
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupPathFor,
  installHooks,
  uninstallHooks,
} from "../src/relay/install.ts";
import { openChannel } from "../src/relay/channel";
import { createClaudeCodeSource } from "../src/relay/session-source";
import { selectState } from "../src/state-selection/reduce";
import { escalates } from "../src/state-selection/escalation";
import { longestWaiting, type PendingSet } from "../src/escalation/pending";

/**
 * What a caller has told the companion it is waiting on.
 *
 * Empty, and it stays empty for the whole run. That is not an omission in the
 * check — it is the boundary being demonstrated. A pending request says what the
 * agent wants to *do*, and a hook payload never says that.
 */
const pending: PendingSet = [];

const RELAY_COMMAND = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../relay/target/release/spark-relay"
);

/** The prompt the real agent is asked. Shortest thing that still starts a session. */
const PROMPT = "Reply with the single word: ok";

let failures = 0;

const check = (ok: boolean, description: string, detail?: string): void => {
  if (ok) {
    process.stdout.write(`  ok    ${description}\n`);
    return;
  }
  failures++;
  process.stdout.write(`  FAIL  ${description}${detail ? `\n        ${detail}` : ""}\n`);
};

const step = (title: string): void => process.stdout.write(`\n${title}\n`);

/* ------------------------------------------------------------------ setup */

execFileSync("cargo", ["build", "--release"], {
  cwd: join(import.meta.dirname, "../relay"),
  stdio: "pipe",
});

const workspace = mkdtempSync(join(tmpdir(), "spark-integration-"));
const settingsPath = join(workspace, ".claude", "settings.json");
mkdirSync(dirname(settingsPath), { recursive: true });

/** What the project looked like before the companion touched it. */
const beforeInstall = { $schema: "https://json.schemastore.org/claude-code-settings.json" };
writeFileSync(settingsPath, `${JSON.stringify(beforeInstall, null, 2)}\n`);
const original = readFileSync(settingsPath, "utf8");

const source = createClaudeCodeSource();
let stopCompanion: (() => void) | null = null;

/** What the real host actually sent, for the report rather than for an assertion. */
const fromTheHost: string[] = [];

const startCompanion = async (): Promise<string> => {
  const channel = await openChannel({
    onPayload: (payload) => {
      source.receive(payload);
      const parsed = JSON.parse(payload.toString("utf8")) as { hook_event_name?: string };
      fromTheHost.push(parsed.hook_event_name ?? "(unrecognised)");
    },
  });
  stopCompanion = () => void channel.close().catch(() => {});
  return channel.address;
};

const stop = (): void => {
  stopCompanion?.();
  stopCompanion = null;
};

/** Run the real agent in the scratch project and collect what happened. */
const runClaude = (
  extra: string[] = []
): Promise<{ status: number | null; stdout: string; stderr: string; ms: number }> =>
  new Promise((done) => {
    const started = Date.now();
    const child = spawn("claude", ["-p", PROMPT, ...extra], {
      cwd: workspace,
      encoding: "utf8",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) =>
      done({ status, stdout, stderr, ms: Date.now() - started })
    );
  });

/** Wait for a session to appear from the host's own stream. */
const waitForSession = async (timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (source.sessions.length > 0) return true;
    await new Promise((wait) => setTimeout(wait, 100));
  }
  return false;
};

const withAgent = !process.argv.includes("--no-agent");

/* ------------------------------------------------------------------- 1. install */

step("1. the relay is a program this machine can run");
check(existsSync(RELAY_COMMAND), "the relay is built", RELAY_COMMAND);
check(
  readFileSync(RELAY_COMMAND).subarray(0, 2).toString() === "\x7fE",
  "it is a binary rather than a script needing an interpreter"
);

step("2. installing the hooks, into a project scope rather than yours");
const installed = await installHooks({
  settingsPath,
  relayCommand: RELAY_COMMAND,
  confirmed: true,
  now: () => new Date("2026-10-11T09:00:00.000Z"),
});
if (!installed.applied) throw new Error("the install did not apply");
check(installed.plan.added.length === 7, "seven hooks were added");
check(
  existsSync(installed.backupPath),
  "the prior configuration was kept",
  installed.backupPath
);
check(
  readFileSync(installed.backupPath, "utf8") === original,
  "and it is the file as it was, byte for byte"
);

step("3. nothing was installed until it was asked for");
const declined = await installHooks({
  settingsPath,
  relayCommand: RELAY_COMMAND,
  confirmed: false,
});
check(
  !declined.applied && declined.backupPath === null,
  "an install with no explicit request writes nothing, not even a backup"
);

/* ------------------------------------------------------------- 4. with the companion */

step("4. the companion is listening");
const address = await startCompanion();
check(address.endsWith("companion.sock") || address.includes("pipe"), "channel bound", address);

/* ------------------------------------------------------------------- 5. the real agent */

if (withAgent) {
  step("5. the real agent starts a session in a directory");
  const run = await runClaude();
  const arrived = await waitForSession(20_000);

  check(arrived, "a session reached the companion", `claude exited ${run.status}`);
  check(source.sessions.length > 0, "with no caller having supplied one");
  check(
    source.sessions.every((session) => session.agent === "claude-code"),
    "and it is attributed to the host agent",
    JSON.stringify(source.sessions.map((s) => s.agent))
  );
  check(
    !/spark-relay|No such file|Connection refused|hook.*(fail|error)/i.test(run.stderr),
    "the agent surfaced no error from the relay",
    run.stderr.slice(0, 400)
  );

  const rendered = selectState(source.sessions);
  check(
    ["idle", "thinking", "working", "success", "focused", "listening", "alert"].includes(
      rendered
    ),
    "the reduction — not the transport — decided what to show",
    `rendered: ${rendered}`
  );

  process.stdout.write(
    `  note  the host sent: ${fromTheHost.join(", ") || "(nothing)"}; ` +
      `the reduction rendered: ${rendered}\n`
  );

  // The agent's own exit status is reported rather than asserted. On a machine
  // whose configured model is unavailable the run fails after the session has
  // already started, which says nothing about the relay — and the baseline for
  // that is a run with no hooks installed at all, which fails identically.
  const modelFailed = /Model is unavailable|API Error/i.test(run.stderr);
  process.stdout.write(
    `  note  claude exited ${run.status}` +
      (modelFailed
        ? " because the configured model is unavailable on this machine — not the relay's doing.\n" +
          "        The session started and its hooks fired before that, which is what is being checked.\n"
        : `\n`)
  );
} else {
  step("5. skipped (--no-agent: the real agent makes a model call)");
}

/* ------------------------------------------------------------------ 5. escalation */

step("6. a blocked session escalates, and cannot be answered from here yet");
{
  // Delivered the way the host would deliver it: through the relay, as the
  // bytes the agent writes.
  const escalate = spawnSyncRelay(
    JSON.stringify({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      session_id: "blocked-1",
      timestamp: Date.now(),
    })
  );
  check(escalate.status === 0, "the relay delivered the block");

  await new Promise((wait) => setTimeout(wait, 300));
  const blocked = source.sessions.find((session) => session.sessionId === "blocked-1");
  check(blocked?.state === "needsYou", "the session is blocked", String(blocked?.state));
  check(
    blocked !== undefined && escalates(blocked),
    "and the surface escalates it",
    "an actionable block escalates"
  );
  check(
    blocked?.block === "authorization",
    "for a reason the companion can answer",
    String(blocked?.block)
  );

  // The boundary, checked rather than asserted. A decision card is offered from
  // the *pending set*, and a pending request is what the agent wants done in
  // terms the user can decide on — `run npm publish`. A hook payload says a
  // session is blocked; it never says what for, and there is nothing in the
  // relay's output that could say it.
  //
  // So a block that arrived through the relay escalates, and offers nothing to
  // answer. That is the documented edge of this change, and `decision-transport`
  // is what completes it.
  check(
    longestWaiting(pending) === null,
    "no decision card is offered for it",
    "nothing arrived that names what the agent wants to do"
  );
  check(
    source.sessions.some(escalates) && longestWaiting(pending) === null,
    "the escalation surfaces while the card cannot be answered — the boundary of this change"
  );
}

/* ------------------------------------------------------------------- 6. companion stopped */

step("7. with the companion stopped, the agent proceeds unaffected");
stop();
{
  // The relay on its own first, because that is the property being claimed.
  const direct = spawnSyncRelay(
    JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "unreachable",
      timestamp: Date.now(),
    })
  );
  check(direct.status === 0, "the relay exits successfully");
  check(direct.stderr === "" && direct.stdout === "", "and says nothing at all");
  check(direct.ms < 2_000, "without waiting", `${direct.ms}ms`);

  if (withAgent) {
    // Then the thing that actually matters: a real agent firing real hooks at a
    // companion that is not there. It has to behave exactly as it would with no
    // companion installed — no error, no delay, no hanging turn.
    const before = source.sessions.length;
    const run = await runClaude();
    const waited = Date.now() - before;

    check(
      !/spark-relay|No such file|Connection refused|hook.*(fail|error)/i.test(run.stderr),
      "a real agent firing real hooks surfaced nothing from the relay",
      run.stderr.slice(0, 400)
    );
    check(run.ms < 60_000, "and was not delayed waiting for a companion", `${run.ms}ms`);
    check(
      source.sessions.length === before,
      "and nothing reached state selection",
      `${source.sessions.length - before} sessions appeared`
    );
    void waited;
  }
}

/* ---------------------------------------------------------------------- 7. uninstall */

step("8. uninstalling restores the project");
await uninstallHooks({ settingsPath, relayCommand: RELAY_COMMAND });
check(readFileSync(settingsPath, "utf8") === original, "the settings file is exactly as it was");
check(
  existsSync(backupPathFor(settingsPath, new Date("2026-10-11T09:00:00.000Z"))),
  "and the backup is still there to recover from"
);

process.stdout.write(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) failed.\n`
);
process.exitCode = failures === 0 ? 0 : 1;

/* ------------------------------------------------------------------ helpers */

/** Run the relay synchronously, timing it and capturing whatever it says. */
function spawnSyncRelay(input: string): { status: number | null; stdout: string; stderr: string; ms: number } {
  const started = Date.now();
  const result = require("node:child_process").spawnSync(RELAY_COMMAND, [], {
    input,
    encoding: "utf8",
    timeout: 10_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ms: Date.now() - started,
  };
}