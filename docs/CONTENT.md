# A series of drawn Shorts about reading your own medical bill

Ten Shorts, 35–45 seconds each, hand-drawn on a whiteboard and narrated.

This document was rewritten on 2026-09-15, after the first one was made. It
previously planned nine **three-to-five-minute screen recordings of real
documents**, on the premise that **YouTube is a search engine** and people search
"why is my bill higher than my EOB" while holding the bill. Both halves of that
turned out to be wrong, in opposite ways and for different reasons:

- **The premise failed on measurement.** YouTube search for this subject is
  close to empty, established three independent ways. The evidence is preserved
  below because it still governs everything.
- **The format failed on inspection.** Real documents are not legible at phone
  size, and cropping them until they are destroys the recognition that was the
  only reason to show them. That is not a judgement call — it is what the frames
  looked like. See *Why it is drawn*.

The earlier reasoning in full is in git history. What follows is what survived.

## Why it is drawn

The first Short was built twice, and the first build is the argument for the
second.

**Attempt one: the real document, cropped to the line being discussed.** A strip
of table is not a bill. The viewer loses the one thing a document was for —
recognising their own paperwork — and gets nothing in exchange.

**Attempt two: the whole page, with a zoom panel beside it.** Honest, and
unreadable. A 564-point table row scaled to fit 1040 pixels puts the type at
about 20px in a 1920px frame. The document was on screen and nobody could read
it, which is the worst of both.

**Attempt three: crop the zoom to the phrase**, not the row — "GENERAL HOSPITAL",
"BALANCE DUE: $845.00". That works, at 60–120px type, and it is where the
document version stopped. It is a decent video. It is also four panels of grey
paperwork, and it took three rebuilds to get there.

**A drawing has none of these problems.** It is legible at any size because it
was authored at that size. It has motion by construction — a stroke being drawn
creates anticipation, and the viewer waits for it to finish, which is dwell time
on a feed that ranks on exactly that. And it can show things a document cannot:
a person, 2 a.m., a hospital, three weeks passing.

Three further consequences, all of which the old plan listed as unsolved
problems:

**The credibility objection disappears.** The old review worried that "Jane Q.
Testpatient" on screen reads as fake to someone whose problem is a real bill. A
drawing claims nothing. Nobody thinks a stick figure is their stick figure, so
nothing is being passed off as anything.

**The copyright and PHI questions stop applying.** No carrier documents, no
fixtures, no attribution, no risk of a real bill ever being near the project.

**The numbers get to be round.** A document forces you to quote it. A drawing
illustrates the shape of the problem, so it can say **$800 and $150** instead of
$845.00 and $186.35 — which is both easier to hold in your head and cheaper to
say out loud. See *House style*.

## House style

Every rule here was learned by making the first one, usually by getting it wrong
first.

### The joke is the first thing said

Not the payoff, the opening. The first version of Short 1 put the funny line at
the end of an eight-second hook and it may as well not have existed.

**Deadpan only.** The narrator is Google Cloud Studio-Q, which reads everything
at one temperature — any joke that needs timing or a smirk dies on the way out.
A joke that lives in the sentence survives. "Your hospital and your insurance
don't talk to each other. You're the group chat."

**The target is the situation, never the accusation.** Two organisations, one
visit, two numbers, and the patient is the one who has to reconcile them — that
is funny and it is true. "The hospital made this number up" is neither, and this
is a product whose entire pitch is *check before you dispute*.

### Round numbers, and as few of them as possible

Nobody holds two decimal places in their head off a feed. There is also a
mechanical cost: **"$186.35" is nine spoken words** and "$150" is three. Hook 1
originally said both exact figures and ran 11.3 seconds; the same hook without
them lands in four.

One number at a time, and only the ones the Short needs.

### Jargon under the plain word, never instead of it

The label reads **the bill**, and *itemized statement* sits under it in grey.
**NOT a bill**, and *Explanation of Benefits* under that.

