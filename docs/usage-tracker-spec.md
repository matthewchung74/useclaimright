# Usage & Benefits Tracker — cumulative view across audits

## Context

Every audit today is an island: the engine catches errors within one bill+EOB pair but nothing accumulates. Users with recurring care (therapy, PT, chiropractic) need the cumulative picture — "I've used 5 of my 6 covered visits" — and early warning before a visit stops being covered. All the raw material already exists in saved audits (occurrence tables, kept dates of service); this feature aggregates it and extends the extraction schema to harvest what EOBs reveal about plan accumulators and limits.

Key design fact settled during spec: EOBs do NOT normally state plan limits ("6 visits/year" lives in the Summary of Benefits), but EOBs DO often carry (a) accumulator snapshots ("deductible met to date: $450 of $1,500") and (b) remark lines when a maximum is hit ("services exceed benefit maximum"). v1 therefore: harvest accumulators + remarks from every EOB automatically; limits are user-entered, with the app SUGGESTING a tracker whenever a remark reveals a maximum.

## Current State (verified 2026-08-06)

- Audits stored at users/{uid}/audits/{auditId}: redactedBill, redactedEob, findings, totals, occurrenceTable [{code, description, count, unitCharges[]}], model, ocrConfidence, createdAt. No service dates, no provider, no deductible fields.
- Dates of service are intentionally KEPT during de-identification (audit keys) — available in redacted text but not structured.
- Firestore rules: users/{uid}/audits owner read/delete only, Function sole writer; users/{uid}/meta locked entirely. No client-writable settings path exists.
- Function: callable analyze, Gemini 3.6 Flash via provider adapter, Ajv-enforced schema, bill-only mode supported.

## Proposed Change

### A. Extraction schema v2 (functions/schema.js + prompt)

Additive fields, all populated by the model from the documents (never invented — empty/null when absent):

- Top-level: `serviceDates: string[]` (ISO YYYY-MM-DD, every distinct date of service found), `provider: string` (billing provider name), `payerRemarks: string[]` (verbatim remark/note lines that mention benefit maximums, visit limits, or non-coverage reasons; empty when none).
- Per occurrence row: `dates: string[]` (dates of service for that code, when determinable).
- `accumulators` (from the EOB; null when not stated): `{deductibleToDate, deductibleLimit, oopToDate, oopLimit, deductibleAppliedThisClaim}` — all `number|null`.
- Bill-only audits: accumulators all null, payerRemarks may come from the bill.
- Prompt addition: "Extract accumulator lines and benefit-maximum/limit remarks VERBATIM when present; use null/[] when absent. Never infer a limit that is not printed."
- Ajv + Gemini responseSchema updated together. Old audits lacking new fields remain valid (fields optional in read paths).

### B. Trackers — user-defined limits (new Firestore path + rules)

- Path: `users/{uid}/trackers/{trackerId}`: `{label, codes: string[], limit: number, planYearStartMonth: 1-12 (default 1), createdAt}`.
- Rules change: `users/{uid}/trackers/**` — owner read/write/delete (pure preference data; no integrity concern). Audits and meta stay locked as today.
- Presets in the "Track a limit" form: Psychotherapy (90832, 90834, 90837), Physical therapy (97110, 97112, 97530), Chiropractic (98940, 98941, 98942), Acupuncture (97810, 97811, 97813, 97814), Custom (free-entry codes).

### C. Aggregation module (web/js/usage.js — pure functions, unit-testable)

- `planYearWindow(startMonth, today)` → {start, end} of the current plan year (handles cross-calendar-year windows, e.g. start month 7 → Jul 1–Jun 30).
- `visitsUsed(audits, tracker, window)` → {count, contributions: [{auditId, date, code, provider, approximate}]}. Counting rule: one visit per (serviceDate, matched code) pair per audit; an audit whose occurrence row count exceeds its dates contributes max(count, dates.length) with `approximate: true`. Audits with no structured serviceDates fall back to createdAt date, flagged `approximate: true`.
- `latestAccumulators(audits, window)` → most recent non-null accumulator snapshot within the window, plus `summedDeductibleApplied` computed across the window's audits as a cross-check; both surfaced when they disagree by > $1.
- `suggestedTrackers(audits)` → codes whose payerRemarks mention max/limit language, for the suggestion banner.
- `warningLevel(count, limit)` → "ok" | "near" (count === limit − 1) | "at" (count === limit) | "over".

### D. UI — "Coverage usage" section (app.html, between upload card and history)

- One card per tracker: label, progress bar `count / limit` for the current plan year, color by warningLevel (teal / amber "one covered visit left" / red "limit reached — further visits may be member responsibility"), expandable list of contributing visits (date · code · provider, "~" marker when approximate), delete-tracker button.
- Deductible card (shown when any audit in-window has accumulator data): "Deductible: $X of $Y met" from latestAccumulators; cross-check line when the summed per-claim amounts disagree; "as of [date of newest EOB]" caveat.
- "Track a limit" form (collapsed by default): preset dropdown + codes + limit + plan-year start month.
- Suggestion banner: when suggestedTrackers finds remark-derived codes with no matching tracker: "Your insurer mentioned a benefit maximum for [code/description] — want to track it?" one-click prefill.
- Report integration: after each analyze, if the new audit's codes match a tracker, the report shows "This appears to be visit N of L for [label]" with warningLevel styling. GA event `tracker_warning_shown` when level ≥ near (event name only, no health data).

### E. Explicitly out of scope

- Dedup / same-document safeguards (separate small task, already agreed).
- Parsing limits from Summary of Benefits documents (v2 candidate).
- Family/multi-member aggregation, multi-plan years history view, insurer API integrations.

## Acceptance Criteria

