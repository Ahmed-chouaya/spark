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
 *   npm run relay:uninstall             take the hooks back out
 * ```
 *
 * There is deliberately no flag that installs as a side effect of something
 * else. The only unattended path is `--yes`, which is an explicit choice.
 */

import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOOK_EVENTS,
  installHooks,
  planHooks,
  uninstallHooks,
  USER_SETTINGS_PATH,
} from "../src/relay/install.ts";
import { readFile } from "node:fs/promises";

/**
 * The relay, as the host will invoke it.
 *
 * Absolute, because a hook runs in whatever directory the session started from:
 * a relative path would resolve against that rather than against anything it
 * means. This is also the only place in the companion that knows where the built
 * binary is.
 */
const RELAY_COMMAND = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../relay/target/release/spark-relay"
);

const USAGE = `spark-relay — deliver the host agent's hook payload to the companion

  install [--yes] [--dry-run]   add the companion's hooks to the host's settings
  uninstall                     remove them again
  events                        list the hook events the companion installs for

Installing edits the host agent's own configuration, so the change is printed
first and applied only once you agree to it. A copy of the current file is kept
in spark-backups/ before anything is written.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...flags] = argv;
  const yes = flags.includes("--yes");
  const dryRun = flags.includes("--dry-run");

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (command) {
    case "events":
      for (const event of HOOK_EVENTS) process.stdout.write(`${event}\n`);
      return 0;

    case "install":
      return install({ yes, dryRun });

    case "uninstall":
      return uninstall();

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

async function install({ yes, dryRun }: { yes: boolean; dryRun: boolean }): Promise<number> {
  const out = process.stdout;

  // The proposal is computed once and shown, and then `installHooks` computes it
  // again from the same file. They cannot disagree unless the file changed in
  // between, and if it did the thing to show is the new one — so the plan that
  // gets written is always the one computed from what is actually on disk.
  const preview = planHooks({
    relayCommand: RELAY_COMMAND,
    current: await currentSettings(),
  });

  if (!preview.changed && !dryRun) {
    out.write("Already installed. Nothing was changed.\n");
    return 0;
  }

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

  const result = await installHooks({ relayCommand: RELAY_COMMAND, confirmed: true });

  if (!result.applied) {
    out.write("Already installed. Nothing was changed.\n");
    return 0;
  }

  out.write(`Installed ${result.plan.added.length} hooks into ${result.settingsPath}\n`);
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