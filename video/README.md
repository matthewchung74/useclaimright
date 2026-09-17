# Making a Short

35-45 second whiteboard explainers about reading your own medical paperwork,
drawn stroke by stroke while a voice reads the script. Everything is generated
from one `lines.json` and the art in `whiteboard.py`, so changing a line changes
the video and nothing drifts.

This file is **how** to make and publish one. **Why** they look this way, the
house style, and the plan for every Short live in `docs/CONTENT.md`. The channel
itself is recorded in `channel-setup.md`.

    video/
      README.md           ← this: setup, making, checking, publishing
      channel-setup.md    ← the channel as configured, and what is deliberately empty
      tts.mjs             ← script → voice (Cloud TTS)
      align.py            ← voice → word timings (local whisper.cpp)
      whiteboard.py       ← all the art, and the renderer
      captions.py         ← karaoke captions and the voice track
      short-NN-<name>/
        lines.json        ← the script: the only file per Short that is committed
        audio/            ← built: one .wav per line, timings.json
        <name>.mp4        ← built: the video
        stills.png        ← built: the last frame of every line, for checking

`NN` is the Short's number in `docs/CONTENT.md`, not the order it was made in.
Everything except `lines.json` is gitignored and rebuilds from it.

## One-time setup

macOS, because the art is written in Bradley Hand Bold and the captions in Arial
Bold, both from `/System/Library/Fonts/Supplemental/`.

    brew install ffmpeg whisper-cpp
    pip3 install pillow
    curl -L --create-dirs -o ~/.cache/whisper/ggml-base.en.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

Node 18 or newer, with no `npm install`: `tts.mjs` uses only built-ins. It calls
Cloud Text-to-Speech with `gcloud auth print-access-token`, so `gcloud` has to be
signed in to an account with access to the `useclaimright` project, and the
Text-to-Speech API has to be enabled there. No Gemini key is involved; Gemini
TTS was tried first and dropped as too unreliable.

## Making one

### 1. Write `lines.json`

    {
      "_injury": "why this injury, and why it earns its place",
      "_numbers": "why these figures",
      "variants": { "bee": "A bee stung you, and your hand swelled up like a rubber glove. So you go to your doctor." },
      "body": [
        { "id": "h2", "text": "The bill lists three charges. Your insurance letter lists two." },
        ...
        { "id": "h8", "text": "Check yours before you dispute. Or upload them free at UseClaimRight.com." }
      ]
    }

- **`variants` holds the hook**, the first line, as a single entry. Its art key
  is `hook-<name>`.
- **Body ids must be unique across every Short**, not just this one: all the
  art lives in one dictionary, and `whiteboard.py` refuses to run on a duplicate.
  Each Short takes its own letter (`d`, `g`, `f`, `h`, and so on).
- **`_` fields are notes to the next person.** Record the reason behind any
  choice someone might undo.
- **Write the domain `UseClaimRight.com`.** The voice spells lowercase
  `useclaimright.com` out letter by letter. Check any new domain, abbreviation or
  unusual figure the same way: synthesise it, and listen or run it through
  `align.py`.

Before drawing anything, check the script against the style in
`docs/CONTENT.md`. The rules that mattered most in practice:

- open on the surprise the viewer already has, not the mechanism that explains it
- name the word within the first ten seconds and define it in the same breath
- one idea: anything that belongs to another Short stays out
- say *why* a scene happens, not just when
- round numbers, and one number per line

### 2. Voice and timings

    node video/tts.mjs short-04-never-seen      # audio/*.wav, voice en-US-Studio-Q
    python3 video/align.py short-04-never-seen  # replaces estimated timings with measured ones

Run both after **any** change to a line. `tts.mjs` alone writes estimated word
timings, because Studio voices do not return them; `align.py` measures the real
ones locally with whisper.cpp. It is forced alignment against the known script,
not transcription, so a misheard word still gets a sensible time. Nothing is
uploaded.

### 3. Draw

The art is the `ART` dictionary in `whiteboard.py`, keyed by folder, then by
line id. Each line gets a list of elements, drawn in order while it is spoken.

- **The board is 1600 × 3700 and the story runs down it in one column.** Side
  by side only when two things are being compared, like two envelopes or two
  lists. The camera follows the drawing, and a zig-zag makes it swing.
- **A line's time is shared out by stroke length, in list order.** A long
  drawing listed first eats the line, so put the thing the viewer must see
  first.
- **The camera frames this line and the one before.** For a line that needs
  everything on screen, such as a summary comparing both halves, add its id to
  `FRAME_ALL`.
