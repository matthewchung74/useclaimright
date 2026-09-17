#!/usr/bin/env python3
"""Whiteboard animation: the whole Short is drawn, stroke by stroke, as narrated.

    python3 video/whiteboard.py short-01-two-numbers

Needs audio/*.wav and audio/timings.json from tts.mjs. Writes the mp4 and
stills.png (the last frame of every line) beside them. Frames are deleted after
the mux unless --keep-frames is passed.

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
import json, math, re, shutil, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from captions import audio_track, caption                       # noqa: E402

HERE = Path(__file__).resolve().parent
W, H, FPS = 1080, 1920, 15
# The board is wider than the frame: the story runs left to right across it and
# the camera moves to whatever is being drawn.
BW, BH = 1600, 4050
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


def person_down(cx, cy, s=1.0, seed=71):
    """Flat on their back, limbs still in the air. Read left to right: head,
    then the rest of them going the wrong way."""
    r = 46 * s
    return [
        circle(cx, cy, r, seed=seed),
        line((cx + r, cy + 6 * s), (cx + 190 * s, cy + 18 * s), n=7, seed=seed + 1),
        line((cx + 100 * s, cy + 10 * s), (cx + 118 * s, cy - 82 * s), seed=seed + 2),
        line((cx + 132 * s, cy + 14 * s), (cx + 172 * s, cy - 66 * s), seed=seed + 3),
        line((cx + 190 * s, cy + 18 * s), (cx + 272 * s, cy - 42 * s), seed=seed + 4),
        line((cx + 190 * s, cy + 18 * s), (cx + 286 * s, cy + 44 * s), seed=seed + 5),
    ]


def person_hop(cx, top, s=1.0, seed=151):
    """On one foot, the other held up behind, arms out for balance.

    Drawn as a hop rather than as someone sat holding the ankle: a seated stick
    figure is a pile of crossing lines and reads as a scribble, but one foot off
    the ground is a silhouette that needs no explaining.
    """
    r = 46 * s
    cy = top + r
    hip = (cx, cy + r + 150 * s)
    sh = (cx, cy + r + 46 * s)
    knee = (cx + 78 * s, hip[1] + 62 * s)
    foot = (cx + 30 * s, hip[1] + 126 * s)
    return [
        circle(cx, cy, r, seed=seed),
        line((cx, cy + r), hip, n=7, seed=seed + 1),
        line(sh, (cx - 92 * s, sh[1] - 62 * s), seed=seed + 2),     # arms up, balancing
        line(sh, (cx + 96 * s, sh[1] - 44 * s), seed=seed + 3),
        line(hip, (cx - 34 * s, hip[1] + 142 * s), seed=seed + 4),  # the leg still working
        line(hip, knee, seed=seed + 5) + line(knee, foot, seed=seed + 6),
        line((cx + 66 * s, foot[1] - 4 * s), (cx + 108 * s, foot[1] - 44 * s), n=3, seed=seed + 7),
        line((cx + 76 * s, foot[1] + 38 * s), (cx + 126 * s, foot[1] + 20 * s), n=3, seed=seed + 8),
    ]


def cat(cx, cy, s=1.0, seed=193):
    """Walking away, tail up, entirely unbothered. Drawn facing out of frame
    because the joke is that it has already moved on."""
    return [
        line((cx, cy - 6 * s), (cx + 120 * s, cy - 16 * s), n=6, seed=seed),      # back
        line((cx + 120 * s, cy - 16 * s), (cx + 112 * s, cy + 32 * s), seed=seed + 1),
        line((cx + 112 * s, cy + 32 * s), (cx + 12 * s, cy + 34 * s), n=6, seed=seed + 2),
        line((cx + 12 * s, cy + 34 * s), (cx, cy - 6 * s), seed=seed + 3),
        line((cx + 24 * s, cy + 34 * s), (cx + 20 * s, cy + 78 * s), seed=seed + 4),
        line((cx + 54 * s, cy + 34 * s), (cx + 58 * s, cy + 78 * s), seed=seed + 5),
        line((cx + 92 * s, cy + 33 * s), (cx + 96 * s, cy + 78 * s), seed=seed + 6),
        circle(cx + 148 * s, cy - 28 * s, 30 * s, seed=seed + 7),
        line((cx + 128 * s, cy - 48 * s), (cx + 136 * s, cy - 70 * s), n=2, seed=seed + 8),
        line((cx + 158 * s, cy - 70 * s), (cx + 168 * s, cy - 48 * s), n=2, seed=seed + 9),
        wobble([(cx - 4 * s - 26 * s * math.sin(i / 7), cy - 10 * s - 66 * s * i / 8)
                for i in range(9)], amp=1.6, seed=seed + 10),                     # tail
    ]


def coin(cx, cy, r, seed=157):
    """Two circles, because one circle is a ball and two are a coin."""
    return [circle(cx, cy, r, seed=seed), circle(cx, cy, r * 0.82, seed=seed + 1)]


def pie(cx, cy, r, frac, seed=163):
    """A circle with a wedge cut out and hatched. The wedge is the share; the
    circle is the price nobody has told you yet."""
    a0, a1 = -math.pi / 2, -math.pi / 2 + 2 * math.pi * frac
    edge = [circle(cx, cy, r, seed=seed),
            line((cx, cy), (cx + r * math.cos(a0), cy + r * math.sin(a0)), seed=seed + 1),
            line((cx, cy), (cx + r * math.cos(a1), cy + r * math.sin(a1)), seed=seed + 2)]
    for i in range(1, 5):                       # hatching inside the wedge
        a = a0 + (a1 - a0) * i / 5
        edge.append(line((cx, cy), (cx + r * 0.92 * math.cos(a), cy + r * 0.92 * math.sin(a)),
                         n=4, seed=seed + 3 + i))
    return edge


def bee(cx, cy, s=1.0, seed=197):
    """Striped body, two wings, a stinger, and a looping flight path behind it
    so it reads as a bee in motion rather than a striped oval."""
    return (ellipse(cx, cy, 44 * s, 28 * s, seed=seed)
            + ellipse(cx - 8 * s, cy - 48 * s, 20 * s, 26 * s, seed=seed + 3)
            + ellipse(cx + 16 * s, cy - 44 * s, 18 * s, 24 * s, seed=seed + 4)) + [
            line((cx - 12 * s, cy - 26 * s), (cx - 12 * s, cy + 26 * s), n=3, seed=seed + 1),
            line((cx + 10 * s, cy - 26 * s), (cx + 10 * s, cy + 26 * s), n=3, seed=seed + 2),
            line((cx - 44 * s, cy), (cx - 70 * s, cy + 6 * s), n=2, seed=seed + 5),
            # The trail leaves from behind the bee and never crosses it.
            wobble([(cx + 70 * s + 9 * s * t, cy - 6 * s * t + 22 * s * math.sin(t * 0.9))
                    for t in range(0, 13)], amp=1.5, seed=seed + 6)]


def swollen_hand(x, y, r=40, seed=211):
    """A balloon of a hand with throb marks. Placed at the end of a person()'s
    arm: for person(cx, top, s) the right hand is at (cx + 74s, top + 224s)."""
    return [circle(x, y, r, seed=seed)] + [
        line((x + (r + 12) * math.cos(a), y + (r + 12) * math.sin(a)),
             (x + (r + 34) * math.cos(a), y + (r + 34) * math.sin(a)), n=2, seed=seed + i + 1)
        for i, a in enumerate((-1.2, -0.4, 0.4))]


def clock(cx, cy, r, seed=223):
    """Face, twelve ticks, two hands. A clock rather than a calendar because
    the point is 'later', not a date."""
    strokes = [circle(cx, cy, r, seed=seed)]
    for i in range(12):
        a = i * math.pi / 6
        k = 0.78 if i % 3 else 0.68
        strokes.append(line((cx + r * k * math.cos(a), cy + r * k * math.sin(a)),
                            (cx + r * 0.9 * math.cos(a), cy + r * 0.9 * math.sin(a)), n=2, seed=seed + i + 1))
    strokes.append(line((cx, cy), (cx, cy - r * 0.6), n=4, seed=seed + 20))
    strokes.append(line((cx, cy), (cx + r * 0.45, cy + r * 0.2), n=4, seed=seed + 21))
    return strokes


def bump(x, y, r=22, seed=257):
    """A lump on the head, with the little stars that say it hurt."""
    strokes = [circle(x, y, r, seed=seed)]
    for i, (dx, dy) in enumerate(((r * 2.4, -r * 1.2), (r * 3.4, r * 0.4), (r * 1.2, -r * 2.6))):
        cx, cy, k = x + dx, y + dy, r * 0.45
        strokes += [line((cx - k, cy), (cx + k, cy), n=2, seed=seed + 2 * i + 1),
                    line((cx, cy - k), (cx, cy + k), n=2, seed=seed + 2 * i + 2)]
    return strokes


def glass_door(x0, y0, w, h, seed=271):
    """A frame with two shine marks and nothing else, because the joke is that
    there is nothing there to see."""
    return box(x0, y0, x0 + w, y0 + h, seed=seed) + [
        line((x0 + w * 0.2, y0 + h * 0.3), (x0 + w * 0.45, y0 + h * 0.12), n=3, seed=seed + 4),
        line((x0 + w * 0.3, y0 + h * 0.36), (x0 + w * 0.55, y0 + h * 0.18), n=3, seed=seed + 5)]


def doc(x0, y0, x1, y1, rows=3, seed=281):
    """A sheet with unreadable body lines: paper, not a particular form."""
    strokes = box(x0, y0, x1, y1, seed=seed)
    for i in range(rows):
        yy = y0 + (y1 - y0) * (i + 1) / (rows + 1)
        strokes.append(line((x0 + 40, yy), (x0 + (x1 - x0 - 80) * (0.95 - 0.12 * i) + 40, yy),
                            n=6, seed=seed + 4 + i))
    return strokes


def person_sling(cx, top, s=1.0, seed=401):
    """Arm across the chest, held in a triangle of cloth slung from the neck.
    The triangle is what makes it a sling: a bent arm on its own reads as a
    wave."""
    r = 46 * s
    hy = top + r
    neck = (cx, hy + r)
    sh = (cx, hy + r + 46 * s)
    hip = (cx, hy + r + 150 * s)
    elbow = (cx + 56 * s, hy + r + 94 * s)
    wrist = (cx - 34 * s, hy + r + 104 * s)
    low = (cx + 6 * s, hy + r + 158 * s)
    return [circle(cx, hy, r, seed=seed),
            line(neck, hip, seed=seed + 1),
            line(sh, (cx - 74 * s, sh[1] + 86 * s), seed=seed + 2),   # good arm
            line(sh, elbow, seed=seed + 3),                            # upper arm
            line(elbow, wrist, seed=seed + 4),                         # forearm, across
            line(wrist, low, n=4, seed=seed + 5),                      # cloth
            line(low, elbow, n=4, seed=seed + 6),
            line((cx - 12 * s, neck[1] + 6 * s), elbow, n=5, seed=seed + 7),  # strap
            line(hip, (cx - 66 * s, hip[1] + 128 * s), seed=seed + 8),
            line(hip, (cx + 66 * s, hip[1] + 128 * s), seed=seed + 9)]


def ladder(x0, y0, w, h, rungs=4, seed=409):
    return [line((x0, y0), (x0 + 18, y0 + h), seed=seed),
            line((x0 + w, y0), (x0 + w + 18, y0 + h), seed=seed + 1)] + [
        line((x0 + 9 * (i + 1) / rungs, y0 + h * (i + 1) / (rungs + 1)),
             (x0 + w + 9 * (i + 1) / rungs, y0 + h * (i + 1) / (rungs + 1)), n=4, seed=seed + i + 2)
        for i in range(rungs)]


def bubble(x0, y0, w, h, seed=419):
    """A speech bubble with a tail, for words that are meant to be said out
    loud rather than read."""
    return box(x0, y0, x0 + w, y0 + h, seed=seed) + [
        line((x0 + 60, y0 + h), (x0 + 30, y0 + h + 54), n=3, seed=seed + 4),
        line((x0 + 30, y0 + h + 54), (x0 + 130, y0 + h), n=3, seed=seed + 5)]


def finger(x, y, w, h, seed=457):
    """A fingertip pointing up: two straight sides, a domed end, a knuckle
    crease, and the splinter in it. Drawn as separate strokes so the pen lifts
    where a hand's would."""
    arc = wobble([(x + w / 2 - (w / 2) * math.cos(i * math.pi / 14),
                   y + (w / 2) - (w / 2) * math.sin(i * math.pi / 14) * 1.15)
                  for i in range(15)], amp=1.8, seed=seed)
    return [arc,
            line((x, y + w / 2), (x, y + h), seed=seed + 1),
            line((x + w, y + w / 2), (x + w, y + h), seed=seed + 2),
            line((x + 8, y + h * 0.82), (x + w - 8, y + h * 0.82), n=4, seed=seed + 3),
            line((x + w * 0.30, y + h * 0.46), (x + w * 0.78, y + h * 0.12), n=3, seed=seed + 4)]


