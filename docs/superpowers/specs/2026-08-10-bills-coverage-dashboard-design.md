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

## Explicitly NOT building (YAGNI)

New nav/routes · per-bill collapse · new color tokens · OOP editing UI · charts/donuts (the horizontal `.progress` bar remains the only progress affordance) · CPT codes in rows · pagination/virtualization/search · any Firestore schema change.

## Implementation sketch (for the build round, after user review)

1. `oopTarget()` in `web/js/plan.js` + tests (TDD).
2. `groupAuditsByProvider(allAudits)` pure helper + tests (sorting, blank bucket, totals).
3. `renderUsage()` gains the `#oop-card` block; `loadHistory()`'s render loop becomes the grouped renderer; markup + CSS per above.
4. TESTING.md: new plan (grouped bills, OOP card, pills, empty state); live smoke.

Estimated size: one phase, ~2 commits, hosting-only deploy.
