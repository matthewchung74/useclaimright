# A video series about reading your own medical bill

Nine videos. The premise is that **YouTube is a search engine**, and people
search "why is my bill higher than my EOB" *while holding the bill*. That is the
intent moment nothing else we do reaches — LinkedIn finds people at work,
Product Hunt finds people who like products, Instagram finds people scrolling. A
good explainer keeps getting found for years; a launch post is dead in two days.

## The format, and why it is not a talking head

**Screen recording of an actual document, with a cursor pointing at lines.** No
face, no studio, no editing beyond cuts. The content *is* the document, and
pointing at the line is the whole teaching act.

Three to five minutes. One idea each. If a video needs two ideas it is two
videos.

This is also the cheapest possible format and the one nobody is doing: search
the space and you get institutional explainers — UnitedHealthcare explaining
UnitedHealthcare's EOB, CMS guides, clinic blogs. An insurer teaching you to
read their EOB will never say *"here is how to catch them charging you above the
allowed amount."* That sentence is the gap.

## Writing for someone who has never read one of these

The audience is not people who know the vocabulary and want the nuance. It is
people holding a piece of paper they do not understand, who may not know the
document has a name.

**Titles use the jargon; the first ten seconds do not.** This is a real tension
and it resolves in one direction only. Someone searching has the word in front of
them — "Explanation of Benefits" is printed at the top of the page — so the title
must carry it or the video is not found. But the opening line has to assume they
have never heard it: *"If you have a page from your insurance company headed
Explanation of Benefits — that is what this is about. It is not a bill."*

Note the product already made this call. The dropzone does not say "upload your
EOB"; it says **"Add the letter from your insurance, if you have it."** The
videos should not be more jargon-heavy than the app they are advertising.

**Words to keep off the soundtrack**, with what to say instead:

| Do not say | Say |
|---|---|
| adjudicated | "your insurance hasn't finished processing it yet" |
| accrues toward | "counts toward" |
| network write-off | "the discount your insurer already negotiated" |
| cost-sharing | "your share" |
| balance billing | "billing you for the discount" |

**One number at a time.** The report shows four totals at once; a novice cannot
hold four. Introduce them singly and only the ones the video needs — video 1 uses
two ($175 and $120) and should show only those until the end.

**Answer the obvious question before it is asked.** The first thing anyone thinks
watching video 1 is *"why does the insurance company get to decide what my doctor
charges?"* If that is not answered in the video, nothing else in it is believed.
The answer — the provider signed a contract agreeing to the lower price in
exchange for patients — belongs early and in one sentence.


## What is safe to record

| Source | Safe? | Why |
|---|---|---|
| `/app?sample=1` | ✅ | A real report on synthetic documents. Public, no login, no PHI. Already built |
| `test-fixtures/` — our own fixtures | ✅ | We wrote them. Canary names throughout (Jane Q. Testpatient) |
| `test-fixtures/carrier/` — real SBCs and EOBs | ⚠️ | No personal data, but they are the carriers' copyright. Fine to *read from* on screen with attribution; do not republish the files |
| `test-fixtures/private/` — the member booklet | ❌ | Not ours |
| Anyone's real bill or EOB | ❌ | PHI. Never, not even scrubbed |

Everything below can be shot from the first two rows.

## The nine

Each row names the fixture that demonstrates it and the figures that actually
appear on screen — all verified against production during the 2026-09-13/14
regression run, so nothing here is a number someone has to invent at record time.

### Tier 0 — the words themselves (proposed addition; takes the series to 11)

Not in the original nine, and the review below argues they are missing rather
than optional: **videos 6 and 7 both depend on knowing what a deductible is, and
nothing in the series explains it.** They are also the highest-volume searches in
this space, and the easiest to make.

**0a. "What is a deductible, and why did my bill get bigger in January?"**
The deductible card, plainly. `real-sbc/cms-2025.pdf` prints $500 individual /
$1,000 family; the card counts toward it as audits accumulate.
The teaching beat: you pay the first $X yourself each year, and the counter
restarts — which is why January bills shock people.

**0b. "Copay or coinsurance — which one are you paying?"**
`fake-sbc.pdf` prints both: a $60 copay on one row, a percentage on another.
The teaching beat: a copay is a fixed price, coinsurance is a share of a price
you have not been told yet. Knowing which your plan says is how you check a bill
at all — and it is what video 1's mismatch finding is comparing against.

### Tier 1 — angry (someone is holding a bill and wants an answer now)

**1. "Your bill says $175, your EOB says $120 — who's right?"**
`series/t1-bill.pdf` + `t1-eob.pdf`. The report reads **$175.00 billed /
$120.00 allowed / $120.00 your responsibility / $55.00 worth disputing**, with
one finding: *"The provider billed $175.00 and reflects a balance due of
$175.00, but the EOB sets the allowed amount and maximum patient responsibility
at $120.00, requiring a network write-off of $55.00."*
The teaching beat: **the insurer's number wins**, and the $55 is not yours to
pay — because the provider signed a contract accepting the lower price. Say that
sentence early; it is the question every viewer has.