def tweezers(x, y, s=1.0, seed=463):
    """Two arms pinched to a point at the bottom and splayed at the top, with
    the cross-piece that says tweezers rather than needle."""
    return [line((x, y + 170 * s), (x - 46 * s, y), n=4, seed=seed),
            line((x + 8 * s, y + 170 * s), (x + 54 * s, y), n=4, seed=seed + 1),
            line((x - 46 * s, y + 24 * s), (x + 54 * s, y + 24 * s), n=3, seed=seed + 2)]


def bar(x0, y0, w, h, seed=467):
    """One bar of a chart, drawn to scale. The scale is the argument."""
    return box(x0, y0, x0 + w, y0 + h, seed=seed)


def bandaid(x, y, w, h, seed=487):
    """A plaster: rounded ends, a pad in the middle, and the little holes in it.
    Drawn flat-on, because a bandaid at an angle reads as a sticking plaster in
    mid-air."""
    r = h / 2
    ends = [wobble([(x + r + r * math.cos(a), y + r + r * math.sin(a))
                    for a in [math.pi / 2 + i * math.pi / 10 for i in range(11)]], amp=1.6, seed=seed),
            wobble([(x + w - r + r * math.cos(a), y + r + r * math.sin(a))
                    for a in [-math.pi / 2 + i * math.pi / 10 for i in range(11)]], amp=1.6, seed=seed + 1)]
    sides = [line((x + r, y), (x + w - r, y), seed=seed + 2),
             line((x + r, y + h), (x + w - r, y + h), seed=seed + 3)]
    pad = box(x + w * 0.34, y + h * 0.18, x + w * 0.66, y + h * 0.82, seed=seed + 4)
    holes = [circle(x + w * (0.40 + 0.07 * i), y + h * f, 3.5, n=8, seed=seed + 8 + i)
             for i in range(4) for f in (0.34, 0.66)]
    return ends + sides + pad + holes


