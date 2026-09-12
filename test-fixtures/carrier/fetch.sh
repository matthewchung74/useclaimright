#!/usr/bin/env bash
# Real documents from real carriers, for testing against layouts we did not write.
#
# NOT COMMITTED. The CMS and DOL specimens in ../real-sbc/ are US government
# works and public domain; these are the carriers' own copyright. They are
# freely published — an SBC is a public document by law and these EOBs are
# member-education samples — but published is not the same as ours to
# redistribute, and this repo is public.
#
# Run this to rebuild the directory. Links rot; when one 404s, search for the
# carrier's current SBC rather than dropping the case it covered.
set -u
cd "$(dirname "$0")"

get () { # url, filename, why it is here
  printf '%-28s ' "$2"
  if curl -sfL --max-time 60 -o "$2" "$1"; then
    printf 'ok  (%s)  %s\n' "$(du -h "$2" | cut -f1)" "$3"
  else
    printf 'FAILED — find the carrier current equivalent: %s\n' "$3"
  fi
}

# --- Summary of Benefits and Coverage -------------------------------------
# Real plans, real numbers, no personal data: an SBC describes a plan, not a
# person. This is the variation ../real-sbc/ cannot provide — every government
# specimen is the same $500/$1,000 plan, which is what P1 in docs/TESTING.md
# spent months recording as an unclosable gap. It was closable.
get "https://choose.kaiserpermanente.org/content/dam/kp/secondsales/microsites/contents/pdf/calpers/2026/CalPERS_Summary%20of%20Benefits%20and%20Coverage%20(SBC)%20(PDF)_CA_Basic_ADA_2026.pdf" \
    kaiser-calpers-2026.pdf "no deductible at all — \$0"
get "https://www.cityofventura.ca.gov/DocumentCenter/View/46801/2026-Blue-Shield-PPO-Summary-of-Benefits-and-Coverage-" \
    blueshield-ppo-2026.pdf "\$1,000 PPO"
get "https://www.bcbsks.com/documents/2026-kse-sbc-plan-a" \
    bcbsks-plan-a-2026.pdf "\$1,000, a different carrier's layout"
get "https://www.bcbsks.com/documents/2026-kse-sbc-plan-c" \
    bcbsks-plan-c-2026.pdf "\$2,750 — same carrier, different plan"
get "https://bkcdocs.blob.core.windows.net/qhp/SBC_2026_94248KS0560019-01.pdf" \
    qhp-ks-2026.pdf "\$2,000 exchange plan"

# --- Explanation of Benefits ----------------------------------------------
# Carrier layouts with sample figures, published for member education. Cleaner
# than a real EOB — one tidy claim, no consolidated family statement — so they
# test the format and not the mess.
get "https://www.trinetaetna.com/pdfs/Sample_Medical_EOB.pdf" \
    eob-aetna-sample.pdf "Aetna layout"
get "https://member.aetna.com/memberSecure/assets/pdfs/EOB%20Guide.pdf" \
    eob-aetna-guide.pdf "Aetna, annotated"
get "https://www.cigna.com/static/www-cigna-com/docs/846894-eob-v1.pdf" \
    eob-cigna-sample.pdf "Cigna layout — amount billed \$189.00"

# --- Claim forms ----------------------------------------------------------
# Caveat worth knowing before trusting these: a CMS-1500 or UB-04 is what a
# PROVIDER sends an INSURER. The product audits the patient-facing itemized
# bill, which is a different artifact — a patient rarely sees a UB-04 unless
# they ask for it. Two of these carry figures and can test extraction; two are
# instruction guides with no dollar amounts at all, kept only as video
# reference for what the forms look like.
get "https://medicaidprovider.mt.gov/docs/forms/CMS-1500SamplePaperClaimInstructions2025.pdf" \
    claim-cms1500-montana.pdf "populated — 6 dollar amounts"
get "https://www.cms.gov/Medicare/Quality-Initiatives-Patient-Assessment-Instruments/PQRS/Downloads/2013_PQRS_sampleCMS1500claim_12-19-2012.pdf" \
    claim-cms1500-pqrs.pdf "populated — 99213 office visit"
get "https://www.gileadoncologysupport.com/-/media/project/gileadoncology/pdf/annotated_cms_1500_form.pdf" \
    claim-cms1500-annotated.pdf "NO figures — annotated blank, video reference"
get "https://medicaidprovider.mt.gov/docs/forms/ub04bwsample06082015.pdf" \
    claim-ub04-montana.pdf "NO figures — blank UB-04, video reference"

echo
echo "Still missing, and the gap that matters: a real patient-facing ITEMIZED"
echo "BILL. Those are patient-specific, so nobody publishes one. It is the other"
echo "half of every audit and we have only the ones we wrote ourselves."
