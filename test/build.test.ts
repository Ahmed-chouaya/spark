import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSteps,
  declaredBundleIcons,
  REPO as REPO_ROOT,
  runBuild,
  type Command,
  type CommandResult,
} from "../scripts/build.ts";
import {
  askCommand,
  programsBeside,
  relayCommand,
  shellCommand,
} from "../src/relay/binary.ts";

/**
 * The build, checked without a Rust toolchain.
 *
 * `npm run build` runs cargo three times and a bundler once: two minutes, and
 * things this suite should not need. What the build is *for*, though, is not the
 * compiling — it is the order, the refusal to carry on with a missing input, and
 * naming the thing that failed. All three are properties of `runBuild` given a
 * `run` that returns whatever the scenario wants, so they are checked here and
 * the cargo runs are left to a person.
 *
 * The one thing not checked here is that the programs compile. That is what
 * `test/relay.test.ts` and `test/ask.test.ts` already run the real binaries for.
 */

/** A `run` that succeeds at everything, recording what it was asked for. */
const succeeding = (asked: Command[] = []): ((command: Command) => Promise<CommandResult>) =>
  async (command) => {
    asked.push(command);
    return { code: 0, signal: null };
  };

/** The steps as a name sequence, which is what the order claim is about. */
const names = (platform: NodeJS.Platform = "linux"): readonly string[] =>
  buildSteps(platform).map((step) => step.name);

describe("the build runs in an order, and the order is a dependency", () => {
  it("builds the icons, then the relay, then the wait, then the window, then the bundle", () => {
    expect(names()).toEqual(["icons", "relay", "ask", "shell", "programs", "bundle"]);
  });

  it("builds the same way on every platform, because the order is not a habit", () => {
    // Asserted rather than read off the source: an order that could differ by
    // platform would be an order somebody had to remember twice.
    expect(names("win32")).toEqual(["icons", "relay", "ask", "shell", "programs", "bundle"]);
    expect(names("darwin")).toEqual(["icons", "relay", "ask", "shell", "programs", "bundle"]);
  });

  it("will not copy the programs before the window's own executable exists", async () => {
    // The claim as a behaviour rather than as a list. `exists` answers true for
    // everything except the companion — the state of a machine where the shell
    // has not been built — so the step that copies is refused, and it says which
    // file it wanted.
    const shell = shellCommand("linux");
    const outcome = await runBuild({
      run: succeeding(),
      exists: (path) => path !== shell,
      platform: "linux",
    });

    expect(outcome.failed).toBe("programs");
    expect(outcome.completed).not.toContain("bundle");
    expect(outcome.failure).toContain("programs cannot start");
    expect(outcome.failure).toContain(shell);
  });

  it("will not bundle when a program is missing from beside the executable", async () => {
    // The dependency the design names: the artefact carries an installer, and
    // that installer's hooks have to name files that are there.
    const beside = programsBeside(shellCommand("linux"));
    const outcome = await runBuild({
      run: succeeding(),
      exists: (path) => path !== beside.ask,
      platform: "linux",
    });

    expect(outcome.failed).toBe("bundle");
    expect(outcome.failure).toContain(beside.ask);
    expect(outcome.completed).toEqual(["icons", "relay", "ask", "shell", "programs"]);
  });
});