def car(x0, y0, w, h, seed=491):
    """A car from the side, with the price sticker still on the window. The
    sticker is the point, so it is drawn last and it is the only square thing
    on a drawing made of curves."""
    body = wobble([(x0, y0 + h), (x0, y0 + h * 0.58), (x0 + w * 0.20, y0 + h * 0.56),
                   (x0 + w * 0.34, y0 + h * 0.06), (x0 + w * 0.64, y0 + h * 0.06),
                   (x0 + w * 0.80, y0 + h * 0.56), (x0 + w, y0 + h * 0.60),
                   (x0 + w, y0 + h)], amp=2.0, seed=seed)
    wheels = [circle(x0 + w * 0.26, y0 + h, h * 0.17, seed=seed + 1),
              circle(x0 + w * 0.76, y0 + h, h * 0.17, seed=seed + 2)]
    window = [line((x0 + w * 0.36, y0 + h * 0.14), (x0 + w * 0.60, y0 + h * 0.14), n=4, seed=seed + 3),
              line((x0 + w * 0.36, y0 + h * 0.14), (x0 + w * 0.26, y0 + h * 0.52), n=3, seed=seed + 4),
              line((x0 + w * 0.60, y0 + h * 0.14), (x0 + w * 0.70, y0 + h * 0.52), n=3, seed=seed + 5)]
    sticker = box(x0 + w * 0.40, y0 + h * 0.20, x0 + w * 0.58, y0 + h * 0.46, seed=seed + 6)
    return [body] + wheels + window + sticker



def tick(x, y, s=1.0, seed=503):
    """A check mark: short down-stroke, long up-stroke, drawn as one."""
    return [wobble([(x, y + 22 * s), (x + 18 * s, y + 42 * s), (x + 52 * s, y - 16 * s)],
                   amp=1.6, seed=seed)]


def person_wrapped(cx, top, s=1.0, seed=541):
    """Bandaged head to toe. The wrapping has to be DENSE to read at phone size:
    a first pass drew three faint strokes and the figure looked unhurt."""
    r = 46 * s
    hy = top + r
    sh = (cx, hy + r + 46 * s)
    hip = (cx, hy + r + 150 * s)
    arms = [(cx - 74 * s, sh[1] + 86 * s), (cx + 74 * s, sh[1] + 86 * s)]
    legs = [(cx - 66 * s, hip[1] + 128 * s), (cx + 66 * s, hip[1] + 128 * s)]
    st = [circle(cx, hy, r, seed=seed), line((cx, hy + r), hip, seed=seed + 1),
          line(sh, arms[0], seed=seed + 2), line(sh, arms[1], seed=seed + 3),
          line(hip, legs[0], seed=seed + 4), line(hip, legs[1], seed=seed + 5)]
    for i, f in enumerate((-0.5, -0.15, 0.2, 0.55)):          # head, wrapped over
        y = hy + r * f
        dx = r * math.sqrt(max(0.0, 1 - f * f)) * 0.99
        st.append(line((cx - dx, y - 5 * s), (cx + dx, y + 5 * s), n=3, seed=seed + 6 + i))
    for i in range(5):                                        # body
        y = (hy + r) + (hip[1] - hy - r) * (0.12 + 0.19 * i)
        st.append(line((cx - 34 * s, y - 4 * s), (cx + 34 * s, y + 6 * s), n=3, seed=seed + 12 + i))
    for i, (ax, ay) in enumerate(arms + legs):                # limbs, twice each
        ox, oy = (cx, sh[1]) if i < 2 else (cx, hip[1])
        for k, f in enumerate((0.35, 0.72)):
            mx, my = ox + (ax - ox) * f, oy + (ay - oy) * f
            st.append(line((mx - 20 * s, my - 12 * s), (mx + 20 * s, my + 12 * s),
                           n=3, seed=seed + 20 + 2 * i + k))
    return st



def ice(x, y, w, seed=79):
    """A patch of it. The short marks underneath are what stop the long line
    reading as the ground."""
    return [wobble([(x + w * i / 24, y + 7 * math.sin(i * 1.1)) for i in range(25)],
                   amp=2.4, seed=seed)] + [
        line((x + w * f, y + 18), (x + w * f + 26, y + 46), n=3, seed=seed + i + 1)
        for i, f in enumerate((0.18, 0.46, 0.74))]


