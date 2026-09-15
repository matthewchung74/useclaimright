#!/usr/bin/env python3
"""Whiteboard animation: the whole Short is drawn, stroke by stroke, as narrated.

    python3 video/whiteboard.py shorts-02-whiteboard

Needs audio/*.wav and audio/timings.json from tts.mjs. Writes frames/ and the
mp4 beside them.

The trick is the same one VideoScribe and Doodly use, and it is only three
things:

  1. the art is STROKES, not a finished picture
  2. each frame draws the first N% of the total stroke length
  3. a marker is composited at the current end of the stroke

(3) is what sells it. Reveal the same art with a wipe and it reads as a
transition; put a pen at the moving tip and it reads as someone drawing.

The art here is generated — parametric strokes with a deterministic wobble so
the lines are not machine-straight. That is the honest limit of this file: it
looks like tidy line art, not like a person's marker. The reveal engine does not
care where the strokes come from, so real drawings can replace these later
without touching any of the timing code.

Elements are shared out across each spoken line in proportion to their length,
so the last stroke of an element lands as its line finishes.
"""
import json, math, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render import audio_track, caption, CAP_STEP, CAP_LINES     # noqa: E402

HERE = Path(__file__).resolve().parent
W, H, FPS = 1080, 1920, 15
# The board is wider than the frame: the story runs left to right across it and
# the camera moves to whatever is being drawn.
BW, BH = 1600, 2900
BOARD, INK, ACCENT, GREY = (253, 253, 251), (34, 38, 42), (190, 54, 54), (150, 158, 164)
PEN_W = 7

HAND = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"
_fonts = {}


def font(size, path=HAND):
    if (size, path) not in _fonts:
        _fonts[(size, path)] = ImageFont.truetype(path, size)
    return _fonts[(size, path)]


# ---------------------------------------------------------------- stroke art

def wobble(pts, amp=2.2, seed=0):
    """Push each point off the true path by a repeatable amount. Straight lines
    are the giveaway that nobody drew this."""
    out = []
    for i, (x, y) in enumerate(pts):
        n = math.sin((i + seed) * 12.9898) * 43758.5453
        m = math.sin((i + seed) * 78.233) * 12345.6789
        out.append((x + (n - math.floor(n) - 0.5) * 2 * amp,
                    y + (m - math.floor(m) - 0.5) * 2 * amp))
    return out


