#!/usr/bin/env python3
"""Render a Short frame by frame, then mux it against the voice track.

    python3 video/render.py shorts-01-two-numbers
    python3 video/render.py shorts-01-two-numbers --variant 2-contradiction

Needs audio/*.wav and audio/timings.json from tts.mjs. Writes frames/, builds
the audio track from the same per-beat lengths the frames were counted from,
and writes <variant>.mp4.

Every body beat is one slide:

    THE BILL                 <- which document this is
    [ the whole page ]       <- never cropped, so it reads as a real bill
    [ the circled part ]     <- the same region again, big enough to read
    captions                 <- the word being spoken, in near-black

The whole page stays on screen the entire time. Cropping to the row being
discussed made the pages unrecognisable — a strip of table is not a bill — so
the zoom is a second panel rather than a camera move, and the circle is drawn
in both panels at once so the eye can connect them.

Geometry is measured with `pdftotext -bbox`, never eyeballed: every callout
edge sits in a gap between rows or columns, so nothing is ever sliced
mid-character. Change a fixture and these boxes must be re-measured.

The patient's SSN is painted out. It is a canary in a fake fixture, but an SSN
on screen in a video about medical bills reads as careless, and a redaction bar
is what a real shared bill looks like anyway.
"""
import json, subprocess, sys, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FIX = HERE.parent / "test-fixtures"
DPI, W, H, FPS = 200, 1080, 1920, 15
S = DPI / 72.0
BG, INK, MUTE, ACCENT = (247, 249, 250), (26, 32, 36), (150, 160, 168), (178, 59, 59)
PAPER, EDGE, REDACT = (255, 255, 255), (206, 212, 218), (188, 195, 201)

F = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
if not Path(F).exists():
    F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

PAGE_W = 880                       # the whole page, every frame
# Both fixtures print on US Letter and stop well short of the bottom. Keeping
# the blank half of the sheet costs the readable half its size, so each page is
# trimmed just below its last line — still a whole bill, nothing of it missing.
PAGE_TRIM = {"bill": 492, "eob": 412}
CALL_W, CALL_H = 1000, 430         # the circled part, blown up
CAP_SIZE = 62
CAP_STEP, CAP_LINES = CAP_SIZE + 22, 3
LABEL_H, CARD_CAP_Y = 56, 1290
GAPS = (0.9, 0.25, 0.45, 0.9, 1.1)  # margins around label, page, callout, captions

BILL, EOB = "$845.00", "$186.35"
PAGES = {"bill": "fake-bill.pdf", "eob": "fake-eob.pdf"}
LABELS = {"bill": "THE BILL", "eob": "EXPLANATION OF BENEFITS"}

# What each beat circles, and the region the callout shows. Both in PDF points.
# The callout box is snapped to row and column gaps read off the page: the
# descriptions end at x=218.2 and the Billed column starts at x=283.5, so 250
# splits them; the letterhead block ends at y=69.6 and the patient block starts
# at 101.4, so 75 is clear of both.
TARGETS = {
    "bill-sender":        ("bill", ( 30.0,  29.9, 316.7,  46.7), ( 24,  22, 400,   75)),
    "bill-balance":       ("bill", (178.8, 423.3, 219.5, 435.9), ( 24, 374, 588,  444)),
    "eob-notabill":       ("eob",  (128.0,  46.7, 233.0,  57.6), ( 24,  22, 400,   70)),
    "eob-responsibility": ("eob",  (542.1, 315.5, 576.0, 326.0), (250, 178, 588,  340)),
    # only the first sentence of the note: it ends at "coinsurance)." (x=352.6)
    # and the lines under it wrap past the right edge, so taking them too would
    # slice them mid-word
    "eob-owe":            ("eob",  (179.3, 352.6, 211.8, 362.7), ( 30, 344, 353.6, 363)),
}
# The canary SSN on the bill, painted over before anything else sees the page.
SSN = (122.8, 111.6, 205.5, 124.8)

_pages, _cache, _fonts = {}, {}, {}


def font(size):
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(F, size)
    return _fonts[size]