def bucket(x0, y0, w, h, seed=83):
    """Wider at the top, so it reads as a bucket rather than a box."""
    inset = w * 0.13
    return [line((x0, y0), (x0 + w, y0), n=7, seed=seed),
            line((x0, y0), (x0 + inset, y0 + h), n=7, seed=seed + 1),
            line((x0 + w, y0), (x0 + w - inset, y0 + h), n=7, seed=seed + 2),
            line((x0 + inset, y0 + h), (x0 + w - inset, y0 + h), n=6, seed=seed + 3)]


def bucket_fill(x0, y0, w, h, frac, seed=89):
    """Hatching inside the bucket, ordered bottom to top — so the ordinary
    stroke reveal fills it up, with no new kind of element."""
    inset, rows = w * 0.13, []
    y = y0 + h - 22
    while y > y0 + h * (1 - frac):
        t = (y - y0) / h
        rows.append(line((x0 + inset * t + 14, y), (x0 + w - inset * t - 14, y),
                         n=6, seed=seed + len(rows)))
        y -= 30
    return rows


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


def Spin(strokes, pivot, deg=180, drains=None):
    """Art that turns. The bucket being emptied is the same bucket, so it is the
    same strokes rotated — not a second drawing of an upside-down one.

    `drains` is (x0, y0, w, h, frac): a fill level that empties as it turns.
    Without it the bucket ends upside down with its contents still drawn inside,
    which flatly contradicts the money falling out of it.
    """
    return {"kind": "spin", "strokes": strokes, "pivot": pivot, "deg": deg,
            "drains": drains}


def Coins(items, dy=200):
    """Dollar signs falling out of something. One element rather than one per
    sign, so they fall together instead of taking turns."""
    return {"kind": "coins", "items": items, "dy": dy}


def Sheet(x0, y0, w, h, text, colour=INK, rise=300):
    """A page sliding up out of an envelope. Not a reveal — the paper is already
    drawn, it moves. White-filled so it covers the envelope it comes out of."""
    return {"kind": "sheet", "box": (x0, y0, x0 + w, y0 + h), "rise": rise,
            "text": text, "colour": colour}


