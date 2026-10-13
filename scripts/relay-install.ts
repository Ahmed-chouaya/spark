/**
 * `spark-relay install` — put the companion's hooks into the host agent's own
 * configuration, having shown the user exactly what that would do.
 *
 * The command exists to make consent a step rather than a flag nobody reads. It
 * computes the proposal, prints it as a diff, and asks. Typing `n`, piping
 * nothing in, or closing the terminal leaves the host's configuration exactly as
 * it was — down to the byte, because planning is a pure function of the file and
 * writing is a separate call that never happens without an answer.
 *
 * ```
 *   npm run relay:install -- --dry-run   show the change, write nothing, ask nothing
 *   npm run relay:install               show it, ask, then do as told
 *   npm run relay:install -- --yes      do it without asking
 *   npm run relay:install -- --wait     also install the hook that waits for you
 *   npm run relay:uninstall             take the non-blocking hooks back out
 *   npm run relay:uninstall:wait        take out only the one that waits
 * ```
 *
 * There is deliberately no flag that installs as a side effect of something
 * else. The only unattended path is `--yes`, which is an explicit choice.
 */

import { createInterface } from "node:readline/promises";
import {
  HOOK_EVENTS,
  installHooks,
  planHooks,
  uninstallHooks,
  uninstallWait,
  USER_SETTINGS_PATH,
} from "../src/relay/install.ts";
import { existsSync } from "node:fs";
import { resolvePrograms } from "../src/relay/binary.ts";
import { readFile } from "node:fs/promises";

/**
 * The programs the hooks will name, and which answer that was.
 *
 * An installation when there is one — resolved against the companion's own
 * executable, so the paths travel with the files they name and a moved checkout
 * cannot leave a hook pointing into nothing. The build's own output when there
 * is not, which is what a developer who has run `cargo build` and not
 * `npm run build` has.
 *
 * Absolute either way, because a hook runs in whatever directory the session
 * started from. This is also the only place in the companion that knows where the
 * built binary is.
 */
const PROGRAMS = resolvePrograms();
const RELAY_COMMAND = PROGRAMS.programs.relay;
const ASK_COMMAND = PROGRAMS.programs.ask;

