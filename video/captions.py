"""Karaoke captions and the voice track, shared by every Short.

Split out of the retired document renderer, which whiteboard.py used to import
them from.
"""
import wave
from pathlib import Path
from PIL import ImageDraw, ImageFont

W = 1080
INK, MUTE = (26, 32, 36), (150, 160, 168)
CAP_SIZE = 62
CAP_STEP, CAP_LINES = CAP_SIZE + 22, 3

F = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
if not Path(F).exists():
    F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_fonts = {}


def font(size):
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(F, size)
    return _fonts[size]


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


def audio_track(dir_, plan, out):
    """One 24kHz mono track, each line padded to exactly the length its frames
    were counted from, so the drawing and the voice never drift apart."""
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
