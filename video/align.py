#!/usr/bin/env python3
"""Replace estimated word timings with measured ones, using local Whisper.

    python3 video/align.py short-01-two-numbers

Rewrites audio/timings.json in place, so the karaoke highlights land on the word
actually being spoken.

Why this exists: the captions need to know when each word starts. Cloud TTS will
tell you directly — put an SSML <mark> before every word and ask for timepoints
back — but ONLY for the Neural2, Wavenet and Standard families. Studio voices
reject <mark> outright and Chirp3-HD returns an empty array, and those are the
voices worth listening to. So for those, the timings are measured after the
fact instead of requested up front.

    brew install whisper-cpp
    curl -L -o ~/.cache/whisper/ggml-base.en.bin \\
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

Runs on the machine, no upload, a couple of seconds a line on Apple Silicon.

This is forced alignment, not transcription: the words are already known. So
Whisper's output is aligned against the script with difflib rather than trusted
as text — a word it mishears still gets a sensible time by interpolation
between its neighbours, and the script is never rewritten by the recogniser.
"""
import json, re, subprocess, sys, tempfile
from difflib import SequenceMatcher
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL = Path.home() / ".cache/whisper/ggml-base.en.bin"


def norm(w):
    return re.sub(r"[^a-z0-9]", "", w.lower())


def heard(wav):
    """[(word, start_seconds)] as Whisper heard them. --max-len 1 with -sow is
    what makes whisper.cpp emit one word per segment instead of one sentence."""
    with tempfile.TemporaryDirectory() as tmp:
        mono = Path(tmp) / "a.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
                        "-ar", "16000", "-ac", "1", str(mono)], check=True)
        subprocess.run(["whisper-cli", "-m", str(MODEL), "-f", str(mono),
                        "--max-len", "1", "-sow", "-oj", "-np",
                        "-of", str(Path(tmp) / "a")], check=True, capture_output=True)
        data = json.loads((Path(tmp) / "a.json").read_text())
    return [(s["text"].strip(), s["offsets"]["from"] / 1000.0)
            for s in data["transcription"] if s["text"].strip()]


def align(words, got, secs):
    """Give every scripted word a start time. Matched words take Whisper's;
    the rest are spread evenly between the matches that bracket them."""
    a, b = [norm(w) for w in words], [norm(w) for _, w in enumerate(x[0] for x in got)]
    times = [None] * len(words)
    for blk in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            times[blk.a + k] = got[blk.b + k][1]

    known = [i for i, t in enumerate(times) if t is not None]
    if not known:
        return [[w, secs * i / len(words)] for i, w in enumerate(words)]
    for i in range(len(times)):
        if times[i] is not None:
            continue
        lo = max([k for k in known if k < i], default=None)
        hi = min([k for k in known if k > i], default=None)
        if lo is None:
            times[i] = times[hi] * i / (hi or 1)
        elif hi is None:
            times[i] = times[lo] + (secs - times[lo]) * (i - lo) / (len(times) - lo)
        else:
            times[i] = times[lo] + (times[hi] - times[lo]) * (i - lo) / (hi - lo)
    # Whisper can hand back a word that starts before the one in front of it.
    for i in range(1, len(times)):
        times[i] = max(times[i], times[i - 1] + 0.02)
    return [[w, round(t, 3)] for w, t in zip(words, times)]


def main():
    if not MODEL.exists():
        sys.exit(f"no model at {MODEL} — see the header of this file")
    folder = next((a for a in sys.argv[1:] if not a.startswith("--")), "short-01-two-numbers")
    audio = HERE / folder / "audio"
    timings = json.loads((audio / "timings.json").read_text())

    for beat, t in timings.items():
        wav = audio / f"{beat}.wav"
        if not wav.exists():
            continue
        words = [w for w, _ in t["timing"]]
        got = heard(wav)
        t["timing"] = align(words, got, t["secs"])
        t["aligned"] = True
        print(f"  {beat:14} {len(got):3} heard / {len(words):3} scripted   "
              f"first word at {t['timing'][0][1]:.2f}s")

    (audio / "timings.json").write_text(json.dumps(timings, indent=1))
    print(f"\n{len(timings)} lines aligned · timings.json rewritten")


if __name__ == "__main__":
    main()