def line(a, b, n=6, seed=0):
    return wobble([(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
                   for i in range(n + 1)], seed=seed)


def circle(cx, cy, r, n=34, seed=0, start=-0.4):
    """Slightly past closed, the way a hand-drawn circle overshoots."""
    return wobble([(cx + r * math.cos(start + 2.15 * math.pi * i / n),
                    cy + r * math.sin(start + 2.15 * math.pi * i / n))
                   for i in range(n + 1)], amp=1.8, seed=seed)


def ellipse(cx, cy, rx, ry, n=40, seed=0):
    """Circling something by hand: starts at about eight o'clock and overshoots."""
    return [wobble([(cx + rx * math.cos(-0.4 + 2.2 * math.pi * i / n),
                     cy + ry * math.sin(-0.4 + 2.2 * math.pi * i / n))
                    for i in range(n + 1)], amp=2.0, seed=seed)]


def phone(x0, y0, w, h, seed=61):
    return (box(x0, y0, x0 + w, y0 + h, seed=seed)
            + [line((x0 + w * 0.32, y0 + 26), (x0 + w * 0.68, y0 + 26), seed=seed + 4),
               line((x0 + 16, y0 + 56), (x0 + w - 16, y0 + 56), seed=seed + 5),
               line((x0 + 16, y0 + h - 56), (x0 + w - 16, y0 + h - 56), seed=seed + 6)])


def box(x0, y0, x1, y1, seed=0):
    return [line((x0, y0), (x1, y0), seed=seed), line((x1, y0), (x1, y1), seed=seed + 1),
            line((x1, y1), (x0, y1), seed=seed + 2), line((x0, y1), (x0, y0), seed=seed + 3)]


def person(cx, top, s=1.0, arms_down=True, seed=3):
    head_r = 46 * s
    hy = top + head_r
    body = [(cx, hy + head_r), (cx, hy + head_r + 150 * s)]
    hip = body[1]
    strokes = [circle(cx, hy, head_r, seed=seed)]
    strokes.append(line(body[0], body[1], seed=seed + 1))
    sh = (cx, hy + head_r + 46 * s)
    strokes.append(line(sh, (cx - 74 * s, sh[1] + 86 * s), seed=seed + 2))
    strokes.append(line(sh, (cx + 74 * s, sh[1] + 86 * s), seed=seed + 3))
    strokes.append(line(hip, (cx - 66 * s, hip[1] + 128 * s), seed=seed + 4))
    strokes.append(line(hip, (cx + 66 * s, hip[1] + 128 * s), seed=seed + 5))
    return strokes


def person_hurt(cx, top, s=1.0, seed=51):
    """Doubled over, clutching the middle, knees bent. Same person, worse night.

    Drawn as its own figure rather than by modifying the first — a whiteboard
    cannot un-draw an arm, so "before and after" is two drawings side by side.
    """
    r = 46 * s
    cy = top + r
    sh = (cx + 10 * s, cy + 66 * s)
    hip = (cx + 46 * s, cy + 150 * s)
    return [
        circle(cx, cy, r, seed=seed),
        line((cx + 4 * s, cy + r), hip, n=7, seed=seed + 1),          # spine, leaning in
        line(sh, (cx + 72 * s, cy + 124 * s), seed=seed + 2),         # arms across the belly
        line((cx - 6 * s, cy + 72 * s), (cx + 62 * s, cy + 132 * s), seed=seed + 3),
        line(hip, (cx + 6 * s, cy + 216 * s), seed=seed + 4)          # knees bent
        + line((cx + 6 * s, cy + 216 * s), (cx + 22 * s, cy + 282 * s), seed=seed + 5),
        line(hip, (cx + 94 * s, cy + 218 * s), seed=seed + 6)
        + line((cx + 94 * s, cy + 218 * s), (cx + 86 * s, cy + 284 * s), seed=seed + 7),
    ]


def hospital(x0, y0, w, h, seed=9):
    cx, cy, a = x0 + w / 2, y0 + h * 0.40, 34
    return (box(x0, y0, x0 + w, y0 + h, seed=seed)
            + [line((x0 - 14, y0), (cx, y0 - 66), seed=seed + 4),             # roof
               line((cx, y0 - 66), (x0 + w + 14, y0), seed=seed + 5),
               line((cx - a, cy), (cx + a, cy), seed=seed + 6),               # cross
               line((cx, cy - a), (cx, cy + a), seed=seed + 7)]
            + box(cx - 34, y0 + h - 82, cx + 34, y0 + h, seed=seed + 8))      # door


def envelope(x0, y0, w, h, seed=15):
    return box(x0, y0, x0 + w, y0 + h, seed=seed) + [
        line((x0, y0), (x0 + w / 2, y0 + h * 0.62), seed=seed + 4),
        line((x0 + w / 2, y0 + h * 0.62), (x0 + w, y0), seed=seed + 5)]


def arrow(a, b, seed=21):
    dx, dy = b[0] - a[0], b[1] - a[1]
    ang = math.atan2(dy, dx)
    return [line(a, b, n=8, seed=seed),
            line(b, (b[0] - 34 * math.cos(ang - 0.45), b[1] - 34 * math.sin(ang - 0.45)), seed=seed + 1),
            line(b, (b[0] - 34 * math.cos(ang + 0.45), b[1] - 34 * math.sin(ang + 0.45)), seed=seed + 2)]


def squiggle(x, y, w, n=3, seed=27):
    pts = []
    for i in range(n * 12 + 1):
        t = i / (n * 12)
        pts.append((x + w * t, y + 16 * math.sin(t * n * 2 * math.pi)))
    return [wobble(pts, amp=1.2, seed=seed)]


# ------------------------------------------------------------------ elements
# Each element is drawn over its share of the line being spoken. Order matters:
# it is the order the hand draws them in.

def S(*groups, colour=INK, width=PEN_W):
    """One element from one or more groups of strokes. The pen lifts between
    strokes and only between strokes."""
    return {"kind": "strokes", "strokes": [st for g in groups for st in g],
            "colour": colour, "width": width}


def T(xy, text, size=66, colour=INK):
    return {"kind": "text", "xy": xy, "text": text, "size": size, "colour": colour}


def Sheet(x0, y0, w, h, text, colour=INK, rise=300):
    """A page sliding up out of an envelope. Not a reveal — the paper is already
    drawn, it moves. White-filled so it covers the envelope it comes out of."""
    return {"kind": "sheet", "box": (x0, y0, x0 + w, y0 + h), "rise": rise,
            "text": text, "colour": colour}


ART = {
    "hook-cold-open": [S(person(210, 620)), T((330, 760), "you", 72, GREY)],
    "d2": [S(person_hurt(600, 700)), S(squiggle(560, 630, 150), squiggle(740, 630, 150)),
           T((580, 470), "2 a.m.", 86)],
    "d3": [S(arrow((830, 900), (1010, 900))), S(hospital(1070, 760, 320, 270))],
    "d4": [S(envelope(180, 1500, 420, 260)), S(envelope(760, 1500, 420, 260))],
    # Round numbers on purpose. The real fixtures say $845.00 and $186.35 and
    # the whole product is built on those, but nobody holds two decimal places
    # in their head off a feed — and this drawing is illustrating the shape of
    # the problem, not quoting a document.
    "d5": [Sheet(215, 1260, 350, 310, "$800", ACCENT),
           Sheet(795, 1260, 350, 310, "$150", INK)],
    "d6": [T((450, 1860), "$650 apart", 104, ACCENT),
           S([line((450, 1985), (930, 1985), n=10, seed=44)], colour=ACCENT, width=8)],
    # Which envelope is which — the question a beginner actually has. The answer
    # is who sent it, so the labels go under the papers they belong to.
    "d7": [T((225, 2090), "the bill", 84)],
    "d8": [T((760, 2090), "NOT a bill", 84)],
    "d9": [S(ellipse(970, 1468, 140, 74), colour=ACCENT, width=8)],
    "d10": [S(phone(430, 2280, 210, 340)), T((700, 2400), "call first", 84)],
    "d11": [T((300, 2700), "useclaimright.com", 100, ACCENT),
            S([line((300, 2830), (1160, 2830), n=14, seed=71)], colour=ACCENT, width=8)],
}


def extent(el):
    """Bounding box, so the camera knows where the drawing actually is."""
    if el["kind"] == "sheet":
        return el["box"]
    if el["kind"] == "text":
        w = ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(el["text"], font=font(el["size"]))
        return (el["xy"][0], el["xy"][1], el["xy"][0] + w, el["xy"][1] + el["size"] * 1.25)
    xs = [p[0] for st in el["strokes"] for p in st]
    ys = [p[1] for st in el["strokes"] for p in st]
    return (min(xs), min(ys), max(xs), max(ys))


def frame_box(els, vw, vh, pad=90, span=0):
    """The camera rectangle holding `els`, in board coordinates, matched to the
    viewport's aspect so nothing is stretched."""
    xs = [e[0] for e in els] + [e[2] for e in els]
    ys = [e[1] for e in els] + [e[3] for e in els]
    x0, y0, x1, y1 = min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad
    # A floor on the shot, so one short stroke does not zoom to 400%.
    if x1 - x0 < span:
        cx = (x0 + x1) / 2
        x0, x1 = cx - span / 2, cx + span / 2
    w, h = x1 - x0, y1 - y0
    if w / h < vw / vh:                       # too tall for the viewport: widen
        w = h * vw / vh
    else:
        h = w * vh / vw
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]