Someone holding the paper has to recognise the phrase printed on it — that is
what the grey line is for — but the plain word is what makes the video make
sense. The old plan resolved this tension the other way (jargon in the title,
plain language in the script) because it was optimising for search. Search is
empty. The jargon has no job left except recognition.

**Do not call the hospital bill "the claim."** The claim is what the provider
sends the insurer; the EOB is the insurer's answer to it. On an insurance portal
claims sit on the EOB side of the story, so that label teaches the exact
confusion these videos exist to undo.

### Captions are how the video is read

Most of this audience sees the first seconds muted. The karaoke captions are not
an accessibility afterthought; they are the primary channel, and the voice is the
secondary one.

### Words to keep off the soundtrack

| Do not say | Say |
|---|---|
| adjudicated | "your insurance hasn't finished processing it yet" |
| accrues toward | "counts toward" |
| network write-off | "the discount your insurer already negotiated" |
| cost-sharing | "your share" |
| balance billing | "billing you for the discount" |

If the app's own interface does not use a word, the soundtrack should not either.
The dropzone says *"Add the letter from your insurance, if you have it"* — not
"upload your EOB".

### Answer the obvious objection inside the video

The first thing anyone thinks watching Short 1 is *"why does the insurance
company get to decide what my doctor charges?"* If that is not answered, nothing
else is believed. The answer is one sentence: the provider signed a contract
accepting the lower price in exchange for patients.

### The cast recurs, and the injury never repeats

There is a cast now — *you*, the hospital, the two envelopes. Ten Shorts that
all open on the same stick figure beside the same two envelopes will blur into
one, so **the figure gets hurt a different way every time**, and that injury is
the opening image.

It does two jobs at once. It is the variety the series needs, and it is a joke
that costs nothing: a splinter and a $2,000 bill is the whole argument of Short 6
before a word is spoken. Each Short below names its injury, and none of them is
used twice.

The injury also has to earn its place in the story — the ice in Short 2 is why it
is January, the bad back in Short 8 is why there are six visits. An injury picked
only for novelty is a wasted first second.

### Two drawing rules that are not stylistic

**A whiteboard cannot un-draw.** Before-and-after is two drawings side by side,
not one drawing modified. "This is you" and "this is you at 2 a.m." are two stick
figures, which is also the funnier read.

**The story runs top to bottom.** One direction, down the board, so the camera
only ever moves one way. Side by side is fine *within* a beat, where two things
are being compared (two envelopes, two buckets), but the story itself does not
zig-zag. Short 1 v1 ran left to right, then down, then sideways again, and it was
harder to follow for it.

**Say why, not just when.** "This is you at 2 a.m." left the viewer to guess what
had happened. "It is two in the morning, and you feel terrible, so you go to
urgent care" gives the drawing a reason.

**The camera holds two beats** — the line being drawn and the one before it.
Framing only the current strokes cuts the previous drawing in half; framing
everything drawn so far shrinks the art as the story grows.

## How one gets made

**The steps live in `video/README.md`**: setup, writing `lines.json`, voice and
timings, drawing, rendering, the checklist before anything goes public, and
publishing or replacing a Short on YouTube. This section keeps only the
reasoning behind them.

About ten minutes to write `lines.json`, twenty to thirty to draw whatever shapes
are new, two to run the pipeline. Everything regenerates from the script, so
changing a line changes the video and nothing drifts.

**The voice is `en-US-Studio-Q`**, chosen by audition. It rejects SSML `<mark>`,
which is where the caption timings used to come from, so the timings are measured
afterwards by whisper.cpp on this machine — forced alignment against a known
script, not transcription.

**Verify pronunciation rather than guessing it.** Studio-Q was reading
useclaimright.com letter by letter. Four spellings were synthesised and run back
through Whisper; `UseClaimRight.com` comes back as one word and the lowercase
form spells out.

**The release checklist exists because YouTube cannot replace a video's file.**
Every fix after publishing costs the views and breaks links; Short 1's LinkedIn
comment pointed at a video that was then replaced. Both rewrites on 2026-09-17
would have been caught by checking stills and by one first-time viewer, which is
why those two steps come before Public.

