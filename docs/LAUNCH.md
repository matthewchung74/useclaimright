# Launch framing

The TODO this replaces said "the Show HN framing is stale — the CEO plan's launch pitch was
built on the on-device redaction hook, which no longer exists." That is true, and worse: the
plan it referred to (`2026-08-20-launch-and-appeal-letter.md`) was never tracked in git, so
there was nothing to correct. Written fresh here, against what the product actually does as of
2026-09-07, and kept in the repo so it goes stale visibly next time.

**What changed under the old pitch.** It led on on-device PHI redaction — the bill was scrubbed
in your browser before anything was sent. That model was removed on 2026-08-23 because it did
not work (see `docs/upstream-bug-openmed-onnx.md`: the fp16 and q4f16 variants failed to load
and the q8 variant returned near-chance logits, which is the dangerous failure — it looked
fine and redacted nothing). Leading a launch on a privacy feature that had never functioned
would have been the worst possible thing to be caught on.

The honest pitch is better anyway, because the product got more interesting: it reads both
documents as images, cross-checks them line by line, checks both against your plan, and quotes
its evidence for every claim.

---

## Show HN post

**Title:** `Show HN: UseClaimRight – Cross-check a medical bill against your insurer's EOB`

*(HN titles: no exclamation, no "AI-powered", under 80 chars. The verb "cross-check" is the
product; "audit" reads as accounting software.)*

**Body:**

> I got overcharged over one hundred dollars on my kiddo's medical bill before. Ever since, I've checked my own claims against my EOBs line by line — and it's slow and a pain.
>
> The process for bills is a mess. The bill comes from the provider; the EOB that would prove the error turns up weeks later, in a different envelope, from the insurer. Catching anything means holding the two next to each other and comparing them by hand.
>
> Family plans make it messier. Two of us can see the same clinic on the same day for the same code, and the bills look identical — a real duplicate charge and two legitimate visits are the same picture until you check the name on the claim line. Pick up the wrong kid's EOB and a perfectly fine bill looks like fraud, because every line comes back missing from it. Insurers also send a consolidated EOB covering everybody, or one per person, and the deductible on it is two numbers — individual and family — that you have to know which of you is counting against. Limits like "6 visits a year" are per person, not per household, and getting that backwards tells someone they're out of covered visits when they aren't.
>
> So I built something that does that part. Upload the itemized bill and the EOB and it tells you what disagrees — a line billed twice, a charge above what your plan allowed, something on the bill the EOB never processed, or the EOB's own numbers not adding up. Add your Summary of Benefits once and it checks the bill against what the plan promised too.
>
> Every finding quotes the line it came from. That's enforced, not encouraged: if the quote isn't verbatim in your document, the finding gets dropped before you see it. Doesn't make the model right, but you can check any claim in about two seconds.
>
> On ChatGPT + Epic, since that landed last week: it reads the clinical chart. A billing error isn't in the chart — it's in the gap between your provider's bill and your insurer's EOB, and neither party holds both.
>
> Free, 10 a day, since I am covering LLM calls myself. There's a sample audit you can read without signing up.
>
> Your documents go to Gemini on Vertex AI with your name still on them. No on-device redaction — I tried, the model I used silently passed everything through, and a privacy feature that doesn't work is worse than none. It says so on the upload screen before anything is sent.
>
> I'd most like to hear from anyone who runs a real bill through it and gets a wrong answer or anyone who runs a bill through it and it is helpful.
>
> Thanks for your time!

*Author's wording, with a family-plan paragraph added 2026-09-08. 2,519 chars.

