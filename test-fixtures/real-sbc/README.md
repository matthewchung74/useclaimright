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

More available and not yet pulled: DOL publishes two further completed samples
for *different* plans, which would add real variation in deductible and
cost-share structure rather than three versions of the same one.
  https://www.dol.gov/agencies/ebsa/laws-and-regulations/laws/affordable-care-act/for-employers-and-advisers/sbc-completed-sample-2
  https://www.dol.gov/agencies/ebsa/laws-and-regulations/laws/affordable-care-act/for-employers-and-advisers/sbc-completed-sample-3