ART = {"short-01-two-numbers": {
    # v2 reads top to bottom. v1 ran left to right across the board, so the
    # camera swung sideways, then down, then sideways again; one direction is
    # easier to follow on a phone.
    "hook-cold-open": [S(person(620, 150)), T((740, 300), "you", 72, GREY)],
    # Why this is you at 2 a.m.: you feel terrible. v1 said the time and left
    # the viewer to guess what had happened.
    "d2": [T((820, 860), "2 a.m.", 86), S(person_hurt(640, 800)),
           S(squiggle(540, 745, 130), squiggle(700, 745, 130))],
    "d3": [S(arrow((680, 1170), (680, 1310))), S(hospital(520, 1400, 320, 270)),
           T((545, 1690), "urgent care", 66)],
    "d4": [S(envelope(180, 2150, 420, 260)), S(envelope(760, 2150, 420, 260))],
    # Round numbers on purpose. The real fixtures say $845.00 and $186.35 and
    # the whole product is built on those, but nobody holds two decimal places
    # in their head off a feed, and this drawing is illustrating the shape of
    # the problem, not quoting a document.
    "d5": [Sheet(215, 1910, 350, 310, "$800", ACCENT),
           Sheet(795, 1910, 350, 310, "$150", INK)],
    "d6": [T((450, 2460), "$650 apart", 104, ACCENT),
           S([line((450, 2585), (930, 2585), n=10, seed=44)], colour=ACCENT, width=8)],
    # Which envelope is which: the question a beginner actually has. The answer
    # is who sent it, so the labels go under the papers they belong to.
    # The jargon goes under the plain word, not instead of it.
    "d7": [T((225, 2690), "the bill", 84), T((205, 2790), "itemized statement", 54, GREY)],
    "d8": [T((790, 2690), "NOT a bill", 84),
           T((730, 2790), "Explanation of Benefits", 54, GREY)],
    "d9": [S(ellipse(970, 2118, 140, 74), colour=ACCENT, width=8)],
    "d10": [S(phone(430, 2920, 210, 340)), T((700, 3040), "call first", 84)],
    "d11": [T((300, 3360), "useclaimright.com", 100, ACCENT),
            S([line((300, 3490), (1160, 3490), n=14, seed=71)], colour=ACCENT, width=8)],
}, "short-02-january": {
    # The date goes above the figure, not beside it: side by side the pair is
    # wide and short, and a wide-and-short shot in a 9:16 frame is mostly white.
    "hook-ice": [T((170, 340), "1 JANUARY", 96), S(person_down(200, 640)),
                 S(ice(120, 760, 520))],
    # v2 opens on the confusion itself: the same visit, two prices. v1 made the
    # viewer carry November in their head for thirty seconds before this landed.
    "g1": [S(box(160, 1000, 600, 1330, seed=95)), T((190, 1025), "NOVEMBER", 50, GREY),
           T((190, 1095), "you pay", 50, GREY), T((190, 1160), "$100", 110),
           S(box(820, 1000, 1260, 1330, seed=97)), T((850, 1025), "JANUARY", 50, GREY),
           T((850, 1095), "you pay", 50, GREY), T((850, 1160), "$400", 110, ACCENT)],
    "g2": [S(ellipse(982, 1232, 175, 88), colour=ACCENT, width=8)],
    # Named straight after the question, defined in the same breath.
    "g3": [T((330, 1470), "deductible", 110),
           S([line((330, 1610), (830, 1610), n=12, seed=113)], width=8),
           T((330, 1650), "what you pay yourself", 54, GREY),
           T((330, 1725), "before insurance helps", 54, GREY)],
    "g4": [S(bucket(220, 1930, 380, 420)), T((238, 1830), "$1,000", 80)],
    "g5": [S(bucket_fill(220, 1930, 380, 420, 0.86)),
           T((250, 2400), "full by November", 54, GREY),
           T((250, 2480), "insurance pays most", 54, GREY)],
    # The same bucket, turned over: the same strokes rotated, with the money
    # falling out, because a whiteboard cannot un-draw.
    "g6": [T((980, 1790), "1 JANUARY", 66, ACCENT), S(arrow((650, 2110), (890, 2110))),
           Spin(bucket(950, 1900, 380, 420, seed=101), (1140, 2110),
                drains=(950, 1900, 380, 420, 0.86)),
           Coins([(1120, 2335, 86), (1210, 2365, 86), (1300, 2335, 86),
                  (1388, 2370, 86)], dy=150)],
    # The arrow back to the full bucket is "until it fills back up" -- and it
    # widens the shot, which otherwise cut the full bucket in half on the one
    # line that compares the two.
    "g7": [T((840, 2640), "empty: you pay it all", 62, ACCENT),
           S(arrow((1080, 2580), (300, 2580), seed=121), colour=GREY, width=5)],
    "g8": [T((330, 2750), "useclaimright.com", 96, ACCENT),
           S([line((330, 2875), (1160, 2875), n=14, seed=119)], colour=ACCENT, width=8)],
}, "short-03-copay": {
    # The 20% goes down FIRST. Beat time is shared by stroke length, and the
    # hopping figure is much the longest element — drawn first it ate three of
    # the hook's four seconds, so the one image worth seeing arrived last.
    "hook-cat": [S(person_hop(300, 420)), S(cat(640, 830))],
    # Left column: the visit, which has a price you were told in advance.
    "f2": [S(coin(430, 1180, 108)), T((355, 1140), "$30", 76),
           T((300, 1360), "copay", 84), T((300, 1460), "a price", 52, GREY)],
    # Right column: the scan, which has a percentage of something unstated.
    "f3": [S([line((800, 1030), (800, 1680), n=12, seed=167)], colour=GREY, width=5),
           T((1010, 1040), "20%", 118, ACCENT), T((1020, 1170), "of what?", 58, GREY)],
    "f4": [S(pie(1180, 1390, 92, 0.2)), T((930, 1510), "coinsurance", 80),
           T((930, 1605), "a share of ???", 50, GREY)],
    "f5": [S(box(200, 1720, 700, 1970, seed=173)),
           T((230, 1750), "X-ray $400", 54, GREY), T((230, 1840), "you $80", 80)],
    "f6": [S(box(880, 1720, 1380, 1970, seed=179)),
           T((910, 1750), "MRI $2,000", 54, GREY),
           T((910, 1840), "you $400", 80, ACCENT)],
    "f7": [T((560, 2050), "same 20%", 78)],
    # The plan document, where both answers are actually printed — and where the
    # two halves of this one visit land in different rows.
    "f8": [S(box(400, 2190, 1200, 2480, seed=181)),
           T((430, 2220), "your plan says", 50, GREY),
           T((430, 2310), "office visit", 54, GREY), T((880, 2310), "$30", 54),
           T((430, 2400), "scans", 54, GREY), T((880, 2400), "20%", 54)],
    "f9": [T((330, 2640), "useclaimright.com", 96, ACCENT),
           S([line((330, 2770), (1160, 2770), n=14, seed=191)], colour=ACCENT, width=8)],
}, "short-04-never-seen": {
    # One column, top to bottom. The two lists are the one place things sit
    # side by side, because they are being compared.
    # Kept narrow: the shot is set by width, so a bee far off to the side
    # shrinks the figure and the joke with it.
    "hook-bee": [S(person(520, 150, s=1.5)), S(swollen_hand(631, 486, r=62)),
                 S(bee(800, 230, s=1.4)), T((390, 740), "your doctor", 76, GREY)],
    # The surprise, second line: three rows against two. The gap in the letter
    # sits level with the shot, so the missing row is visible before it is said.
    "h2": [T((180, 920), "the bill", 66), S(box(160, 1010, 700, 1410, seed=227)),
           T((200, 1070), "visit", 60, GREY), T((200, 1170), "shot $100", 64),
           T((200, 1290), "bandage", 60, GREY),
           T((920, 920), "insurance letter", 66), S(box(900, 1010, 1440, 1410, seed=229)),
           T((940, 1070), "visit", 60, GREY), T((940, 1290), "bandage", 60, GREY)],
    "h3": [S(ellipse(370, 1208, 215, 62), colour=ACCENT, width=8),
           T((1130, 1150), "?", 120, ACCENT)],
    "h4": [T((380, 1520), "pending", 130),
           S([line((380, 1680), (880, 1680), n=12, seed=233)], width=8),
           T((380, 1720), "not finished yet", 58, GREY)],
    "h5": [S(clock(640, 2030, 170)), T((880, 1990), "weeks", 80, GREY)],
    "h6": [S(envelope(560, 2590, 480, 280, seed=239)),
           Sheet(615, 2300, 370, 310, "shot $100", INK),
           T((440, 2910), "don't pay it yet", 72, ACCENT)],
    "h7": [S(phone(300, 3070, 210, 340, seed=241)),
           T((580, 3140), "has this been sent", 60),
           T((580, 3220), "to my insurance?", 60)],
    "h8": [T((300, 3490), "useclaimright.com", 100, ACCENT),
           S([line((300, 3620), (1160, 3620), n=14, seed=251)], colour=ACCENT, width=8)],
}, "short-11-sbc": {
    # The toe is the swollen_hand shape at the end of a leg: for person(cx,
    # top, s) the right foot is at (cx + 66s, top + 370s).
    "hook-toe": [S(person(700, 150, s=1.5)), S(swollen_hand(799, 705, r=34, seed=291)),
                 T((880, 170), "$?", 120, ACCENT)],
    "i2": [S(doc(420, 880, 980, 1260, seed=293)), T((1010, 1040), "never opened", 58, GREY)],
    # Named in the third line, at about ten seconds.
    "i3": [T((520, 1330), "SBC", 150),
           T((330, 1540), "Summary of Benefits", 62, GREY),
           T((330, 1620), "and Coverage", 62, GREY)],
    # Side by side because they are being compared: two plans, one layout.
    "i4": [S(doc(300, 1790, 640, 2090, seed=301)), S(doc(900, 1790, 1240, 2090, seed=301)),
           T((360, 2110), "plan A", 54, GREY), T((960, 2110), "plan B", 54, GREY),
           T((560, 2200), "same layout", 70)],
    "i5": [S(box(300, 2340, 1300, 2660, seed=307)),
           T((400, 2380), "office visit", 62, GREY), T((1010, 2375), "$30", 72),
           S([line((320, 2500), (1280, 2500), n=10, seed=311)], colour=GREY, width=4)],
    "i6": [T((400, 2540), "X-ray", 62, GREY), T((1010, 2535), "20%", 72, ACCENT),
           S(ellipse(800, 2583, 470, 60, seed=313), colour=ACCENT, width=8)],
    "i7": [S(phone(420, 2760, 210, 340, seed=317)),
           T((690, 2840), "insurer website", 58), T((690, 2920), "your plan, SBC", 58, GREY)],
    "i8": [T((330, 3170), "then check the bill", 76)],
    "i9": [T((300, 3360), "useclaimright.com", 100, ACCENT),
           S([line((300, 3490), (1160, 3490), n=14, seed=319)], colour=ACCENT, width=8)],
}, "short-12-claim": {
    "hook-door": [S(glass_door(860, 120, 340, 620)), S(person(560, 150, s=1.5)),
                  S(bump(620, 150))],
    # Three sheets, the first in grey with a question mark: the one you never see.
    "j2": [S(doc(200, 880, 520, 1180, seed=331), colour=GREY), T((320, 970), "?", 120, GREY),
           S(doc(640, 880, 960, 1180, seed=337)), S(doc(1080, 880, 1400, 1180, seed=341))],
    # From here the paper moves down the board in the order it travels.
    "j3": [S(hospital(650, 1370, 300, 230, seed=347)), T((620, 1620), "doctor's office", 56, GREY),
           S(arrow((800, 1710), (800, 1810), seed=353)),
           S(box(600, 1840, 1000, 2100, seed=359), colour=GREY),
           T((640, 1870), "CLAIM", 74, GREY),
           S(arrow((800, 2130), (800, 2230), seed=361)), T((610, 2250), "insurance", 84)],
    "j4": [T((640, 1975), "codes, prices", 52, GREY)],
    "j5": [S(arrow((800, 2370), (800, 2470), seed=367)), S(box(560, 2500, 1040, 2760, seed=371)),
           T((600, 2530), "EOB", 76), T((600, 2640), "the answer", 56, GREY)],
    "j6": [S(arrow((800, 2790), (800, 2890), seed=373)), S(box(560, 2920, 1040, 3160, seed=379)),
           T((600, 2950), "BILL", 76), T((600, 3060), "your part", 56, GREY)],
    # The arrows already show the order, so this line draws where to see your
    # own claims rather than restating it.
    "j7": [S(phone(330, 3210, 180, 290, seed=389)),
           T((570, 3250), "insurer website", 70), T((570, 3340), "Claims", 80, ACCENT)],
    "j8": [T((300, 3540), "useclaimright.com", 100, ACCENT),
           S([line((300, 3670), (1160, 3670), n=14, seed=383)], colour=ACCENT, width=8)],
}, "short-05-phone-call": {
    "hook-sling": [S(ladder(300, 180, 150, 520)), S(person_sling(760, 240, s=1.4)),
                   T((980, 300), "ouch", 70, GREY)],
    # A beat of its own, so the fall and the sling are not fighting the
    # paperwork for the same four seconds.
    "k2": [S(hospital(660, 900, 300, 230, seed=443)), T((640, 1160), "the clinic", 62, GREY)],
    # The series' image for paperwork arriving, as in Short 1: envelopes first,
    # then the pages slide out of them.
    "k3": [S(envelope(200, 1560, 420, 260, seed=447)), S(envelope(760, 1560, 420, 260, seed=449))],
    "k4": [Sheet(255, 1320, 350, 310, "$400", INK), T((215, 1870), "your EOB", 56, GREY),
           T((215, 1950), "allowed", 56, GREY)],
    "k5": [Sheet(815, 1320, 350, 310, "$1,000", ACCENT),
           T((790, 1870), "the clinic's bill", 56, GREY)],
    "k6": [T((280, 2090), "balance billing", 120),
           S([line((280, 2240), (1180, 2240), n=14, seed=421)], width=8),
           T((280, 2280), "in network: not allowed", 62, ACCENT)],
    "k7": [S(arrow((690, 2420), (870, 2420), seed=431)), T((600, 2470), "$600", 110, ACCENT),
           T((420, 2600), "the network discount", 62, GREY)],
    "k8": [T((430, 2720), "comes off the bill", 74),
           T((430, 2810), "not on to you", 74, ACCENT)],
    "k9": [S(phone(260, 2960, 200, 330, seed=433))],
    # The payload: the words to say, big enough to read off a phone screen.
    "k10": [S(bubble(540, 2930, 940, 420)),
            T((580, 2970), "I'm in network.", 66),
            T((580, 3070), "My EOB says what I owe.", 66),
            T((580, 3170), "Please correct the balance.", 66),
            T((560, 3440), "out of network, the rules differ", 56, GREY)],
    # Drawn, not left to the description: this Short tells someone not to pay.
    "k11": [T((300, 3540), "general information,", 60, GREY),
            T((300, 3620), "not legal or medical advice", 60, GREY),
            T((300, 3740), "useclaimright.com", 100, ACCENT),
            S([line((300, 3870), (1160, 3870), n=14, seed=439)], colour=ACCENT, width=8)],
}, "short-06-sticker-price": {
    # The joke is the gap between the treatment and the number: a splinter, a
    # bandaid, and $2,000. Nothing else is in the first shot.
    "hook-splinter": [S(finger(300, 320, 190, 400)), S(bandaid(276, 470, 238, 96)),
                      S(tweezers(600, 170, s=1.3)), T((760, 330), "$2,000", 150, ACCENT)],
    "m2": [T((760, 560), "nobody pays this", 66, GREY),
           S([line((740, 420), (1280, 396), n=8, seed=471)], colour=ACCENT, width=8)],
    # Three bars to scale: 1000px, 150px, 30px. The lengths are the argument.
    "m3": [T((250, 860), "billed", 58, GREY), S(bar(250, 930, 1000, 90)),
           T((250, 1040), "$2,000", 76),
           T((250, 1210), "allowed", 58, GREY), S(bar(250, 1280, 150, 90)),
           T((440, 1295), "$300", 76),
           # The condition belongs with the number, not in a footnote.
           T((640, 1310), "in network", 56, ACCENT)],
    "m4": [T((250, 1470), "the allowed amount", 104),
           S([line((250, 1620), (1230, 1620), n=14, seed=473)], width=8),
           T((250, 1660), "the only real number", 58, ACCENT)],
    "m5": [T((250, 1820), "sticker price", 96),
           T((250, 1950), "there so there is something to discount", 54, GREY)],
    # The analogy lands on its own image, straight after the definition.
    # The analogy gets its own image, straight after the definition.
    "m6": [S(car(260, 2100, 620, 330)), T((940, 2180), "sticker price", 66),
           T((940, 2270), "on a car", 66),
           T((940, 2380), "nobody pays it", 56, GREY)],
    "m7": [T((260, 2540), "your insurance", 74),
           T((260, 2640), "negotiated it", 74),
           T((260, 2760), "years before you walked in", 54, GREY)],
    "m8": [T((250, 2920), "your share", 58, GREY), S(bar(250, 2990, 30, 90)),
           T((330, 3005), "$60", 76, ACCENT),
           # The percentage is the coinsurance; the dollars are your share. Writing
           # the arithmetic out stops the label reading as a name for the $60.
           T((250, 3120), "20% coinsurance", 56, GREY),
           T((250, 3190), "of the $300 allowed, not the $2,000 billed", 56, GREY)],
    "m9": [T((250, 3340), "read the letter", 90),
           T((250, 3450), "before you panic", 90),
           T((250, 3570), "out of network, the rules differ", 54, GREY)],
    "m10": [T((300, 3700), "useclaimright.com", 100, ACCENT),
            S([line((300, 3830), (1160, 3830), n=14, seed=479)], colour=ACCENT, width=8)],
}, "short-09-duplicate": {
    # Two people, and the plasters are the evidence: the reason there are two
    # charges is standing right there in the first shot.
    "hook-shots": [S(person(400, 200, s=1.3)), S(bandaid(300, 430, 120, 48)),
                   S(person(820, 330, s=0.95)), S(bandaid(752, 500, 96, 40)),
                   T((1010, 250), "flu shots", 70, GREY)],
    "n2": [S(box(220, 900, 1180, 1280, seed=509)), T((220, 820), "the bill", 58, GREY),
           T((260, 960), "flu vaccine", 62, GREY), T((880, 955), "$40", 70),
           T((260, 1110), "flu vaccine", 62, GREY), T((880, 1105), "$40", 70)],
    "n3": [T((250, 1420), "a duplicate is", 74),
           T((250, 1540), "same person", 66, ACCENT), T((250, 1630), "same day", 66, ACCENT),
           T((250, 1720), "same code", 66, ACCENT), T((250, 1810), "billed twice", 66, ACCENT)],
    # The other half of the lesson: reasons two identical lines are honest.
    "n4": [T((250, 1970), "or a good reason for two", 66),
           T((290, 2080), "two X-rays", 58, GREY),
           T((290, 2160), "one knee each side", 58, GREY),
           T((290, 2240), "a second dose", 58, GREY)],
    "n5": [S(tick(250, 2400)), T((350, 2380), "the name on the line", 62),
           S(tick(250, 2510)), T((350, 2490), "the date", 62),
           S(tick(250, 2620)), T((350, 2600), "a reason for two", 62)],
    "n6": [T((250, 2780), "no reason?", 84), T((250, 2890), "ask about that one", 84, ACCENT)],
    "n7": [S(doc(300, 3060, 1100, 3360, rows=2, seed=521)),
           T((340, 3090), "your EOB", 56, GREY), T((690, 3270), "listed once", 62, ACCENT)],
    "n8": [T((300, 3520), "useclaimright.com", 100, ACCENT),
           S([line((300, 3650), (1160, 3650), n=14, seed=523)], colour=ACCENT, width=8)],
}, "short-10-itemized": {
    # The figure and the bill together: everything that happened, and the one
    # line that is supposed to describe it.
    "hook-bandaged": [S(person_wrapped(430, 170, s=1.55)),
                      S(box(760, 400, 1420, 760, seed=547)),
                      T((800, 440), "the bill", 52, GREY),
                      T((800, 530), "hospital services", 58, GREY),
                      T((800, 630), "$9,000", 104)],
    "o2": [S(ellipse(1090, 580, 330, 150, seed=551), colour=ACCENT, width=8),
           T((820, 830), "nothing here to check", 64, ACCENT)],
    # The same visit, itemised: the list is long on purpose.
    "o3": [T((250, 1020), "ask for the itemized bill", 84),
           S(doc(250, 1130, 1250, 1830, rows=9, seed=557)),
           T((290, 1150), "same visit, every charge, with its code", 52, GREY)],
    "o4": [S(phone(250, 1950, 190, 310, seed=563)),
           S(bubble(500, 1930, 900, 300, seed=569)),
           T((540, 1970), "Please send an itemized", 62),
           T((540, 2060), "statement for this visit.", 62)],
    "o5": [T((250, 2400), "your own record", 74),
           T((250, 2510), "you can ask, usually free", 58, GREY)],
    "o6": [S(doc(250, 2660, 700, 3010, rows=4, seed=571)),
           S(doc(800, 2660, 1250, 3010, rows=4, seed=577)),
           T((250, 3040), "the bill", 54, GREY), T((800, 3040), "your EOB", 54, GREY),
           S(arrow((720, 2830), (780, 2830), seed=587))],
    "o7": [T((250, 3200), "one number tells you nothing", 72),
           T((250, 3300), "a list tells you where to look", 72, ACCENT)],
    "o8": [T((300, 3500), "useclaimright.com", 100, ACCENT),
           S([line((300, 3630), (1160, 3630), n=14, seed=593)], colour=ACCENT, width=8)],
}, "short-13-charity-care": {
    # The number is the shock and the hospital is the setting; no villain in the
    # drawing, because the video is about using a policy, not accusing anyone.
    "hook-stone": [S(person_hurt(420, 200, s=1.3)), S(hospital(880, 300, 340, 260, seed=601)),
                   T((900, 620), "one night", 58, GREY),
                   T((420, 760), "$4,000", 130, ACCENT)],
    "p2": [T((250, 980), "before the payment plan", 72),
           T((250, 1080), "ask one question", 72)],
    "p3": [S(bubble(250, 1220, 1000, 300, seed=607)),
           T((300, 1270), "Does this hospital have a", 62),
           T((300, 1360), "financial assistance policy?", 62)],
    "p4": [T((250, 1680), "nonprofit hospital?", 74),
           T((250, 1790), "it must have one", 66, ACCENT),
           T((250, 1880), "and must say who qualifies", 56, GREY)],
    "p5": [T((250, 2040), "charity care", 104),
           S([line((250, 2180), (900, 2180), n=12, seed=613)], width=8),
           T((250, 2220), "the old name for it", 54, GREY),
           T((250, 2330), "cuts the bill, sometimes clears it", 60, ACCENT)],
    "p6": [T((250, 2490), "goes by household income", 64),
           T((250, 2580), "limits are higher than", 56, GREY),
           T((250, 2650), "people expect", 56, GREY)],
    "p7": [S(phone(250, 2800, 190, 310, seed=617)),
           T((500, 2830), "ask for the policy", 66),
           T((500, 2920), "ask how to apply", 66),
           T((500, 3030), "after the bill arrives is fine", 54, GREY)],
    "p8": [T((300, 3260), "general information,", 54, GREY),
           T((300, 3340), "not legal or medical advice", 54, GREY),
           T((300, 3460), "useclaimright.com", 100, ACCENT),
           S([line((300, 3590), (1160, 3590), n=14, seed=619)], colour=ACCENT, width=8)],
}}

