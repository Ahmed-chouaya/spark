import { describe, expect, it } from "vitest";
import { dllNames, foreignImports, isApiSet } from "./support/imports";

/**
 * The DLL scanner, tested without a PE binary anywhere in sight.
 *
 * This code runs on Windows and nowhere else, so testing it on Windows would mean
 * it is tested only on the machine where a failure is hardest to reproduce. Every
 * branch here is a pure function of bytes, so it is checked against synthetic
 * buffers on whatever platform the suite runs on — which is the only way this
 * stays verifiable from Linux at all.
 */

/** Bytes with NUL padding between strings, as a PE import table is laid out. */
const pe = (...strings: string[]): Uint8Array =>
  Uint8Array.from(Buffer.concat(strings.map((s) => Buffer.from(`${s}\0`, "latin1"))));

describe("reading imported libraries out of a PE", () => {
  it("finds a null-terminated name", () => {
    expect(dllNames(pe("KERNEL32.dll"))).toEqual(["KERNEL32.dll"]);
  });

  it("finds every name in a table", () => {
    expect(dllNames(pe("KERNEL32.dll", "advapi32.dll", "ntdll.dll"))).toEqual([
      "KERNEL32.dll",
      "advapi32.dll",
      "ntdll.dll",
    ]);
  });

  it("is case-insensitive about the suffix, because PE is", () => {
    expect(dllNames(pe("WS2_32.DLL"))).toEqual(["WS2_32.DLL"]);
  });

  it("deduplicates, so one library imported twice is one entry", () => {
    expect(dllNames(pe("user32.dll", "USER32.dll"))).toEqual(["USER32.dll", "user32.dll"]);
  });

  it("ignores strings that are not library names", () => {
    // The binary is full of other ASCII: panic messages, symbol names, this
    // project's own prose. Only a run that *is* a DLL name counts.
    const bytes = pe(
      "the relay translates nothing",
      "src/relay/channel.ts",
      "cannot derive the companion's address",
      "KERNEL32.dll"
    );
    expect(dllNames(bytes)).toEqual(["KERNEL32.dll"]);
  });

  it("ignores a fragment of a longer string", () => {
    // `foo.dll.txt` is not a library, and a substring search would find it.
    expect(dllNames(pe("notreal.dll.txt"))).toEqual([]);
  });

  it("finds nothing in an ELF, which is why the platforms answer differently", () => {
    // The real relay binary on Linux. If this ever started reporting DLLs, the
    // scanner had started matching arbitrary bytes.
    const elfLike = Buffer.from([
      0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(dllNames(Uint8Array.from(elfLike))).toEqual([]);
  });

  it("survives arbitrary bytes without throwing", () => {
    const noise = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37) % 256);
    expect(() => dllNames(noise)).not.toThrow();
  });

  it("returns an empty list for an empty binary", () => {
    expect(dllNames(new Uint8Array())).toEqual([]);
  });
});

describe("telling a Windows system library from one that had to be installed", () => {
  // A synthetic System32. The real list is a few thousand entries and is the
  // machine's, not ours, so these stand in for it — the question being asked is
  // "is this name one Windows already had", not "is this name on our list".
  const system = new Set(
    ["kernel32.dll", "ntdll.dll", "ucrtbase.dll", "vcruntime140.dll", "dbghelp.dll"].map((n) =>
      n.toLowerCase()
    )
  );

  it("accepts a library the installation already has", () => {
    expect(foreignImports(["KERNEL32.dll", "ntdll.dll", "vcruntime140.dll"], system)).toEqual([]);
  });

  it("accepts the case the import table and the directory disagree on", () => {
    // The table said VCRUNTIME140.dll and the directory says vcruntime140.dll.
    // On Windows they are the same file, and treating them as different would
    // fail every Rust build on the platform.
    expect(foreignImports(["VCRUNTIME140.dll"], system)).toEqual([]);
  });

  it("accepts an API set, which resolves to a file rather than being one", () => {
    expect(isApiSet("api-ms-win-crt-runtime-l1-1-0.dll")).toBe(true);
    expect(foreignImports(["api-ms-win-core-synch-l1-2-0.dll"], system)).toEqual([]);
  });

  it("refuses a language runtime, which is the whole point", () => {
    // A relay that cannot start because an interpreter is missing is the
    // failure this exists to catch.
    expect(foreignImports(["node.dll", "python311.dll", "mscoree.dll"], system)).toEqual([
      "mscoree.dll",
      "node.dll",
      "python311.dll",
    ]);
  });

  it("refuses a library a build vendored", () => {
    expect(foreignImports(["openssl-3-x64.dll"], system)).toEqual(["openssl-3-x64.dll"]);
  });

  it("refuses everything when the system directory cannot be read", () => {
    // Fail closed. An unreadable System32 is not evidence that the imports are
    // fine; it is the absence of evidence, and the safe reading of "we could not
    // check" is "this is not proven".
    expect(foreignImports(["kernel32.dll"], new Set())).toEqual(["kernel32.dll"]);
  });

  it("accepts a library Windows gained since the test was written", () => {
    // The property a list cannot express: a DLL that did not exist when this
    // test was written, arriving with a Windows update, is still not something
    // the user had to install.
    const later = new Set([...system, "brandnew.dll"]);
    expect(foreignImports(["brandnew.dll"], later)).toEqual([]);
  });
});