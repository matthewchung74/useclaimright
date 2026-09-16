# UseClaimRight

Cross-checks a medical bill against the Explanation of Benefits your insurer sent,
and tells you what disagrees.

**[useclaimright.com](https://www.useclaimright.com)** — free, with a sample audit you can
read without an account.

**[Short explainers on YouTube](https://www.youtube.com/playlist?list=PLYCXBRe11FUU)** — forty-second drawn videos about the
paperwork rather than about the tool: which document is which, why a January bill jumps,
copay versus coinsurance. Scripts and the renderer that builds them are in `video/`.

## Why this exists

Your bill comes from the provider. The EOB that would prove an error arrives weeks later,
from your insurer, in a different envelope. A billing error usually isn't visible in either
document alone — it's in the difference between them. Almost nobody puts the two pages side
by side, because it's slow and the vocabulary is hostile.

So: upload both, and it reports what disagrees. A line billed twice. A charge above what
your plan allowed. Something on the bill the EOB never processed. The EOB's own totals not
adding up. Add your Summary of Benefits once and it also checks the bill against what your
plan actually promised — your copay, your deductible, your visit limits.

## What it will not do

It won't tell you a finding is correct. **Every finding quotes the line it came from, and
that's enforced rather than encouraged** — if the quote isn't verbatim in your document, the
finding is dropped before you see it (`functions/schema.js`, `verifyEvidence`). That doesn't
make the model right. It means you can check any claim in about two seconds, which is the
most a tool like this can honestly offer.

It isn't legal, medical or insurance advice, and it doesn't know your situation.

## Where your documents go

**To Google's Gemini models on Vertex AI, with your name still on them.** There is no
on-device redaction. There was an attempt at it; it was removed on 2026-08-23 because it did
not work — the model silently passed everything through while appearing to redact, which is
the dangerous kind of failure. `docs/upstream-bug-openmed-onnx.md` has the details. A privacy
feature that doesn't work is worse than none, so it's gone and the upload screen says so
before anything is sent.

No HIPAA compliance is claimed. Several similar tools claim it; this one won't, because it
isn't a covered entity and the claim would be decoration. The code is here instead — you can
read exactly what happens to a document rather than take anyone's word for it. That's the
trade this repo is making.

## How it works

- **Browser** renders each PDF page to an image. Pages go to the model, not an extracted text
  layer — a text layer destroys column association, and a table is the whole point
  (`web/js/extract.js`). The text layer is used only to *find* which pages matter in a long
  plan booklet (`web/js/sections.js`).
- **Firebase Functions** run the model calls, the schema validation, and every limit.
- **Firestore** holds audits, saved EOBs, trackers and the plan.
- **Guards** — a per-member daily allowance, a global spend ceiling, and a kill switch that
  stops model calls without a deploy (`functions/guard.js`, `functions/budget.js`).

An audit costs about $0.008 in model calls. That's why it's free, and why it has no reason to
find a problem that isn't there.

## The testing is the interesting part

`docs/TESTING.md` is a long, honest record: what's verified, what isn't, and what broke. It
names defects found in production and the assumptions that hid them. Some of it is
uncomfortable reading, which is the point — a test plan that only records successes is a
marketing document.

Three test layers, ~310 tests:

    npm --prefix functions test          # unit, including the cost ledger
    npm --prefix test/browser test       # drift, DOM/geometry, the message matrix
    npm --prefix functions run emulators # then: npm --prefix functions run test:integration

The integration suite runs the real handlers against the Firestore emulator and skips — rather
than fails — when it isn't running, because a suite that goes red on a laptop without Java is
one people learn to ignore.

## Running your own

You'd need a Firebase project, Vertex AI enabled, and a Gemini API key. `docs/SETUP.md`
covers it. Honestly: self-hosting isn't the point of publishing this. Verifiability is.

## Contributions

**Issues and pull requests are off.** This is a solo project maintained in spare hours, and
pretending otherwise would waste your time. Read it, fork it, copy from it, tell me it's
wrong — [the feedback bubble in the app](https://www.useclaimright.com/app) reaches me.

## Licence

MIT. See `LICENSE`.
