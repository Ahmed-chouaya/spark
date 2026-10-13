"""Generate the companion's icon set.

Why this exists
---------------
The shell shipped a 70-byte placeholder. A placeholder is honest about a spike
and is not honest about a product: a taskbar entry, a dock tile and an installer's
uninstall row are places a user sees every day, and "works on my machine" is the
sentence this project has been arguing against since the first spike.

The formats differ per platform and the difference is not cosmetic. Windows
compiles a resource file into the executable and that step requires a real
`.ico`; Linux and macOS want a PNG and an ICNS. Getting it wrong produces a build
failure rather than an ugly icon — which is exactly what happened to this
repository's own spike, which built and ran on Linux for days and then failed on
the first machine it was meant for.

Generated rather than drawn, and committed rather than built at install time, for
two reasons. A 32-bit BMP-in-ICO is not something to author by hand — see
`spikes/overlay/src-tauri/icons/make-icon.py`, which says so and exists for the
same reason. And an icon produced during an install is an icon that is missing on
the machine where something goes wrong, which is the worst machine to discover it
on. So the outputs are committed, and `test/bundle-icons.test.ts` holds this
repository to having them.

Determinism
-----------
No clock, no randomness, no environment. Re-running this writes the same bytes,
which is what makes "the committed files are what the script produces" a check
anybody can run rather than a claim.

    python3 shell/src-tauri/icons/make-icons.py
"""

import math
import struct
import zlib
from pathlib import Path

SIZE = 1024

# The artwork's own coordinates, taken from `src/components/mascot/states/Idle.tsx`.
# Drawn rather than traced: a Bézier rasteriser is not a thing to add to a
# repository to produce a file, and the silhouette below is the same silhouette —
# the body, the little nub at the top left, the two eyes, the glow underneath.
ART_LEFT, ART_TOP, ART_WIDTH, ART_HEIGHT = 1.94, 32.70, 18.26, 12.37
SCALE = (SIZE * 0.94) / ART_WIDTH
OFFSET_X = (SIZE - ART_WIDTH * SCALE) / 2 - ART_LEFT * SCALE
OFFSET_Y = (SIZE - ART_HEIGHT * SCALE) / 2 - ART_TOP * SCALE

# The mascot's own paint, read off `Idle.tsx` so the mark and the face it stands
# for cannot drift apart into two different characters.
GLOW = (0x1F, 0x19, 0xB5)
BODY_STROKE = (0x00, 0x33, 0xFF)
EYE_FILL = (0x88, 0xF7, 0xFF)
EYE_STROKE = (0x00, 0x77, 0xFF)
# The three stops of `Paint20`: cyan, violet, magenta.
BODY_STOPS = ((0.00, (0x00, 0xE5, 0xFF)), (0.53, (0x7F, 0x80, 0xFF)), (1.00, (0xFF, 0x4D, 0xFF)))

# (cx, cy, rx, ry) in artwork units. The body is two ellipses and a nub, which is
# enough to get the mascot's proportions without a path.
BODY_UPPER = (10.80, 39.10, 5.55, 4.60)
BODY_LOWER = (10.70, 42.10, 5.35, 2.55)
BODY_NUB = (9.30, 34.95, 1.15, 1.15)
EYE_LEFT = (13.83, 40.71, 0.80, 1.38)
EYE_RIGHT = (9.91, 40.73, 0.82, 1.38)
GLOW_SHAPE = (11.07, 44.35, 9.13, 0.72)

STROKE_WIDTH = 0.20  # artwork units, from the 0.15625 the face is drawn with


def px(x: float) -> float:
    return x * SCALE + OFFSET_X


def py(y: float) -> float:
    return y * SCALE + OFFSET_Y


def pr(r: float) -> float:
    return r * SCALE


def ellipse(x: float, y: float, cx: float, cy: float, rx: float, ry: float) -> float:
    """Signed distance to an ellipse, in pixels. Negative inside."""
    dx = (x - px(cx)) / pr(rx)
    dy = (y - py(cy)) / pr(ry)
    r = math.sqrt(dx * dx + dy * dy)
    return (r - 1.0) * min(pr(rx), pr(ry))


def body(x: float, y: float) -> float:
    """Signed distance to the mascot's silhouette, in pixels."""
    distances = [
        ellipse(x, y, *BODY_UPPER),
        ellipse(x, y, *BODY_LOWER),
        ellipse(x, y, *BODY_NUB),
    ]
    return min(distances)


