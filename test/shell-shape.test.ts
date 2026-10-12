import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { MASCOT_STATES } from "../src/components/mascot";
import * as stateSelection from "../src/state-selection";
import { posixPath } from "./support/paths";

/**
 * Keeping the shell a shell.
 *
 * ## Why this reads source rather than behaviour
 *
 * The property is a property of the program's *shape*. A Rust side that parsed a
 * payload and emitted a canonical event would still deliver a working session to
 * a document that understood both shapes, so every functional test here would
 * pass and the second implementation of a host's vocabulary would be invisible
 * until the two disagreed about an event neither had been written for yet.
 *
 * That is the same argument `test/relay-shape.test.ts` makes for the relay, for
 * the same reason, and the same one `test/selection-source.test.ts` makes for the
 * reduction. Where behaviour *can* be checked it is — the capability report, the
 * placement arithmetic and the runtime's decisions all have real tests. This file
 * is for the claims those tests cannot make.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const RUST_DIR = join(REPO_ROOT, "shell/src-tauri/src");
const SHELL_SRC = join(REPO_ROOT, "shell");

/** Every `.rs` file that makes up the shell. */
const rustSources = (): { name: string; code: string }[] =>
  readdirSync(RUST_DIR, { encoding: "utf8" })
    .filter((name) => name.endsWith(".rs"))
    .map((name) => ({ name, code: readFileSync(join(RUST_DIR, name), "utf8") }));

/** Source with comments removed, so prose about a rule is not a violation of it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const rust = (name: string): string => code(rustSources().find((f) => f.name === name)!.code);

/** Every TypeScript source under a directory. */
const sourcesIn = (dir: string): { name: string; path: string; code: string }[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => ({
      name: posixPath(relative(REPO_ROOT, join(dir, path))),
      path: join(dir, path),
      code: readFileSync(join(dir, path), "utf8"),
    }));

/** The module specifier of every import in the source. */
const specifiers = (source: string): string[] =>
  [...code(source).matchAll(/(?:^|\s)from\s+["']([^"']+)["']/gm)].map((m) => m[1] ?? "");

const within = (dir: string, target: string): boolean => target === dir || target.startsWith(dir + sep);

/** The host agent's vocabulary, as identifiers or as string literals. */
const HOST_VOCABULARY = [
  "hook_event_name",
  "session_id",
  "notification_type",
  "tool_use_id",
  "tool_input",
  "tool_response",
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "permission_prompt",
  "elicitation_dialog",
  "idle_prompt",
];

/** The canonical vocabulary it would be translated into. */
const CANONICAL_VOCABULARY = [
  "session-started",
  "prompt-submitted",
  "tool-activity",
  "authorization-requested",
  "agent-question",
  "time-passed",
  "failed",
  "completed",
];

/** The fields a session is made of, which the shell has no business reading. */
const SESSION_FIELDS = ["block", "ambient", "enteredAt", "lastEventAt", "lastActiveAt", "sessionId"];