**2. "There's a charge on my bill that isn't on my EOB"**
`series/t4-bill.pdf` against the consolidated `t-eob.pdf`. One `not_in_eob`
finding at **$175.00**: *"does not appear on the provided EOB, which only covers
services through 2026-03-11."*
The teaching beat: this is usually **timing, not fraud** — your insurance has
not finished processing it. Do not pay it, and do not panic. Ask.

**3. "I got a bill after my insurance already paid"**
`fake-bill.pdf` + `fake-eob.pdf`. **$2,115.00 / $841.75 / $186.35 / $822.15**,
including *"The provider billed patient balance due ($845.00) exceeds the maximum
patient responsibility indicated on the EOB ($186.35), improperly balance billing
contracted network write-offs."*
The teaching beat: **balance billing**, and that a network contract forbids it.
This is the highest-stakes video in the series and should be made carefully.

### Tier 2 — learning (someone is trying to understand, not fighting)

**4. "What 'allowed amount' means"**
`carrier/eob-cigna-sample.pdf` — a real Cigna layout. Amount billed **$189.00**,
a "Covered amount", and the line *"You saved $177.11 (or 94%) off the total
amount billed."*
The teaching beat: the sticker price is fiction; the allowed amount is the real
price, and it is the only number worth arguing about. Use the real carrier
document here — the credibility is the point — and say whose it is on screen.

**5. "Your EOB is not a bill — so what is it?"**
Any EOB header: *"Explanation of Benefits — THIS IS NOT A BILL."*
`carrier/eob-aetna-sample.pdf` is Aetna's own annotated guide to reading one and
is useful reference, though its figures live inside a small watermarked image, so
shoot the Cigna one for legibility.
The teaching beat: it is a receipt of a negotiation you were not in.

### Tier 3 — traps (things that look wrong and are not, or look fine and are not)

**6. "Your family deductible isn't two individual deductibles"**
`real-sbc/cms-2025.pdf` on file ($500 individual / $1,000 family) with FAM1's
audits. The card reads **$640.00 of $1,000.00**, sourced *"Family target from
your plan (SBC)."*
The teaching beat: a family plan has two limits — one for each person, one for
the household — and your bills count toward one of them. The insurer's letter is
the only document that tells you which.

**7. "Your plan covers 6 visits — how do you know where you are?"**
`series/t4-t6` pairs with no plan on file. After t5 the app surfaces the
insurer's own remark: *"Plan note: 5 of 6 covered outpatient mental health visits
used this plan year."*
The teaching beat: **the limit is often printed on the EOB and nobody reads it**
— and running out of covered visits is the most expensive surprise in the series,
because it costs care and not just money.
*(Retitled from "which one are you on?", which collided with video 9.)*

**8. "Same day, same code, two family members — is that a duplicate?"**
`family/matthew-bill.pdf` and `sarah-bill.pdf` — flu shot 90686, both
**2026-03-10**, both **$85.00**, same clinic. The dashboard groups them as
**2 bills · $170.00** and raises **no duplicate flag**.
Then the contrast, which is the actual lesson: `t2-bill` and `t2-bill-rebill` —
*one* person, *one* visit, two statements — and that one *does* flag:
**"$175.00 at stake · The same visit is on two statements."**
The teaching beat: same day and same code is not a duplicate. **Same day, same
code, same person** is.