def body_gradient(x: float, y: float) -> tuple[int, int, int]:
    """The mascot's vertical gradient, sampled at a point."""
    top, bottom = py(BODY_UPPER[1] - BODY_UPPER[3]), py(BODY_LOWER[1] + BODY_LOWER[3])
    t = min(1.0, max(0.0, (y - top) / (bottom - top)))

    for (t0, c0), (t1, c1) in zip(BODY_STOPS, BODY_STOPS[1:]):
        if t <= t1:
            u = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return tuple(int(round(c0[i] + (c1[i] - c0[i]) * u)) for i in range(3))  # type: ignore[return-value]

    return BODY_STOPS[-1][1]


def coverage(distance: float) -> float:
    """One pixel of antialiasing, rather than a staircase edge at every size."""
    return min(1.0, max(0.0, 0.5 - distance))


def sample(x: float, y: float) -> tuple[float, float, float, float]:
    """One pixel of the mark, as premultiplied RGBA in 0..255.

    Composited in premultiplied space and un-premultiplied at the end, because the
    glow is behind the body and a naive `over` would let the mascot's transparent
    edge drag its colour towards whatever was underneath it — which on a dark task
    bar is a grey fringe nobody asked for.
    """
    red = green = blue = alpha = 0.0
    stroke = pr(STROKE_WIDTH)

    # The glow first: it is behind the mascot and only shows outside it.
    glow = coverage(ellipse(x, y, *GLOW_SHAPE))
    if glow > 0.0:
        # Falls off across its own width *and* its height. One axis alone is a
        # bar with a soft top, which is a shadow rather than a glow.
        across = max(0.0, 1.0 - abs(x - px(GLOW_SHAPE[0])) / pr(GLOW_SHAPE[2])) ** 2
        through = max(0.0, 1.0 - abs(y - py(GLOW_SHAPE[1])) / pr(GLOW_SHAPE[3])) ** 2
        weight = glow * across * through * 0.7
        red += GLOW[0] * weight
        green += GLOW[1] * weight
        blue += GLOW[2] * weight
        alpha += weight

    inside = body(x, y)
    # `ellipse` is negative inside, so the shape is `inside <= 0` and the rim is
    # the ring from the edge inward, `inside` in [-stroke, 0]. Getting either
    # sign backwards is a mascot that is all outline and no face, which is what
    # happened twice before this one rendered.
    if inside <= 0:
        fill = coverage(inside)
        if fill > 0.0:
            colour = body_gradient(x, y)
            # The outline. The outermost `stroke` pixels are the rim rather than
            # the fill, which is what gives the mark an edge at 16 pixels where
            # the gradient has nothing left to distinguish itself by.
            rim = min(1.0, max(0.0, -inside / stroke))
            colour = (
                BODY_STROKE[0] + (colour[0] - BODY_STROKE[0]) * rim,
                BODY_STROKE[1] + (colour[1] - BODY_STROKE[1]) * rim,
                BODY_STROKE[2] + (colour[2] - BODY_STROKE[2]) * rim,
            )
            red = colour[0] * fill + red * (1.0 - fill)
            green = colour[1] * fill + green * (1.0 - fill)
            blue = colour[2] * fill + blue * (1.0 - fill)
            alpha = fill + alpha * (1.0 - fill)

    # The eyes, over the body, ringed in the body's own stroke colour so they
    # still read at sixteen pixels.
    for eye in (EYE_LEFT, EYE_RIGHT):
        distance = ellipse(x, y, *eye)
        if distance <= 0:
            fill = coverage(distance)
            if fill > 0.0:
                colour = EYE_FILL if distance <= -stroke * 0.7 else EYE_STROKE
                red = colour[0] * fill + red * (1.0 - fill)
                green = colour[1] * fill + green * (1.0 - fill)
                blue = colour[2] * fill + blue * (1.0 - fill)
                alpha = fill + alpha * (1.0 - fill)

    if alpha <= 0.0:
        return (0, 0, 0, 0)
    return (
        int(round(red / alpha)),
        int(round(green / alpha)),
        int(round(blue / alpha)),
        int(round(alpha * 255)),
    )


def render_master() -> list[bytearray]:
    """The mark at `SIZE`, as rows of straight (non-premultiplied) RGBA."""
    rows: list[bytearray] = []
    for row in range(SIZE):
        line = bytearray()
        y = row + 0.5
        for column in range(SIZE):
            line += bytes(sample(column + 0.5, y))
        rows.append(line)
    return rows


