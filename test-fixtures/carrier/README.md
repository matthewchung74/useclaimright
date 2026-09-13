# Documents from carriers who are not us

Everything in `../real-sbc/` is a US government specimen, and every one of them
describes the **same** plan: $500 individual / $1,000 family deductible,
$2,500 / $5,000 out-of-pocket. Five files, one plan. `docs/TESTING.md` recorded
that for months as a gap only a real member's SBC could close.

**That was wrong.** An SBC describes a plan, not a person — it carries no
personal information at all, and carriers are required to publish them. So real
SBCs for real plans are freely available, and the variation was there the whole
time:

| plan | deductible |
|---|---|
| Kaiser CalPERS | **$0** |
| Blue Shield PPO | $1,000 |
| BCBS Kansas Plan A | $1,000 |
| Kansas exchange QHP | $2,000 |
| BCBS Kansas Plan C | **$2,750** |

Five carriers, five layouts, 7–14 pages each. All with text layers.

## Not committed

These are the carriers' copyright. Published is not the same as ours to
redistribute, and this repo is public. Rebuild them with:

    test-fixtures/carrier/fetch.sh

Links rot. When one 404s, find the carrier's current equivalent rather than
dropping the case it covered — the reason each file is here is written next to
its URL in the script.

## What is here, and what it is good for

**SBCs** — real plans, the only real plan variation we have.

**EOBs** — **one** usable one, and it is Cigna's: two pages, a real claim
layout, amount billed $189.00, "This is not a bill" printed on it. Published
for member education, so it is cleaner than a real EOB — one tidy claim, no
consolidated family statement. It tests the *format*, not the mess.

`eob-aetna-sample.pdf` is not a second one. Aetna's "EOB Guide" URL returns 200
and serves the same bytes as the sample URL, so the two files this directory
was meant to hold were one file under two names — `curl -f` catches a 404, not
a 200 serving the wrong document. Worse, the survivor is the **guide**:
explanatory prose beside a thumbnail EOB stamped SAMPLE, 2,205 characters over
two pages, not one of them a claim. Keep it for the video series; do not pair a
bill with it. `test/browser/carrier.test.js` asserts both of these so the
mistake cannot be made twice.

**Claim forms** — a CMS-1500 or UB-04 is what a provider sends an insurer, not
what a patient receives. The product audits the patient-facing itemized bill,
so these test a document it does not take. Two carry figures; two are blank
instruction guides kept as video reference.

## The gap that is still open

**A real patient-facing itemized bill.** Those are specific to one patient, so
nobody publishes them, and every itemized bill we test against is one we wrote.
It is one half of every audit. If you get hold of a real one — with permission,
scrubbed — it is worth more than everything in this directory.
