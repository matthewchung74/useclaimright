# Real SBCs, from CMS

Genuine sample Summary of Benefits and Coverage documents published by CMS and
DOL. The SBC format is mandated by the ACA and standardized, so these are
structurally identical to what a member actually uploads — unlike
`../fake-sbc.pdf`, which we wrote ourselves and which therefore only ever proved
that extraction works on our own assumptions.

| file | plan year | source |
|---|---|---|
| `cms-2025.pdf` | 2025 | cms.gov/cciio/.../english-sample-completed-sbc-accessible-format-012825.pdf |
| `cms-2019.pdf` | 2022 | cms.gov/files/document/sample-completed-sbc-accessible-format-11-2019-v2.pdf |
| `cms-older.pdf` | 2017 | cms.gov/CCIIO/Resources/Regulations-and-Guidance/Downloads/SBC-Sample-Completed.pdf |

Public domain US government works.

All three are **Coverage for: Family**, deductible $500 individual / $1,000
family, OOP max $2,500 / $5,000. That makes them the reproduction case for the
family-deductible bug in `web/js/plan.js` (targets are hardcoded to
`.individual`, so a family plan measures progress against the wrong number).

Verified 2026-08-24: `runPlanExtract` returns schema-valid output on all three,
with correct plan years, deductibles, OOP maxima, 13–17 cost-share rows, and
limits carrying CPT hints.

| `dol-sample-2.pdf` | 2018 | dol.gov/.../sbc-completed-sample-2.pdf |
| `dol-sample-3.pdf` | 2022 | dol.gov/.../sbc-completed-sample-3.pdf |

**The DOL samples do NOT add the variation this file used to promise.** They were pulled on
2026-08-26 on the expectation that they were *different* plans with different deductible and
cost-share structure. They are not. All five documents are the same specimen plan —
**$500 / $1,000 deductible and $2,500 / $5,000 out-of-pocket maximum** — confirmed by running
both through `runPlanExtract` on production. What they do add is real **year and layout**
variation (2017, 2018, 2022, 2022, 2025), and `dol-sample-3` earns its place on layout alone:
`pdftotext` renders its "overall deductible?" row with **no dollar figures beside the
question**, yet extraction still returned $500 / $1,000. That is a layout which defeats naive
text-adjacency parsing and the model handled it.

So the "no real variation in plan structure" gap is **not** closed by these files, and cannot
be closed by any government specimen — every published sample uses the same numbers. Only a
real member's SBC will do it.

**Corrected 2026-09-12 — that conclusion was wrong.** It assumed the only
alternative to a government specimen was one member's private document. But an
SBC describes a *plan*, not a person: it carries no personal information, and
carriers are required by law to publish one for every plan they sell. Real SBCs
for real plans are freely downloadable, and five of them — $0 through $2,750
deductible, five carriers, five layouts — now sit in `../carrier/`, fetched by
`../carrier/fetch.sh`.

The claim held for months because nobody tested it. It took one search.
