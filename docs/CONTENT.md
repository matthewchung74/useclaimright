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

**The camera holds two beats** — the line being drawn and the one before it.
Framing only the current strokes cuts the previous drawing in half; framing
everything drawn so far shrinks the art as the story grows.

## How one gets made

    node video/tts.mjs shorts-02-whiteboard        # WAVs, en-US-Studio-Q
    python3 video/align.py shorts-02-whiteboard    # word timings, local Whisper
    python3 video/whiteboard.py shorts-02-whiteboard

About ten minutes to write `lines.json`, twenty to thirty to draw whatever shapes
are new, two to run the pipeline. Everything regenerates from the script, so
changing a line changes the video and nothing drifts.

**The voice is `en-US-Studio-Q`**, chosen by audition. It rejects SSML `<mark>`,
which is where the caption timings used to come from, so the timings are measured
afterwards by whisper.cpp on this machine — forced alignment against a known
script, not transcription. `video/README.md` has the setup.

**Verify pronunciation rather than guessing it.** Studio-Q was reading
useclaimright.com letter by letter. Four spellings were synthesised and run back
through Whisper; `UseClaimRight.com` comes back as one word and the lowercase
form spells out. That loop costs nothing and should be used on every domain,
abbreviation and dollar figure.

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

### 2. The January reset · next

**Hook:** *"Your January bill is not a mistake. It is a reset."*
**Opens on:** an empty bucket with **1 JANUARY** written over it.
**Injury:** slipped on ice — which is also why it is January.

**Teaching beat:** you pay the first $X of the year yourself, and on 1 January
the counter goes back to zero. That is why the same visit costs more in January
than in November, and it is the most common "my bill is wrong" that isn't.

**New art:** a bucket that fills, a calendar page, a counter snapping to 0, a
figure flat on its back.

Second because deductible is load-bearing for Shorts 7 and 8.

### 3. Copay or coinsurance

**Hook:** *"One of these is a price. The other is a percentage of a price nobody
has told you yet."*
**Opens on:** a coin with **$60** on it, beside a pie chart with no total.
**Injury:** a twisted ankle, on the way into a routine appointment.

**Teaching beat:** a copay is fixed and knowable before you go; coinsurance is a
share of a number you will not see until afterwards. Which one your plan says is
how you check a bill at all.

**New art:** a coin, a pie with its total missing.

### 4. A charge your insurance has never seen

**Hook:** *"There is a line on your bill your insurance has never seen."*
**Opens on:** two lists side by side, one row longer than the other.
**Injury:** a bee sting — small, and it still produces a line nobody can explain.

**Teaching beat:** usually **timing, not fraud** — they have not finished
processing it. Do not pay it, do not panic, ask.

**New art:** two lists, a clock.

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
| 3 | a $60 coin beside a pie with no total | twisted ankle |
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

- **Publish Short 1.** Requires a person; the channel needs a sign-in.
- **Apply the channel description and keywords** from `video/channel-setup.md`.
- **Write the page for Google.** Still the highest-evidence recommendation in
  this document and still unstarted.
- **Decide what happens to `video/render.py`**, the document renderer. It works,
  it is tested against the fixtures, and nothing currently plans to use it. Keep
  it or retire it deliberately rather than letting it rot.