- **A whiteboard cannot un-draw.** "Before" and "after" are two drawings.
- **Shapes to reuse:** `person`, `person_hurt`, `person_down`, `person_hop`,
  `cat`, `bee`, `swollen_hand`, `hospital`, `envelope`, `phone`, `bucket`,
  `bucket_fill`, `ice`, `coin`, `pie`, `clock`, `doc`, `bump`, `glass_door`,
  `arrow`, `box`, `ellipse` (for
  circling), `squiggle`, `line`, `circle`. Elements: `S(...)` for strokes,
  `T(xy, text, size, colour)` for handwriting, `Sheet` (a page sliding out of an
  envelope), `Spin` (art that rotates, optionally draining), and `Coins`
  (dollar signs falling together).
- **New shapes go with the others**, as functions returning a list of strokes
  (each stroke a list of points), with a docstring saying what makes them read
  as the thing.

### 4. Render

    python3 video/whiteboard.py short-04-never-seen

This writes `<name>.mp4` and `stills.png` (the name is the folder minus
`short-NN-`), then deletes the frames. Pass `--keep-frames` to keep them. A
render takes a minute or two.

**Open `stills.png` every time.** It is step 1 of the checklist below, and it is
how every layout bug so far was found.

## Before it goes public

YouTube cannot swap the file on a video. Every fix after publishing means a new
upload, losing the views, deleting the old one by hand, and fixing every link
that pointed at it. Both rewrites on 2026-09-17 would have been caught by this
list:

1. **Check `stills.png`.** Clipped text, black edges and half-framed
   comparisons hide in playback and are obvious in stills.
2. **When remaking a Short, keep the previous cut** as `<name>-v1.mp4` and
   watch them back to back.
3. **Upload Private.**
4. **Have someone who does not know the subject watch it once.** Ask what the
   video said, not whether they liked it. Short 2 v1 followed every style rule
   and still lost a first-time viewer.
5. **Only then publish.** Link to the playlist, not a single video, so a later
   replacement does not break the link.

## Publishing on YouTube

Channel `@useclaimright`, playlist **Reading your own medical bill**
(`PLYCXBRe11FUU`). Studio → **Create** → **Upload videos**, then:

- **Title:** the surprise, in plain words, under about 60 characters. Match the
  video: when Short 1 changed from hospital to urgent care, its title did too.
- **Description:** five short paragraphs, in this order:
  1. the surprise, in one or two sentences
  2. the explanation, with the jargon named
  3. what to do about it
  4. `Check yours before you dispute, or upload them free at useclaimright.com`
  5. `General information, not legal or medical advice. Always check figures against your own documents before disputing a charge.`
- **Playlist:** Reading your own medical bill.
- **Audience:** No, it's not made for kids.
- **Visibility:** Private, until the checklist is done.
- **Order in the playlist:** it is sorted manually, and new uploads land at the
  bottom. Studio cannot reorder it. On the public playlist page, use a video's
  ⋮ menu → **Move to top** / **Move to bottom**, then reload to confirm, because
  the move does not always stick.

Then record the video id in the Status table below and in `channel-setup.md`.

### Replacing a published Short

1. Upload the new cut as above: Private, same playlist, title and description
   updated to match.
2. Move it into the old one's place in the playlist.
3. Publish the new one first, so the playlist never has a gap.
4. Delete the old one by hand in Studio (⋮ → **Delete forever**). Deleting also
   removes it from the playlist.
5. Fix anything that linked to the old video directly.

## Status

| Order | # | Short | Folder | Length | YouTube |
|---|---|---|---|---|---|
| 1 | 1 | Bill or EOB? | `short-01-two-numbers` | 42.1s | `l0g-GiNdqbQ` Public |
| 2 | 12 | Claim, EOB, bill | `short-12-claim` | 36.6s | `J5W0eRzFsW8` Public |
| 3 | 11 | Your SBC | `short-11-sbc` | 38.2s | `D7ZMQ1V1-ts` Public |
| 4 | 2 | The January reset | `short-02-january` | 34.5s | `YKheiL2nerE` Public |
| 5 | 3 | Copay vs coinsurance | `short-03-copay` | 42.5s | `aaO_pqBPpSs` Public |
| 6 | 4 | A charge not on your EOB | `short-04-never-seen` | 35.4s | `dvOpGw7camA` Public |
| — | 5–10 | see `docs/CONTENT.md` | — | — | — |

**`#` is the number in `docs/CONTENT.md`; `Order` is the playlist's teaching
order.** They differ on purpose: 11 and 12 were written last and belong second
and third, because everything after them assumes you know which paper is which.

## Superseded, awaiting removal

`render.py`, `superseded-document-short/` and `05-eob-is-not-a-bill/` are from
the first format: screen recordings of the real test bill and EOB, three to five
minutes long. It was replaced on 2026-09-15 because a real document is not
legible at phone size. Nothing uses them now; `whiteboard.py` has its own
caption helpers in `captions.py`. `package.json` still lists `@google/genai`,
which nothing imports since Gemini TTS was dropped.
