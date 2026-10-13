import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diagnose, render, type DoctorInput } from "../scripts/doctor.ts";
import { installHooks, planHooks } from "../src/relay/install.ts";
import type { HostWindow } from "../src/escalation/capability.ts";
import type { ResolvedPrograms } from "../src/relay/binary.ts";

/**
 * `npm run doctor`.
 *
 * The claims under test are, in order of how much they matter:
 *
 *   - it changes nothing, which is a property checked by running it over a real
 *     settings file in a real directory and comparing the bytes, the timestamps
 *     and the listing afterwards;
 *   - an absent companion is reported rather than treated as a fault, because a
 *     machine where nothing has blocked the agent is the normal case and a tool
 *     that exits non-zero for it is a tool that cries wolf;
 *   - the floating answer is the *surface's* answer, read from the same module,
 *     so the two cannot drift apart;
 *   - it says what it looked at, because "it works on my machine" is the
 *     sentence this project has been arguing against since the first spike.
 */

const SETTINGS_PATH = "/tmp/scratch/.claude/settings.json";

/** The programs an install on this machine would point hooks at. */
const PROGRAMS: ResolvedPrograms = {
  programs: { relay: "/opt/spark/spark-relay", ask: "/opt/spark/spark-ask" },
  source: "installed",
  searched: ["/opt/spark", "/opt/spark/resources"],
};

/** A settings file with the companion's hooks in it, built by the real installer. */
const installedSettings = (relay: string, ask?: string): string =>
  planHooks({ relayCommand: relay, ...(ask ? { askCommand: ask } : {}), current: "" }).proposed;

/** Everything the report needs, with the parts a scenario cares about overridable. */
const input = (overrides: Partial<DoctorInput> = {}): DoctorInput => ({
  settings: "",
  settingsPath: SETTINGS_PATH,
  programs: PROGRAMS,
  exists: (path) => path.startsWith("/opt/spark"),
  companion: { address: "/tmp/spark-1000/companion.sock", reachable: false },
  capability: null,
  ...overrides,
});

/** Every line the report printed, as one string, for a claim about wording. */
const said = (overrides: Partial<DoctorInput> = {}): string =>
  render(diagnose(input(overrides))).join("\n");

const finding = (report: ReturnType<typeof diagnose>, subject: string) =>
  report.findings.find((entry) => entry.subject === subject)!;

describe("what the doctor reports about the hooks", () => {
  it("says they are not installed, and how to see the change without making it", () => {
    const report = diagnose(input());
    const hooks = finding(report, "hooks");

    expect(hooks.severity).toBe("absent");
    expect(hooks.answer).toContain(SETTINGS_PATH);
    expect(hooks.remedy).toContain("--dry-run");
    expect(report.broken).toBe(false);
  });

  it("says they are installed when they are, and names the file", () => {
    const report = diagnose(
      input({ settings: installedSettings(PROGRAMS.programs.relay, PROGRAMS.programs.ask) })
    );
    const hooks = finding(report, "hooks");

    expect(hooks.severity).toBe("ok");
    expect(hooks.answer).toContain(SETTINGS_PATH);
  });

  it("reads the file through the same function that installs it", () => {
    // A second reader of the settings format is a second implementation of what
    // a hook is, and the two would disagree the first time the format moved. So
    // the answer to "are they installed" comes from `planHooks`.
    const settings = installedSettings(PROGRAMS.programs.relay, PROGRAMS.programs.ask);
    const plan = planHooks({
      relayCommand: PROGRAMS.programs.relay,
      askCommand: PROGRAMS.programs.ask,
      current: settings,
    });

    expect(plan.changed).toBe(false);
    expect(diagnose(input({ settings })).findings.find((f) => f.subject === "hooks")?.severity).toBe(
      "ok"
    );
  });

  it("says which of the two hooks are there, because they are separate entries", () => {
    // A user who installed the wait should be able to take it out on its own,
    // and a user who did not should be able to add it on its own. The report has
    // to name which, or neither of those is a thing they can do.
    const withoutWait = diagnose(
      input({ settings: installedSettings(PROGRAMS.programs.relay) })
    );
    expect(finding(withoutWait, "hooks").note).toContain("NOT installed");
    expect(finding(withoutWait, "hooks").remedy).toContain("--wait");

    const withWait = diagnose(
      input({ settings: installedSettings(PROGRAMS.programs.relay, PROGRAMS.programs.ask) })
    );
    expect(finding(withWait, "hooks").note).toContain("PreToolUse");
    expect(finding(withWait, "hooks").remedy).toContain("relay:uninstall:wait");
  });

  it("refuses to read a settings file it cannot parse, and changes nothing", () => {
    const report = diagnose(input({ settings: "{ this is not json" }));

    // The same refusal the installer makes, for the same reason: a file whose
    // contents are unknown is not a file to be rewritten on a guess.
    expect(finding(report, "hooks").severity).toBe("bad");
    expect(render(report).join("\n")).toContain("nothing was changed");
  });
});