### The art library, which compounds

`video/whiteboard.py` holds the shapes. After Short 1: `person`, `person_hurt`,
`hospital`, `envelope`, `Sheet` (a page that slides out of an envelope), `phone`,
`arrow`, `ellipse` (for circling), `squiggle`, `box`, `line`, plus `T` for
handwritten text in Bradley Hand.

Each Short below names the two or three shapes it adds. They are inherited by
every Short after it, so the marginal cost falls as the series goes on — the
tenth needs almost nothing new.

## The ten

Short 1 exists. The rest are planned, not written.

Each gives the hook (the first line spoken, which is the whole game), the opening
image, the injury, the teaching beat, and the art it adds to the library.

### 1. Two numbers · MADE — 41.4s

**Hook:** *"Your hospital and your insurance don't talk to each other. You're the
group chat."*
**Opens on:** a stick figure, then the same figure doubled over at 2 a.m.
**Injury:** something abdominal, unnamed — 2 a.m. is doing the work.

Two envelopes three weeks later, $800 and $150 sliding out of them, $650 apart.
Labels both documents, circles what you actually owe, ends on *call first*.

**Teaching beat:** the two papers are different documents with different jobs,
and the insurer's letter is the one that says what you owe.

**Absorbs old videos 1 and 5**, which the earlier review flagged as nearly the
same video. Drawn, they are one.

### 2. The January reset · MADE — 34.5s (v2)

**Hook:** *"Your body does not know it is January. Your insurance does."*
**Opens on:** a figure down on ice, **1 JANUARY** above it.
**Injury:** slipped on ice — which is also why it is January.

**Teaching beat:** you pay the first $1,000 of the year yourself, and on 1 January
the bucket empties. That is why the same visit costs more in January than in
November, and it is the most common "my bill is wrong" that isn't.

**New art added:** `person_down`, `ice`, `bucket`, `bucket_fill`, `Spin` (art
that rotates about a pivot, with an option to drain a fill as it turns),
`Coins` (dollar signs that fall together).

The bucket fills by **ordering the hatch lines bottom to top** — the ordinary
stroke reveal then fills it, with no new kind of element.

**v1 was too hard to follow, and why.** A first-time viewer said so, and the
script explains it: it ran November then January, so the viewer carried a year
in their head before the point; the word arrived at 0:35; two hospital trips
each had a bill and an EOB; the November split ($100 you / $300 insurance)
quietly raised a second question — why pay anything if the bucket is full? —
which is coinsurance, Short 3's subject; and a held-open "why did they pay three
hundred?" added one more thing to carry. Each choice was defensible alone.
Together they were five things to track in 46 seconds.

**v2 opens on the confusion the viewer would actually have** — same visit,
$100 in November, $400 today — names the word straight after it, defines it in
the same breath, and shows the bucket once. November says "insurance paid most
of the bill" with no split, so there is no arithmetic and no second concept.

**The lesson for the rest:** start from the surprise the viewer already has, not
from the mechanism that explains it. Name the word within the first ten seconds.
One number per beat. Anything that belongs to another Short gets left to it.

Second because deductible is load-bearing for Shorts 7 and 8.

### 3. Copay or coinsurance · MADE — 42.5s

**Hook:** *"You tripped over your cat and hurt your knee, so you see your
doctor."*
**Opens on:** a figure hopping on one leg while the cat walks off unbothered.
**Injury:** a knee, courtesy of the cat.

**Teaching beat:** a copay is a price you can know before you go; coinsurance is
a share of a number you will not see until afterwards. The same 20% is then run
against a $400 X-ray and a $2,000 MRI — $80 and $400 — so the lesson is that the
share holds still while the number moves.

**Both charges land on ONE visit**, which is how it actually happens: the office
visit is the copay, the scan they send you for is the coinsurance. An earlier cut
had the hook say you pay 20% to see a doctor and then closed on a plan document
saying an office visit is a $30 copay — it contradicted itself. Pinning the visit
type in the first line is what exposed that, and fixing it made the Short more
useful, because the split between a copay visit and a coinsurance scan is the
thing people actually get caught by.

