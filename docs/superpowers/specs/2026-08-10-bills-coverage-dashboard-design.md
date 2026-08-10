# Bills & Coverage Dashboard — Design

**Date:** 2026-08-10 · **Status:** Awaiting user review (spec-first per plan; no code yet)
**Designer-voice input incorporated in full (2026-08-10).**

## Context

Users want to sign in and see all their bills and remaining coverage at a glance. Today that story is split across a flat "Your past audits" list (date · provider · findings · $) and the Coverage usage cards. All required data already loads client-side: `allAudits`, `allTrackers`, `activePlan.structured`, and `latestAccumulators()`. This is a **rendering/regrouping change — zero Firestore schema changes, zero new data sources.**

## Placement

Same `#upload` section, same position below the upload card. The two headings "Coverage usage" and "Your past audits" merge into one **"Bills & coverage"**, ordered coverage-first (money left to spend), bills second (money in dispute). Deliberately NOT a new `show()` section or nav — the app has no nav by design; adding one is a bigger product decision than this feature.

## Coverage-at-a-glance

A repositioning of existing elements plus one genuinely new card:

```html
<div class="coverage-row"><!-- grid, 2-up -->
  <div id="deductible-card"></div>
  <div id="oop-card"></div>
</div>
<div id="usage-list"></div><!-- tracker cards, unchanged, stacked below -->
```

- `.coverage-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}` — same grid idiom as `.plan-grid`/`.totals`.
- `#deductible-card` and `#usage-list` keep their markup and `renderUsage()` logic untouched; only the wrapper changes.
- **`#oop-card` is the new piece** — closes a real gap: `oopToDate`/`oopLimit` are extracted by the schema and never rendered anywhere. Built exactly like the deductible card (`.usage-card` + `.progress`, guarded render: paint only when `snapshot.oopToDate` is a number OR `structured.oopMax` exists, else empty). Requires a pure `oopTarget(structured, snapshot)` in `web/js/plan.js` mirroring `deductibleTarget()` (SBC owns the limit, EOB owns progress), with node:test coverage.
- The plan-line strip stays number-free (its existing contract); no duplication of figures on the page.

## Bills grouped by provider

Replace the flat `#history-list` loop with per-provider `<details>` groups (native disclosure — the pattern `details.explain` already established):

```html
<details class="provider-group" open>
  <summary class="pg-summary">
    <b>Mercy General Hospital</b>
    <span class="muted">3 bills</span>
    <span class="mono-money pg-total">$612 worth disputing</span>
  </summary>
  <div class="bill-row">
    <span class="bill-date">Mar 12, 2026</span>
    <span class="bill-findings">2 findings</span>
    <span class="bill-status found">$420</span>
  </div>
</details>
```

- **Grouping:** client-side over `allAudits` by `provider`; blanks bucket into "Provider not read" (never drop rows). Group order = most recent audit in group, descending.
- **Row:** date (`serviceDates[0]` else `createdAt`), findings count, dispute amount as a **status pill** — `.bill-status.found{background:#E8F25C}` reusing the report's found-money mark color literal (never a new hex); zero-finding rows get a muted gray pill "No discrepancies." No CPT codes in rows (that detail lives in the report's occurrence table).
- **Disclosure:** group-level only; bill rows are single lines (no nested collapse).
- **Open/delete:** unchanged click contract — each row opens the full report exactly as today's history buttons do (fetch doc → `renderReport()` → `show("report")`); per-row ✕ delete stays.
- **Empty state:** "No bills audited yet — add one above and it'll show up here with what's worth disputing."

## Evidence Desk conformance (current palette)

All dollar figures in mono: extend `.mono-money` onto `.pg-total`, `.bill-status`, and `.usage-count` (the last is a pre-existing gap, in scope here). Colors: only existing `--brand`/`--gold`/`--bad` variables plus the existing `#E8F25C` literal. Structure is 100% existing primitives (grid cards, `.progress`, `<details>`, `.usage-card`) recombined.

## Cross-bill analysis (added 2026-08-10 — "that is the whole value")

Presentation alone doesn't deliver the cross-bill promise: every audit is currently a silo, so the one thing only this app can see — *the same charge appearing on two different statements* — is invisible. Two pure functions, no schema change, both computed from `allAudits` as already stored.

### 1. `crossBillDuplicates(audits) -> [{provider, code, date, description, bills: [{auditId, amount}]}]`

The finding: a service billed on **two different bills**. Keying:

- **Bill identity** = the stored `redactedBill` text (audits already save it). Identical text = the *same bill audited twice* (e.g. once against an individual EOB, once against a consolidated one — exactly the M4 pattern) → **never flagged**, that's the user re-running, not a provider double-billing.
- **Charge identity** = `(provider, code, date)` drawn from `occurrenceTable[].dates` (falling back to the audit's `serviceDates`).
- Flag only when one charge identity appears under **2+ distinct bill identities**.

Why this is safe: recurring care shares codes but not dates, so a weekly therapy patient never trips it. The date is what makes a repeat suspicious.

Surface: a card above the bill groups — *"Billed twice across statements: 90837 on 2026-02-12 appears on two different bills ($175 each)"* — with links to both audits. Amount at stake = the lesser of the two charges (you should owe one, not both).

### 2. `runningTotals(audits, window) -> {atStake, findings, audited}`

Plan-year totals across every audit: total worth disputing, finding count, bills audited. This is the same gap seen at batch level ($55 shown when the batch found $205), one level up — today no screen sums anything across audits.

Surface: a one-line summary at the top of the dashboard — *"12 bills audited this plan year · 7 findings · $1,240 worth disputing"* — dollar figures in mono per DESIGN.md.

### Tests (mirroring the existing pure-module pattern)

`functions/test/crossbill.test.js` against `web/js/crossbill.js`: same bill audited twice → no duplicate; two distinct bills sharing (provider, code, date) → one duplicate; same code on different dates → none; different providers, same code+date → none; missing occurrence dates → falls back to serviceDates; empty history → zeroed totals.

## Explicitly NOT building (YAGNI)

New nav/routes · per-bill collapse · new color tokens · OOP editing UI · charts/donuts (the horizontal `.progress` bar remains the only progress affordance) · CPT codes in rows · pagination/virtualization/search · any Firestore schema change.

## Implementation sketch (for the build round, after user review)

1. `oopTarget()` in `web/js/plan.js` + tests (TDD).
2. `groupAuditsByProvider(allAudits)` pure helper + tests (sorting, blank bucket, totals).
3. **`web/js/crossbill.js`**: `crossBillDuplicates()` + `runningTotals()` + tests (TDD) — the cross-bill analysis above.
4. `renderUsage()` gains the `#oop-card` block; `loadHistory()`'s render loop becomes the grouped renderer; the duplicates card and running-total line render above it; markup + CSS per above.
5. TESTING.md: new plan (grouped bills, OOP card, pills, empty state, a planted cross-bill duplicate); live smoke.

**Fixture needed for step 5:** a second statement re-billing a service already on another bill (e.g. `t2-bill-rebill.pdf` — same provider, same 90837, same 2026-02-12, new statement number) so the duplicate detector has a true positive to catch, plus the existing t-series as the negative control (same code, different dates → no flag).

Estimated size: one phase, ~3 commits, hosting-only deploy.
