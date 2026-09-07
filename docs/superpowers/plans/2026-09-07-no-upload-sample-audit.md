# No-Upload Sample Audit (+ flow GIF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A visitor can see a complete, real audit report — four totals and three findings, each with its quoted evidence openable — **without signing in and without spending a model call**. Today the funnel is landing page → "Audit my bill" → sign-in wall, and nothing has been demonstrated at the point the account is asked for. This is the highest-leverage change for a free launch with no marketing spend, because organic traffic converts on the result, not the pitch.

**Architecture:** `/app?sample=1` renders the app's **genuine** `#report` section through the existing `renderReport()`, populated from a committed JSON fixture captured from a real E1 run on production. No second report layout is built. This is the load-bearing decision: on 2026-08-28 the dashboard was found duplicated inside `<section id="upload">` with 17 duplicated element ids, so `getElementById` always returned the wrong copy and the visible one was never populated. A hand-built "sample report" on the marketing page is that same failure with a slower fuse — two layouts that drift, and the one prospects see is the one nobody maintains. Going through `renderReport()` makes drift structurally impossible.

**Tech Stack:** No new dependencies. Vanilla-JS ESM client, a static JSON fixture fetched lazily (so signed-in users never pay for it), `node:test` + Playwright in `test/browser/`.

## Global Constraints

- **Zero model calls.** The fixture is committed; `?sample=1` must never reach `analyze`. A sample that costs a penny per curious visitor is a sample that gets removed the first time it is linked somewhere busy.
- **The bill must be visibly synthetic.** The fixture is Jane Q. Testpatient at St. Verification General Hospital. A page rendering medical line items and dollar figures without saying it is made up reads as a real person's record. The banner is not optional and must sit **above** the totals, not in a footer.
- **No duplicated report markup.** If a task tempts you to copy a card, a total or a finding row into `index.html`, stop — link to `?sample=1` instead.
- **No new fonts, no new palette tokens.** DESIGN.md governs; the report is already compliant and the sample reuses it. The highlighter `#E8F25C` stays on "Worth disputing" only.
- **No invented numbers.** The figures are whatever the captured run produced. Do not round, re-word a finding, or "improve" the model's prose — the honesty of the sample is the point of it.
- Run `graphify update .` after code changes (project rule). Commits end with the repo's standard Co-Authored-By footer.
- Do not consume live audits. The fixture is captured once from an audit that **already exists** in history; nothing in this plan runs a new one.

## File Structure

- `web/sample-audit.json` (create) — the captured E1 result: `totals`, `findings`, `occurrenceTable`. Fetched only when `?sample=1`.
- `web/app.html` (modify) — `#sample-banner` above the report; sample-mode CTA; a "see a sample" link on the sign-in card.
- `web/js/app.js` (modify) — `sampleMode()` check, fixture fetch, branch in `onAuthStateChanged`, button visibility in sample mode.
- `web/index.html` (modify) — a compact section between the hero and `#how` linking to the sample.
- `web/img/flow.gif` (create, Task 6) — the upload leg only.
- `test/browser/ui.test.js` (modify) — sample renders, totals correct, evidence openable, no network call to `analyze`.
- `test/browser/drift.test.js` (modify) — every finding `type` in the fixture still exists in `functions/schema.js`.

---

## Task 1 — Capture the fixture

- [x] Read the E1 audit document from the signed-in account's history (`users/{uid}/audits/{id}`) — the 2026-09-07 run: billed $2,115.00, EOB allowed $841.75, responsibility $186.35, worth disputing **$822.15**, findings `duplicate_charge` $145.50, `billed_vs_allowed_mismatch` $658.65, `cost_share_error` $18.00.
- [x] Write `web/sample-audit.json` containing **only** `totals`, `findings` and `occurrenceTable`. Strip `billText`, `eobText`, `patientName`, `statementId`, timestamps, uid and model/token metadata — none of it renders, and a fixture carrying document text is a document published by accident.
- [x] Verify by eye that every string in the file comes from the synthetic fixtures (Jane Q. Testpatient, St. Verification General Hospital, Acme Health Insurance). **If any real name appears, stop** — the wrong audit was captured.
- [x] Verify: `node -e` parses it and asserts `totals.totalAtStake === 82215` (or the stored unit) and `findings.length === 3`.

**Why this audit:** the third finding is the reason. A duplicate charge is what people expect a bill checker to find. `cost_share_error` — the EOB's own per-line amounts summing to $168.35 while it states $186.35 — is the insurer's statement contradicting itself, and that is the moment a reader stops skimming.

## Task 2 — Sample mode in the app

- [x] Add `const sampleMode = () => new URLSearchParams(location.search).get("sample") === "1";`
- [x] In `onAuthStateChanged`, check sample mode **before** both branches — signed out *and* signed in — so the URL is linkable by anyone and testable without auth. A signed-in visitor who follows the link should see the sample, not be bounced to their dashboard.
- [x] `showSample()`: `fetch("/sample-audit.json")` → `renderReport(data, {})` → reveal `#sample-banner` → `show("report")`.
- [x] Set `lastAuditId = null` in sample mode so nothing can act on a report that has no document behind it.
- [x] Hide `#gen-email` and `#new-audit` in sample mode; leave `#print-report`. The call to action here is signing up, not the letter.
- [x] On fetch failure fall through to the normal route rather than showing a broken report — a sample that 404s must not become a dead screen.
- [x] Verify: `/app?sample=1` signed out renders four totals; signed in renders the same; `/app` unchanged in both states.

