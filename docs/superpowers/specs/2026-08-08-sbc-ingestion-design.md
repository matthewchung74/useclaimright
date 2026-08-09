# SBC Ingestion & Plan Cross-Check — Design

**Date:** 2026-08-08 · **Status:** Approved by user (sections reviewed individually)
**Scope decisions:** Full feature including audit cross-check · Single active plan with plan-year awareness · UI follows DESIGN.md ("Evidence Desk")

## Context

UseClaimRight audits bills against EOBs, but plan-level knowledge (deductible, OOP max, visit limits, copays) currently enters only via the manual "Track a limit" form or opportunistic EOB remarks. The Summary of Benefits and Coverage (SBC) is a standardized, ACA-mandated document every insured user can download; ingesting it closes the loop: auto-configured trackers and deductible targets, a plan reference card, and a new class of audit findings that compare what the bill/EOB did against what the plan promised.

The existing usage-tracker spec (docs/usage-tracker-spec.md) explicitly anticipated this: "'6 visits/year' lives in the Summary of Benefits... limits are user-entered." This feature is its designed-for v2.

## Architecture (Approach A — plan digest into the existing audit call)

One new callable `extractPlan` parses the SBC once into (a) a structured, Ajv-validated plan object and (b) a compact text digest. The structured object deterministically powers UI (deductible card, auto-trackers, "Your plan" card). The digest is appended to the existing `analyze` Gemini call at audit time, where the model performs the category-to-CPT judgment that deterministic code does badly. One audit call, no added per-audit latency beyond bounded digest tokens; findings reuse the existing schema/report/email pipeline.

Rejected: a separate cross-check Gemini pass per audit (2x cost, merge complexity); purely deterministic cross-check (dies on SBC-category → CPT-code mapping).

## Plan freshness, duplicates, and older uploads

- **Out of date:** at upload, if the extracted `planYearEnd` is before today, warn before storing: "This SBC's coverage period ended {date} — if you have your current one, upload that instead. Keep this one anyway?" At runtime, once today passes `planYearEnd`, the "Your plan" card shows an amber renewal nudge: "Your plan year ended {date} — upload your new SBC." (Audit-time correctness is already guarded separately by the service-date window.)
- **Same SBC uploaded again:** detected client-side for free — if the newly redacted text is byte-identical to the stored `redactedText`, skip the `extractPlan` call entirely and tell the user "this plan is already on file" (no rate-limit consumption, no tracker churn, `createdAt` preserved).
- **Older SBC uploaded:** if the new document's `planYearStart` is earlier than the stored plan's, do not silently replace. The Function returns both coverage periods and stores nothing; the client confirms — "The plan on file covers {newer period}; this document covers {older period}. Replace anyway?" — and re-calls with an explicit `force` flag on yes.

## Data model

`users/{uid}/plan/active` (fixed ID = single active plan; overwritten atomically on successful re-extraction; written only by the Function, owner read/delete):

- `structured`: `{planName, planYearStart, planYearEnd, deductible: {individual, family}, oopMax: {individual, family}, limits: [{label, codesHint[], visitsPerYear}], costShares: [{category, verbatim, copay, coinsurancePct, deductibleApplies}]}` — all nullable; extractor never invents unprinted values.
- `digest`: structured numbers + verbatim coverage rows, capped ~2,000 chars — the audit-time context block.
- `redactedText`: full redacted SBC (for "View full plan" and future re-extraction).
- `sourceName`, `createdAt`, `model`.

Plan-year awareness: cross-check applies only when audit service dates fall within `planYearStart–planYearEnd`; otherwise the report carries a one-line "Not checked against your plan: …" note. Trackers auto-created from `limits` carry `source: "sbc"` so re-upload updates them without touching manual trackers.

## Upload & extraction flow