# Beats that pull back to show everything drawn so far, instead of the usual
# two-beat shot. The summary line of a comparison needs both halves of the
# comparison in frame — e7 was cutting off the $40 bill it argues against.
# f4 names coinsurance, which only means anything against the copay beside it,
# so it needs the wide shot as much as the summary does.
FRAME_ALL = {"short-03-copay": {"f4", "f7"}}



def turn(pts, pivot, deg):
    r = math.radians(deg)
    c, sn = math.cos(r), math.sin(r)
    return [(pivot[0] + (x - pivot[0]) * c - (y - pivot[1]) * sn,
             pivot[1] + (x - pivot[0]) * sn + (y - pivot[1]) * c) for x, y in pts]


def extent(el):
    """Bounding box, so the camera knows where the drawing actually is."""
    if el["kind"] == "sheet":
        return el["box"]
    if el["kind"] == "coins":
        xs = [i[0] for i in el["items"]]
        ys = [i[1] for i in el["items"]]
        big = max(i[2] for i in el["items"])
        return (min(xs), min(ys), max(xs) + big, max(ys) + el["dy"] + big * 1.3)
    if el["kind"] == "spin":
        # Both ends of the turn, so the camera does not drift while it rotates.
        pts = [p for st in el["strokes"] for p in st]
        pts += turn(pts, el["pivot"], el["deg"])
        return (min(p[0] for p in pts), min(p[1] for p in pts),
                max(p[0] for p in pts), max(p[1] for p in pts))
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