describe("a failure names the thing that failed", () => {
  it("names the step, what it was for, and where the output is", async () => {
    const outcome = await runBuild({
      run: async (command) =>
        command.args.join(" ").includes("ask/Cargo.toml")
          ? { code: 101, signal: null }
          : { code: 0, signal: null },
      platform: "linux",
    });

    // The wait is the third step, and the one that matters most: a hook pointing
    // at a missing binary stalls the user's agent on every tool call, so "the
    // build failed" is not a message anybody can act on.
    expect(outcome.failed).toBe("ask");
    expect(outcome.failure).toContain("build: ask failed");
    expect(outcome.failure).toContain("the program that waits for your answer");
    expect(outcome.failure).toContain("exited 101");
    expect(outcome.failure).toMatch(/Full output: .*ask\.log/);
  });

  it("stops there, rather than carrying on to build something impossible", async () => {
    const outcome = await runBuild({
      run: async (command) =>
        command.args.join(" ").includes("relay/Cargo.toml")
          ? { code: 1, signal: null }
          : { code: 0, signal: null },
      platform: "linux",
    });

    expect(outcome.completed).toEqual(["icons"]);
    expect(outcome.failed).toBe("relay");
    // Nothing after it ran, so the bundler was never asked to package a window
    // whose own programs had not been built.
    expect(outcome.completed).not.toContain("shell");
    expect(outcome.completed).not.toContain("bundle");
  });

  it("reports a command that could not be started at all", async () => {
    // `cargo` missing is a different problem from `cargo` failing, and a message
    // saying "exited 1" for a process that never began sends the reader to the
    // wrong place.
    const outcome = await runBuild({
      run: async () => {
        throw new Error("spawn cargo ENOENT");
      },
      platform: "linux",
    });

    expect(outcome.failed).toBe("relay");
    expect(outcome.failure).toContain("could not run");
    expect(outcome.failure).toContain("spawn cargo ENOENT");
  });

  it("reports a kill as a kill rather than as an exit status", async () => {
    const outcome = await runBuild({
      run: async () => ({ code: null, signal: "SIGKILL" as NodeJS.Signals }),
      platform: "linux",
    });

    expect(outcome.failure).toContain("killed by SIGKILL");
  });

  it("reports a copy that could not be made, rather than carrying on", async () => {
    const outcome = await runBuild({
      run: succeeding(),
      copy: async (from) => {
        throw new Error(`EACCES: permission denied, open '${from}'`);
      },
      platform: "linux",
    });

    expect(outcome.failed).toBe("programs");
    expect(outcome.failure).toContain("could not copy");
    expect(outcome.completed).toEqual(["icons", "relay", "ask", "shell"]);
  });

  it("says only what happened, in the order it happened", async () => {
    // A reader who hit a failure has to be able to trust that the earlier lines
    // are the earlier steps and not a summary written afterwards.
    const outcome = await runBuild({
      run: async (command) =>
        command.args.join(" ").includes("vite")
          ? { code: 1, signal: null }
          : { code: 0, signal: null },
      platform: "linux",
    });

    expect(outcome.failed).toBe("shell");
    expect(outcome.lines).toEqual([
      "build: icons — the icon set the bundle is built from",
      "build: relay — the program the host agent's hooks invoke",
      "build: ask — the program that waits for your answer",
      "build: shell — the window, and the page it loads",
      expect.stringContaining("build: shell failed"),
    ]);
  });
});

describe("an incomplete icon set fails the build, naming the file", () => {
  it("takes the list from the bundle's own declaration rather than from this file", () => {
    // Read from `tauri.conf.json`, not written here. The formats differ per
    // platform and a wrong one does not produce an ugly icon — it produces a
    // build failure, on the machine nobody is watching. A list kept here is a
    // list that drifts from the one the bundler reads.
    const declared = (
      JSON.parse(readFileSync(join(REPO_ROOT, "shell/src-tauri/tauri.conf.json"), "utf8")) as {
        bundle: { icon: string[] };
      }
    ).bundle.icon;

    expect(declared.length).toBeGreaterThan(0);
    expect(declaredBundleIcons()).toEqual(
      declared.map((icon) => join(REPO_ROOT, "shell/src-tauri", icon))
    );
  });

  it("refuses to start, and names the file that is not there", async () => {
    const missing = join(REPO_ROOT, "shell/src-tauri/icons/icon.ico");
    const outcome = await runBuild({
      run: succeeding(),
      exists: (path) => path !== missing,
      platform: "linux",
    });

    // Before anything else, and saying how to put it back: an icon set is
    // committed, so a missing icon is a deleted file and the fix is a
    // regeneration, not a build anybody should re-run to find out why it broke.
    expect(outcome.failed).toBe("icons");
    expect(outcome.completed).toEqual([]);
    expect(outcome.failure).toContain(missing);
    expect(outcome.failure).toContain("make-icons.py");
  });

  it("checks every icon the declaration names, not just the first", async () => {
    // A first-match check passes the moment two files are declared and one is
    // missing, which is the case that matters on a platform with an extra format.
    const icns = join(REPO_ROOT, "shell/src-tauri/icons/icon.icns");
    const outcome = await runBuild({
      run: succeeding(),
      exists: (path) => path !== icns,
      platform: "linux",
    });

    expect(outcome.failed).toBe("icons");
    expect(outcome.failure).toContain(icns);
  });

  it("names the file rather than the set, because a name is what is actionable", async () => {
    const outcome = await runBuild({
      run: succeeding(),
      exists: (path) => !path.endsWith(".ico"),
      platform: "win32",
    });

    expect(outcome.failure).toMatch(/icons[\\/]icon\.ico/);
    expect(outcome.failure).not.toContain("not built");
  });
});