1. Schema v2 round-trips: an audit of the synthetic therapy fixtures stores serviceDates, provider, accumulators, payerRemarks; an old-format audit (no new fields) still renders in history and report without errors.
2. Creating a "Psychotherapy, limit 6, plan year Jan" tracker with 5 seeded therapy audits shows 5/6 amber ("one covered visit left") with 5 dated contributions.
3. Running the 6th therapy audit flips the tracker to 6/6 red AND the visit-6 report carries "visit 6 of 6" with red styling.
4. A PT-code audit does not change the psychotherapy tracker's count (grouping isolation).
5. Deductible card shows the visit-6 EOB's accumulator snapshot ($720 of $1,500 per fixtures) and the summed cross-check agrees.
6. Visit-6 EOB's benefit-maximum remark produces the suggestion banner when no tracker exists (tested with trackers deleted).
7. Rules: another user cannot read/write my trackers (emulator rules test); audits remain client-unwritable.
8. Old audits without serviceDates contribute with the "~" approximate marker, not silently dropped.
9. All unit tests pass (`npm --prefix functions test`); Ajv accepts model output for all six fixture pairs on the first or retry attempt.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit (usage.js) | planYearWindow (Jan start, Jul start crossing year boundary, leap year), visitsUsed (multi-code grouping, per-date counting, approximate fallback, window exclusion of prior-year visits), latestAccumulators (latest-wins, disagreement flag), warningLevel thresholds, suggestedTrackers remark matching | +10 |
| Unit (schema) | v2 fields validate; nulls accepted; old-format audit object passes read-path guards | +3 |
| Rules (emulator) | trackers owner-only read/write; cross-user denied; audits still client-unwritable | +3 |
| E2E (emulator + browse) | Seed 5 therapy audits (fixtures below) → create tracker → verify 5/6 amber; audit visit 6 → 6/6 red + report line; audit PT pair → therapy count unchanged; delete trackers → suggestion banner appears after re-viewing visit-6 audit | 1 scripted pass |
| Live smoke | Signed-out pages render; tracker section hidden when signed out | 1 |

## Synthetic Test Dataset (fixtures to generate at build time)

Same fake patient (Jane Q. Testpatient canary set) and generator approach as the existing fixtures (HTML → PDF via headless browser, digital text layer). Provider: "Testville Behavioral Health Associates". Insurer: Acme Health, plan year = calendar 2026, deductible $1,500, therapy allowed $120/visit, 20% coinsurance after deductible.

**Series T — psychotherapy (code 90837, billed $175, allowed $120), monthly visits:**

| Pair | Date of service | EOB deductible-to-date | EOB remark | Expected tracker state after audit |
|---|---|---|---|---|
| T1 | 2026-01-15 | $120 of $1,500 | — | 1/6 ok |
| T2 | 2026-02-12 | $240 of $1,500 | — | 2/6 ok |
| T3 | 2026-03-11 | $360 of $1,500 | — | 3/6 ok |
| T4 | 2026-04-15 | $480 of $1,500 | — | 4/6 ok |
| T5 | 2026-05-13 | $600 of $1,500 | "5 of 6 covered outpatient mental health visits used this plan year" | 5/6 near (amber) |
| T6 | 2026-06-10 | $720 of $1,500 | "BENEFIT MAXIMUM REACHED: your plan covers 6 outpatient mental health visits per calendar year. Additional visits are member responsibility." | 6/6 at (red); suggestion banner source |

**Series P — physical therapy isolation control (code 97110, billed $210, allowed $95):**

| Pair | Date | Purpose |
|---|---|---|
| P1 | 2026-03-20 | Audited alongside Series T; psychotherapy tracker count must NOT change; a "Physical therapy, limit 20" tracker shows 1/20 |

**Edge-case fixtures (unit-level, no PDFs needed — JSON audit documents seeded directly into the emulator):**

- E1: audit with occurrence count 2 but one date (double-billed visit) → contributes 2 with approximate flag.
- E2: old-format audit (no serviceDates/accumulators) dated via createdAt → approximate contribution.
- E3: audit dated 2025-12-20 → excluded from a Jan-start 2026 window; included in a Jul-start window test.

Expected answer key lives next to the fixtures as `test-fixtures/series-expected.json` so the E2E script asserts numbers, not vibes.

## Files Reference

| File | Change |
|---|---|
| functions/schema.js | v2 fields (serviceDates, provider, payerRemarks, accumulators, per-row dates) |
| functions/providers/gemini.js | prompt: extract accumulators/remarks verbatim, never infer |
| functions/index.js | pass-through of new fields into the audit document |
| firestore.rules | users/{uid}/trackers owner read/write |
| web/js/usage.js | NEW — pure aggregation functions |
| web/js/app.js | tracker CRUD, usage section render, report visit-count line, suggestion banner |
| web/app.html | Coverage usage section + track-a-limit form styles |
| functions/test/usage.test.js | NEW — unit tests |
| functions/test/rules.test.js | tracker rules cases |
| test-fixtures/gen-series.mjs | NEW — generates T1-T6, P1 HTML+PDF and series-expected.json |

## Rollback

All schema changes are additive; old clients ignore new fields. Feature rollback = hide the usage section (one deploy); tracker docs are inert preference data. No migration required either direction.

## Effort Estimate (CC-assisted)

| Component | Est. |
|---|---|
| Schema v2 + prompt + function pass-through | ~45 min |
| usage.js + unit tests | ~1 hr |
| Fixtures generator + expected answer key | ~45 min |
| UI (usage section, form, report line, banner) | ~1.5-2 hrs |
| Rules + rules tests | ~20 min |
| Emulator E2E scripted pass + deploy + live smoke | ~1 hr |
| Total | ~half a day |