describe("the Rust side interprets nothing", () => {
  it("names no event of the host's own, as an identifier or a literal", () => {
    for (const { name, code: source } of rustSources()) {
      const body = code(source);
      for (const term of HOST_VOCABULARY) {
        expect(body, `${name} names the host's "${term}"`).not.toContain(term);
      }
    }
  });

  it("names no canonical event either, so there is no mapping to do", () => {
    // Either direction of the vocabulary is evidence of interpretation. A shell
    // that merely re-labelled `SessionStart` as `session-started` would be
    // translating, which is the thing being ruled out.
    for (const { name, code: source } of rustSources()) {
      const body = code(source);
      for (const term of CANONICAL_VOCABULARY) {
        expect(body, `${name} names the canonical "${term}"`).not.toContain(term);
      }
    }
  });

  it("names no mascot state and no session field", () => {
    // Enumerated from the mascot's own vocabulary rather than written out here, so
    // a tenth state is covered the moment it exists and a stale copy of the list
    // cannot quietly shrink the check.
    for (const { name, code: source } of rustSources()) {
      const body = code(source);
      for (const state of MASCOT_STATES) {
        expect(body, `${name} names the state "${state}"`).not.toMatch(new RegExp(`\\b${state}\\b`));
      }
      for (const field of SESSION_FIELDS) {
        expect(body, `${name} names the session field "${field}"`).not.toMatch(
          new RegExp(`\\b${field}\\b`)
        );
      }
    }
  });

  it("reaches for no reduction of its own", () => {
    // The Rust side derives no state. A `match` over anything that looks like a
    // status is the shape that would take, so the reduction's own vocabulary is
    // forbidden rather than only its functions.
    const exports = Object.keys(stateSelection);
    expect(exports).toContain("selectState");

    for (const { name, code: source } of rustSources()) {
      for (const symbol of exports) {
        expect(code(source), `${name}: ${symbol}`).not.toMatch(new RegExp(`\\b${symbol}\\b`));
      }
    }
  });

  it("carries the payload as opaque bytes", () => {
    const body = rust("channel.rs");

    // No decoding, no deserialisation, no field access: the payload is `Vec<u8>`
    // from the socket to the webview and nothing in between knows what is in it.
    // `read_to_end` is the read; `from_utf8` and `from_slice` would be a
    // translation wearing a transport's clothes.
    expect(body).toMatch(/read_to_end\(&mut payload\)/);
    expect(body).not.toMatch(/from_utf8|String::from|serde_json|from_slice|lines\(\)|split\(/);
  });

  it("emits the payload it read, as the same value", () => {
    const body = rust("main.rs");

    expect(body).toMatch(/window\.emit\(PAYLOAD, payload\)/);
    // One event, and it is this program's own. A second event would be a second
    // channel, and a channel is something the host would need to know about.
    expect([...body.matchAll(/\.emit\(/g)]).toHaveLength(1);
  });

  it("states the claim in the source, for the next person who edits it", () => {
    // Not a claim in a changelog nobody opens before touching a file: the
    // reasoning is at the top of the file, where an editor meets it.
    const main = readFileSync(join(RUST_DIR, "main.rs"), "utf8");

    expect(main).toMatch(/parses no payload, names no event of a host's own, and derives no state/i);
    expect(main).toMatch(/the restraint is not modesty/i);
    expect(main).toMatch(/single implementation of[\s\S]*vocabulary/i);
  });
});

describe("the shell consumes the existing modules and changes none of them", () => {
  /**
   * The modules this change consumes and is forbidden to change.
   *
   * `src/escalation` is deliberately absent from this list and is checked
   * separately below. It is the one module that legitimately mentions the shell:
   * it declares `HOST_WINDOW_KEY`, the seam the host fills, and it did so before
   * this change existed. Forbidding the key there would be forbidding the seam.
   */
  const CONSUMED = [
    join(REPO_ROOT, "src/state-selection"),
    join(REPO_ROOT, "src/components/mascot"),
    join(REPO_ROOT, "src/relay"),
  ];

  /** Everything the shell reaches, including the surface it mounts. */
  const REACHED = [...CONSUMED, join(REPO_ROOT, "src/escalation")];

  it("reaches the surface and the fold through the modules that already own them", () => {
    // The one-way dependency is the whole of what makes this a shell. Stated as
    // what it reaches rather than as what it must not, because a guard that only
    // forbids names fails on a refactor and passes on a second implementation.
    const shell = sourcesIn(SHELL_SRC);
    const runtime = shell.find(({ name }) => name === "shell/src/companion.tsx")!;
    const reached = specifiers(runtime.code).filter((specifier) => specifier.startsWith("."));

    expect(
      reached.some((specifier) => specifier.includes("state-selection")),
      "the fold is reached through the adapter"
    ).toBe(true);
    expect(
      reached.some((specifier) => specifier.includes("escalation")),
      "the surface is reached through its module"
    ).toBe(true);
  });

  it("adds no code path to the modules it consumes", () => {
    // Not "these files are unchanged" — a guard that diffed them would have to be
    // updated every time this change legitimately grew, and would then be a
    // changelog. The claim is about direction: nothing upstream can reach the
    // shell, so the shell cannot have given any of them a requirement.
    for (const dir of REACHED) {
      for (const source of sourcesIn(dir)) {
        for (const specifier of specifiers(source.code)) {
          if (!specifier.startsWith(".")) continue;
          const target = resolve(dirname(source.path), specifier);
          expect(within(SHELL_SRC, target), `${source.name} imports ${specifier}`).toBe(false);
        }
      }
    }
  });

  it("names the shell nowhere in them, in prose or in a string", () => {
    for (const dir of CONSUMED) {
      for (const source of sourcesIn(dir)) {
        expect(code(source.code), source.name).not.toMatch(/__SPARK_HOST_WINDOW__|spark-shell|shell\/src/);
      }
    }
  });

  it("keeps the development harness out of the product", () => {
    // The shell ships a harness too, and it lives beside it rather than in
    // `src/dev` so that the isolation those harnesses are held to is unchanged.
    // The direction matters: a product importing a harness is how product logic
    // grows in scaffolding and ships by accident.
    for (const source of sourcesIn(SHELL_SRC)) {
      if (source.name === "shell/harness/main.tsx") continue;

      for (const specifier of specifiers(source.code)) {
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(source.path), specifier);
        expect(within(join(SHELL_SRC, "harness"), target), `${source.name} imports ${specifier}`).toBe(
          false
        );
      }
    }
  });
});

describe("`npm run companion` is the app", () => {
  const launcher = readFileSync(join(REPO_ROOT, "scripts/spark-companion.ts"), "utf8");
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  it("runs the launcher", () => {
    expect(scripts.scripts.companion).toBe("vite-node scripts/spark-companion.ts");
  });

  it("prints no reduction, because the reduction is on the window now", () => {
    // The old companion wrote a line per state change. That line was the whole of
    // what the product had to show, and a launcher that still writes one is a
    // printer with a window behind it.
    expect(code(launcher)).not.toMatch(/selectState|\bescalates\b|applyReceivedPayload/);
    expect(code(launcher)).not.toMatch(/blocked:/);
  });

  it("starts the window rather than describing what it would do", () => {
    expect(code(launcher), "it runs the crate that opens the window").toMatch(/cargo/);
    expect(code(launcher), "and builds what that window loads").toMatch(/vite", "build/);
  });

  it("mounts the reduction it used to print", () => {
    // The other half of "rather than a printer": whatever the line used to say is
    // now drawn, by the same reduction, on the surface.
    const runtime = code(readFileSync(join(SHELL_SRC, "src/companion.tsx"), "utf8"));

    expect(runtime).toMatch(/\buseCompanionSurface\b/);
    expect(runtime).toMatch(/applyReceivedPayload/);
    expect(runtime).toMatch(/latest\.surface|<>\{.*surface\.*\}?<\/>/);
  });

  it("hands the shell an address derived by the one rule that owns it", () => {
    // Not a second derivation: `src/relay/address.ts` answers, `test/relay-address
    // .test.ts` compares that answer with the relay's Rust one, and the shell is
    // told. A third implementation in a third language would be a third answer
    // that nothing compares.
    expect(code(launcher)).toMatch(/currentCompanionAddress/);
    expect(code(launcher)).toContain("SPARK_CHANNEL_ADDRESS");
  });

  it("installs no hooks, because that is a separate command that asks first", () => {
    // Starting the app is not consent to reconfigure the user's agent.
    // `~/.claude/settings.json` is the file that decides whether their agent runs,
    // and a launcher that wrote it as a side effect of being launched would be
    // taking that decision on their behalf.
    expect(code(launcher)).not.toMatch(/relay-install|relay\/install|planHooks|installHooks|settings\.json/);

    for (const source of sourcesIn(SHELL_SRC)) {
      expect(code(source.code), source.name).not.toMatch(/relay-install|relay\/install|planHooks|installHooks/);
    }
  });

  it("leaves the install command as the only way hooks are written", () => {
    const installer = code(readFileSync(join(REPO_ROOT, "scripts/relay-install.ts"), "utf8"));

    expect(scripts.scripts["relay:install"]).toContain("relay-install.ts");
    expect(installer).toMatch(/installHooks/);
  });
});