def check_art():
    """A duplicate key in a dict literal is silently legal — the later one wins
    and the earlier one vanishes. That is exactly what happened when an edit to
    this file was interrupted half-applied, and a whole Short rendered from art
    nobody had written. Counting the keys in the source catches it."""
    src = Path(__file__).read_text()
    block = src[src.index("ART = {"):src.index("FRAME_ALL")]
    seen = set()
    for key in re.findall(r'^    "([^"]+)":', block, re.M):
        if key in seen:
            raise SystemExit(f"whiteboard.py: ART has two entries for {key!r}")
        seen.add(key)


def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def element_len(el):
    if el["kind"] in ("sheet", "spin", "coins"):
        return 300.0                    # a move, not a stroke: give it a beat
    if el["kind"] == "text":
        return ImageDraw.Draw(Image.new("RGB", (1, 1))).textlength(
            el["text"], font=font(el["size"])) * 0.9      # writing is faster than drawing
    return sum(seg_len(s[i], s[i + 1]) for s in el["strokes"] for i in range(len(s) - 1))


def draw_element(im, el, p):
    """Draw the first `p` of an element. Returns the pen position, or None once
    the element is finished (nothing left to hold the marker to)."""
    d = ImageDraw.Draw(im)
    if el["kind"] == "spin":
        e = p * p * (3 - 2 * p)
        strokes = list(el["strokes"])
        if el.get("drains"):
            x0, y0, w, h, frac = el["drains"]
            strokes += bucket_fill(x0, y0, w, h, frac * (1 - e), seed=103)
        for st in strokes:
            d.line(turn(st, el["pivot"], el["deg"] * e), fill=INK, width=PEN_W,
                   joint="curve")
        return None
    if el["kind"] == "coins":
        e = p * p * (3 - 2 * p)
        for x, y, size in el["items"]:
            d.text((x, y + el["dy"] * e), "$", font=font(size), fill=INK)
        return None
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
    check_art()
    folder = next((a for a in sys.argv[1:] if not a.startswith("--")), "short-01-two-numbers")
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
    MARGIN = 900                       # white overhang, so a wide shot near the board edge never shows black
    n, plan, done = 0, [], []          # `done` accumulates: a whiteboard keeps what was drawn
    ends = []                          # last frame of each line, for stills.png
    cam, prev_els = None, []
    for b in beats:
        t = timings[b["id"]]
        steps = int((t["secs"] + b["pad"]) * FPS)
        plan.append((b["id"], 0.0, steps / FPS))
        words = [w for w, _ in t["timing"]]
        starts = [s for _, s in t["timing"]]

        els = ART.get(folder, {}).get(b["id"], [])
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
        wide = b["id"] in FRAME_ALL.get(folder, ())
        shot = (done + els) if wide else (prev_els + els)
        want = frame_box([extent(e) for e in shot] or [(0, 0, BW, BH)],
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
        ends.append(n - 1)
        cam, prev_els = want, els

    wav = dir_ / "audio" / "_track.wav"
    audio_track(dir_, plan, wav)
    out = dir_ / f"{folder.split('-', 2)[-1]}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS),
                    "-i", str(frames / "f%05d.png"), "-i", str(wav),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)], check=True)
    wav.unlink()
    stills(frames, ends, [b["id"] for b in beats], dir_ / "stills.png")
    # The frames are ~100MB a Short and the mp4 is the product; stills.png is
    # what the release checklist actually needs from them.
    if "--keep-frames" not in sys.argv:
        shutil.rmtree(frames)
    print(f"{n} frames · {n / FPS:.1f}s · {out} · {dir_ / 'stills.png'}")


def stills(frames, ends, ids, out, cols=5, tw=270, th=480):
    """The last frame of every line on one sheet. Step 1 of the release
    checklist: clipped text, black edges and half-framed comparisons hide in
    playback and are obvious here."""
    rows = -(-len(ends) // cols)
    sheet = Image.new("RGB", (cols * tw, rows * (th + 36)), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for k, (e, beat) in enumerate(zip(ends, ids)):
        x, y = (k % cols) * tw, (k // cols) * (th + 36)
        sheet.paste(Image.open(frames / f"f{e:05d}.png").resize((tw, th)), (x, y))
        d.text((x + 8, y + th + 6), beat, font=font(24), fill=GREY)
    sheet.save(out)


if __name__ == "__main__":
    main()