## Task 3 — The banner and the CTA

- [x] `#sample-banner` above `#report-totals`, using the existing `.banner` class (not `.error`): *"This is a sample audit on a sample bill, so you can see what a result looks like before signing up."* with an **Audit my bill →** button linking to `/app`. *(Wording settled 2026-09-07: "made-up bill" became "sample bill" and the trailing "Nothing here is a real person's" was cut. The constraint above is still met — "sample" is the disclosure — and the shorter line is the one that gets read.)*
- [x] A second CTA below the findings, after someone has read them — the same link. One at the top for people who bounce, one at the bottom for people who are convinced.
- [x] Verify at 375px: banner wraps, button reaches 44px, nothing overflows. `ui.test.js` already iterates every section for overflow and tap targets, so this is covered once the section renders.

## Task 4 — Entry points

- [x] `web/index.html`: a compact section between the hero and `#how` — headline result in text plus the link. Something like *"A $2,115 hospital bill, audited: $822.15 worth disputing, including an $18 error in the insurer's own arithmetic."* → **See the sample audit →**. Text only; **do not** rebuild the totals cards here.
- [x] Placement is deliberate: **before** "How it works". That section describes the process; the sample demonstrates the outcome, and people decide on the outcome.
- [x] `web/app.html` sign-in card: *"Not sure yet? See a sample audit first."* below the reCAPTCHA attribution. This is the wall an HN spike actually hits.
- [x] Verify: both links resolve to `/app?sample=1` and render.

## Task 5 — Tests

- [x] `ui.test.js`: load `/app?sample=1`, assert the four totals read $2,115.00 / $841.75 / $186.35 / $822.15, three finding groups render, and at least one `<details>` evidence block exists and opens.
- [x] `ui.test.js`: assert **no request to `analyze`** is made while the sample renders — this is the constraint that keeps it free, and it should fail loudly if someone later wires it to a live call.
- [x] `drift.test.js`: every `type` in the fixture appears in `functions/schema.js`. A finding type renamed server-side would otherwise render as an unlabelled group in the one report prospects see.
- [x] Break each new assertion once and confirm it fails before trusting it.


**Tasks 1–5 completed 2026-09-07.** One thing the sample immediately exposed, fixed in the
report rather than in the sample as this plan requires: the Evidence block rendered `Bill: ""`
for any finding whose evidence lives in one document only. `cost_share_error` is pure EOB
arithmetic and quotes no bill line, so the first thing a prospect would have opened showed empty
quotes under a heading called Evidence — in the one place whose entire promise is showing its
sources. The bill line was unconditional while the EOB line was guarded, and `sbcQuote` was
never rendered there at all. All three are now guarded symmetrically via `EVIDENCE_SOURCES`.

## Task 6 — The flow GIF (separate, lower priority)

The live sample answers *"are the findings any good?"*. It cannot answer *"what is this like to use?"* — that is the upload → review → processing leg, and it is the only thing a GIF is better at.

- [x] Record on production with the Chrome tooling's `gif_creator`, driving a **real** run on the E1 fixtures. Do not mock frames.
- [x] **6–10 seconds**, upload leg only, ending as the findings appear. The sample takes over from there.
- [x] Budget **≤2MB**. Acquisition is organic and mobile-heavy; a multi-megabyte hero GIF is a real cost. If it will not fit, cut seconds before cutting resolution.
- [x] Place in `#how`, `loading="lazy"`, with alt text describing the flow for anyone who cannot see it.
- [x] Add a dated note in `docs/LAUNCH.md` recording what build it was recorded against. **A GIF is the most drift-prone artifact in the repo** — nothing fails when the UI moves on — so the mitigation is that its staleness is at least written down next to the launch pitch that links it.

## Risks

| Risk | Mitigation |
|---|---|
| The sample is mistaken for a real patient's record | Banner above the totals, synthetic names throughout, Task 1's stop-condition |
| The fixture drifts from the findings schema | Task 5's drift check |
| Someone later "improves" the sample by hardcoding it into `index.html` | The constraint is stated twice above; the drift check only guards the fixture, not a copy |
| Sample indexed and ranking for a real query | Judged acceptable — an indexable worked example is *useful* for organic acquisition, and the banner carries the disclosure. Revisit if it ever outranks the landing page |
| The GIF goes stale | Accepted and recorded; it is why the GIF is Task 6 and not Task 1 |

## Out of scope

- Multiple samples, or letting the visitor pick a bill. One good example beats a gallery.
- Rendering the sample inline on the landing page. It is a link, on purpose.
- Any change to `renderReport()` itself. If the sample needs the renderer changed, the change belongs to the report, not the sample.