def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def element_len(el):
    if el["kind"] == "sheet":
        return 260.0                    # a move, not a stroke: give it a beat
    if el["kind"] == "text":
        return ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(
            el["text"], font=font(el["size"])) * 0.9      # writing is faster than drawing
    return sum(seg_len(s[i], s[i + 1]) for s in el["strokes"] for i in range(len(s) - 1))


def draw_element(im, el, p):
    """Draw the first `p` of an element. Returns the pen position, or None once
    the element is finished (nothing left to hold the marker to)."""
    d = ImageDraw.Draw(im)
    if el["kind"] == "sheet":
        e = p * p * (3 - 2 * p)
        x0, y0, x1, y1 = el["box"]
        dy = el["rise"] * (1 - e)
        d.rectangle((x0, y0 + dy, x1, y1 + dy), fill=(255, 255, 255))
        for st in box(x0, y0 + dy, x1, y1 + dy, seed=31):
            d.line(st, fill=INK, width=5, joint="curve")
        for i in range(3):              # the body text of a bill, unreadable
            yy = y0 + dy + 62 + i * 38
            d.line(line((x0 + 34, yy), (x0 + 34 + (x1 - x0 - 68) * (0.95 - 0.16 * i), yy),
                        n=9, seed=50 + i), fill=GREY, width=5, joint="curve")
        f = font(76)
        tw = d.textlength(el["text"], font=f)
        d.text((x0 + (x1 - x0 - tw) / 2, y1 + dy - 130), el["text"], font=f, fill=el["colour"])
        return None                     # nothing is being drawn, so no marker
    if el["kind"] == "text":
        f = font(el["size"])
        w = int(d.textlength(el["text"], font=f))
        layer = Image.new("RGBA", (w + 20, el["size"] * 2), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((0, 0), el["text"], font=f, fill=el["colour"])
        cut = int(w * min(p, 1.0))
        im.paste(layer.crop((0, 0, cut, layer.height)), el["xy"], layer.crop((0, 0, cut, layer.height)))
        return None if p >= 1 else (el["xy"][0] + cut, el["xy"][1] + el["size"] * 0.75)

    total = element_len(el)
    budget = total * p
    tip = None
    for st in el["strokes"]:
        for i in range(len(st) - 1):
            if budget <= 0:
                return tip
            seg = seg_len(st[i], st[i + 1])
            if seg <= budget:
                d.line([st[i], st[i + 1]], fill=el["colour"], width=el["width"], joint="curve")
                budget -= seg
                tip = st[i + 1]
            else:
                t = budget / seg
                end = (st[i][0] + (st[i + 1][0] - st[i][0]) * t,
                       st[i][1] + (st[i + 1][1] - st[i][1]) * t)
                d.line([st[i], end], fill=el["colour"], width=el["width"], joint="curve")
                return end
    return None if p >= 1 else tip


def marker(im, tip):
    """A marker held at the tip. Without this the art reads as a wipe."""
    if not tip:
        return
    x, y = tip
    d = ImageDraw.Draw(im)
    dx, dy = 44, -118                                   # pointing up and right
    d.polygon([(x, y), (x + 17, y - 26), (x + dx * 0.34, y + dy * 0.24)], fill=(60, 64, 70))
    d.line([(x + dx * 0.3, y + dy * 0.22), (x + dx, y + dy)], fill=(40, 44, 48), width=26)
    d.line([(x + dx * 0.95, y + dy * 0.93), (x + dx * 1.2, y + dy * 1.2)],
           fill=(120, 126, 132), width=26)


def main():
    folder = next((a for a in sys.argv[1:] if not a.startswith("--")), "shorts-02-whiteboard")
    dir_ = HERE / folder
    spec = json.loads((dir_ / "lines.json").read_text())
    timings = json.loads((dir_ / "audio" / "timings.json").read_text())
    frames = dir_ / "frames"
    frames.mkdir(exist_ok=True)
    for old in frames.glob("*.png"):
        old.unlink()

    beats = [{"id": f"hook-{k}", "pad": 0.35} for k in spec["variants"]]
    beats += [{"id": b["id"], "pad": 0.35} for b in spec["body"]]

    VW, VH = W, H - 380                # viewport: the board above the captions
    MOVE = 0.55                        # seconds for the camera to settle
    MARGIN = 500                       # white overhang, so a wide shot has edges
    n, plan, done = 0, [], []          # `done` accumulates: a whiteboard keeps what was drawn
    cam, prev_els = None, []
    for b in beats:
        t = timings[b["id"]]
        steps = int((t["secs"] + b["pad"]) * FPS)
        plan.append((b["id"], 0.0, steps / FPS))
        words = [w for w, _ in t["timing"]]
        starts = [s for _, s in t["timing"]]

        els = ART.get(b["id"], [])
        lens = [element_len(e) for e in els] or [1]
        total = sum(lens)
        # Drawing finishes a shade before the line does, so the voice is never
        # waiting on the hand.
        span = t["secs"] * 0.92
        bounds, acc = [], 0.0
        for L in lens:
            bounds.append((acc / total * span, (acc + L) / total * span))
            acc += L

        # Where the camera wants to be for this line: everything drawn so far
        # plus what is about to be drawn. Held still while the hand works, so
        # only the cut between lines moves.
        # The shot holds this line and the one before it: framing only the
        # current strokes cut the previous drawing in half, and framing the
        # whole board shrank everything as the story grew.
        want = frame_box([extent(e) for e in prev_els + els] or [(0, 0, BW, BH)],
                         VW, VH, span=1050)
        prev = cam or want

        for k in range(steps):
            now = k / FPS
            board = Image.new("RGB", (BW, BH), BOARD)
            for el in done:
                draw_element(board, el, 1.0)
            tip = None
            for el, (t0, t1) in zip(els, bounds):
                p = 0.0 if now <= t0 else 1.0 if now >= t1 else (now - t0) / (t1 - t0)
                if p > 0:
                    got = draw_element(board, el, p)
                    if p < 1:
                        tip = got
            marker(board, tip)

            e = min(1.0, now / MOVE)
            e = e * e * (3 - 2 * e)
            view = [a + (c - a) * e for a, c in zip(prev, want)]
            pad = Image.new("RGB", (BW + 2 * MARGIN, BH + 2 * MARGIN), BOARD)
            pad.paste(board, (MARGIN, MARGIN))
            crop = pad.crop((int(view[0]) + MARGIN, int(view[1]) + MARGIN,
                             int(view[2]) + MARGIN, int(view[3]) + MARGIN)
                            ).resize((VW, VH), Image.LANCZOS)
            im = Image.new("RGB", (W, H), BOARD)
            im.paste(crop, (0, 0))

            active = max((i for i, st in enumerate(starts) if now >= st), default=-1)
            caption(im, words, active, H - 300)
            im.save(frames / f"f{n:05d}.png")
            n += 1
        done.extend(els)
        cam, prev_els = want, els

    wav = dir_ / "audio" / "_track.wav"
    audio_track(dir_, plan, wav)
    out = dir_ / "whiteboard.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", str(frames / "f%05d.png"), "-i", str(wav),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)], check=True)
    wav.unlink()
    print(f"{n} frames · {n / FPS:.1f}s · {out}")


if __name__ == "__main__":
    main()
