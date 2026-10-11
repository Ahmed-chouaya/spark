import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../src/relay/diff";

describe("the proposal shown before anything is written", () => {
  it("says nothing when nothing would change", () => {
    const same = '{\n  "hooks": {}\n}\n';

    expect(unifiedDiff(same, same)).toBe("");
  });

  it("names the lines that would be added and removed", () => {
    const before = '{\n  "theme": "dark"\n}\n';
    const after = '{\n  "theme": "light"\n}\n';

    expect(unifiedDiff(before, after, "settings.json")).toBe(
      [
        "--- settings.json",
        "+++ settings.json",
        "@@ -1,3 +1,3 @@",
        '-  "theme": "dark"',
        '+  "theme": "light"',
        "",
      ].join("\n")
    );
  });

  it("shows an insertion as an insertion, not as a rewrite of everything", () => {
    const before = '{\n  "a": 1\n}\n';
    const after = '{\n  "a": 1,\n  "b": 2\n}\n';

    const diff = unifiedDiff(before, after);

    expect(diff).toContain('+  "b": 2');
    // The surrounding lines are common, so they are not reported as removed and
    // re-added — which is what a naive line-by-line comparison would produce,
    // and what would make a one-line change unreadable.
    expect(diff).not.toContain('-"a": 1');
    expect(diff.match(/^-/gm)).toHaveLength(2); // the header, and nothing else
  });

  it("treats a file that did not exist as wholly added", () => {
    const diff = unifiedDiff("", '{\n  "hooks": {}\n}\n');

    expect(diff).toContain('+{');
    expect(diff).toContain('+  "hooks": {}');
  });

  it("does not report a trailing newline as a change when there is none", () => {
    // Splitting on newlines must not turn a final newline into a line of its
    // own, or every file would show a spurious change on its last line.
    expect(unifiedDiff("a\nb\n", "a\nb\n")).toBe("");
    expect(unifiedDiff("a\nb", "a\nb")).toBe("");
  });

  it("reports a missing final newline, because the file really did change", () => {
    // This module rewrites a file it did not write, and a hand-edited settings
    // file may end without a newline. Writing one and showing nothing would be
    // the diff lying about the only change that was made.
    const diff = unifiedDiff("a\nb\n", "a\nb");

    expect(diff).not.toBe("");
    expect(diff).toContain("No newline at end of file");
  });
});