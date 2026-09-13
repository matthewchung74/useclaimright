# Documents only one person has

`test-fixtures/carrier/` holds documents anyone can fetch. This directory holds
documents nobody can: a member's own plan booklet, a member's own EOB. There is
no `fetch.sh` here and there cannot be one, so every test that reads this
directory **skips** when it is empty — which is most of the time, for most
people, and is the correct outcome rather than a broken checkout.

Everything except this README is gitignored. Put a file here and it stays here.

## What goes in it, and what each one unlocks

| Name the file | What it must be | What nothing else can test |
|---|---|---|
| `booklet.pdf` | An employer plan booklet / SPD, 25+ pages, with schedules of benefits in it | **`findPlanSections` narrowing.** Every real SBC returns `[]` — they are 7-14 pages holding one plan, and the narrowing path never runs on them. A booklet is the only document that exercises it |
| `member-eob.pdf` | A real EOB as it arrived from the insurer | A real accumulator table, real remark codes, a consolidated statement. Ours are all tidy single claims we wrote |
| `member-bill.pdf` | A real itemized patient bill | The half of every audit we have never had a real example of |

## Before you put a real EOB or bill in here

**Those two carry PHI and this one does not.** A plan booklet describes a plan,
not a person — the 135-page booklet this was built against has no name, no
member number, no date of birth anywhere in it; its only personal-sounding
matches were COBRA prose about the Social Security Administration. An EOB and a
bill are the opposite: they are a specific person's claims.

Gitignoring them is necessary and not sufficient. They are still on the disk,
still readable by anything with filesystem access, and still yours to think
about before copying them out of wherever they came from. Prefer a scrubbed
copy. If you use an unscrubbed one, know that you did.
