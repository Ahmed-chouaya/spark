import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePrograms } from "../src/relay/binary.ts";

/**
 * `npm run relay:install`, as a command.
 *
 * The pure function underneath is held to by `test/relay-install.test.ts` and
 * `test/decision-install.test.ts`. What is held to *here* is the thing those
 * cannot see: that the command people are told to type does what the README says
 * it does, with npm's own argument handling, against a real settings file in a
 * real directory.
 *
 * That is not a formality. `npm run relay:install -- --dry-run` hands the script
 * `--dry-run` and nothing else — npm eats the first `--` — so a program that
 * reads its command from `argv[0]` prints `Unknown command: --dry-run`, writes
 * nothing, and **exits 0**. Every document in this repository tells people to
 * type it. It was broken, and only running it found that.
 *
 * The user's own settings are never touched: every run here gets a scratch
 * `HOME`, which is how the installer's default path gets pointed somewhere safe.
 */

/** A machine that has this project's hooks in it, and nothing else of ours. */
const A_SETTINGS_FILE = {
  model: "opus",
  env: { FOO: "bar" },
  hooks: {
    Stop: [
      {
        matcher: "*",
        hooks: [{ type: "command", command: "/usr/local/bin/somebody-elses-thing", args: [] }],
      },
    ],
  },
};

interface Machine {
  readonly home: string;
  readonly settings: string;
  run(...args: string[]): { stdout: string; status: number | null };
  read(): Record<string, unknown>;
}

function aMachine(): Machine {
  const home = mkdtempSync(join(tmpdir(), "spark-install-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  const settings = join(home, ".claude", "settings.json");
  writeFileSync(settings, `${JSON.stringify(A_SETTINGS_FILE, null, 2)}\n`, "utf8");

  return {
    home,
    settings,
    run(...args) {
      const result = spawnSync(
        process.execPath,
        [join(import.meta.dirname, "..", "scripts/relay-install.ts"), ...args],
        { cwd: join(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, HOME: home } }
      );
      return { stdout: result.stdout, stderr: result.stderr, status: result.status };
    },
    read: () => JSON.parse(readFileSync(settings, "utf8")) as Record<string, unknown>,
  };
}

/** The commands every matcher group in the file runs. */
const commandsIn = (settings: Record<string, unknown>): string[] => {
  const hooks = (settings.hooks ?? {}) as Record<string, { hooks?: { command?: string }[] }[]>;
  return Object.values(hooks).flatMap((groups) =>
    (groups ?? []).flatMap((group) => (group?.hooks ?? []).map((hook) => hook.command ?? ""))
  );
};

/**
 * What the installer would name, resolved the way the installer resolves it.
 *
 * Not `relayCommand()`: that answers for the build output, and `packaging`
 * changed the answer to the installation's beside the window. A test that
 * asserted the old one would be asserting the bug.
 */
const PROGRAMS = resolvePrograms();

/**
 * Whether the waiting hook can be offered at all, asked the same way the
 * installer asks: of the path it would actually write into the settings.
 *
 * `askCommand()` — the build output — would be the wrong question. On a checkout
 * where `cargo build` has run but `npm run build` has not, the build output is
 * there and the installed copy is not, and that is exactly the machine on which
 * `--wait` has to refuse rather than write a hook naming nothing.
 */
const ASK_BUILT = existsSync(PROGRAMS.programs.ask);

describe("the commands the README tells people to type", () => {
  it("`--dry-run` alone is an install that writes nothing", () => {
    // Exactly the words in the README, in the order the README gives them, with
    // npm's own argument handling — which is the whole point of this file.
    const before = aMachine();
    const beforeBytes = readFileSync(before.settings, "utf8");

    const run = before.run("--dry-run");

    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout).toContain("nothing was written");
    expect(run.stdout).toContain("The following change would be made");
    expect(readFileSync(before.settings, "utf8")).toBe(beforeBytes);
  });

  it("`--yes` alone installs the seven hooks and leaves everything else alone", () => {
    const machine = aMachine();
    machine.run("--yes");

    const settings = machine.read();
    const commands = commandsIn(settings);

    expect(commands).toContain(PROGRAMS.programs.relay);
    expect(commands.filter((command) => command === PROGRAMS.programs.relay)).toHaveLength(7);
    // The user's own configuration is not ours to rewrite.
    expect(commands).toContain("/usr/local/bin/somebody-elses-thing");
    expect(settings.model).toBe("opus");
    expect(settings.env).toEqual({ FOO: "bar" });
  });

  it("names the paths it is about to write, before writing them", () => {
    const machine = aMachine();
    const run = machine.run("--dry-run");

    // Which of the two answers it used matters: a hook naming a path inside a
    // clone stops working the day the clone moves, and "it installed the wrong
    // one" has to be answerable from the output.
    expect(run.stdout).toContain(PROGRAMS.programs.relay);
    expect(run.stdout).toMatch(/resolved against the installed companion|no installed companion was found/);
  });

  it("says what is already there rather than doing it twice", () => {
    const machine = aMachine();
    machine.run("--yes");
    const after = readFileSync(machine.settings, "utf8");

    const again = machine.run("--yes");

    expect(again.stdout).toContain("Already installed");
    expect(readFileSync(machine.settings, "utf8")).toBe(after);
  });

  it("a hook pointing at a file that is not there is reported by the doctor", () => {
    // The failure the whole install path exists to avoid, checked end to end:
    // the settings name a program this machine does not have, and the one
    // command whose job is to say so says so.
    const machine = aMachine();
    machine.run("--yes");

    const doctor = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "..", "scripts/doctor.ts"), machine.settings],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, HOME: machine.home } }
    );

    // The subject, and the answer under it: this install's own path, or the
    // file that is missing. Either way the doctor says which, rather than
    // reporting a hook as fine because *some* spark-relay exists somewhere.
    expect(doctor.stdout).toContain("programs: spark-relay");
    expect(doctor.stdout).toContain(PROGRAMS.programs.relay);

    // Zero only when this install's two programs are both there. The doctor's
    // answer is the interesting one either way: it names what is missing rather
    // than treating a hook as fine because a file happens to exist somewhere.
    const bothBuilt = [PROGRAMS.programs.relay, PROGRAMS.programs.ask].every((path) =>
      existsSync(path)
    );
    expect(doctor.status, doctor.stdout).toBe(bothBuilt ? 0 : 1);
  });
});