It closes on the plan document with both printed side by side (*office visit
$30, emergency 20%*), which is the actual answer to "which one do I have": both,
depending on the visit. That is what the cat is for — tripping over it is the
cheapest possible reason to see a doctor, and the question is which column that
lands in.

**The hook has to be a scene, not a statement.** The first cut opened on "your
plan says you pay twenty percent," which is a sentence about a document, and it
made this the odd Short out: 1 and 2 both open on something happening to a
person. Moving the question to the second beat costs nothing — the big red 20%
is then the first thing drawn in that beat rather than the third thing in the
hook — and the Short got 4 seconds shorter in the process.

**New art added:** `person_hop`, `cat`, `coin`, `pie`.

**Made third, against this document's own order (1, 2, 4).** Short 2 showed you
paying $100 of a $400 bill and never said why it was $100 — that is coinsurance.
Short 3 answers a question Short 2 left open, the way Short 2 answered one Short
1 left open. Short 4 is next.

A drawing lesson from it: the injury was first drawn as someone sitting holding
their ankle, and a seated stick figure is a pile of crossing lines that reads as
a scribble. One foot off the ground is a silhouette that needs no explaining.

### 4. A charge your insurance has never seen · MADE — 34.9s

**Hook:** *"A bee stung you, and your hand swelled up like a rubber glove. So you go to your doctor."*
**Opens on:** a figure with a balloon of a hand, and the bee that did it.
**Injury:** a bee sting — small, and it still produces a line nobody can explain.

**Teaching beat:** the bill lists three charges and the insurance letter lists
two. The missing one is usually **pending**, not wrong: charges reach your
insurance at different times. Don't pay that line yet; wait for the letter that
lists it, or ask "has this been sent to my insurance?"

**New art added:** `bee`, `swollen_hand`, `clock`, and two lists as boxes of rows.

First Short written after the "Before it goes public" checklist and the
2026-09-17 rewrites. The surprise (three rows against two) is the second line;
"pending" is named and defined by about 0:12; one idea, timing, with no second
concept; one number, the $100 shot; top to bottom. The gap in the letter's list
sits level with the shot, so the missing row is visible before it is said.

### 5. The phone call

**Hook:** *"They paid. Then the hospital billed you for the discount. Here is the
sentence to say."*
**Opens on:** a phone, and one sentence written out to be read aloud.
**Injury:** an arm in a sling — already treated, now arguing.

**Teaching beat:** balance billing, and that a network contract forbids it — but
the payload is **the sentence**, written on screen, that a viewer reads down the
phone.

**Recast from an explainer to a procedure**, because as an explainer it was the
same drawing as Short 1: two papers with different numbers. The earlier review
had already reached this conclusion about old video 3 and it did not carry over.
As a procedure it is the most valuable Short in the set.

**Highest stakes in the series.** It tells someone not to pay a bill, and a stick
figure is weak authority for that. The disclaimer goes **on screen, in words**,
drawn like everything else — not in a description nobody opens.

**New art:** a speech bubble with words in it, a contract with two signatures.

### 6. The sticker price is fiction

**Hook:** *"A splinter. Two thousand dollars."*
**Opens on:** three bars of wildly different heights.
**Injury:** a splinter — the gap between the injury and the number is the joke.

**Teaching beat:** billed, allowed, your share — three different numbers, and
only one is real. The allowed amount is the only one worth arguing about.

**New art:** three bars.

The strongest visual in the set. A candidate to bring forward if Short 2 or 4
turns out to be harder to draw than it looks.

### 7. A family deductible is not two of yours

**Hook:** *"Two people, two deductibles — and a third one you did not know
about."*
**Opens on:** two figures and three buckets.
**Injury:** a child with a broken arm, and a parent who is fine.

