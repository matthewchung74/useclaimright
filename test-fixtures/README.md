# Test fixtures — what pairs with what

All patients/IDs are fake canaries (Jane Q. Testpatient, SSN 999-88-7777, …) so you can
also watch the redaction screen catch them. Server limit: 10 audits per account per day.

## Quick single audit (planted errors)

| Upload together | What the audit should find |
|---|---|
| `fake-bill.pdf` + `fake-eob.pdf` | Duplicate 80053 lab panel ($145.50); billed $845 vs $186.35 owed per EOB (~$658.65); $18 math error inside the EOB |

## The visit series (`series/`) — for the usage tracker

Six monthly psychotherapy visits (code 90837, Jan–Jun 2026) plus one physical-therapy
control. **Each `tN-bill.pdf` pairs with its own `tN-eob.pdf`** (1:1).

| Pair | Date | Notes on the EOB |
|---|---|---|
| `t1-bill` + `t1-eob` | 2026-01-15 | deductible to date $120 of $1,500 |
| `t2-bill` + `t2-eob` | 2026-02-12 | $240 |
| `t3-bill` + `t3-eob` | 2026-03-11 | $360 |
| `t4-bill` + `t4-eob` | 2026-04-15 | $480 |
| `t5-bill` + `t5-eob` | 2026-05-13 | $600 · remark "5 of 6 covered visits used" |
| `t6-bill` + `t6-eob` | 2026-06-10 | $720 · remark "BENEFIT MAXIMUM REACHED" → triggers tracker suggestion |
| `p1-bill` + `p1-eob` | 2026-03-20 | PT control (97110) — must NOT move a psychotherapy tracker |

Run them in order, create a Psychotherapy tracker (limit 6, plan year starts January),
and watch the count go 5/6 amber → 6/6 red.

## The consolidated EOB — for the EOB library / batch sharing

**`t-eob.pdf` is ONE statement covering the t1, t2, and t3 claims.** Use it *instead of*
`t1/t2/t3-eob.pdf`, never alongside them:

- Single audit: `t1-bill.pdf` + `t-eob.pdf`, leave "save this EOB" checked.
- Reuse: then audit `t2-bill.pdf` alone — the saved EOB is pre-selected.
- Batch: drop `t1-bill.pdf` + `t2-bill.pdf` + `t3-bill.pdf` + `t-eob.pdf` in one go →
  3 audits, all sharing the consolidated EOB.

It does NOT cover t4–t6 or p1 — auditing those against it should flag `not_in_eob`.

Answer key for scripted checks: `series-expected.json`. Regenerate HTML fixtures with
`node gen-series.mjs` (PDFs are rendered from the HTML via the browse CLI).