describe("the two removals, which the README promises are separate", () => {
  // The first three need the waiting hook installed in the first place, and
  // installing it needs `spark-ask` to exist. On a checkout where
  // `npm run build` has not run there is nothing to remove and nothing to prove,
  // which is the branch the refusal test above covers instead.
  it.runIf(ASK_BUILT)("uninstall takes out the mascot and leaves the wait", () => {
    const machine = aMachine();
    machine.run("--yes", "--wait");

    const removal = machine.run("uninstall");
    const commands = commandsIn(machine.read());

    expect(removal.stdout).toContain("Removed the companion's hooks");
    // Said on the way out, because "removed the companion's hooks" reads as "the
    // companion is gone now" and it is not.
    expect(removal.stdout).toContain("npm run relay:uninstall:wait");
    expect(commands).not.toContain(PROGRAMS.programs.relay);
    expect(commands).toContain(PROGRAMS.programs.ask);
    expect(commands).toContain("/usr/local/bin/somebody-elses-thing");
  });

  it.runIf(ASK_BUILT)("uninstall-wait takes out the wait and leaves the mascot", () => {
    const machine = aMachine();
    machine.run("--yes", "--wait");

    const removal = machine.run("uninstall-wait");
    const commands = commandsIn(machine.read());

    expect(removal.stdout).toContain("The mascot's hooks are still installed");
    expect(commands).not.toContain(PROGRAMS.programs.ask);
    expect(commands).toContain(PROGRAMS.programs.relay);
  });

  it.runIf(ASK_BUILT)("both together leave the file with nothing of ours in it", () => {
    const machine = aMachine();
    machine.run("--yes", "--wait");
    machine.run("uninstall");
    machine.run("uninstall-wait");

    const settings = machine.read();
    expect(commandsIn(settings)).toEqual(["/usr/local/bin/somebody-elses-thing"]);
    expect(settings.model).toBe("opus");
  });

  it("says so when there was nothing to remove, rather than reporting success", () => {
    const machine = aMachine();

    const first = machine.run("uninstall");
    expect(first.stdout).toContain("were not installed");

    const second = machine.run("uninstall-wait");
    expect(second.stdout).toContain("was not installed");
  });
});

describe("installing the waiting hook", () => {
  it.runIf(ASK_BUILT)("adds one hook on one event, in its own group", () => {
    const machine = aMachine();
    const run = machine.run("--yes", "--wait");

    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout).toContain("Installed 8 hooks");

    const preToolUse = (machine.read().hooks as Record<string, unknown[]>).PreToolUse!;
    expect(preToolUse).toHaveLength(2);
    expect(commandsIn(machine.read())).toContain(PROGRAMS.programs.ask);
  });

  it.runIf(!ASK_BUILT)(
    "refuses, naming the file and the command that builds it, rather than installing a broken hook",
    () => {
      // The branch that matters most and is easiest to get wrong: an installer
      // that writes a hook naming a file which is not there, and reports
      // success. `npm run verify` does not build `npm run build`'s output, so on a
      // clean checkout this is the branch that runs here.
      const machine = aMachine();
      const run = machine.run("--yes", "--wait");

      expect(run.status).toBe(1);
      expect(run.stdout).toContain("Cannot install the waiting hook");
      expect(run.stdout).toContain(PROGRAMS.programs.ask);
      expect(run.stdout).toContain("npm run build");
      // Nothing written, and no diff drawn to be agreed to.
      expect(commandsIn(machine.read())).not.toContain(PROGRAMS.programs.ask);
      expect(run.stdout).not.toContain("The following change would be made");
    }
  );
});

describe("asking", () => {
  it("an answer that is not an explicit yes declines, and writes nothing", () => {
    // Typed at a terminal rather than piped, because `createInterface` closes on
    // a closed input and this is the branch a user hits by pressing Enter.
    const machine = aMachine();
    const before = readFileSync(machine.settings, "utf8");

    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "..", "scripts/relay-install.ts")],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, HOME: machine.home }, input: "\n" }
    );

    expect(result.stdout).toContain("Apply this change?");
    expect(readFileSync(machine.settings, "utf8")).toBe(before);
  });

  it("`--help` says what there is, and installs nothing", () => {
    const machine = aMachine();
    const before = readFileSync(machine.settings, "utf8");

    for (const argument of ["--help", "-h", "events"]) {
      const run = machine.run(argument);
      expect(run.status, argument).toBe(0);
    }

    expect(machine.run("--help").stdout).toContain("uninstall-wait");
    expect(readFileSync(machine.settings, "utf8")).toBe(before);
  });

  it("an unknown command says so, on standard error, and exits non-zero", () => {
    const machine = aMachine();
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "..", "scripts/relay-install.ts"), "frobnicate"],
      { cwd: join(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, HOME: machine.home } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: frobnicate");
    expect(result.stderr).toContain("uninstall-wait");
  });
});