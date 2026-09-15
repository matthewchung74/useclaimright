#!/usr/bin/env python3
"""Render the UseClaimRight mark as a PNG.

    python3 scripts/make-mark.py                 # -> web/img/mark.png, 800x800

The site's mark is CSS — a 26px rounded square, teal gradient, white tick — so
there has never been a raster copy of it. Anywhere that needs an image file (a
YouTube channel picture, a favicon, an OpenGraph card) needs one, and a
hand-exported PNG with no source is a thing nobody can reproduce or recolour.

Full-bleed rather than a rounded square on a background: every avatar slot that
matters crops to a circle, so the rounded corners are thrown away and the padding
only makes the tick smaller. At 32px the tick is all that survives, so it is
drawn large and heavy.

Colours come from DESIGN.md, which is the authority. NOTE: web/index.html is
currently on #0d8a8a/#0a6d6d, an older pair, so the live site and DESIGN.md have
drifted. They are close enough to be indistinguishable at avatar size; the
divergence is worth fixing at the source rather than by matching it here.
"""
from pathlib import Path
from PIL import Image, ImageDraw

BRAND, BRAND_DARK = (0x08, 0x7E, 0x78), (0x05, 0x6A, 0x65)
SIZE = 800
OUT = Path(__file__).resolve().parent.parent / "web/img/mark.png"


def main():
    im = Image.new("RGB", (SIZE, SIZE))
    d = ImageDraw.Draw(im)
    # 135deg linear gradient, the same direction as the CSS.
    for i in range(SIZE * 2):
        t = i / (SIZE * 2 - 1)
        d.line([(i, 0), (0, i)], fill=tuple(
            round(a + (b - a) * t) for a, b in zip(BRAND, BRAND_DARK)))

    # The tick, drawn rather than set in a font: no system font is guaranteed to
    # have a heavy enough glyph, and a stroke is exact at any size.
    w = round(SIZE * 0.105)
    pts = [(SIZE * 0.265, SIZE * 0.520), (SIZE * 0.435, SIZE * 0.685),
           (SIZE * 0.745, SIZE * 0.335)]
    d.line(pts, fill=(255, 255, 255), width=w, joint="curve")
    for p in (pts[0], pts[2]):                  # rounded cap at each end
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2],
                  fill=(255, 255, 255))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    im.save(OUT)
    print(f"{OUT}  {SIZE}x{SIZE}  {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