describe("what the doctor reports about the programs the hooks name", () => {
  it("says a program the settings name is not on this machine", () => {
    // The failure this whole command exists for: an installer that reports
    // success while writing a path that is not there, and an agent that then
    // quietly stops reporting.
    const report = diagnose(
      input({
        settings: installedSettings("/somewhere/that/moved/spark-relay"),
        exists: (path) => path.startsWith("/opt/spark"),
      })
    );

    expect(finding(report, "programs: spark-relay").severity).toBe("bad");
    expect(finding(report, "programs: spark-relay").answer).toContain(
      "/somewhere/that/moved/spark-relay"
    );
    expect(report.broken).toBe(true);
  });

  it("says a program left over from another install is not this install's", () => {
    const report = diagnose(
      input({
        settings: installedSettings("/home/somebody-else/spark/spark-relay"),
        exists: () => true,
      })
    );

    const relay = finding(report, "programs: spark-relay");
    expect(relay.severity).toBe("bad");
    expect(relay.answer).toContain("another install");
  });

  it("says a program that is there and is this install's, and nothing more", () => {
    const report = diagnose(
      input({ settings: installedSettings(PROGRAMS.programs.relay, PROGRAMS.programs.ask) })
    );

    expect(finding(report, "programs: spark-relay").severity).toBe("ok");
    expect(finding(report, "programs: spark-relay").answer).toBe("/opt/spark/spark-relay");
    expect(finding(report, "programs: spark-ask").severity).toBe("ok");
    expect(report.broken).toBe(false);
  });

  it("says when this install has not been built, and what builds it", () => {
    const report = diagnose(input({ exists: () => false }));

    expect(finding(report, "this install: spark-relay").severity).toBe("bad");
    expect(finding(report, "this install: spark-relay").remedy).toBe("npm run build");
    expect(report.broken).toBe(true);
  });

  it("says where it looked, and which of the two answers it used", () => {
    // The question "is this *my* install?" is not answerable without saying where
    // it looked, and an answer that did not say would be indistinguishable from
    // one that had looked in the right place.
    expect(said()).toContain("the installed companion's own directory");
    expect(said()).toContain("looked in /opt/spark, /opt/spark/resources");

    const fromBuild = said({ programs: { ...PROGRAMS, source: "build" } });
    expect(fromBuild).toContain("this checkout's build output");
    expect(fromBuild).toContain("/opt/spark/resources");
  });
});

describe("an absent companion is reported, not treated as a fault", () => {
  it("says nothing is listening, and that this is not a problem", () => {
    const report = diagnose(input());

    expect(finding(report, "companion").severity).toBe("absent");
    expect(finding(report, "companion").note).toContain("not a fault");
    expect(finding(report, "companion").remedy).toBe("npm run companion");
    // The whole point: nothing about a quiet machine is broken.
    expect(report.broken).toBe(false);
  });

  it("says it is listening when it is", () => {
    const report = diagnose(
      input({ companion: { address: "/tmp/spark-1000/companion.sock", reachable: true } })
    );

    expect(finding(report, "companion").severity).toBe("ok");
    expect(finding(report, "companion").answer).toContain("/tmp/spark-1000/companion.sock");
  });

  it("separates an unaskable host from a platform that said no", () => {
    // The distinction the capability module exists to keep. One is a fact about
    // the host, one is a fact about the platform, and a reader debugging a
    // machine needs to know which they are looking at.
    const unaskable = finding(
      diagnose(input({ capability: { placement: "unknown", held: false } })),
      "floating surface"
    );
    expect(unaskable.note).toContain("host could not ask");

    const saidNo = finding(
      diagnose(input({ capability: { placement: "wayland-layer", held: false } })),
      "floating surface"
    );
    expect(saidNo.note).toContain("appears when something blocks");
  });

  it("reports a host's own affirmative, naming the question that produced it", () => {
    // Not "Windows floats". The report says what the host said it was asked and
    // what it answered — which is the whole difference between a checkable
    // report and a conclusion. `docs/platform-findings.md` records that this
    // probe's Windows read cannot confirm the window then stayed on top.
    const windows: HostWindow = { placement: "windows-topmost", held: true };
    const report = diagnose(input({ capability: windows }));
    const floating = finding(report, "floating surface");

    expect(floating.answer).toContain("yes");
    expect(floating.answer).toContain("WS_EX_TOPMOST");
  });

  it("never carries one platform's answer into another's row", () => {
    // Nothing here reads `process.platform` to decide what to print. The answer
    // is whatever the host report says, and a host that did not run produces a
    // different sentence rather than the same one with a different adjective.
    const source = readFileSync(join(import.meta.dirname, "..", "scripts/doctor.ts"), "utf8");
    expect(source).not.toContain("process.platform");
    expect(source).not.toContain("win32");
  });
});

