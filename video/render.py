#!/usr/bin/env python3
"""Render a Short frame by frame, then mux it against the voice track.

    python3 video/render.py shorts-01-two-numbers
    python3 video/render.py shorts-01-two-numbers --variant 2-contradiction

Needs audio/*.wav and audio/timings.json from tts.mjs. Writes frames/, builds
the audio track from the same per-beat lengths the frames were counted from,
and writes <variant>.mp4.

Replaces scenes.py + assemble.mjs, which fought each other: scenes.py owned
geometry, assemble.mjs owned time, and neither could put a caption on screen at
the moment a word was said.

Four things it fixes, all of which were real:

**Nothing is cut off.** Crop edges are snapped to the row gaps read out of the
PDF with `pdftotext -bbox`, so an edge never lands mid-character — the old
letterhead crop ended at y=64, straight through "Tax ID 99-9999999". Where a box
would clip, it is widened to the next gap rather than the text being sliced. The
circle is clamped into the frame for the same reason: a letterhead sits hard
against the page margin, so an ellipse drawn around it wants to start off-screen.

**The white space is gone.** A wide document in a 9:16 frame cannot fill it —
the letterhead is 7:1 and the frame is 0.56:1 — so the answer is to fill the
frame around it rather than to stretch the document. Three bands, all occupied:
the running totals on top, the document in the middle, the captions below.

**Karaoke.** The word being spoken is near-black, the rest of the line grey,
driven by the per-word timepoints in timings.json.

**The hook is a hook.** It was the first narrated line over the same wide table
used later — indistinguishable from the body. It is now its own card, both
figures at once, on screen 1.6s before anything is said.
"""
import json, subprocess, sys, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FIX = HERE.parent / "test-fixtures"
DPI, W, H, FPS = 200, 1080, 1920, 15
S = DPI / 72.0
BG, INK, MUTE, ACCENT = (247, 249, 250), (26, 32, 36), (150, 160, 168), (178, 59, 59)

F = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
if not Path(F).exists():
    F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Three bands — running totals, document, captions — spaced evenly down the
# frame rather than pinned to fixed rows. A wide document cannot fill a 9:16
# frame (the letterhead is 7:1), so the fix for the empty-video problem is to
# distribute what is left as even margins instead of one void in the middle.
# Heights are taken from the beat's *tight* crop, so the layout holds still
# while the camera pushes in.
SCORE_H, LABEL_H, CAP_SIZE = 106, 90, 62
CAP_STEP = CAP_SIZE + 22           # three lines always reserved, so the block
CAP_H = CAP_STEP * 3               # never jumps as the line count changes
CARD_CAP_Y = 1390
GAPS = (0.8, 1.0, 1.0, 1.2)        # top, score->doc, doc->caption, bottom
DOC_W, DOC_MAX_H, PAD = W - 40, 780, 34

BILL, EOB = "$845.00", "$186.35"

# Wide view, then what to push into. Every edge sits in a gap between rows or
# columns measured off the page, so a crop never lands on a glyph.
WINDOWS = {
    "bill-head":  ("fake-bill.pdf",  24,  22, 588,  75),
    "bill-table": ("fake-bill.pdf",  24, 218, 588, 444),
    "eob-head":   ("fake-eob.pdf",   24,  22, 588,  70),
    "eob-table":  ("fake-eob.pdf",   24, 178, 588, 390),
}
TIGHT = {
    # the whole letterhead block: name, address and tax ID, none of them sliced
    "bill-sender":        ("bill-head",   24,  22, 400,  75),
    "eob-notabill":       ("eob-head",    24,  22, 400,  70),
    # totals and the balance-due band, whole rows
    "bill-balance":       ("bill-table",  24, 374, 588, 444),
    # the numeric columns: the gap between the descriptions (which end at 218.2)
    # and the Billed column (which starts at 283.5, on the $1,969.50 row) out to
    # the margin, header row down through CLAIM TOTALS
    "eob-responsibility": ("eob-table",  250, 178, 588, 340),
    # just the first sentence of the note, which ends at "coinsurance)." (x=352.6)
    # — the lines under it wrap past the right edge, so including them would slice
    # them mid-word, and a paragraph shrunk to fit is unreadable on a phone anyway
    "eob-owe":            ("eob-table",   30, 344, 353.6, 363),
}
TARGETS = {
    "bill-sender":        ("fake-bill.pdf",  30.0,  29.9, 316.7,  46.7),
    "bill-balance":       ("fake-bill.pdf", 178.8, 423.3, 219.5, 435.9),
    "eob-notabill":       ("fake-eob.pdf",  128.0,  46.7, 233.0,  57.6),
    "eob-responsibility": ("fake-eob.pdf",  542.1, 315.5, 576.0, 326.0),
    "eob-owe":            ("fake-eob.pdf",  179.3, 352.6, 211.8, 362.7),
}
LABELS = {"bill-head": "THE BILL", "bill-table": "THE BILL",
          "eob-head": "EXPLANATION OF BENEFITS", "eob-table": "EXPLANATION OF BENEFITS"}