**Teaching beat:** a family plan has a limit for each person and a limit for the
household, and your bills count toward one of them. The insurer's letter is the
only document that says which.

**New art:** buckets in two sizes, a smaller figure.

### 8. Six visits, and nobody says where you are

**Hook:** *"Your plan covers six visits. Nothing tells you it is visit six."*
**Opens on:** six boxes, five of them ticked.
**Injury:** a bad back — the injury that takes six visits.

**Teaching beat:** the count is often printed on the insurer's letter and nobody
reads that far. Running out costs care, not just money.

**New art:** six boxes, ticks.

### 9. Same day, same code, not a duplicate

**Hook:** *"Two identical charges, same day, same clinic. This one is fine."*
**Opens on:** two figures with matching plasters on their arms.
**Injury:** flu shots — two people, two sore arms.

**Teaching beat:** same day and same code is not a duplicate; two people can get
the same shot. **Same day, same code, same person** is.

The Short that teaches when *not* to dispute, which buys more trust than the ones
that teach when to.

**New art:** a plaster, a second smaller figure holding a matching sheet.

### 10. One line, no explanation

**Hook:** *"Your bill has one line on it. Ask for the one with all of them."*
**Opens on:** a sheet with a single line and an enormous number.
**Injury:** wrapped head to toe in bandages, unexplained — because the bill does
not explain either.

**Teaching beat:** a summary bill cannot be checked. The **itemized** bill is the
one with the codes and the line items, you are entitled to ask for it, and it is
the document every other Short in this series assumes you have.

**New art:** a bandaged figure, a long itemized list unrolling.

**Replaces "Three plans, one booklet"**, which was dropped for weak subject
matter rather than format. That one was really about our own plan-selection flow
— a problem people have with the app, not a problem they have with their mail.
This one is the single most recommended first action in every bill-dispute guide,
it is trivially visual, and it is on-strategy: an itemized bill is the document
that makes the product work at all.

**On the bench, if the series gets past three:** out-of-network care inside an
in-network hospital (the anaesthetist nobody chose — high incidence, and the No
Surprises Act means it needs care), and a free annual physical that arrives with
a bill because a symptom got mentioned.

## Order, and why it is short

**1 is made. Publish it. Then 2, then 4. Then stop and look.**

That is three Shorts, not ten, and the reason is that **nothing has ever been
published**. The channel exists (`@useclaimright`, `UCk3LT3FEx9ht_CwEZbZ3B7g`,
created 2026-09-14) and is empty, so there is no retention data, no feed
behaviour, and no evidence that a drawing holds a swipe any better than a
document did.

Making ten before publishing one would be building on an unverified premise for
the second time in this document.

2 comes before 4 because deductible is load-bearing for 7 and 8. 4 comes third
because it is the most immediately useful. 5 waits until the format is settled,
for the reason given in its entry.

**At a glance**, so the sameness risk stays visible — no two open on the same
image, and no injury repeats:

| # | Opens on | Injury |
|---|---|---|
| 1 | a figure doubled over at 2 a.m. | abdominal, unnamed |
| 2 | an empty bucket, 1 JANUARY | slipped on ice |
| 3 | a figure hopping, the cat walking off | knee, courtesy of the cat |
| 4 | two lists, one a row longer | bee sting |
| 5 | a phone and one sentence to read | arm in a sling |
| 6 | three bars of wildly different heights | a splinter |
| 7 | two figures, three buckets | child's broken arm |
| 8 | six boxes, five ticked | bad back |
| 9 | two figures with matching plasters | flu shots |
| 10 | one line and an enormous number | bandaged head to toe |

## What we still do not know

**Whether the drawing holds attention.** The old format's risk was retention and
it was sold on cost; the same trap is available here. A whiteboard is more
watchable than a cursor on a PDF, but "more watchable than the worst option" is
not a standard.

**Whether the humour lands or grates.** It is deadpan under a synthetic voice.
That could read as dry and confident or as flat. One published Short answers it.

