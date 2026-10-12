import { describe, expect, it } from "vitest";
import { dllNames, isWindowsSystemDll } from "./support/imports";

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

describe("what counts as a Windows system library", () => {
  it("accepts what the C runtime and the kernel need", () => {
    for (const name of [
      "KERNEL32.dll",
      "ntdll.dll",
      "ucrtbase.dll",
      "vcruntime140.dll",
      "msvcrt.dll",
      "ADVAPI32.dll",
      "ws2_32.dll",
    ]) {
      expect(isWindowsSystemDll(name), name).toBe(true);
    }
  });

  it("accepts the API sets, which are Windows' own indirection layer", () => {
    expect(isWindowsSystemDll("api-ms-win-core-synch-l1-2-0.dll")).toBe(true);
  });

  it("refuses a language runtime", () => {
    // The exact thing this assertion exists to catch: a relay that cannot start
    // because an interpreter is missing.
    for (const name of ["node.dll", "python311.dll", "mscoree.dll", "libc++abi.dll"]) {
      expect(isWindowsSystemDll(name), name).toBe(false);
    }
  });

  it("refuses a third-party library that a build might have vendored", () => {
    expect(isWindowsSystemDll("openssl-3-x64.dll")).toBe(false);
    expect(isWindowsSystemDll("sqlite3.dll")).toBe(false);
  });

  it("is not fooled by a system name with something appended", () => {
    expect(isWindowsSystemDll("kernel32.dll.evil")).toBe(false);
  });
});