def centre(d, text, f, y, fill, x0=0, x1=W):
    d.text((x0 + (x1 - x0 - d.textlength(text, font=f)) // 2, y), text, font=f, fill=fill)


def page(which):
    if which not in _pages:
        pdf = FIX / PAGES[which]
        stem = HERE / f"_{pdf.stem}"
        subprocess.run(["pdftoppm", "-png", "-r", str(DPI), str(pdf), str(stem)],
                       check=True, capture_output=True)
        im = Image.open(f"{stem}-1.png").convert("RGB")
        if which == "bill":
            ImageDraw.Draw(im).rectangle([v * S for v in SSN], fill=REDACT)
        im = im.crop((0, 0, im.width, int(PAGE_TRIM[which] * S)))
        _pages[which] = im
    return _pages[which]


def ring(d, box, extent, width):
    """`extent` degrees of an ellipse, opening at about eight o'clock, the way a
    person circles something by hand."""
    d.arc(box, start=145, end=145 + min(extent, 360), fill=ACCENT, width=width)


def whole_page(which, target, extent, width=PAGE_W):
    """The full page, with the figure being spoken about circled on it."""
    key = ("page", which, target, round(extent / 36), width)
    if key in _cache:
        return _cache[key]
    src = page(which)
    sc = width / src.width
    im = src.resize((width, int(src.height * sc)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width - 1, im.height - 1], outline=EDGE)
    if target and extent > 0:
        x0, y0, x1, y1 = [v * S * sc for v in TARGETS[target][1]]
        px, py = max((x1 - x0) * 0.08, 7), max((y1 - y0) * 0.75, 7)
        ring(d, [x0 - px, y0 - py, x1 + px, y1 + py], extent, 4)
    _cache[key] = im
    return im


def callout(target, extent, grow=1.0):
    """The circled part of the page, blown up far enough to read on a phone."""
    key = ("call", target, round(extent / 36), round(grow, 2))
    if key in _cache:
        return _cache[key]
    which, tgt, box = TARGETS[target]
    x0, y0, x1, y1 = box
    crop = page(which).crop((int(x0 * S), int(y0 * S), int(x1 * S), int(y1 * S)))
    pad = 26
    sc = min((CALL_W - 2 * pad) / crop.width, (CALL_H - 2 * pad) / crop.height) * grow
    im = crop.resize((int(crop.width * sc), int(crop.height * sc)), Image.LANCZOS)

    card = Image.new("RGB", (im.width + 2 * pad, im.height + 2 * pad), PAPER)
    card.paste(im, (pad, pad))
    d = ImageDraw.Draw(card)
    d.rectangle([0, 0, card.width - 1, card.height - 1], outline=EDGE, width=3)
    if extent > 0:
        fx0, fy0 = pad + (tgt[0] - x0) * S * sc, pad + (tgt[1] - y0) * S * sc
        fx1, fy1 = pad + (tgt[2] - x0) * S * sc, pad + (tgt[3] - y0) * S * sc
        px = min((fx1 - fx0) * 0.10 + 16, 56)
        py = max((fy1 - fy0) * 0.55, 20)
        ring(d, [max(fx0 - px, 5), max(fy0 - py, 5),
                 min(fx1 + px, card.width - 6), min(fy1 + py, card.height - 6)], extent, 9)
    _cache[key] = card
    return card


def layout(blocks):
    """Block heights, top to bottom -> the top edge of each, with everything
    left over spread as even margins. A wide document cannot fill a 9:16 frame,
    so the empty space is distributed rather than left to pool in one place."""
    unit = (H - sum(blocks)) / sum(GAPS)
    tops, y = [], 0.0
    for i, h in enumerate(blocks):
        y += unit * GAPS[i]
        tops.append(int(y))
        y += h
    return tops


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
    idx = next((n for n, ln in enumerate(lines) if any(i == active for i, _ in ln)), 0)
    lo = max(0, min(idx - 1, len(lines) - CAP_LINES))
    y = top
    for ln in lines[lo:lo + CAP_LINES]:
        x = (W - d.textlength(" ".join(w for _, w in ln), font=f)) // 2
        for i, w in ln:
            d.text((x, y), w, font=f, fill=INK if i == active else MUTE)
            x += d.textlength(w + " ", font=f)
        y += CAP_STEP


def hook_card():
    """The hook: the two documents and their two figures, together, before a
    word is spoken."""
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    thumbs = [whole_page("bill", None, 0, 490), whole_page("eob", None, 0, 490)]
    lab, num = font(38), font(96)
    y = 330
    # Short labels here, not the ones the body slides use: "EXPLANATION OF
    # BENEFITS" at this size runs into the edge of the frame.
    for i, (cap, amount) in enumerate([("THE HOSPITAL BILL", BILL),
                                       ("YOUR INSURANCE", EOB)]):
        lo, hi = (20, 530) if i == 0 else (550, 1060)
        centre(d, cap, lab, y, MUTE, lo, hi)
        centre(d, amount, num, y + 50, ACCENT if i == 0 else INK, lo, hi)
        im.paste(thumbs[i], (lo + (hi - lo - 490) // 2, y + 190))
    centre(d, "Same visit. Same day.", font(58), y + 190 + thumbs[0].height + 60, MUTE)
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
    out_frames = []
    for beat_id, lead, length in plan:
        with wave.open(str(dir_ / "audio" / f"{beat_id}.wav"), "rb") as w:
            rate, data = w.getframerate(), w.readframes(w.getnframes())
        want = int(length * rate) * 2
        out_frames.append((b"\x00\x00" * int(lead * rate) + data)[:want].ljust(want, b"\x00"))
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(out_frames))


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
    CIRC, GROW = 0.5, 0.22   # seconds of circle, seconds of the callout landing

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

        if b["scene"]:
            which = TARGETS[b["scene"]][0]
            page_h = whole_page(which, None, 0).height
            call_h = callout(b["scene"], 0).height
            ly, py, cy, capy = layout([LABEL_H, page_h, call_h, CAP_STEP * CAP_LINES])

        for k in range(steps):
            spoken = k / FPS - lead
            active = max((i for i, st in enumerate(starts) if spoken >= st), default=-1)
            if b["scene"] is None:
                frame = hook_card() if bi == 0 else cta_card()
                if spoken >= 0:
                    caption(frame, words, active, CARD_CAP_Y)
            else:
                # The circle is drawn on the page and in the callout at once, so
                # the blown-up panel is visibly the ring on the page above it.
                circle_at = max(0.0, t["secs"] * b["at"])
                ext = min(1.0, max(0.0, (spoken - circle_at) / CIRC)) * 360
                g = min(1.0, max(0.0, (spoken - circle_at + GROW) / GROW))
                frame = Image.new("RGB", (W, H), BG)
                centre(ImageDraw.Draw(frame), LABELS[which], font(46), ly, MUTE)
                pg = whole_page(which, b["scene"], ext)
                frame.paste(pg, ((W - pg.width) // 2, py))
                if g > 0:
                    card = callout(b["scene"], ext, 0.86 + 0.14 * (g * g * (3 - 2 * g)))
                    frame.paste(card, ((W - card.width) // 2,
                                       cy + (call_h - card.height) // 2))
                caption(frame, words, active, capy)
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