_pages, _cache, _fonts = {}, {}, {}


def font(size):
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(F, size)
    return _fonts[size]


def centre(d, text, f, y, fill):
    d.text(((W - d.textlength(text, font=f)) // 2, y), text, font=f, fill=fill)


def page(name):
    if name not in _pages:
        pdf = FIX / name
        stem = HERE / f"_{pdf.stem}"
        subprocess.run(["pdftoppm", "-png", "-r", str(DPI), str(pdf), str(stem)],
                       check=True, capture_output=True)
        _pages[name] = Image.open(f"{stem}-1.png").convert("RGB")
    return _pages[name]


def doc_image(pdf, box, target, extent):
    """The document crop at its own aspect ratio, with `extent` degrees of a
    circle drawn on the target."""
    key = (pdf, tuple(round(v, 1) for v in box), target, round(extent / 30))
    if key in _cache:
        return _cache[key]
    x0, y0, x1, y1 = box
    crop = page(pdf).crop((int(x0 * S), int(y0 * S), int(x1 * S), int(y1 * S)))
    sc = min(DOC_W / (crop.width + 2 * PAD / S), DOC_MAX_H / crop.height)
    im = crop.resize((int(crop.width * sc), int(crop.height * sc)), Image.LANCZOS)

    # The crop sits on a margin so a circle drawn round a figure at the edge of
    # the paper has somewhere to go. Without it the ellipse is sliced by the crop
    # it is annotating — which is the thing being circled looking cut off.
    canvas = Image.new("RGB", (im.width + 2 * PAD, im.height + 2 * PAD), BG)
    canvas.paste(im, (PAD, PAD))

    if target and extent > 0:
        _, tx0, ty0, tx1, ty1 = TARGETS[target]
        fx0, fy0 = PAD + (tx0 - x0) * S * sc, PAD + (ty0 - y0) * S * sc
        fx1, fy1 = PAD + (tx1 - x0) * S * sc, PAD + (ty1 - y0) * S * sc
        px = min((fx1 - fx0) * 0.10 + 16, 56)
        py = max((fy1 - fy0) * 0.55, 20)
        rect = [max(fx0 - px, 5), max(fy0 - py, 5),
                min(fx1 + px, canvas.width - 6), min(fy1 + py, canvas.height - 6)]
        ImageDraw.Draw(canvas).arc(rect, start=145, end=145 + min(extent, 360),
                                   fill=ACCENT, width=9)
    _cache[key] = canvas
    return canvas


def layout(doc_h):
    """Even margins around the three bands, given how tall this beat's document
    ends up. Returns the top of each."""
    free = H - (SCORE_H + LABEL_H + doc_h + CAP_H)
    unit = free / sum(GAPS)
    top = unit * GAPS[0]
    label = top + SCORE_H + unit * GAPS[1]
    return top, label, label + LABEL_H, label + LABEL_H + doc_h + unit * GAPS[2]


def scoreboard(frame, side, y):
    """The two figures from the hook, kept on screen. The document being read is
    lit, the other is muted — so a viewer who joins mid-video still has both."""
    d = ImageDraw.Draw(frame)
    lab, num = font(34), font(58)
    for i, (cap, amount, live) in enumerate(
            [("THE HOSPITAL BILL SAYS", BILL, side == "bill"),
             ("YOUR INSURANCE SAYS", EOB, side == "eob")]):
        x = 90 if i == 0 else W // 2 + 40
        col = ACCENT if (live and i == 0) else INK if live else MUTE
        d.text((x, y), cap, font=lab, fill=MUTE)
        d.text((x, y + 48), amount, font=num, fill=col)


def wrap(words, f, maxw, d):
    lines, cur = [], []
    for i, w in enumerate(words):
        trial = cur + [(i, w)]
        if d.textlength(" ".join(t[1] for t in trial), font=f) > maxw and cur:
            lines.append(cur)
            cur = [(i, w)]
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def caption(frame, words, active, top):
    """Karaoke: the line in grey, the word being said in near-black.

    Most of this audience sees the first seconds muted, so the captions are not
    an accessibility afterthought — they are how the video is read at all.
    """
    d = ImageDraw.Draw(frame)
    f = font(CAP_SIZE)
    lines = wrap(words, f, W - 140, d)
    # At most three lines, the window sliding to keep the spoken word visible.
    idx = next((n for n, ln in enumerate(lines) if any(i == active for i, _ in ln)), 0)
    lo = max(0, min(idx - 1, len(lines) - 3))
    y = top
    for ln in lines[lo:lo + 3]:
        x = (W - d.textlength(" ".join(w for _, w in ln), font=f)) // 2
        for i, w in ln:
            d.text((x, y), w, font=f, fill=INK if i == active else MUTE)
            x += d.textlength(w + " ", font=f)
        y += CAP_STEP


def hook_card():
    """The hook: both figures on screen before a word is spoken."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    big, lab = font(150), font(44)
    y = 300
    for cap, amount, col in [("THE HOSPITAL BILL SAYS", BILL, ACCENT),
                             ("YOUR INSURANCE SAYS", EOB, INK)]:
        centre(d, cap, lab, y, MUTE)
        centre(d, amount, big, y + 74, col)
        y += 330
    centre(d, "Same visit. Same day.", font(58), y + 10, MUTE)
    return im


def cta_card():
    """Only the address. The instruction is spoken, and the caption under it is
    already saying the same words — printing them twice reads as a mistake."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    centre(d, "FREE BILL CHECK", font(44), 700, MUTE)
    centre(d, "useclaimright.com", font(86), 780, ACCENT)
    return im


def audio_track(dir_, plan, out):
    """One 24kHz mono track, each line padded to exactly the length its frames
    were counted from — so the circle lands on the figure however long the mux
    takes."""
    frames_out = []
    for beat_id, lead, length in plan:
        with wave.open(str(dir_ / "audio" / f"{beat_id}.wav"), "rb") as w:
            rate, data = w.getframerate(), w.readframes(w.getnframes())
        want = int(length * rate) * 2
        pad = b"\x00\x00" * int(lead * rate)
        frames_out.append((pad + data)[:want].ljust(want, b"\x00"))
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(frames_out))


def main():
    args = sys.argv[1:]
    folder = next((a for a in args if not a.startswith("--")), "shorts-01-two-numbers")
    variant = args[args.index("--variant") + 1] if "--variant" in args else "1-number"

    dir_ = HERE / folder
    spec = json.loads((dir_ / "lines.json").read_text())
    timings = json.loads((dir_ / "audio" / "timings.json").read_text())
    frames = dir_ / "frames"
    frames.mkdir(exist_ok=True)
    for old in frames.glob("*.png"):
        old.unlink()

    HOOK_HOLD = 1.6          # the card alone, before the voice starts
    ZOOM, CIRC = 0.7, 0.5    # seconds of push-in, seconds of circle

    beats = [{"id": f"hook-{variant}", "scene": None, "pad": 0.5, "at": 0.0}]
    beats += [{"id": b["id"], "scene": b["scene"], "at": b["circleAt"], "pad": 0.35}
              for b in spec["body"]]
    if spec.get("cta"):
        beats.append({"id": "cta", "scene": None, "at": 0.0, "pad": 1.0})

    n, plan = 0, []
    for bi, b in enumerate(beats):
        t = timings[b["id"]]
        lead = HOOK_HOLD if bi == 0 else 0.0
        steps = int((lead + t["secs"] + b["pad"]) * FPS)
        plan.append((b["id"], lead, steps / FPS))
        words = [w for w, _ in t["timing"]]
        starts = [s for _, s in t["timing"]]
        tight_h = 0
        if b["scene"]:
            win, *tb = TIGHT[b["scene"]]
            tight_h = doc_image(WINDOWS[win][0], tb, None, 0).height

        for k in range(steps):
            spoken = k / FPS - lead
            active = max((i for i, st in enumerate(starts) if spoken >= st), default=-1)
            if b["scene"] is None:
                frame = hook_card() if bi == 0 else cta_card()
                if spoken >= 0:
                    caption(frame, words, active, CARD_CAP_Y)
            else:
                target = b["scene"]
                win, *tight_box = TIGHT[target]
                pdf, *wide_box = WINDOWS[win]
                circle_at = max(0.0, t["secs"] * b["at"])
                z = min(1.0, max(0.0, (spoken - (circle_at - ZOOM)) / ZOOM))
                e = z * z * (3 - 2 * z)
                box = [w + (tt - w) * e for w, tt in zip(wide_box, tight_box)]
                ext = min(1.0, max(0.0, (spoken - circle_at) / CIRC)) * 360

                frame = Image.new("RGB", (W, H), BG)
                doc = doc_image(pdf, box, target, ext)
                sy, ly, dy, cy = layout(tight_h)
                scoreboard(frame, "bill" if win.startswith("bill") else "eob", sy)
                centre(ImageDraw.Draw(frame), LABELS[win], font(46), ly, MUTE)
                # Centred in the space its tight crop will occupy, so the push-in
                # grows from the middle instead of shoving the captions around.
                frame.paste(doc, ((W - doc.width) // 2,
                                  int(dy + (tight_h - doc.height) / 2)))
                caption(frame, words, active, cy)
            frame.save(frames / f"f{n:05d}.png")
            n += 1

    for p in HERE.glob("_*.png"):
        p.unlink()

    wav = dir_ / "audio" / "_track.wav"
    audio_track(dir_, plan, wav)
    out = dir_ / f"{variant}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                    "-framerate", str(FPS), "-i", str(frames / "f%05d.png"),
                    "-i", str(wav), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-r", "30", "-c:a", "aac", "-b:a", "192k", "-shortest",
                    str(out)], check=True)
    wav.unlink()
    print(f"{n} frames · {n / FPS:.1f}s · {out}")


if __name__ == "__main__":
    main()
