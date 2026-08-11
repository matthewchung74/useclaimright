# Audit Summary as Home — Design & Plan

**Date:** 2026-08-11 · **Status:** Plan, awaiting approval to build
**Supersedes:** the routing question left open in `2026-08-10-bills-coverage-dashboard-design.md` (Conflicts §), and M4's post-batch behavior.

## Context

Two problems, one fix.

1. **"Worth disputing — money you may not owe; hold off paying this part"** is a label carrying a paragraph. It was lengthened when "Potentially at stake" read as *money you owe*; now that findings sit directly beneath it and the dashboard frames the number, the sentence is scaffolding that has served its purpose.
2. **After a batch, the app shows one audit's report** — whichever the queue ordered last. The user has just processed N bills and is shown one of them, chosen arbitrarily, with no signal the others exist. The real question at that moment is *"what did you find across all of these?"*

The fix for (2) is a **bills list that doubles as the audit summary**, and once that exists it is the natural home screen. Decisions taken: single audits still go **straight to findings**; the all-bills section **keeps provider grouping**; the list **becomes home**.

## Screens after this change

| Section | Purpose |
|---|---|
| `#bills` (**home**) | Audit summary: totals, cross-bill duplicate hero, *Just audited* (after a batch), bills by provider, clean bills, then coverage (plan line, deductible, OOP, trackers) |
| `#upload` | The audit form only (steps 1–3), entered from the CTA; gains "← Back to bills" |
| `#report` | One audit's findings; gains "← Back to bills" |
| `#onboarding`, `#processing`, `#review` | Unchanged |

### Routing

- Sign in → no plan and never skipped → `#onboarding`; otherwise → **`#bills`**
- Onboarding "Skip" or a completed SBC upload → `#bills`
- **"Audit a new bill"** CTA (on `#bills`) → `#upload`
- **Single** audit completes → `#report` (unchanged — one bill, one result)
- **Batch** (2+) completes → **`#bills`** with the just-audited bills pinned at top
- Clicking any bill row (anywhere) → `#report` for that audit
- "New audit" on a report → `#upload`; "← Back to bills" → `#bills`

## The "Just audited" section

A pinned block at the top of the bills list, above the provider groups:

```
JUST AUDITED · 2 bills · $110.00 worth disputing
  Feb 12, 2026   Billed above EOB allowed amount        $55.00   ✕
  Mar 11, 2026   Billed above EOB allowed amount        $55.00   ✕
```

- Populated from a session-scoped `justAuditedIds` array set by `runBatch()`; **not persisted** — it answers "what just happened", not "what is true".
- Cleared when a new audit run starts (`prepareAudit`/`prepareBatch`), so it never shows stale results.
- Rows are identical in structure to the grouped rows (date · finding summary · amount · ✕) and click through to the report.
- The same bills also appear below in their provider groups — this is a *lens*, not a separate list, so nothing is hidden from the permanent view.
- Marked with the **highlighter ribbon** and an uppercase "JUST AUDITED" label (user decision, overriding an initial teal-rule proposal — the block leads with money found in this run, so the highlighter reads as continuous with the rest of the found-money language).

## Changes by file

- **`web/app.html`** — split `#upload` into `#bills` + `#upload`; add the "Audit a new bill" CTA card (with "EOB on file: …" hint per v2); add `#just-audited`; add "← Back to bills" to `#upload` and `#report`; shorten the totals label to **"Worth disputing"**.
- **`web/js/app.js`** — `show()` gains `bills` to the feedback-bubble allowlist; auth handler routes to `#bills`; `renderDashboard()` renders the CTA, the just-audited block, and moves the plan line/coverage under it; `runBatch()` collects `justAuditedIds` and ends with `show("bills")` instead of `renderReport(last…)`; `prepareAudit`/`prepareBatch` clear `justAuditedIds`; back-links wired.
- **`web/js/crossbill.js`** — unchanged (grouping and totals already do the work).
- **Tests** — `runningTotals`/`groupAuditsByProvider` already covered; add a pure `splitJustAudited(audits, ids)` helper + tests (ids preserved in audit order; unknown ids ignored; empty ids → empty section) so the pinning logic isn't only exercised by hand.

## Test-plan consequences (`docs/TESTING.md`)

- **M4** — rewrite the ending: no "last audit's totals cards". Expect landing on `#bills` with "JUST AUDITED · 2 bills · $110.00", both rows present, each clicking through to its own findings, and the same bills also visible in the provider group below.
- **D1** — becomes the home screen; drop "return to the audit page" and note the CTA is how you reach the upload form.
- **E1** — after "Skip for now", the user lands on **bills** (empty state) and reaches the form via the CTA; the dashed no-plan reminder now lives in the coverage block on that page.
- **E1b** — "Getting here" changes to: from the report, "← Back to bills" → "Audit a new bill".
- **New R2** — "Worth disputing" label is the short form on every report.

## Risks and how they're handled

- **A batch's findings are now one click away** rather than on screen. Mitigated: each row already carries the finding summary and amount, so the list answers "what was found" without opening anything; only the evidence needs a click.
- **Two ways to reach a report** (list row, or finishing a single audit) must both offer a way back. Both get "← Back to bills"; from a single audit that link is the only exit besides "New audit".
- **Empty home for a brand-new user** — the CTA card is the first thing on the page, above an empty-state line, so the primary action is never hidden behind emptiness.
- **`#bills` renders before data loads** on a cold sign-in. The plan-before-history ordering already fixed the coverage race; the bills list must render its empty state without flashing "no bills" while the query is in flight — render the skeleton only after `loadHistory()` resolves.

## Not doing

Persisting "just audited" across reloads · a separate batch-results screen (the list *is* it) · changing the report's internals · touching the duplicate hero.
