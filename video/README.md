# Video scripts

One folder per video, named by its number in `docs/CONTENT.md` — not by shooting
order, which changes. The plan, the audience rules and the adversarial review of
all of it live in that document; this directory holds only what gets said and
what is on screen.

    video/
      05-eob-is-not-a-bill/
        script.md          ← spoken line, screen state, cuts, disclaimer

## Shooting order

**5 → 4 → 1**, and 0a/0b before either if Tier 0 is made. Not numerical order:
video 5 defines the document every other video reads from, and 4 defines the
number they all argue about.

## Channel

Not created yet. `channel-setup.md` holds the name, handle, description and
keywords ready to paste — and the reason to create it before making anything,
which is that **YouTube Studio's Research tab is the only free source of real
search-volume figures** and is gated behind having a channel.

## Before shooting anything

The premise is unverified — see the review in `docs/CONTENT.md`. An hour of
hand-searching these titles on YouTube and reading the view counts on the top
three results comes first. If the intent is not there, none of this is worth
shooting.

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
| 5 | Your EOB is not a bill — so what is it? | ✅ draft | — |
| 4 | What does "allowed amount" mean on my EOB? | — | — |
| 1 | Your bill says $175, your EOB says $120 | — | — |
| 0a, 0b, 2, 3, 6, 7, 8, 9 | see `docs/CONTENT.md` | — | — |
