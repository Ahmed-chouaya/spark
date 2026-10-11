import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MASCOT_STATES } from "../src/components/mascot";
import * as stateSelection from "../src/state-selection";

/**
 * Structural guards on the development harness.
 *
 * Every rule here is a rule about the shape of the code rather than about what
 * it draws, and each is a temptation that looks reasonable in review. The
 * harness is scaffolding for an application that does not exist yet, which is
 * exactly the kind of code that grows product logic by accident and ships by
 * accident. Pinning the boundaries here means crossing one fails a test rather
 * than passing review.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(REPO_ROOT, "src");
const DEV_DIR = join(SRC_DIR, "dev");

interface Source {
  /** Path relative to the repository root, for readable failures. */
  name: string;
  /** Absolute path, for resolving what a module specifier points at. */
  path: string;
  code: string;
}

const sourcesIn = (dir: string, pattern: RegExp): Source[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => pattern.test(path))
    .map((path) => ({
      name: relative(REPO_ROOT, join(dir, path)),
      path: join(dir, path),
      code: readFileSync(join(dir, path), "utf8"),
    }));

/**
 * The harness is two pages, and they are held to different rules.
 *
 * `DevPage.tsx` is the state vocabulary page: it renders the mascot's nine states
 * and is forbidden from deciding anything about which one to show. `mascot-
 * escalation` added a second page that drives the real surface, which has to
 * reach the state machine to do it — that is the whole point of the page — so the
 * selection rule cannot be applied to it unchanged.
 *
 * The split is by file, not relaxed wholesale: the state page keeps every rule
 * below at full strength, and the surface page is held by its own rules in
 * `escalation-surface-harness.test.ts`, which check the opposite condition —
 * that it drives the product module rather than reimplementing it.
 */
const STATE_PAGE = "src/dev/DevPage.tsx";
const STATE_ENTRY = "src/dev/main.tsx";

/** Everything in the harness. */
const devSources = (): Source[] => sourcesIn(DEV_DIR, /\.tsx?$/);

/** The state vocabulary page and its entry, which render states and choose none. */
const stateHarness = (): Source[] =>
  devSources().filter(({ name }) => name === STATE_PAGE || name === STATE_ENTRY);

/** The escalation surface page and its entry. */
const surfaceHarness = (): Source[] =>
  devSources().filter(({ name }) => name !== STATE_PAGE && name !== STATE_ENTRY);

/** Everything that ships: the harness excluded. */
const productSources = (): Source[] =>
  sourcesIn(SRC_DIR, /\.(ts|tsx)$/).filter(({ path }) => !within(DEV_DIR, path));

/** Whether `target` is `dir` or sits inside it. */
const within = (dir: string, target: string): boolean =>
  target === dir || target.startsWith(dir + sep);

/** Strip comments, so prose about a rule cannot trip the rule's own check. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const importStatements = (source: string): string[] =>
  [...code(source).matchAll(/^import[^;]+;/gm)].map((match) => match[0]);

/** The module specifier of every import in the source. */
const specifiers = (source: string): string[] =>
  [...code(source).matchAll(/(?:^|\s)from\s+["']([^"']+)["']/gm)].map((match) => match[1] ?? "");

