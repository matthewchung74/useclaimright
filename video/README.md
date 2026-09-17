# Video scripts

One folder per video, named by its number in `docs/CONTENT.md` — not by shooting
order, which changes. The plan, the audience rules and the adversarial review of
all of it live in that document; this directory holds only what gets said and
what is on screen.

    video/
      channel-setup.md              ← name, handle, description, keywords
      superseded-document-short/
        scripts.md                  ← one body, three hooks, as an experiment
      05-eob-is-not-a-bill/
        script.md                   ← spoken line, screen state, cuts, disclaimer

## Order

**Publish Short 1, then make 2 and 4, then stop and look.** Three, not ten — the
channel is empty, so there is no evidence yet that a drawing holds a swipe any
better than a document did. `docs/CONTENT.md` has the ten and the reasoning.

The format changed on 2026-09-15. It was three-to-five-minute screen recordings
of real documents; it is now 35-45 second whiteboard Shorts, drawn. The short
version of why: a real document is not legible at phone size, and cropping it
until it is destroys the recognition that was the only reason to show it. The
long version, with the frames that made the case, is in `docs/CONTENT.md`.

**The measured position** (`docs/CONTENT.md`) is that YouTube search volume for
this subject is Low by YouTube's own labels, three ways of measuring agree, and
the intent lives on Google instead. Video here is a cheap bet placed alongside a
written page, not instead of one.

## Channel

Not created yet. `channel-setup.md` holds the name, handle, description and
keywords ready to paste — and the reason to create it before making anything,
which is that **YouTube Studio's Research tab is the only free source of real
search-volume figures** and is gated behind having a channel.

## Before shooting anything

~~The premise is unverified.~~ **Measured 2026-09-14 and it did not hold** — see
`docs/CONTENT.md`. Trends, autocomplete and YouTube Studio all report Low volume,
and YouTube does not recognise "explanation of benefits" as an insurance topic at
all. What remains is feed distribution, which is what the Shorts experiment
tests.

## Making one

Three commands, all generated, nothing by hand:

    node video/tts.mjs superseded-document-short      # WAVs, Cloud TTS (en-US-Studio-Q)
    python3 video/align.py superseded-document-short  # measure the word timings, locally
    python3 video/render.py superseded-document-short # every frame, then the mux -> 1-number.mp4

`--variant 2-contradiction` cuts a different hook against the same body. The
whiteboard films the same way, with `whiteboard.py` in place of `render.py`.

**Why there is an alignment step.** The captions need to know when each word
starts. Cloud TTS will tell you directly — an SSML `<mark>` before every word,
timepoints back — but only for Neural2, Wavenet and Standard. Studio voices
reject `<mark>` and Chirp3-HD returns an empty array, and those are the voices
worth listening to. So `tts.mjs` sends marks when the voice takes them and plain
text when it does not, and `align.py` measures the timings afterwards with
whisper.cpp on this machine. Nothing is uploaded; it takes a second or two a
line. It is forced alignment, not transcription — the script is known, so
Whisper's output is matched against it and a misheard word still gets a sensible
time from its neighbours.

    brew install whisper-cpp
    curl -L --create-dirs -o ~/.cache/whisper/ggml-base.en.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

Every body beat is one slide — which document this is, the whole page, the
circled part blown up, the caption:

    THE BILL
    [ the whole page, uncropped, circled where the figure is ]
    [ that same region again, big enough to read on a phone ]
    the word being spoken, in near-black

The page is never cropped to the row being discussed. A strip of table is not a
bill, and the point of showing the document at all is that a viewer recognises
their own paperwork — so the zoom is a second panel rather than a camera move,
and the circle is drawn in both panels at once so the eye connects them.

Everything is driven by `audio/timings.json`: the karaoke highlight, the callout
landing, and the circle closing as the figure is spoken. Rewrite a line and the
frames that carry it change length; nothing else drifts.

Callout edges are snapped to row and column gaps measured with
`pdftotext -bbox`, so nothing is ever sliced mid-character. Change a fixture and
the boxes in `render.py` have to be re-measured. The patient's SSN is painted
out — it is a canary in a fake fixture, but an SSN on screen in a video about
medical bills reads as careless.

## Conventions

**Format.** Screen recording of a document with a cursor. No face. Three to five
minutes. One idea per video.

**Language.** Jargon in the title, because that is what gets searched. Plain
language from the first word spoken. The table of words to avoid is in
`docs/CONTENT.md` — the short version is that if the app's own interface does not
use the word, the soundtrack should not either.

**One number at a time.** Introduce only the figures the video needs, and only
when it needs them.

**What can be filmed.** `/app?sample=1` and anything under `test-fixtures/`
except `private/`. The carrier documents in `test-fixtures/carrier/` can be read
from on screen with attribution but not republished. Nobody's real bill or EOB,
ever, scrubbed or not.

**Recordings are not committed.** Add `.mov`/`.mp4`/`.png` exports to
`.gitignore` rather than the repo — the scripts are the source, the video is a
build artefact.

## Status

| # | Short | Folder | Made | Published |
|---|---|---|---|---|
| 1 | Two numbers — the bill and the letter | `short-01-two-numbers` | ✅ 42.1s (v2) | v2 uploaded, Private (v1 Public, to delete) |
| 2 | The January reset (deductible) | `short-02-january` | ✅ 34.5s (v2) | v2 uploaded, Private (v1 to delete) |
| 3 | Copay or coinsurance | `short-03-copay` | ✅ 42.5s | uploaded, Private |
| 4 | A charge your insurance has never seen | `short-04-never-seen` | ✅ 34.9s | not yet — checklist |
| 5–10 | see `docs/CONTENT.md` | — | — | — |

**`short-NN-` matches the number in `docs/CONTENT.md`.** It briefly did not:
folders were numbered as they were built, so the superseded document version sat
on 01 and pushed everything after it out by one. `superseded-document-short/`
holds that version — the real bill and EOB on screen, three hook variants — kept
because the writing is still good, and `video/render.py` still builds it.

Superseded by the format change, kept because the writing is still good:
`superseded-document-short/` (the document version, three hook variants) and
`05-eob-is-not-a-bill/script.md` (long-form, absorbed into Short 1).
