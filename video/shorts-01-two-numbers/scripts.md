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

## Framing for 9:16

The gift of vertical: **one row fills the frame.** No cursor needed for most of
it — cut between two tight crops.

- **Crop A** — the bill's balance-due line, nothing else in frame
- **Crop B** — the EOB's patient-responsibility line, nothing else in frame
- **Crop C** — both stacked, A above B, for the reveal

Big text, filmed at 2x and downscaled so it is legible on a phone held at arm's
length. If you have to squint on your own phone, it is too small.

---

## The shared body — identical in all three

Starts at 0:02. **Do not re-record this between variants.**

| Time | Frame | Say |
|---|---|---|
| 0:02 | **Crop A** — $845.00 | "This is a hospital bill. It wants eight hundred and forty-five dollars." |
| 0:07 | **Crop B** — $186.35 | "This is the letter from the insurance company, about the same visit. It says you owe a hundred and eighty-six." |
| 0:13 | **Crop C** — both stacked | "Same visit. Same day. Two different numbers." |
| 0:17 | Crop C, the gap highlighted | "The difference is six hundred and fifty-eight dollars — and it's the discount your insurer already negotiated. The hospital agreed to it when they joined the network." |
| 0:25 | Crop B, back on $186.35 | "So before you pay a medical bill, find the letter from your insurance and check that the numbers match. If they don't, that's a phone call." |
| 0:29 | Card | *on screen:* "Example documents. Check your own before disputing anything." |

**Total: ~30 seconds.** If it runs to 35, cut the network-contract clause at 0:17
before cutting anything else — it is the most explanatory and the least urgent.

---

## Variant 1 — the number hook

**Opening frame: Crop C, both numbers already visible. No build-up.**

> **"Eight hundred and forty-five dollars, or a hundred and eighty-six?"**

Then straight into the shared body at 0:02.

*Testing:* whether a number in frame one stops a swipe. Highest contrast, zero
context — the viewer has to stay to find out what they are looking at.

## Variant 2 — the contradiction hook

**Opening frame: Crop C, both numbers visible.**

> **"Two numbers on your medical bill should match. They usually don't."**

*Testing:* whether a claim beats a number. Gives the viewer the point up front
and asks them to stay for the evidence — the opposite bet to variant 1.

## Variant 3 — the instruction hook

**Opening frame: Crop A, the $845 alone.**

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