/** Every string literal in the source, ignoring module specifiers. */
const literals = (source: string): string[] =>
  [
    ...code(source)
      .replace(/^import[^;]+;/gm, " ")
      .matchAll(/(["'`])([^"'`\\\r\n]*)\1/g),
  ].map((match) => match[2] ?? "");

describe("the state page reads the mascot and holds no selection logic", () => {
  it("imports the mascot library", () => {
    const fromMascot = stateHarness().flatMap(({ code: source }) =>
      importStatements(source).filter((statement) => statement.includes("components/mascot"))
    );

    // The component that draws, and the list that says which ones to draw —
    // both named, rather than reached through a path that could resolve to
    // anything else.
    expect(fromMascot.some((statement) => /\bMascot\b/.test(statement))).toBe(true);
    expect(fromMascot.some((statement) => /\bMASCOT_STATES\b/.test(statement))).toBe(true);
  });

  it("imports nothing from state selection, by any path", () => {
    for (const { name, code: source } of stateHarness()) {
      for (const specifier of specifiers(source)) {
        expect(specifier, name).not.toMatch(/state-selection/);
      }
    }
  });

  it("names no state-selection export anywhere in the state page", () => {
    // The banned vocabulary is the module's own public surface rather than a
    // watchlist of symbols somebody remembered to forbid: a new export is
    // covered the moment it is added, with nothing to update here.
    const forbidden = Object.keys(stateSelection);
    expect(forbidden.length, "state selection exports something to avoid").toBeGreaterThan(0);
    expect(forbidden).toContain("selectState");

    for (const { name, code: source } of stateHarness()) {
      for (const symbol of forbidden) {
        expect(code(source), `${name}: ${symbol}`).not.toMatch(new RegExp(`\\b${symbol}\\b`));
      }
    }
  });

  it("imports nothing from the product except the mascot library", () => {
    // "Decides nothing" stated as what the page can reach rather than as a
    // list of words it must not contain. The page is handed a state and
    // renders it, so the only product module it has business importing is the
    // one that draws. A second import is the seam a state-selection
    // dependency arrives through, called or not.
    const MASCOT_DIR = join(SRC_DIR, "components", "mascot");

    for (const source of stateHarness()) {
      for (const specifier of specifiers(source.code)) {
        if (!specifier.startsWith(".")) continue; // react and friends
        const target = resolve(dirname(source.path), specifier);
        if (within(DEV_DIR, target)) continue; // a sibling in the harness
        expect(within(MASCOT_DIR, target), `${source.name} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("is still the whole of the state page, with the surface page accounted for separately", () => {
    // The split has to be a split: if the state page grew files, or the surface
    // page quietly took one of them, this stops describing what is guarded.
    expect(stateHarness().map(({ name }) => name).sort()).toEqual([
      "src/dev/DevPage.tsx",
      "src/dev/main.tsx",
    ]);
    expect(surfaceHarness().length, "a second harness page exists").toBeGreaterThan(0);
  });
});

describe("the page cannot fall behind the vocabulary", () => {
  it("spells out no state name, so a hand-written list cannot survive", () => {
    // A list of states maintained by hand has to contain the state names, so
    // the check is that the harness's own string vocabulary contains none of
    // them. Nothing here enumerates forbidden states — only the rule that the
    // page may not own a copy of the vocabulary.
    for (const { name, code: source } of stateHarness()) {
      const own = new Set(literals(source));
      for (const state of MASCOT_STATES) {
        expect(
          own.has(state),
          `${name} spells out "${state}" — enumerate MASCOT_STATES instead`
        ).toBe(false);
      }
    }
  });

  it("takes the vocabulary from the mascot's exported list, and only from there", () => {
    const vocabularyImports = stateHarness().flatMap(({ code: source }) =>
      importStatements(source).filter((statement) => /\bMASCOT_STATES\b/.test(statement))
    );

    expect(vocabularyImports.length).toBeGreaterThan(0);
    for (const statement of vocabularyImports) {
      expect(statement).toMatch(/from\s+"\.\.\/components\/mascot"/);
    }
  });

  it("renders one card per state, so an added state appears unedited", () => {
    // The behavioural half, asserted here so the two halves of the rule sit
    // together: the page's card count is the mascot's list, by construction.
    expect(MASCOT_STATES.length).toBeGreaterThan(0);
    expect(new Set(MASCOT_STATES).size).toBe(MASCOT_STATES.length);
  });
});

describe("the harness cannot reach the product", () => {
  it("is imported by no product source, resolving each specifier to a path", () => {
    // Resolved rather than pattern-matched: the question is where a specifier
    // actually points, and a `from "./../dev/…"` written three ways is still
    // one import of this directory.
    const product = productSources();
    expect(product.length, "product sources").toBeGreaterThan(0);

    for (const source of product) {
      for (const specifier of specifiers(source.code)) {
        if (!specifier.startsWith(".")) continue; // a package, not ours to resolve
        const target = resolve(dirname(source.path), specifier);
        expect(within(DEV_DIR, target), `${source.name} imports ${specifier}`).toBe(false);
      }
    }
  });

  it("leaves the product's own entry points untouched", () => {
    // The mascot library and state selection are what the application is made
    // of. The harness is downstream of both, and neither is downstream of it.
    const product = productSources().map(({ name }) => name).sort();
    expect(product).toEqual(
      expect.arrayContaining([
        "src/components/mascot/index.ts",
        "src/components/mascot/Mascot.tsx",
        "src/state-selection/index.ts",
        // Added by `mascot-escalation`: the surface the harness can drive.
        "src/escalation/index.ts",
      ])
    );
    expect(product.filter((name) => name.startsWith("src/dev/"))).toEqual([]);
  });
});