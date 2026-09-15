# Shorts experiment 1 — three hooks, one body

**This is not three videos. It is one video with three openings**, so that the
only variable is the thing you can actually control: the first two seconds.

Shoot all three in one sitting from the same screen recording. Publish a week
apart. Read the **retention graph**, not the view count — views are the feed
lottery, retention is whether the thing works.

## Why these documents

`test-fixtures/fake-bill.pdf` and `fake-eob.pdf`, cropped to two figures:

| Document | Line | Figure |
|---|---|---|
| The bill | PATIENT BALANCE DUE | **$845.00** |
| The insurance letter | Your responsibility | **$186.35** |

A **$658.65** gap, and it is the real E1 finding — verified on production twice
on 2026-09-14, with the model's own words: *"The provider billed patient balance
due ($845.00) exceeds the maximum patient responsibility indicated on the EOB
($186.35), improperly balance billing contracted network write-offs."*

**These are our own example documents and the script says so**, once, plainly.
The earlier review flagged that synthetic fixtures undercut exactly the videos
that need credibility — saying "this is an example" out loud costs a second and
is stronger than hoping nobody clocks "Jane Q. Testpatient". The alternative — a
real carrier EOB — only shows one side, and the whole point here is two documents
disagreeing.

## Framing for 9:16 — the frames are generated, not shot

    python3 video/shorts-01-two-numbers/frames.py

Writes five 1080×1920 PNGs beside that script. **They are gitignored** — the
generator is the source and the frames are a build artefact, the same split as
`test-fixtures/gen-*.mjs`.

| Frame | Shows |
|---|---|
| `A-bill.png` | THE BILL — PATIENT BALANCE DUE: **$845.00** |
| `B-eob.png` | YOUR INSURANCE LETTER — What you may owe the provider: **$186.35** |
| `C-both.png` | both, stacked and labelled |
| `D-gap.png` | both, plus **$658.65 difference** in the app's own red |
| `E-disclaimer.png` | "Example documents. Check your own before disputing anything." |

The gift of vertical: **one row fills the frame.** There is no screen recording
and no cursor — it is five stills and a voice track, which is why this is an
afternoon rather than a day.

Crops are pinned to coordinates read out of the PDFs with `pdftotext -bbox`
rather than eyeballed, so a fixture change makes the generator fail loudly
instead of drifting a few pixels.

The blocks sit slightly above centre on purpose: YouTube lays the handle and
description across the bottom of a Short and the like/share rail down the right.

---

## The shared body — identical in all three

Starts at 0:02. **Do not re-record this between variants.**

| Time | Frame | Say |
|---|---|---|
| 0:02 | `A-bill.png` | "This is a hospital bill. It wants eight hundred and forty-five dollars." |
| 0:07 | `B-eob.png` | "This is the letter from the insurance company, about the same visit. It says you owe a hundred and eighty-six." |
| 0:13 | `C-both.png` | "Same visit. Same day. Two different numbers." |
| 0:17 | `D-gap.png` | "The difference is six hundred and fifty-eight dollars — and it's the discount your insurer already negotiated. The hospital agreed to it when they joined the network." |
| 0:25 | `B-eob.png` again | "So before you pay a medical bill, find the letter from your insurance and check that the numbers match. If they don't, that's a phone call." |
| 0:29 | `E-disclaimer.png` | *(silent, or read it)* |

**Total: ~30 seconds.** If it runs to 35, cut the network-contract clause at 0:17
before cutting anything else — it is the most explanatory and the least urgent.

---

## Variant 1 — the number hook

**Opening frame: `C-both.png`, both numbers already visible. No build-up.**

> **"Eight hundred and forty-five dollars, or a hundred and eighty-six?"**

Then straight into the shared body at 0:02.

*Testing:* whether a number in frame one stops a swipe. Highest contrast, zero
context — the viewer has to stay to find out what they are looking at.

## Variant 2 — the contradiction hook

**Opening frame: `C-both.png`.**

> **"Two numbers on your medical bill should match. They usually don't."**

*Testing:* whether a claim beats a number. Gives the viewer the point up front
and asks them to stay for the evidence — the opposite bet to variant 1.

## Variant 3 — the instruction hook

**Opening frame: `A-bill.png`, the $845 alone.**

> **"Before you pay this, there's one number you need to find."**

*Testing:* whether a promise of usefulness beats either. Slowest opening of the
three and the most like a normal explainer, so it is the control as much as a
variant.

---

## What to measure

Studio → the Short → **Audience retention**. Ignore views for the first week.

| Signal | Reading |
|---|---|
| Flat drop before 0:03 on all three | The format is wrong. A document on screen does not hold a swipe. Stop here — that is the experiment working |
| A shelf after 0:05 on any of them | The content holds. That hook is the one to build on, and volume is now worth buying |
| One travels, others do not | Compare openings, not topics. You have found the hook |
| All three flat at ~200 views with good retention | Feed did not pick them up. Re-cut the winner and post again — this is normal and not a verdict |

**Decide in advance what a win is.** A Short that reaches 100,000 people and
produces four audits is a different outcome from one that reaches 2,000 and
produces forty. Write the number down before publishing, or you will rationalise
whatever happens.

## Cross-posting

Same export to **Reels and TikTok**. Three feeds, three algorithms, one
afternoon — and the AskMyFit account already has the habit and the equipment, so
the marginal cost here is close to zero.

Strip `#shorts` for the other two. Keep hashtags minimal: the 538-view example in
`docs/CONTENT.md` carried `#money #credit #finance #medicalbills` and the
196K one carried nearly the same set, so hashtags are demonstrably not the lever.

## What this is not

This is a cheap bet, not the strategy. The measured conclusion in
`docs/CONTENT.md` is that the intent lives on Google search and a written page is
the instrument with evidence behind it. Three Shorts cost an afternoon and might
win; the page is the thing that is *likely* to work.
