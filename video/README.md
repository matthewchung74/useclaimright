# Video scripts

One folder per video, named by its number in `docs/CONTENT.md` — not by shooting
order, which changes. The plan, the audience rules and the adversarial review of
all of it live in that document; this directory holds only what gets said and
what is on screen.

    video/
      channel-setup.md              ← name, handle, description, keywords
      shorts-01-two-numbers/
        scripts.md                  ← one body, three hooks, as an experiment
      05-eob-is-not-a-bill/
        script.md                   ← spoken line, screen state, cuts, disclaimer

## Shooting order

**Shorts experiment 1 first, and nothing else until it reports.**

Three thirty-second variants, one afternoon, published a week apart. It answers
whether a document on screen can hold a swipe at all — and if it cannot, the
long-form scripts below are moot and should not be shot.

For long-form after that: **5 → 4 → 1**, and 0a/0b before either if Tier 0 is
made. Not numerical order — video 5 defines the document every other video reads
from, and 4 defines the number they all argue about.

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

    python3 video/shorts-01-two-numbers/scenes.py        # document crops + circle animations
    node video/tts.mjs shorts-01-two-numbers             # eight WAVs, Cloud TTS
    node video/assemble.mjs shorts-01-two-numbers        # -> 1-number.mp4

`--variant 2-contradiction` cuts a different hook against the same body.
`--no-b4` drops the network-contract line, which is the difference between 39.5s
and 30.5s.

Each frame is held for exactly as long as its line takes to say plus a beat, so
rewriting a line changes that frame's length and nothing else drifts.

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

| # | Video | Script | Shot |
|---|---|---|---|
| — | Shorts experiment 1 — three hooks | ✅ draft | — |
| 5 | Your EOB is not a bill — so what is it? | ✅ draft | — |
| 4 | What does "allowed amount" mean on my EOB? | — | — |
| 1 | Your bill says $175, your EOB says $120 | — | — |
| 0a, 0b, 2, 3, 6, 7, 8, 9 | see `docs/CONTENT.md` | — | — |
