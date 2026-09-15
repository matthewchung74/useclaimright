#!/usr/bin/env python3
"""Generate the 1080x1920 frames for Shorts experiment 1.

    python3 video/shorts-01-two-numbers/frames.py

Writes PNGs next to this file. They are gitignored — this script is the source,
the frames are a build artefact, same split as test-fixtures/gen-*.mjs.

The crops are pinned to coordinates read out of the PDFs with `pdftotext -bbox`,
not eyeballed, so regenerating after a fixture change either works or fails
loudly rather than drifting a few pixels.
"""
import subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FIX = HERE.parent.parent / "test-fixtures"
DPI = 200
S = DPI / 72.0                      # PDF points -> rendered pixels
W, H = 1080, 1920                   # 9:16
BG, MUTE, INK = (247, 249, 250), (110, 122, 130), (26, 32, 36)
ACCENT = (178, 59, 59)              # the same red the app uses for money at stake

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
if not Path(FONT_BOLD).exists():            # non-mac fallback
    FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Rows located with: pdftotext -layout -bbox <pdf> - | grep <figure>
# (x0, x1, y0, y1) in PDF points, trimmed so the figure is the last thing in frame.
ROWS = {
    "bill": ("fake-bill.pdf", 36, 220.0, 422.5, 436.5),   # PATIENT BALANCE DUE: $845.00
    "eob":  ("fake-eob.pdf",  36, 212.3, 351.8, 363.2),   # What you may owe the provider: $186.35
}


def render(pdf: Path, stem: Path) -> Path:
    out = stem.with_suffix("")
    subprocess.run(["pdftoppm", "-png", "-r", str(DPI), str(pdf), str(out)],
                   check=True, capture_output=True)
    page = Path(f"{out}-1.png")
    if not page.exists():
        sys.exit(f"pdftoppm produced nothing for {pdf}")
    return page


def band(png: Path, x0, x1, y0, y1) -> Image.Image:
    im = Image.open(png).convert("RGB")
    return im.crop((int(x0 * S) - 8, int(y0 * S) - 7, int(x1 * S) + 2, int(y1 * S) + 4))


def fit(strip: Image.Image, target_w: int) -> Image.Image:
    w, h = strip.size
    return strip.resize((target_w, int(h * target_w / w)), Image.LANCZOS)


def frame(items, out: Path, footer: str | None = None):
    """items: [(label, strip)] — one block for a single-document frame, two for the pair."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    f_lab = ImageFont.truetype(FONT_BOLD, 46)
    blocks = [(t, fit(s, 980)) for t, s in items]
    GAP, LAB = 130, 74
    total = sum(LAB + s.size[1] for _, s in blocks) + GAP * (len(blocks) - 1)
    # Sits slightly above centre on purpose: YouTube overlays the handle and
    # description across the bottom of a Short, and the rail down the right.
    y = (H - total) // 2 - 90
    for t, s in blocks:
        tw = d.textlength(t, font=f_lab)
        d.text(((W - tw) // 2, y), t, font=f_lab, fill=MUTE)
        y += LAB
        im.paste(s, (50, y))
        y += s.size[1] + GAP
    if footer:
        f_big = ImageFont.truetype(FONT_BOLD, 84)
        tw = d.textlength(footer, font=f_big)
        d.text(((W - tw) // 2, y - GAP + 60), footer, font=f_big, fill=ACCENT)
    im.save(out)
    return out


def card(lines, out: Path, size=52):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT_BOLD, size)
    total = len(lines) * (size + 26)
    y = (H - total) // 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text(((W - tw) // 2, y), ln, font=f, fill=INK if ln else MUTE)
        y += size + 26
    im.save(out)
    return out


def main():
    strips = {}
    for key, (name, *box) in ROWS.items():
        pdf = FIX / name
        if not pdf.exists():
            sys.exit(f"missing fixture: {pdf}")
        strips[key] = band(render(pdf, HERE / f"_{key}"), *box)

    made = [
        frame([("THE BILL", strips["bill"])], HERE / "A-bill.png"),
        frame([("YOUR INSURANCE LETTER", strips["eob"])], HERE / "B-eob.png"),
        frame([("THE BILL", strips["bill"]),
               ("YOUR INSURANCE LETTER", strips["eob"])], HERE / "C-both.png"),
        frame([("THE BILL", strips["bill"]),
               ("YOUR INSURANCE LETTER", strips["eob"])], HERE / "D-gap.png",
              footer="$658.65 difference"),
        card(["Example documents.", "", "Check your own before", "disputing anything."],
             HERE / "E-disclaimer.png"),
    ]
    for p in (HERE / "_bill-1.png", HERE / "_eob-1.png"):
        p.unlink(missing_ok=True)
    for p in made:
        print(p.name, Image.open(p).size)


if __name__ == "__main__":
    main()