That paragraph does three jobs at once, which is why it earns its length. It follows
from the opener — a kiddo's bill means a family plan — so the hardest case in the
product is also the author's own. It restores the build detail HN rewards, framed as a
real problem rather than an engineering aside. And every claim in it is behaviour
verified in TESTING.md rather than colour: FAM1 (two members are not one person billed
twice), FAM4 (the wrong member's EOB), FAM3 (consolidated vs per-member), FAM2
(individual vs family deductible) and FAM5 (limits are per member).

It is also the honest answer to "why not just paste this into a chatbot": the
family cases are where a plausible-sounding wrong answer costs someone money or care.*

---

## The flow video

`web/img/flow.mp4` (484KB) + `flow.webm` (331KB) + `flow-poster.jpg` — 762×480, 19.2s, in `#how`
beside the three steps, which highlight in time with it.

**A video rather than a GIF, and the reason decides it.** A GIF exposes no playback state — no
`currentTime`, no events, no way to know when it started or where it is in its loop — so the step
highlighting could only be guessed at with a timer, and the guess drifts the moment a load is slow
or a tab is backgrounded. `timeupdate` is exact and self-correcting. It is also about five times
smaller than the same footage as a GIF, which matters where acquisition is organic and mobile.

**Recorded 2026-09-08 against production**, driving a real audit on `sample-bill.pdf` +
`sample-eob.pdf` with the Acme Silver PPO plan on file. The run produced $2,115.00 / $841.75 /
$186.35 / **$842.39**, and `web/sample-audit.json` is that same audit — so the video and
`/app?sample=1` end on identical numbers rather than two versions of the truth. Editing is limited
to trimming dead air (82s to 19.2s, including 40s of spinner) and cutting two macOS file-picker
windows that showed the recorder's home directory. No overlays, no watermark, no invented frames;
the absence of the picker is verified by a luminance scan of the output rather than by eye.

**Still the most drift-prone artifact in the repo.** Nothing fails when the UI moves on. Re-record
when the upload form, the review screen or the report visibly changes — and if you are reading this
note long after that happened, the video is already lying. The step timings in `index.html`
(`data-at` on each `.step`) are cut points in this specific file and must be re-derived with it.

---

## LinkedIn post

Different audience, opposite rules. HN punishes a post that opens on a competitor; LinkedIn rewards
a structural take on news people are already reading about. So this one *does* lead with the Epic
integration, keeps the product to a closing line, and stands up as an observation even for someone
who never clicks.

**POSTED 2026-09-10.** This is the text as published — not a draft. Edit the record, not history,
if it changes.

> OpenAI connected ChatGPT to Epic. It reads your clinical record — your history, your labs, your
> medications — and I just used it to ask about my bloodwork. It's really good.
>
> But ask it about your medical bills. It has no access, and that gap isn't closing soon, because of
> where the data lives.
>
> I was really disappointed since I have spent countless hours verifying bills against Explanation
> of Benefits ever since I caught a mistake 10 years ago.
>
> Here's why it can't help. Your clinical record sits with your provider. Your EOB comes from your
> insurer, weeks later, in its own envelope. Two companies, two systems, and neither one has both
> halves.
>
> That's the whole problem, because a billing error usually isn't visible in either document alone.
> It's in the difference between them — a charge that shows up twice on the itemized bill but once
> on the EOB, for example. That's easy to see the moment the two pages are side by side, which is
> exactly the boring, fiddly work I've been doing by hand for a decade.
>
> So I built UseClaimRight to do it. You upload the bill and the letter from your insurance, and a
> couple of minutes later you get a list of what's worth questioning — each one quoting the line it
> came from, so you can check it yourself before you call anyone. If nothing's wrong, it tells you
> that too.
>
> It's free. There's a sample audit on the site if you'd rather look before uploading anything.
> Maybe you were overcharged like me. If you've got a bill you've been meaning to look at, try it
> out and let me know how it goes. Also, this is focused on billing, it is not medical advice.
> Analysis is done by Google's Gemini.
>
> 🔗 useclaimright.com

### What changed from the draft, and why it matters

**The specific findings came out.** An earlier draft opened the practical section with "On one
$2,115 emergency-room bill: a lab test billed twice at $145.50, $658.65 charged above what the plan
allowed" and an $18 arithmetic error in the insurer's own EOB. Every one of those numbers is from
`test-fixtures/fake-bill.pdf` and `fake-eob.pdf` — patient "Jane Q. Testpatient", provider "St.
Verification General Hospital". **We wrote them.**

In a first-person post that opens "I just used it to ask about my bloodwork", they read as the
author's own bill. They are not. If a commenter had asked to see the EOB there would have been
nothing to show.

The old note called the $18 finding "the hook — specific, checkable, and surprising in a way 'we
find errors' never is." All true, and none of it survives the fact that it did not happen. **Do not
reintroduce those numbers.** If a concrete example is wanted later, either attribute it to the
sample audit on the site — which is honest and already public — or use a real finding from a real
bill, once one exists.

**"Last week" came out** rather than being dated. The argument is about where the data lives, which
does not expire; the news timing does.

**The disclaimer went in.** A post telling people to upload medical bills should say where the
documents go before anyone asks.

### What the post claims, and where each was verified

Checked 2026-09-10 against the day's testing, so a future edit knows what is load-bearing:

| claim | status |
|---|---|
| "a couple of minutes" | audits ran 30–40s |
| "quoting the line it came from" | every finding carries verbatim evidence from both documents |
| "if nothing's wrong, it tells you that too" | true, and the bill-only wording was fixed the same day |
| "a sample audit on the site" | `/app?sample=1`, no sign-in and no model call, covered by a browser test |
| "It's free" | payments off, deliberately |
| "I caught a mistake 10 years ago" | the author's own, unverifiable here, and the strongest thing in the post |

## Why this framing

**Lead with the document nobody reads.** The insight is not "AI reads your bill"; it is that
the evidence to dispute a bill already exists, in the mail, and no one cross-references it.
That is a real observation and it survives the AI hype cycle.

**The interesting-failures section is the post.** HN rewards being specific about what went
wrong. The wrong-family-member case, the text-extraction reversal and the per-member limit are
all concrete, all counterintuitive, and all true. They also demonstrate care without claiming
accuracy the product cannot prove.

**State the privacy tradeoff before anyone asks.** A health product sending named documents to
a third-party model will be asked about it in the first ten comments. Saying it first — and
admitting the redaction attempt failed and was pulled — converts the single biggest objection
into evidence of honesty. Hiding it invites the thread to be about that and nothing else.

**Ask for false positives.** It is a genuine open problem (`per-finding feedback` is still an
open TODO and is the only way to measure them), it invites the exact contribution HN is good
at, and it sets expectations that the tool can be wrong.

## Do not say

- "AI-powered" anywhere. The post shows what it does.
- Any recovery figure or success rate. There is no data behind one, and inventing it on a
  medical-billing product is the fastest way to deserve a bad thread.
- "Save thousands." Same reason.
- That it is HIPAA-compliant. It is not a covered entity; the frame is the FTC Health Breach
  Notification Rule, and that conclusion has not been reviewed by an attorney either.

## Before posting

- [ ] **The no-upload sample audit** (open TODO). A visitor currently has to create an account
      before seeing anything work, and an HN spike lands on a sign-in wall. This is the single
      highest-leverage thing to build first.
- [ ] Confirm the 10/day cap and the `meta/guard` spend guard survive a front-page spike, and
      know what the ceiling costs. An audit is ~$0.01, so 2,000 of them is ~$20.
- [ ] Be at the keyboard for the first few hours. An unanswered Show HN dies.
