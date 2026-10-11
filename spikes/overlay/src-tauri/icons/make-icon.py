"""Generate icons/icon.ico for the spike's Windows build.

Why this exists
---------------
`tauri-build` compiles a Windows resource file into the executable and that step
requires `icons/icon.ico`. Linux has no equivalent step, so the spike built and ran
here with only a PNG — and failed on the first machine it was actually meant for.

Which is the second time this spike assumed Linux was general. The first was the
POSIX-only test paths in the relay suite. A spike exists to answer a question about
*other* machines, so anything it assumes about the machine it was written on is a
defect in the spike, not in the platform.

Format
------
A 32x32 32-bit BMP icon, which every Windows version accepts. PNG-compressed icons
are smaller and modern Windows reads them, but the resource compiler's tolerance is
not worth betting a cross-platform spike on.
"""

import struct
from pathlib import Path

SIZE = 32
XOR_BYTES = SIZE * SIZE * 4
AND_ROW_BYTES = 4  # 32 bits, already 4-byte aligned
AND_BYTES = AND_ROW_BYTES * SIZE
IMAGE_BYTES = XOR_BYTES + AND_BYTES
# The offset the ICONDIRENTRY points at: past ICONDIR (6) and ICONDIRENTRY (16).
# The BITMAPINFOHEADER is *part of the image blob*, not part of what the offset
# skips, so 40 is not added here. Adding it puts every pixel 40 bytes out of step
# and the icon reads as fully transparent.
OFFSET = 6 + 16  # ICONDIR(6) + ICONDIRENTRY(16) = 22


def pixel(x: int, y: int) -> tuple[int, int, int, int]:
    """A soft circle, cyan at the top fading to magenta, transparent outside.

    Stands in for the mascot. The icon only has to exist and be 32-bit; nobody
    reads it.
    """
    cx = cy = (SIZE - 1) / 2
    radius = SIZE * 0.46
    distance = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5

    if distance > radius:
        return (0, 0, 0, 0)

    # One pixel of falloff at the edge so the circle is not visibly stepped.
    alpha = 255 if distance < radius - 1 else int(255 * (radius - distance))

    t = y / (SIZE - 1)
    r = int(0x00 + (0xFF - 0x00) * t)  # cyan -> magenta on the red channel
    g = int(0xE5 * (1 - t) + 0x4D * t)
    b = int(0xFF * (1 - t) + 0xFF * t)
    return (b, g, r, alpha)  # BGRA, as a DIB stores it


def build() -> bytes:
    xor = bytearray()
    # DIB rows run bottom-up.
    for y in range(SIZE - 1, -1, -1):
        for x in range(SIZE):
            xor.extend(pixel(x, y))
    assert len(xor) == XOR_BYTES

    # The AND mask is fully opaque wherever the XOR is opaque; the colour channels
    # carry the transparency, which is what a 32-bit icon does.
    and_mask = bytearray(b"\xff" * AND_BYTES)

    header = struct.pack(
        "<IiiHHIIiiII",  # BITMAPINFOHEADER
        40,               # biSize
        SIZE,             # biWidth
        SIZE * 2,         # biHeight: XOR and AND stacked
        1,                # biPlanes
        32,               # biBitCount
        0,                # biCompression: BI_RGB
        IMAGE_BYTES,      # biSizeImage
        0, 0,             # pixels per metre
        0, 0,             # colours used / important
    )

    image = header + bytes(xor) + bytes(and_mask)
    assert len(image) == IMAGE_BYTES + 40

    icondir = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack(
        "<BBBBHHII",
        SIZE,             # width
        SIZE,             # height
        0,                # colours in palette; 0 means > 8
        0,                # reserved
        1,                # planes
        32,               # bits per pixel
        len(image),       # bytes in the image
        OFFSET,           # where the image starts
    )
    assert OFFSET == 22, "the entry must point past ICONDIR and ICONDIRENTRY"

    return icondir + entry + image


if __name__ == "__main__":
    target = Path(__file__).with_name("icon.ico")
    data = build()
    target.write_bytes(data)
    print(f"wrote {target} ({len(data)} bytes)")
