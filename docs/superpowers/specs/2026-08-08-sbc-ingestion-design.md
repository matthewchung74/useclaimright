# SBC Ingestion & Plan Cross-Check — Design

**Date:** 2026-08-08 · **Status:** Approved by user (sections reviewed individually)
**Scope decisions:** Full feature including audit cross-check · Single active plan with plan-year awareness · UI follows DESIGN.md ("Evidence Desk")

## Context

UseClaimRight audits bills against EOBs, but plan-level knowledge (deductible, OOP max, visit limits, copays) currently enters only via the manual "Track a limit" form or opportunistic EOB remarks. The Summary of Benefits and Coverage (SBC) is a standardized, ACA-mandated document every insured user can download; ingesting it closes the loop: auto-configured trackers and deductible targets, a plan reference card, and a new class of audit findings that compare what the bill/EOB did against what the plan promised.

The existing usage-tracker spec (docs/usage-tracker-spec.md) explicitly anticipated this: "'6 visits/year' lives in the Summary of Benefits... limits are user-entered." This feature is its designed-for v2.

## Architecture (Approach A — plan digest into the existing audit call)

One new callable `extractPlan` parses the SBC once into (a) a structured, Ajv-validated plan object and (b) a compact text digest. The structured object deterministically powers UI (deductible card, auto-trackers, "Your plan" card). The digest is appended to the existing `analyze` Gemini call at audit time, where the model performs the category-to-CPT judgment that deterministic code does badly. One audit call, no added per-audit latency beyond bounded digest tokens; findings reuse the existing schema/report/email pipeline.

Rejected: a separate cross-check Gemini pass per audit (2x cost, merge complexity); purely deterministic cross-check (dies on SBC-category → CPT-code mapping).

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

## Error handling & security

- Firestore rules: add `users/{uid}/plan/{doc}` — owner read/delete, Function sole writer.
- Non-SBC upload (no coverage period / no Important-Questions numbers found): clean "this doesn't look like a Summary of Benefits" error; nothing stored; existing plan intact. Replace is atomic on successful extraction only.
- Plan fetch failure mid-audit → audit proceeds, `planApplied: false`. A plan problem never blocks a bill audit.
- Tracker collisions: re-upload updates only `source:"sbc"` trackers; manual trackers never touched or duplicated (match by codes overlap).

## Testing & fixtures

- New fixture `test-fixtures/fake-sbc.html/pdf` (via gen-series.mjs; answer key in series-expected.json): Acme Silver PPO, standardized SBC format, $1,500 deductible, $6,000 OOP max, period 2026-01-01→12-31, "outpatient mental health: $0 after deductible, 6 visits/year", planted hook "specialist visit — $60 copay".
- Test paths: SBC upload → plan card + auto 6-visit tracker; fake-bill audit → copay-mismatch with $115 delta; p1-bill (2026-03-20) → cross-check applies; out-of-period bill → "not checked" line.
- Unit tests (node:test): plan schema + new finding types validation; pure functions for plan-year applicability and sbc-tracker merge rule. Gemini extraction covered by live fixture round-trip, as audits are today.

## Out of scope (explicit)

Multi-plan / dual coverage (future; plan picker per audit). Whole-app Evidence Desk restyle (separate task). SBC-derived coverage Q&A chat. Dark mode.
