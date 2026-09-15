#!/usr/bin/env python3
"""Frames for Shorts experiment 1 — document crops with a circle drawn on the
figure as it is spoken.

    python3 video/shorts-01-two-numbers/scenes.py

Supersedes frames.py, which cropped a single row per frame. Showing the table
around the number is what lets a viewer recognise their own paperwork, and the
circle is what tells them where to look — a row on its own did neither.

Per beat it writes three things, so ffmpeg can hold stills cheaply and only play
real frames while the circle is being drawn:

    <beat>-base.png      the crop, no circle
    <beat>-anim-000..N   the circle being drawn, 12 frames
    <beat>-done.png      the crop, circle complete

Geometry is in PDF points, read with `pdftotext -bbox`, never eyeballed. Change
a fixture and this fails loudly instead of circling empty paper.
"""
import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FIX = HERE.parent.parent / "test-fixtures"
DPI = 200
S = DPI / 72.0
W, H = 1080, 1920
BG, MUTE = (247, 249, 250), (110, 122, 130)
ACCENT = (178, 59, 59)
ANIM_FRAMES = 12

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
if not Path(FONT_BOLD).exists():
    FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Page regions to show, in PDF points (x0, y0, x1, y1).
# The bill window starts at y=180 on purpose: above it is the patient block,
# which carries a canary SSN. Fake or not, an SSN on screen in a video about
# medical bills reads as careless.
WINDOWS = {
    "bill-table": ("fake-bill.pdf", 24, 180, 588, 442),
    "eob-table":  ("fake-eob.pdf",  24, 140, 588, 375),
    "eob-header": ("fake-eob.pdf",  24,  30, 588,  72),
}

# What to circle, in PDF points, keyed to the page it lives on.
TARGETS = {
    "bill-balance":       ("fake-bill.pdf", 178.8, 423.3, 219.5, 435.9),   # $845.00
    "bill-total":         ("fake-bill.pdf", 533.2, 381.9, 576.0, 392.8),   # $2,115.00
    "eob-responsibility": ("fake-eob.pdf",  542.1, 315.5, 576.0, 326.0),   # $186.35, claim totals
    "eob-owe":            ("fake-eob.pdf",  179.3, 352.6, 211.8, 362.7),   # $186.35, in the box
    "eob-notabill":       ("fake-eob.pdf",  128.0,  46.7, 233.0,  57.6),   # THIS IS NOT A BILL
}

LABELS = {"bill-table": "THE BILL",
          "eob-table": "EXPLANATION OF BENEFITS",
          "eob-header": "EXPLANATION OF BENEFITS"}


def render(pdf_name):
    pdf = FIX / pdf_name
    if not pdf.exists():
        sys.exit(f"missing fixture: {pdf}")
    stem = HERE / f"_{pdf.stem}"
    subprocess.run(["pdftoppm", "-png", "-r", str(DPI), str(pdf), str(stem)],
                   check=True, capture_output=True)
    page = Path(f"{stem}-1.png")
    if not page.exists():
        sys.exit(f"pdftoppm produced nothing for {pdf}")
    return Image.open(page).convert("RGB")


def compose(window, pages):
    """Crop the window, scale to 1080 wide, centre it, and return the frame plus
    the transform needed to map page points into frame pixels."""
    pdf, x0, y0, x1, y1 = WINDOWS[window]
    crop = pages[pdf].crop((int(x0 * S), int(y0 * S), int(x1 * S), int(y1 * S)))
    scale = (W - 80) / crop.width
    crop = crop.resize((W - 80, int(crop.height * scale)), Image.LANCZOS)

    frame = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(frame)
    f_lab = ImageFont.truetype(FONT_BOLD, 46)
    label = LABELS[window]
    tw = d.textlength(label, font=f_lab)
    top = (H - crop.height) // 2 - 60
    d.text(((W - tw) // 2, top - 90), label, font=f_lab, fill=MUTE)
    frame.paste(crop, (40, top))

    def to_frame(px, py):
        return (40 + (px * S - x0 * S) * scale, top + (py * S - y0 * S) * scale)

    return frame, to_frame


def circle(frame, to_frame, target, extent):
    """Draw `extent` degrees of an ellipse around the target. extent=360 closes it."""
    _, tx0, ty0, tx1, ty1 = TARGETS[target]
    x0, y0 = to_frame(tx0, ty0)
    x1, y1 = to_frame(tx1, ty1)
    padx, pady = (x1 - x0) * 0.22 + 14, (y1 - y0) * 0.75 + 12
    box = [x0 - padx, y0 - pady, x1 + padx, y1 + pady]
    out = frame.copy()
    d = ImageDraw.Draw(out)
    if extent <= 0:
        return out
    # Start at about eight o'clock, the way a person circles something by hand.
    d.arc(box, start=145, end=145 + min(extent, 360), fill=ACCENT, width=9)
    return out


def emit(name, window, target, pages):
    frame, to_frame = compose(window, pages)
    made = []
    base = HERE / f"{name}-base.png"
    (frame if target is None else circle(frame, to_frame, target, 0)).save(base)
    made.append(base)
    if target:
        for i in range(ANIM_FRAMES):
            ext = 360 * (i + 1) / ANIM_FRAMES
            p = HERE / f"{name}-anim-{i:03d}.png"
            circle(frame, to_frame, target, ext).save(p)
            made.append(p)
        done = HERE / f"{name}-done.png"
        circle(frame, to_frame, target, 360).save(done)
        made.append(done)
    return made


def card(lines, out, size=52):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT_BOLD, size)
    y = (H - len(lines) * (size + 26)) // 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text(((W - tw) // 2, y), ln, font=f, fill=(26, 32, 36))
        y += size + 26
    im.save(out)
    return out


# scene name -> (window, circle target or None)
SCENES = {
    "hook":  ("bill-table", "bill-balance"),
    "b1":    ("bill-table", "bill-balance"),
    "b2":    ("eob-table",  "eob-responsibility"),
    "b3":    ("eob-table",  "eob-owe"),
    "b4":    ("eob-table",  "eob-responsibility"),
    "b5":    ("eob-header", "eob-notabill"),
}


def main():
    pages = {name: render(name) for name in {v[0] for v in WINDOWS.values()}}
    n = 0
    for scene, (window, target) in SCENES.items():
        n += len(emit(scene, window, target, pages))
    card(["Example documents.", "", "Check your own before", "disputing anything."],
         HERE / "E-disclaimer.png")
    for p in HERE.glob("_*.png"):
        p.unlink()
    print(f"{n + 1} frames for {len(SCENES)} scenes + disclaimer")


if __name__ == "__main__":
    main()