**9. "Your plan document has three plans. Which one is yours?"**
An employer booklet (shoot our own synthetic stand-in, not the member's).
The app reports *"Your plan document is 135 pages. We're sending the 24 that look
like the benefits schedule — it covers 3 plans (EPO Plan, PPO Plan, HDHP
Plans)"*, then asks: *"Which plan are you on? Your EOBs disagree — PPO and HDHP.
Until you say, bills are not checked against plan terms."*
The teaching beat: your employer's booklet may describe plans you are not on, and
the deductible you read may not be yours. **Video 9 needs a synthetic booklet
built first** — see Open work.

## Order to shoot

Not 1→9. **5, then 4, then 1** — and 0a/0b before either if they are made.

**5 comes before 4**, which the first draft had backwards. You cannot explain
what a number on a document means to someone who does not yet know what the
document is. "Your EOB is not a bill" is the foundation; "allowed amount" is the
first thing built on it.

Both are evergreen definitional searches and the lowest risk of being wrong. They
also teach the vocabulary the other seven depend on, so shooting them first means
later videos can say "allowed amount" without stopping to explain it. Then 1,
which is the highest-intent query in the set.

Leave 3 until the format is settled. Balance billing is the video most likely to
be quoted back at someone in a dispute, and it should be the most careful.

## Cautions

**Do not use the "80% of medical bills contain errors" statistic.** It is
everywhere, it is poorly sourced, and the entire positioning of this product is
refusing to overclaim. One unsupported number in video 1 undoes the credibility
the other eight are for.

**Say what the app cannot do.** It does not decide whether a CPT code was the
right one, and it does not know whether the care was appropriate. It reads three
documents and reports where they contradict each other. Saying so on camera is
not a weakness — it is the reason to trust the parts it does claim.

**This is slow.** Months, not weeks. Five good videos beat thirty rushed ones,
and "a little every week" is the correct cadence.

**One recording, three channels.** Vertical cuts from the same screen recordings
are Shorts and Reels. Whatever AskMyFit has learned about hooks and cadence
applies to distributing the same asset.

## What is weak about this plan

Written against it deliberately, because the parts that sound most confident are
the parts with the least behind them.

### The premise is unverified, and it is load-bearing

"YouTube is a search engine and people search this while holding the bill" is an
assertion. I searched once, found articles rather than videos, and noted at the
time that the tool does not index YouTube well — so *"nobody is doing this"* is
not established, it is the absence of evidence from a search that was not
looking in the right place. You had already seen competing videos yourself.

**Everything below depends on this and none of it tests it.** The cheap check,
before shooting anything: search YouTube by hand for the nine titles, and read
the view counts on the top three results for each. Under a few thousand views
means the intent moment is not there and the whole plan is wrong. That is an
hour of work against months of shooting.

### Videos 1 and 3 are close to the same video

"Billed above the allowed amount" and "balance billing after insurance paid" are
the same mechanism with different framing — and the E1 fixture produces both
findings from one pair of documents. Either merge them, or make 3 specifically
about **what to do next** (who to call, what to say, that the network contract is
the lever) so it is a procedure video rather than a second explainer.

### Nothing here says how anyone finds video 1

Nine videos on a channel with no subscribers is nine videos nobody watches.
Search ranking uses engagement signals a new channel does not have. The plan
covers what to make and is silent on how the first hundred views happen — and
the honest answer may be that the Reddit and forum threads found earlier in the
marketing work are the distribution, with the video as the thing linked rather
than the thing discovered.

### The format's biggest risk is retention, and I sold it on cost

A cursor moving over a static document for four minutes, with no face, is
low-retention by construction — and YouTube ranks on watch time. "Cheap, and
nobody is doing it" may have a less flattering explanation than novelty. Worth
testing on **one** video before committing to nine: if the retention graph falls
off a cliff at thirty seconds, the format is wrong regardless of how right the
content is.

### Synthetic fixtures undercut exactly the videos that need credibility

"Jane Q. Testpatient" and "Testville Behavioral Health Associates" on screen read
as fake to someone whose problem is a real bill — and they appear in tiers 1 and
3, which are the persuasion videos. The real carrier documents are confined to 4
and 5, which need credibility least. That is backwards, and the fix is not
obvious: a real bill cannot be filmed, so the options are better-disguised
fixtures or saying plainly on screen that the documents are synthetic and why.
Saying it is probably stronger than hoping nobody notices.

### There is no path from watching to using

The doc never says how a viewer becomes a user. Nine videos that never mention
the product are charity; nine that pitch it lose the trust the format is for. A
defensible middle — the tool is mentioned once, at the end, as the thing that
does this comparison automatically — still needs deciding rather than assuming.

### Mechanics are missing entirely

Titles, thumbnails, descriptions and chapters are most of whether a video is
found at all, and none of them appear above. The nine titles here are article
headings, not search queries — "What 'allowed amount' means" is how a writer
phrases it; "what does allowed amount mean on my EOB" is how someone types it.

### Two claims I should not have made

- *"running out of covered visits is the most expensive surprise in the series"*
  — unsupported, and cut it or find the number.
- *"verified against production"* is doing more work than it earns. Those figures
  prove **the app is consistent on our own fixtures**, not that the scenarios are
  common or that the findings are right in the world.

### The one that matters most

Video 3 tells someone not to pay a bill. That is the most useful thing in the
series and the closest it comes to advice. The app carries a disclaimer on every
report; a video carries nothing unless you put it there. Whatever the app's
footer says about self-help rather than legal advice belongs on screen in that
video, in words, not in a description nobody opens.

## Open work

- **Video 9 needs a synthetic multi-plan booklet.** The only real one is the
  member's and cannot be filmed. It needs to be long enough that narrowing
  actually runs — over `PAGE_BUDGET`, currently 24 pages — and hold three
  medical schedules. `test-fixtures/gen-*.mjs` is the pattern to follow.
- **Nothing is scripted yet.** This is the plan, not the scripts. Video 4 is the
  one to draft first.
- **The premise check comes before any of it** — an hour of hand-searching the
  nine titles on YouTube, reading view counts. If that fails, none of the rest
  is worth doing.