const USAGE = `spark-relay — deliver the host agent's hook payload to the companion

  install [--yes] [--dry-run] [--wait]
                              add the companion's hooks to the host's settings
  uninstall                   remove the non-blocking hooks again
  uninstall-wait              remove only the hook that waits for your answer
  events                      list the hook events the companion installs for

Installing edits the host agent's own configuration, so the change is printed
first and applied only once you agree to it. A copy of the current file is kept
in spark-backups/ before anything is written.

--wait installs the second program too, the one that blocks a tool call until you
answer it. It goes in its own matcher group so that 'uninstall' leaves it alone
and 'uninstall-wait' leaves the mascot alone.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...flags] = argv;
  const yes = flags.includes("--yes");
  const dryRun = flags.includes("--dry-run");
  const wait = flags.includes("--wait");

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (command) {
    case "events":
      for (const event of HOOK_EVENTS) process.stdout.write(`${event}\n`);
      return 0;

    case "install":
      return install({ yes, dryRun, wait });

    case "uninstall":
      return uninstall();

    case "uninstall-wait":
      return uninstallTheWait();

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

/**
 * Whether the waiting hook can be installed at all on this machine.
 *
 * Checked before anything is proposed, because the alternative is proposing a
 * hook that points at a file which is not there and reporting success — which is
 * the one outcome this command exists to make impossible.
 */
function waitAvailable(): boolean {
  return existsSync(ASK_COMMAND);
}

async function install({
  yes,
  dryRun,
  wait,
}: {
  yes: boolean;
  dryRun: boolean;
  wait: boolean;
}): Promise<number> {
  const out = process.stdout;

  if (wait && !waitAvailable()) {
    // Named, with the command that fixes it. Refusing before the diff is drawn
    // means the user is never shown a change they cannot have.
    out.write(
      `Cannot install the waiting hook: ${ASK_COMMAND} does not exist.\n` +
        "Build it with: npm run build\n\n"
    );
    return 1;
  }

  // The proposal is computed once and shown, and then `installHooks` computes it
  // again from the same file. They cannot disagree unless the file changed in
  // between, and if it did the thing to show is the new one — so the plan that
  // gets written is always the one computed from what is actually on disk.
  const preview = planHooks({
    relayCommand: RELAY_COMMAND,
    ...(wait ? { askCommand: ASK_COMMAND } : {}),
    current: await currentSettings(),
  });

  if (!preview.changed && !dryRun) {
    out.write("Already installed. Nothing was changed.\n");
    return 0;
  }

  out.write(`The hooks will name:\n  ${RELAY_COMMAND}\n`);
  if (wait) out.write(`  ${ASK_COMMAND}\n`);
  out.write(
    PROGRAMS.source === "installed"
      ? "  (resolved against the installed companion, so moving the installation moves these with it)\n\n"
      : "  (no installed companion was found; these are this checkout's own build outputs)\n\n"
  );

  out.write(`The following change would be made to ${preview.settingsPath}:\n\n`);
  out.write(preview.diff === "" ? "  (nothing)\n\n" : preview.diff);

  if (dryRun) {
    out.write("\n--dry-run: nothing was written.\n");
    return 0;
  }

  out.write("\nA copy of the current file is kept in spark-backups/ before it is changed.\n\n");

  // Silence is a no. A prompt that treats a closed input as consent is not
  // consent, so anything but an explicit yes — including an error reading the
  // answer — declines.
  const confirmed = yes || (await ask("Apply this change? [y/N] "));
  if (!confirmed) {
    out.write("Declined. Nothing was written.\n");
    return 0;
  }

  const result = await installHooks({
    relayCommand: RELAY_COMMAND,
    ...(wait ? { askCommand: ASK_COMMAND } : {}),
    confirmed: true,
  });

  if (!result.applied) {
    out.write("Already installed. Nothing was changed.\n");
    return 0;
  }

  const added = result.plan.added.length + result.plan.addedBlocking.length;
  out.write(`Installed ${added} hooks into ${result.settingsPath}\n`);
  out.write(`Previous configuration kept at ${result.backupPath}\n`);
  return 0;
}

async function uninstall(): Promise<number> {
  const result = await uninstallHooks({ relayCommand: RELAY_COMMAND });

  process.stdout.write(
    result.changed
      ? `Removed the companion's hooks from ${result.settingsPath}. The backup has been kept.\n`
      : "The companion's hooks were not installed. Nothing was changed.\n"
  );

  // Said on the way out, because "removed the companion's hooks" reads as "the
  // companion is gone now" and it is not: the waiting hook is a separate entry in
  // that same file, and a user who installed it wants to know it is still there.
  process.stdout.write(
    "The hook that waits for your answer is a separate entry and is still installed.\n" +
      "To take that out too, and only that: npm run relay:uninstall:wait\n"
  );
  return 0;
}

/**
 * Take out only the hook that waits, leaving the mascot installed.
 *
 * A separate command rather than a flag on `uninstall` because "remove the wait"
 * and "remove everything" are different things a person can mean: one is finished
 * with this, the other liked the mascot and found the wait not for them. Overload
 * one command with an optional mode and the second silently means the first
 * whenever both are given, which is exactly the call somebody makes in a hurry.
 */
async function uninstallTheWait(): Promise<number> {
  const result = await uninstallWait({ askCommand: ASK_COMMAND });

  process.stdout.write(
    result.changed
      ? `Removed the waiting hook from ${result.settingsPath}. The mascot's hooks are still installed.\n`
      : "The waiting hook was not installed. Nothing was changed.\n"
  );
  return 0;
}

/** Ask one question. Anything but an explicit yes is a no. */
async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

/** The host's settings as they are now; `""` when there is no file yet. */
async function currentSettings(): Promise<string> {
  try {
    return await readFile(USER_SETTINGS_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));