- Entry point: "Your plan" card in Coverage usage — deliberately NOT the bill/EOB dropzones (SBC filenames contain "benefits", which `classifyFile` would misread as EOB; SBCs must never enter batch pairing).
- Pipeline: existing `extractText` → NER + `deidentify` on-device → existing review screen (single-document tabs) → `extractPlan`.
- `extractPlan` guards mirror `analyze`: auth, 200k-char cap, Ajv + one self-correcting retry, own rate limit (3/day, separate counter in `meta/usage`).
- Prompt: extract coverage period, deductible/OOP, visit limits, cost-share rows verbatim-or-null; never infer unprinted numbers; SBC standardized format ("Important Questions" table, "Common Medical Events" grid) named explicitly. `codesHint` proposed from model knowledge, flagged in UI as "from your SBC — check the codes" until user touches the tracker once.
- Client on response: render plan card; create/update `source:"sbc"` trackers (skip when a manual tracker's codes overlap); deductible card uses SBC target when no in-window EOB accumulator has stated one (EOB "met to date" stays authoritative when present — it is newer information).

## EOB-vs-SBC semantics audit (existing code, verified 2026-08-08)

Audited `web/js/usage.js`, `functions/providers/gemini.js`, `functions/schema.js`, and all coverage-related UI copy for places that treat the EOB as a source of plan terms. Result: **no incorrect logic found.** Accumulators and `payerRemarks` are extracted verbatim-or-null from what the EOB actually prints (EOBs legitimately carry "met to date" lines and limit remarks); plan limits are exclusively user-entered trackers; the audit prompt forbids inferring unprinted values. Two precedence notes this feature must implement:

- **Deductible/OOP *limit* precedence:** today the "$X of $Y" target comes only from EOB-printed accumulator lines. With an SBC on file, the SBC is authoritative for the *limit* (Y); the EOB stays authoritative for *progress* (X). If an EOB-printed limit disagrees with the SBC's by more than $1, show both (same pattern as the existing accumulator cross-check line).
- **"Coverage usage" heading:** currently shows usage against user-entered limits, not actual coverage; once the "Your plan" card lands in this section the heading becomes accurate. No change needed.

## Audit-time cross-check

- `analyze` reads `users/{uid}/plan/active` server-side (client payload unchanged; server authoritative). No plan / out-of-period → audit runs exactly as today, response carries `planApplied: false` + reason.
- Prompt gains a fenced "PLAN TERMS (from the member's Summary of Benefits; quote these when citing a mismatch)" block + instructions: compare lines against matching benefit rows; report a mismatch only when the plan term is explicit and the discrepancy arithmetic, not interpretive; cite both document line and SBC row verbatim in evidence.
- New `FINDING_TYPES` (same finding shape; report/email/history render unchanged): `copay_mismatch`, `coinsurance_mismatch`, `deductible_misapplied`, `not_covered_per_plan` (worded as "worth asking about"). `amountAtStake` computed only from printed numbers; feeds the existing "Worth disputing" total.
- Confidence: plan findings default to medium unless the SBC row names the exact service. Disclaimer gains one clause on SBC-based findings.

## UI (per DESIGN.md — Evidence Desk)

- **"Your plan" card**: wallet-benefits-card styling; header = plan name + coverage period; mono-figures grid (deductible, OOP max, limits with copay/coinsurance). Empty state: "Add your Summary of Benefits — we'll set up your deductible and limits automatically" with its own small dashed drop target. Filled state: card + "Replace" + "View full plan" (shows redactedText).
- **Trackers**: `source:"sbc"` tag "from your SBC — check the codes" until first touch. Deductible card: "target from your plan" sourcing note.
- **Cross-check findings**: evidence-narrative — both sides quoted in mono with the drawn cross-reference ("Your SBC says: 'Specialist visit — $60 copay' → this bill applies $175.00"), dollar delta carries the highlighter mark `#E8F25C` (replaces gold in money-at-stake contexts per DESIGN.md). Plain-English TYPE_LABELS: "Copay doesn't match your plan" / "Coinsurance math doesn't match" / "Deductible applied where plan says none" / "Coverage question worth asking".
- **Not-applicable note**: one muted line, e.g. "Not checked against your plan: coverage period ended 2025-12-31."
- **Scope boundary**: the whole-app Evidence Desk restyle (fonts, highlighter app-wide, receipt summary) is a separate follow-up task; this feature builds its new surfaces DESIGN.md-compliant but does not reskin existing screens.

### UI designer review (2026-08-08) — incorporated

- **Card construction:** build "Your plan" on `.usage-card` (12px radius), not `.card` — it must group with the deductible/tracker cards it feeds. Place it **first** in Coverage usage, above the deductible card: plan is the source, deductible/trackers its outputs; the ordering is the information design. Header: plan name bold 15px left, coverage period right in mono 13px muted. Figures grid: `repeat(auto-fit,minmax(150px,1fr))`, 12px muted label over mono 15px tabular value per cell. Wallet metaphor carried by structure (mono grid + `border-top:3px solid var(--brand)` hairline), no fills or gradients. Actions in a quiet right-aligned footer row ("Replace" = ghost sm button, "View full plan" = 13px link) — never in the header. Empty state reuses `.dz` at reduced scale inside the same card shell.
- **Cross-check finding structure:** `.finding` card, quotes NOT collapsed in `<details>` — the confrontation is the finding. Two `.xq` rows (mono 13px, 3px teal left rule, `SBC`/`BILL` source labels styled like `.pane-label`), then a delta sentence where only the dollar amount carries `<mark>` with `#E8F25C` (1px 4px padding, 3px radius). Highlighter marks the delta only, never the quotes.
- **Gold/highlighter coexistence rule:** roles must never overlap in scale — gold stays at chrome level (card borders), `#E8F25C` exists only as an inline text mark. No highlighter borders or fills, and no soft `#F5F8BD`, until the app-wide restyle retires gold.
- **"Not checked" line:** report footer (after findings, before disclaimer), never the top — leading with a caveat undercuts "it found money." Out-of-period: "Not checked against your plan — this bill's service dates fall outside your plan year (ended {date})." No plan: "Not checked against your plan — add your Summary of Benefits under Coverage usage to enable plan checks" (the only variant that may carry a link).
- **Empty-state prominence:** medium — one card in Coverage usage, no banners in the audit flow. Includes a `details.explain` mirroring the EOB explainer: "What's an SBC, and where do I find it?" (insurer website → plan documents → 'Summary of Benefits and Coverage' PDF; enrollment packet; or ask HR).
- **Risk mitigations:** (a) the SBC drop target carries the hint "This is about your plan — not a bill or EOB" to prevent misfiling; (b) do NOT load Newsreader/Plex Mono for these surfaces alone — use `ui-monospace,Menlo` (already used by `.chip`) and honor DESIGN.md structurally until the full restyle swaps fonts; (c) highlighter stays out of `.tot.hi`.

## Error handling & security

- Firestore rules: add `users/{uid}/plan/{doc}` — owner read/delete, Function sole writer.
- Non-SBC upload (no coverage period / no Important-Questions numbers found): clean "this doesn't look like a Summary of Benefits" error; nothing stored; existing plan intact. Replace is atomic on successful extraction only.
- Plan fetch failure mid-audit → audit proceeds, `planApplied: false`. A plan problem never blocks a bill audit.
- Tracker collisions: re-upload updates only `source:"sbc"` trackers; manual trackers never touched or duplicated (match by codes overlap).

## Testing & fixtures

- New fixture `test-fixtures/fake-sbc.html/pdf` (via gen-series.mjs; answer key in series-expected.json): Acme Silver PPO, standardized SBC format, $1,500 deductible, $6,000 OOP max, period 2026-01-01→12-31, "outpatient mental health: $0 after deductible, 6 visits/year", planted hook "specialist visit — $60 copay".
- Test paths: SBC upload → plan card + auto trackers (6/yr mental health, 20/yr rehab); p1-bill + p1-eob (PT, 2026-03-20, in-period, EOB member responsibility $95) → copay_mismatch against the planted "Rehabilitation services — $60 copay/visit, deductible does not apply" row (~$35 delta); t1 pair → no false plan mismatch (mental-health row consistent with its EOB); out-of-period bill → "not checked" line.
- Unit tests (node:test): plan schema + new finding types validation; pure functions for plan-year applicability and sbc-tracker merge rule. Gemini extraction covered by live fixture round-trip, as audits are today.

can we organize the test-fixtures by dir and use case, with diff use cases per user and more than 1 user edge case testing. 

## Out of scope (explicit)

Multi-plan / dual coverage (future; plan picker per audit). Whole-app Evidence Desk restyle (separate task). SBC-derived coverage Q&A chat. Dark mode.