describe("the programs go where an installed companion can find them", () => {
  it("copies both, to the executable's own directory", async () => {
    const beside = programsBeside(shellCommand("linux"));
    const copied: [string, string][] = [];

    const outcome = await runBuild({
      run: succeeding(),
      copy: async (from, to) => {
        copied.push([from, to]);
      },
      platform: "linux",
    });

    expect(outcome.failed).toBe(null);
    expect(copied).toEqual([
      [relayCommand("linux"), beside.relay],
      [askCommand("linux"), beside.ask],
    ]);
  });

  it("copies to a directory the companion owns, not to a place inside a checkout", () => {
    // "Beside the built shell" is a claim about a directory, so it is checkable:
    // each destination is in the companion's own directory, and neither is the
    // path a hook would carry out of a clone — the one that stops being true the
    // first time somebody moves or deletes that clone.
    for (const platform of ["linux", "win32"] as const) {
      const beside = programsBeside(shellCommand(platform), platform);
      const companionDirectory = dirname(shellCommand(platform));

      for (const destination of [beside.relay, beside.ask]) {
        expect(dirname(destination), `${platform}: ${destination}`).toBe(companionDirectory);
      }
      expect(beside.relay, platform).not.toBe(relayCommand(platform));
      expect(beside.ask, platform).not.toBe(askCommand(platform));
    }
  });

  it("says where each program went, so a hook that fails is a one-line question", async () => {
    const beside = programsBeside(shellCommand("linux"));
    const outcome = await runBuild({ run: succeeding(), platform: "linux" });

    expect(outcome.lines).toContain(`build: programs — copied ${beside.relay}`);
    expect(outcome.lines).toContain(`build: programs — copied ${beside.ask}`);
    expect(outcome.lines.at(-1)).toContain("beside spark-shell");
  });

  it("spells out no destination of its own, on either platform", () => {
    // The same property `test/relay-binary-wiring.test.ts` holds the installer to,
    // for the same reason: a path written out here is a second answer about where
    // a binary is, and the second answer is how two scripts come to disagree
    // about what cargo calls a Windows binary. Executed rather than read, so a
    // copy to a hardcoded destination fails here whatever the source looks like.
    for (const platform of ["linux", "win32"] as const) {
      const copies = buildSteps(platform).find((step) => step.name === "programs")?.copies ?? [];

      expect(copies.map(([, to]) => to)).toEqual([
        programsBeside(shellCommand(platform), platform).relay,
        programsBeside(shellCommand(platform), platform).ask,
      ]);
    }
  });
});

describe("every binary path the build asks about is one the owner names", () => {
  it("takes them from `src/relay/binary.ts` and from nowhere else", async () => {
    // A build that resolved its own paths would fail this, and so would one that
    // took them from a caller. The evidence is that the paths it asks about *are*
    // the owner's paths — asked for with the Windows spelling, because that is
    // the only machine this can be checked on and the only one where the answer
    // differs.
    const asked: string[] = [];
    await runBuild({
      run: succeeding(),
      exists: (path) => {
        asked.push(path);
        return true;
      },
      platform: "win32",
    });

    const owned = [
      relayCommand("win32"),
      askCommand("win32"),
      shellCommand("win32"),
      programsBeside(shellCommand("win32"), "win32").relay,
      programsBeside(shellCommand("win32"), "win32").ask,
    ];

    // The icons are asked about too, and they are not the owner's to name: they
    // come from the bundle's own declaration, which is a different question with
    // a different owner. Narrowed to the binaries, because "every path" is
    // precisely the claim that is not true.
    const binaries = asked.filter((path) => !path.includes("icons"));

    expect(binaries.length).toBeGreaterThan(0);
    for (const path of binaries) expect(owned, `${path} is not one the owner names`).toContain(path);
    expect(asked.length).toBeGreaterThan(binaries.length);
  });
});

describe("what an installation spells on each platform", () => {
  const installed = (platform: NodeJS.Platform) =>
    programsBeside(shellCommand(platform), platform);

  it("puts both programs in the companion's directory, with this platform's names", () => {
    for (const platform of ["linux", "win32", "darwin"] as const) {
      const { relay, ask } = installed(platform);
      const suffix = platform === "win32" ? ".exe" : "";

      expect(dirname(relay), platform).toBe(dirname(shellCommand(platform)));
      expect(relay.endsWith(`spark-relay${suffix}`), relay).toBe(true);
      expect(ask.endsWith(`spark-ask${suffix}`), ask).toBe(true);
    }
  });

  it("gives Windows the extension cargo appends, which is the rule got wrong twice", () => {
    // Asserted from Linux, which is the only place it can be asserted at all.
    expect(installed("win32").relay).toContain("spark-relay.exe");
    expect(installed("win32").ask).toContain("spark-ask.exe");
  });

  it("carries no crate's build directory into an installation", () => {
    // The failure this exists for: hooks pointing at a clone's
    // `relay/target/release/spark-relay.exe`, which stops working the moment the
    // clone is moved, deleted, or was never on the user's machine.
    for (const platform of ["linux", "win32"] as const) {
      const { relay, ask } = installed(platform);
      const crateDirectory = platform === "win32" ? "relay\\target" : "relay/target";

      expect(relay, platform).not.toContain(crateDirectory);
      expect(ask, platform).not.toContain(crateDirectory);
    }
  });
});