def downsample(master: list[bytearray], size: int) -> list[bytearray]:
    """A smaller icon, box-filtered from the master.

    Derived rather than drawn again: the same mark at a different resolution
    cannot come to disagree with itself about what the mascot looks like, and one
    render pass is one render pass.
    """
    factor = size / SIZE
    rows: list[bytearray] = []

    for row in range(size):
        line = bytearray()
        top, bottom = int(row * factor), max(int(row * factor) + 1, int((row + 1) * factor))
        for column in range(size):
            left, right = int(column * factor), max(int(column * factor) + 1, int((column + 1) * factor))
            red = green = blue = alpha = 0
            count = 0
            for source_row in range(top, min(SIZE, bottom)):
                source = master[source_row]
                for source_column in range(left, min(SIZE, right)):
                    offset = source_column * 4
                    a = source[offset + 3]
                    # Premultiply before averaging: averaging straight RGBA drags
                    # every edge towards black wherever transparency is involved.
                    red += source[offset] * a
                    green += source[offset + 1] * a
                    blue += source[offset + 2] * a
                    alpha += a
                    count += 1

            if alpha == 0 or count == 0:
                line += b"\x00\x00\x00\x00"
                continue
            line += bytes(
                (
                    min(255, red // alpha),
                    min(255, green // alpha),
                    min(255, blue // alpha),
                    alpha // count,
                )
            )
        rows.append(line)

    return rows


# ------------------------------------------------------------------- encoders


def png(size: int, rows: list[bytearray]) -> bytes:
    """A PNG. Written by hand because `zlib` is in the standard library and Pillow
    is not, and a build tool that needs `pip install` is a build tool that fails
    on somebody's machine."""
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def ico(entries: list[tuple[int, bytes]]) -> bytes:
    """A Windows icon: a 32-bit BGRA DIB per size, plus the 1-bit AND mask.

    Uncompressed on purpose. A PNG-compressed entry is smaller and modern Windows
    reads it, but the tolerance of the resource compiler that consumes this is
    not worth betting a cross-platform build on — which is the whole of the
    spike's lesson, repeated here on purpose.
    """
    directory = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory_entries = b""
    images = b""

    for size, rows in entries:
        xor = bytearray()
        for row in reversed(rows):  # DIB rows run bottom-up
            for column in range(size):
                r, g, b, a = bytes(row[column * 4 : column * 4 + 4])
                xor += bytes((b, g, r, a))
        and_mask = b"\x00" * (4 * size)  # fully opaque where the colour says so

        header = struct.pack(
            "<IiiHHIIiiII",
            40,
            size,
            size * 2,  # XOR and AND stacked
            1,
            32,
            0,  # BI_RGB
            len(xor) + len(and_mask),
            0,
            0,
            0,
            0,
        )
        image = header + bytes(xor) + and_mask
        directory_entries += struct.pack(
            "<BBBBHHII",
            size % 256,
            size % 256,
            0,
            0,
            1,
            32,
            len(image),
            offset,
        )
        images += image
        offset += len(image)

    return directory + directory_entries + images


def icns(entries: list[tuple[bytes, bytes]]) -> bytes:
    """A macOS icon file, PNG-compressed entries.

    `ic07`/`ic08`/`ic09`/`ic10` are the types Apple's own tooling writes for
    128, 256, 512 and 1024. Nothing here has been opened on a Mac — no Mac was
    available — so this is a correctly-shaped file, not a measured one.
    """
    body = b""
    for kind, payload in entries:
        body += kind + struct.pack(">I", len(payload) + 8) + payload
    return b"icns" + struct.pack(">I", len(body) + 8) + body


# --------------------------------------------------------------------- output

SIZES = [1024, 512, 256, 128, 64, 48, 32, 16]

OUTPUTS = {
    "icon.png": 1024,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "32x32.png": 32,
    "Square30x30Logo.png": 32,
    "Square44x44Logo.png": 48,
    "Square71x71Logo.png": 64,
    "Square89x89Logo.png": 64,
    "Square107x107Logo.png": 64,
    "Square142x142Logo.png": 64,
    "Square150x150Logo.png": 64,
    "Square284x284Logo.png": 128,
    "Square310x310Logo.png": 128,
    "StoreLogo.png": 64,
}


def main() -> None:
    here = Path(__file__).resolve().parent
    master = render_master()
    rendered = {size: (master if size == SIZE else downsample(master, size)) for size in SIZES}

    for name, size in OUTPUTS.items():
        data = png(size, rendered[size])
        (here / name).write_bytes(data)
        print(f"wrote {name} ({size}x{size}, {len(data)} bytes)")

    windows = ico([(size, rendered[size]) for size in (16, 32, 48, 64, 128, 256)])
    (here / "icon.ico").write_bytes(windows)
    print(f"wrote icon.ico (16..256, {len(windows)} bytes)")

    mac = icns(
        [
            (b"ic07", png(128, rendered[128])),
            (b"ic08", png(256, rendered[256])),
            (b"ic09", png(512, rendered[512])),
            (b"ic10", png(1024, rendered[1024])),
        ]
    )
    (here / "icon.icns").write_bytes(mac)
    print(f"wrote icon.icns (128..1024, {len(mac)} bytes)")


if __name__ == "__main__":
    main()