**How the first hundred views happen.** Feed distribution is the mechanism, but a
channel with no subscribers is not owed any. The honest answer may still be that
Reddit and forum threads are the distribution and the Short is the thing linked
rather than the thing discovered.

**Do not use the "80% of medical bills contain errors" statistic.** It is
everywhere, poorly sourced, and one unsupported number undoes the credibility the
other nine are for.

**Say what the app cannot do.** It does not decide whether a CPT code was right,
and it does not know whether care was appropriate. It reads three documents and
reports where they contradict each other. Saying so is not a weakness; it is the
reason to believe the parts it does claim.

## The evidence that killed the search plan

Measured 2026-09-14, three independent ways, all agreeing. This governs the
format choice above and is kept in full because it is the most expensive thing in
this document.

### 1. Hand-searching the titles

| Query | Top result | Views | Age |
|---|---|---|---|
| explanation of benefits not a bill | exact-title match | **8** | 6 months |
| " | DeltaDentalAZ, institutional | 2.2K | **10 years** |
| why is my medical bill higher than my eob | "Why Is My EOB Not A Medical Bill?" | **3** | 9 months |
| what does allowed amount mean | Inlera University | **12K** | 6 years |

A video whose title exactly matches the search, six months old, with eight views,
is not a discoverability problem. It is an absence of searchers.

### 2. YouTube autocomplete, which is ordered by real volume

Typing **"medical bill"** returns, in order: *medical billing and coding ·
medical billing · medical billing and coding day in the life · medical billing
for beginners · medical billing training videos.*

**Every one is somebody training for a job in billing.** Not one is a patient.
"what does allowed amount" completes to *"in medical billing"* and *"in medical
billing tamil"* — the offshore billing workforce. That explains Inlera's 12K: it
is a training channel and those are students. The eight-view video is the one
actually aimed at patients.

"why is my medical bill" completes to three things, and all three are **"can I
avoid paying this?"** — *what happens if i don't pay my medical bills · how to
get medical bills reduced · should i pay my medical bills.* None is "help me
understand this document."

### 3. YouTube Studio Research, which is YouTube's own label

| Searched | What it returned | Label |
|---|---|---|
| medical bill | out of network medical billing · patient calling in medical billing | **Low · Low** |
| dispute medical bill | how to remove medical bills from credit report · **dispute collections on credit report** | Low · **Medium** |
| explanation of benefits | what is cost benefit analysis · what is the benefit of eating | Low · Low |

**YouTube does not recognise "explanation of benefits" as an insurance topic at
all.** It matched the word *benefits* and offered cost-benefit analysis and the
benefits of eating. The phrase has so little volume in its insurance sense that
the topic engine has not learned it exists.

The one Medium term — *dispute collections on credit report* — is a different
product. UseClaimRight finds billing errors; it does not remove entries from
credit reports.

### What follows from it

**The 4.1M-view Short on negotiating medical bills did not come from search.** It
cannot have; the volume is not there. It came from the Shorts feed, which
distributes on watch-through and does not care whether anyone typed anything.

So:

- **Keyword titles are close to pointless here.** The title's job is to hold
  someone already being shown the video. It is a hook, not a keyword.
- **The first two seconds decide everything** — not the title, not the thumbnail.
- **The written page is the better instrument for search demand**, because the
  demand is on Google, not YouTube. Three advertisers bid on "how to dispute a
  medical bill", one of them — testmybill.com — with our exact pitch. That is the
  recommendation with the most evidence behind it and the least work in it, and
  it is still not done.

Shorts are a cheap bet placed alongside that page, never instead of it.

## Open work

- **Write the page for Google.** Still the highest-evidence recommendation in
  this document and still unstarted.
- **Retire the document renderer** (`video/render.py`, `superseded-document-short/`,
  `05-eob-is-not-a-bill/`) and the unused `@google/genai` dependency. Nothing uses
  them since the whiteboard format; git history keeps them.
- **Replace the two remaining v1 uploads** (Shorts 1 and 2): publish the new cuts,
  then delete the old ones by hand. See `video/README.md`.
