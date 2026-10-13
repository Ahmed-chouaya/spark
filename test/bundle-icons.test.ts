import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The icon set the bundle is built from.
 *
 * ## Why these are checks and not good taste
 *
 * A shipped product has a mark, and it has one per platform because the formats
 * differ and the difference is not cosmetic. Windows compiles a resource file
 * into the executable and that step requires a real `.ico`; Linux and macOS want
 * a PNG and an ICNS. Getting it wrong produces a **build failure**, not an ugly
 * icon — which is exactly what happened to this repository's own spike, which
 * built and ran on Linux for days and then failed on the first machine it was
 * meant for.
 *
 * So the files are committed rather than made during an install (an icon that is
 * generated while something is going wrong is missing on the machine where you
 * need it), and this file holds the repository to having them, to having the
 * right ones, and to being able to regenerate exactly those.
 */

/** Where the shell's crate keeps its icon set. */
const ICONS = join(import.meta.dirname, "..", "shell/src-tauri/icons");

/** Where the shell's own configuration lives. */
const TAURI = join(import.meta.dirname, "..", "shell/src-tauri");

/** The bundle's own declaration, which is what decides what has to exist. */
const declared = (
  JSON.parse(readFileSync(join(TAURI, "tauri.conf.json"), "utf8")) as {
    bundle: { icon: string[] };
  }
).bundle.icon;

const bytes = (name: string): Buffer => readFileSync(join(ICONS, name));

/**
 * Run git and answer, rather than shelling out and parsing a status code.
 *
 * `allowFailure` for the commands whose *non-zero exit is the answer*:
 * `check-ignore` exits 1 when nothing it was asked about is ignored, which is
 * the result this file wants, and letting that become an exception would turn the
 * healthy case into a red test.
 */
const git = (args: string[], allowFailure = false): string => {
  try {
    return execFileSync("git", ["-C", join(import.meta.dirname, ".."), ...args], {
      encoding: "utf8",
    });
  } catch (error) {
    if (!allowFailure) throw error;
    return (error as { stdout?: string }).stdout ?? "";
  }
};

/** The width and height out of a PNG's `IHDR`. */
const pngSize = (name: string): { width: number; height: number } => {
  const data = bytes(name);
  expect(data.subarray(0, 8), `${name} is a PNG`).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};

describe("every icon the bundle declares is there", () => {
  it("declares a format each platform can actually use", () => {
    // Not a wish list. `tauri-build` on Windows fails without the `.ico`, and
    // this project's spike discovered that by building successfully for days on
    // the one platform that does not care.
    const names = declared.map((path) => path.replace(/^.*[\\/]/, ""));

    expect(names.some((name) => name.endsWith(".png"))).toBe(true);
    expect(names.some((name) => name.endsWith(".ico"))).toBe(true);
    expect(names.some((name) => name.endsWith(".icns"))).toBe(true);
  });

  it("has every one of them on disk, and each PNG is the size its name claims", () => {
    // The dimension rather than the byte count. A 32-pixel icon of flat colour
    // compresses to about eighty bytes and a 1024-pixel one to about twenty
    // thousand, so "is this file big enough" is a proxy that gets the answer
    // backwards on exactly the files that matter least. Reading `IHDR` is the
    // property; the file size is only ever evidence of something else.
    for (const declaredPath of declared) {
      const path = join(ICONS, "..", declaredPath);
      expect(existsSync(path), `${declaredPath} is declared by the bundle and is not there`).toBe(true);

      const name = declaredPath.replace(/^.*[\\/]/, "");
      if (!name.endsWith(".png")) continue;

      // `128x128@2x.png` is Tauri's name for the 256-pixel one — a high-DPI
      // variant of the same icon, which is why the size is taken from the pixels
      // before the `@` rather than parsed out of the whole name.
      const [logical, scale] = name.replace(/\.png$/, "").split("@");
      const size = Number.parseInt(logical!, 10) * (scale?.startsWith("2x") ? 2 : 1);

      expect(pngSize(name), name).toEqual({ width: size, height: size });
    }
  });

  it("carries a real mark rather than the spike's placeholder", () => {
    // The spike's `icon.png` was a single transparent pixel. Checked by reading
    // the header rather than by size, because size is a proxy and this is the
    // file a user looks at four hundred times a week.
    expect(pngSize("icon.png")).toEqual({ width: 1024, height: 1024 });
    expect(pngSize("128x128.png")).toEqual({ width: 128, height: 128 });
    expect(pngSize("32x32.png")).toEqual({ width: 32, height: 32 });
  });

  it("gives Windows an icon with the sizes Windows asks a shell for", () => {
    // `ICONDIR`, one entry, six images. Each entry's `dwWidth` is 0 for 256,
    // which is a byte in a format rather than a mistake.
    const data = bytes("icon.ico");
    expect(data.readUInt16LE(0)).toBe(0); // reserved
    expect(data.readUInt16LE(2)).toBe(1); // 1 = icon
    const count = data.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(3);

    const sizes = Array.from({ length: count }, (_, entry) => {
      const at = 6 + entry * 16;
      // ICONDIRENTRY: width(1) height(1) colours(1) reserved(1) planes(2)
      // bitCount(2) bytesInRes(4) imageOffset(4). The two one-byte fields first,
      // which is why the bit count is at +6 and not at +4.
      expect(data.readUInt16LE(at + 6), `entry ${entry} is 32-bit`).toBe(32);
      expect(data.readUInt32LE(at + 8) + data.readUInt32LE(at + 12), `entry ${entry} is inside the file`)
        .toBeLessThanOrEqual(data.length);
      return data[at] === 0 ? 256 : data[at];
    });

    // 16 and 32 for a taskbar, 256 for an Explorer view. The spike shipped 32
    // only and Windows rendered it at every size from that one bitmap.
    expect(sizes).toContain(16);
    expect(sizes).toContain(32);
    expect(sizes).toContain(256);
  });

  it("gives macOS a file it can read, and says so was never opened on one", () => {
    // The shape is checkable here. Whether it is *right* is not: no Mac was
    // available, so this asserts the file's structure and nothing about how a Mac
    // renders it.
    const data = bytes("icon.icns");
    expect(data.subarray(0, 4).toString("latin1")).toBe("icns");
    expect(data.readUInt32BE(4), "the declared length is the file's length").toBe(data.length);

    const kinds: string[] = [];
    for (let at = 8; at < data.length; ) {
      const size = data.readUInt32BE(at + 4);
      kinds.push(data.subarray(at, at + 4).toString("latin1"));
      expect(data.subarray(at + 8, at + 16), `${kinds.at(-1)} is PNG-compressed`).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      at += size;
    }
    expect(kinds).toEqual(["ic07", "ic08", "ic09", "ic10"]);
  });
});