describe("the doctor changes nothing", () => {
  const scratch = (): string => mkdtempSync(join(tmpdir(), "spark-doctor-"));

  /**
   * Run it as a command.
   *
   * `spawnSync` rather than `execFileSync` because the status is not what this is
   * about: a settings file naming a missing program *should* exit non-zero, and a
   * check that insisted otherwise would be asserting that the tool never reports
   * anything.
   */
  const doctorRun = (settingsPath: string) =>
    spawnSync("node", [join(import.meta.dirname, "..", "scripts/doctor.ts"), settingsPath], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    });

  it("leaves the settings file byte for byte, and adds nothing beside it", () => {
    // Run as a command rather than as a function, because "as a function" would
    // be a claim about `diagnose` and this is a claim about the thing a person
    // types. The settings file is a real one with real hooks in it, written by
    // the real installer, at a path this run is pointed at.
    const directory = scratch();
    const settingsPath = join(directory, "settings.json");
    const contents = installedSettings("/opt/spark/spark-relay", "/opt/spark/spark-ask");
    writeFileSync(settingsPath, contents, "utf8");

    const before = readFileSync(settingsPath, "utf8");
    const beforeStat = statSync(settingsPath);
    const beforeListing = readdirSync(directory).sort();

    const run = doctorRun(settingsPath);
    expect(run.stderr, run.stderr).toBe("");
    expect(run.stdout, "it said something").not.toBe("");

    expect(readFileSync(settingsPath, "utf8")).toBe(before);
    expect(statSync(settingsPath).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(readdirSync(directory).sort()).toEqual(beforeListing);
  });

  it("leaves nothing behind when the file it was pointed at does not exist", () => {
    const directory = scratch();
    const settingsPath = join(directory, "settings.json");

    expect(doctorRun(settingsPath).status).toBe(0);

    // No file created, no backup directory, no stray. A diagnostic that leaves a
    // mark on a machine where nothing was wrong is one nobody runs twice.
    expect(readdirSync(directory)).toEqual([]);
  });

  it("exits non-zero only when something is actually broken", () => {
    // A companion that is not running is not broken, so a quiet machine exits
    // zero. A hook pointing at a file that is not there is broken, and exits one.
    const directory = scratch();
    const settingsPath = join(directory, "settings.json");

    writeFileSync(settingsPath, installedSettings("/gone/spark-relay"), "utf8");
    expect(doctorRun(settingsPath).status).toBe(1);

    writeFileSync(settingsPath, "", "utf8");
    expect(doctorRun(settingsPath).status).toBe(0);
  });

  it("can reach no write of its own", () => {
    // The structural version of the claim above, because the behavioural one
    // only covers the paths this run happened to take. Read from the source, with
    // comments stripped so prose about writing is not a violation of it.
    const source = readFileSync(join(import.meta.dirname, "..", "scripts/doctor.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    for (const forbidden of [
      "writeFile",
      "appendFile",
      "copyFile",
      "mkdir",
      "unlink",
      "rmdir",
      "rmSync",
      "rename",
      "installHooks",
      "uninstallHooks",
      "uninstallWait",
    ]) {
      expect(source, `the doctor can ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("sends nothing down the channel to find out whether it is there", () => {
    // It connects and says nothing. A reachability check that delivered a
    // payload would be a second thing with a second consent model, and the
    // companion would fold a packet nobody sent.
    const source = readFileSync(join(import.meta.dirname, "..", "scripts/doctor.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");

    expect(source, "it writes to the socket").not.toMatch(/socket\.write|\bsocket\.end\([^)]/);
    expect(source, "it ends the socket without a payload").toMatch(/socket\.end\(\)/);
  });
});

describe("the floating answer is the surface's answer", () => {
  it("reads the same probe `npm run probe:capability` runs", () => {
    const sourceOf = (relative: string): string =>
      readFileSync(join(import.meta.dirname, "..", relative), "utf8");

    for (const file of ["scripts/doctor.ts", "scripts/probe-capability.mjs"]) {
      const source = sourceOf(file);
      expect(source, `${file} does not import the probe`).toContain(
        "src/escalation/capability"
      );
      expect(source, `${file} does not ask it the question`).toContain(
        "canHoldPersistentSurface"
      );
    }
  });

  it("feeds it the host's own report, rather than something of its own", () => {
    // The import is the easy half. What matters is where the answer enters the
    // report: a doctor that read a capability from anywhere other than the host's
    // published report would be a second probe, and two probes are two answers
    // that can disagree — which is the mistake `docs/platform-findings.md`
    // records having already made once, on Windows 11.
    const entry = readFileSync(join(import.meta.dirname, "..", "scripts/doctor.ts"), "utf8");
    const reporting = entry.slice(entry.indexOf("export async function doctor"));

    expect(reporting).toMatch(/capability:\s*readHostWindow\(\)/);
    expect(reporting).not.toMatch(/capability:\s*\{/);
  });

  it("asks nothing of the platform by itself", () => {
    // No compositor query, no window handle, no window level: every one of those
    // is a thing this repository has already got wrong by inventing a second
    // way of asking. The doctor's job is to report the surface's answer, and
    // reading a style bit correctly is not the same as the platform honouring it.
    const source = readFileSync(join(import.meta.dirname, "..", "scripts/doctor.ts"), "utf8");
    for (const forbidden of ["GetWindowLong", "zwlr_layer_shell", "NSWindow", "DISPLAY", "WAYLAND"]) {
      expect(source, `the doctor asks about ${forbidden} itself`).not.toContain(forbidden);
    }
  });
});