describe("the icon set is committed, not made on the way past", () => {
  it("is in git rather than in the build directory", () => {
    // An icon produced during an install is an icon that is missing on the
    // machine where something has gone wrong, which is the worst machine to
    // discover it on. So: committed, and the build checks for them rather than
    // making them.
    const tracked = git(["ls-files", "shell/src-tauri/icons"]).split("\n").filter(Boolean);

    expect(tracked).toContain("shell/src-tauri/icons/make-icons.py");
    for (const declaredPath of declared) {
      expect(tracked, `${declaredPath} is not committed`).toContain(`shell/src-tauri/${declaredPath}`);
    }
  });

  it("is not ignored by a pattern somebody added to tidy up a build", () => {
    // `.gitignore` carries four `target/` lines and nobody has read them since.
    // A new one under `icons/` would be silent: the file would simply stop being
    // part of the repository, and the build would still pass on this machine.
    const ignored = git(
      [
        "check-ignore",
        ...declared.map((path) => `shell/src-tauri/${path}`),
        "shell/src-tauri/icons/make-icons.py",
      ],
      true
    );

    expect(ignored.trim()).toBe("");
  });
});

describe("the generator is committed, and writing the same bytes twice", () => {
  const source = readFileSync(join(ICONS, "make-icons.py"), "utf8");

  it("has no source of entropy in it", () => {
    // The property that makes "re-running this reproduces the committed files" a
    // claim somebody can check rather than one they have to take on trust. A
    // clock, a random seed or an environment-dependent branch would each make
    // the committed bytes depend on when and where they were generated, and the
    // set would then be a different file on every machine that ran the script.
    for (const source_ of ["import random", "import time", "import datetime", "os.environ", "uuid"] as const) {
      expect(source, `the generator uses ${source_}`).not.toContain(source_);
    }
  });

  it("writes every file the bundle declares", () => {
    // Otherwise the determinism above is the determinism of a set that is
    // missing something, and the build's icon check would be the only thing
    // noticing — on the machine that deleted it, not here.
    for (const declaredPath of declared) {
      const name = declaredPath.replace(/^.*[\\/]/, "");
      expect(source, `nothing writes ${name}`).toContain(`"${name}"`);
    }
  });

  it("writes the Windows and macOS formats by hand rather than asking for them", () => {
    // A 32-bit BMP-in-ICO and a PNG-chunked ICNS are not things to author by
    // hand — except that authoring them in a committed script *is* exactly what
    // makes them reproducible on a machine with no image library installed.
    expect(source).toContain("zlib.compress");
    expect(source).toMatch(/BITMAPINFOHEADER|<IiiHHIIiiII/);
    expect(source).toContain("icns");
  });
});
describe("what each platform is told to build", () => {
  /**
   * The bundle targets each platform produces, read from the files that declare
   * them rather than written here.
   *
   * Tauri merges `tauri.<platform>.conf.json` over the base configuration, and a
   * reader who wants to know what comes out of `npm run build` on Windows should
   * be able to read that off a file rather than infer it from Tauri defaults.
   */
  const targetsFor = (platform: "linux" | "windows"): string[] => {
    const config = JSON.parse(readFileSync(join(TAURI, `tauri.${platform}.conf.json`), "utf8")) as {
      bundle: { targets: string[] };
    };
    return config.bundle.targets;
  };

  it("names them explicitly for the two platforms this has been run on", () => {
    // Not a third platform's defaults: macOS is left on the base `"all"`, which
    // is a fact about Tauri rather than a claim about this project. Naming it
    // would say "we decided macOS produces an `.app` and a `.dmg`", which nobody
    // here has checked — see `docs/platform-findings.md`.
    expect(targetsFor("linux")).toEqual(["deb", "rpm", "appimage"]);
    expect(targetsFor("windows")).toEqual(["nsis", "msi"]);
  });

  it("declares no target for macOS, because nobody has bundled on one", () => {
    expect(existsSync(join(TAURI, "tauri.macos.conf.json"))).toBe(false);
  });

  it("builds for the platform it is on, not for all three", () => {
    // The base declaration is `"all"`, which means "every target this platform
    // has" — and each platform file narrows that to the ones this project is
    // prepared to claim. A Linux build reaching for an MSI would be a build
    // reaching for a platform it cannot run.
    const base = (
      JSON.parse(readFileSync(join(TAURI, "tauri.conf.json"), "utf8")) as {
        bundle: { targets: string };
      }
    ).bundle.targets;

    expect(base).toBe("all");
    for (const target of targetsFor("linux")) {
      expect(targetsFor("windows")).not.toContain(target);
    }
  });
});
