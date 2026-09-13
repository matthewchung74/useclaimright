// Groups the canonical fixtures into one folder per test plan, so running a
// plan means opening its folder and uploading everything in it — no cross-
// referencing the Data: line against a flat directory of 50 files.
//
// The folders are DERIVED. Never edit anything under by-plan/; edit the
// canonical fixture (or the generator that writes it) and re-run this. That is
// why duplication across plans is fine here: t4-bill belongs to both M5 and M7,
// and a copy in each cannot drift when both are rewritten from one source.
//
//   node test-fixtures/gen-by-plan.mjs
//
// Two plans need files that do not exist as canonical fixtures, and both used
// to be hand-built from a shell one-liner buried in the plan text:
//   E6 needs two UNRELATED documents sharing a filename stem, to prove the
//      pairing is by name and the mismatch guard catches it.
//   S1 needs a rasterised bill — a PDF with no text layer — to prove the model
//      reads pages rather than the browser OCRing them.
// Both are generated here so the plan is reproducible instead of remembered.

import { copyFileSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "by-plan");

// plan -> [[source relative to test-fixtures, name inside the plan folder], ...]
// Names match what the plan's Data: line says to upload.
const PLANS = {
  "E1-no-sbc-core-audit": [["fake-bill.pdf"], ["fake-eob.pdf"]],
  "M1-plan-setup": [["fake-sbc.pdf"]],
  "M2-plan-violation": [["series/p1-bill.pdf"], ["series/p1-eob.pdf"]],
  "M3-consistent-claim": [["series/t1-bill.pdf"], ["series/t1-eob.pdf"]],
  "M4-batch-consolidated-eob": [["series/t2-bill.pdf"], ["series/t3-bill.pdf"], ["series/t-eob.pdf"]],
  "M5-eob-library-reuse": [["series/t4-bill.pdf"]],
  "M6-plan-duplicate-reupload": [["fake-sbc.pdf"]],
  "M7-tracking-from-remarks": [
    ["series/t4-bill.pdf"], ["series/t4-eob.pdf"],
    ["series/t5-bill.pdf"], ["series/t5-eob.pdf"],
    ["series/t6-bill.pdf"], ["series/t6-eob.pdf"],
  ],
  "D1-dashboard-cross-bill-duplicate": [
    ["series/t2-bill.pdf"], ["series/t2-eob.pdf"], ["series/t2-bill-rebill.pdf"],
  ],
  "E2-bill-only": [["series/t5-bill.pdf"]],
  "E4-wrong-doc-on-sbc-dropzone": [["series/t6-bill.pdf"]],
  "E6-wrong-eob-paired": [
    // Unrelated documents, matching stems: an ED visit bill and a PT EOB. The
    // app pairs by filename, so this is what makes them pair at all.
    ["fake-bill.pdf", "mixup-bill.pdf"],
    ["series/p1-eob.pdf", "mixup-eob.pdf"],
  ],
  "FAM1-two-family-members": [
    ["family/matthew-bill.pdf"], ["family/sarah-bill.pdf"], ["family/family-eob.pdf"],
  ],
  // Matthew's bill against SARAH's EOB. Same clinic, same day, same 90686 — so
  // documentsRelated, which compares dates and codes, calls them related and
  // stays quiet. The patient name is the only thing that separates them.
  "FAM4-wrong-family-members-eob": [
    ["family/matthew-bill.pdf"], ["family/sarah-eob.pdf"],
  ],
  "FAM3-consolidated-eob-different-name": [
    ["family/matthew-bill.pdf"], ["family/family-eob.pdf"],
  ],
  "P1-real-sbcs": [
    ["real-sbc/cms-2025.pdf"], ["real-sbc/cms-2019.pdf"], ["real-sbc/cms-older.pdf"],
  ],
  // Scans of documents that were only ever tested as text. Every real document
  // reaches the model as page images now, so these are the main path, not an
  // edge: S1 only ever rasterised the BILL.
  "S2-scanned-eob": [["scans/eob-scan-1.png", "eob-scan.png"]],
  // fake-sbc rasterised. Deliberately the same SBC that is already on file as
  // text, so the extracted plan can be compared field by field — a scan that
  // produces a DIFFERENT plan is the failure, and a new plan would hide it.
  "S3-scanned-sbc": [["scans/sbc-scan-1.png", "sbc-scan.png"]],
  // Five pages, a real CMS document. The first genuinely multi-page scan.
  "S4-multipage-scan": [
    ["scans/sbc5-scan-1.png"], ["scans/sbc5-scan-2.png"], ["scans/sbc5-scan-3.png"],
    ["scans/sbc5-scan-4.png"], ["scans/sbc5-scan-5.png"],
  ],
  // S1's rasterised bill is written by rasterise() below, not copied.
  "S1-scan-read-by-model": [],
  // IMG1's fixtures are canonical and committed under img1/ rather than built
  // here: they need macOS `sips` (rotation, HEIC, resampling), which a Linux CI
  // box does not have. Generated once by gen-img1.sh, then copied like anything
  // else — so this generator stays portable and the browser suite always finds
  // them. They used to be made by hand, and re-running this script deleted them.
  "IMG1-image-edge-cases": [
    ["img1/01-normal-scan.png"], ["img1/02-rotated-90.png"], ["img1/03-upside-down.png"],
    ["img1/04-iphone.heic"], ["img1/05-screenshot.png"], ["img1/06-low-res.png"],
    ["img1/07-full-res-phone.png"], ["img1/08-eob-page-1.png"],
  ],
};

// Plans that need no files at all. Listed so an empty folder is a deliberate
// statement ("this plan uploads nothing") rather than a missing entry.
const NO_FILES = {
  "E1b-intake-and-account-menu": "runs on E1's report and the account menu",
  "E3-remove-plan": "removes the plan on file",
  "E5-restore-plan": "re-uploads M1's SBC via Replace — use M1-plan-setup/",
  "E7-reset-account": "destructive; no uploads",
  "X1-destructive-confirmations": "deletes existing data",
  "R2-home-routing": "reads whatever audits already exist",
  "F1-feedback-widget": "no uploads",
  "A1-auth": "a throwaway email address",
  "FAM2-family-deductible": "reads FAM1's audits",
  "G1-spend-guard": "Firestore console, meta/guard",
  "PAY1-appeal-letter": "any existing audit WITH findings",
  "REV1-review-screen": "reuse any plan's bill",
  "TAP1-tap-targets": "no uploads",
  "FAM5-per-member-limits": "reads FAM1's audits — two people sharing a code",
  "PHONE1-phone-layout": "no uploads; drive the app at 375px",
};

// Plans whose documents DO exist but are not ours to commit: real carrier SBCs,
// gitignored because this repo is public and they are the carriers' copyright.
// Distinct from NO_FILES — "not here" is not the same statement as "uploads
// nothing", and a reader who cannot tell them apart goes looking for the wrong
// thing. The free half of these plans needs no document at all and runs in
// test/browser/carrier.test.js.
const NOT_COMMITTED = {
  "C1-no-deductible": ["kaiser-calpers-2026.pdf"],
  "C2-network-split": ["bcbsks-plan-c-2026.pdf"],
  "C3-more-layouts": ["blueshield-ppo-2026.pdf", "bcbsks-plan-a-2026.pdf", "qhp-ks-2026.pdf"],
  "C4-real-eob": ["eob-cigna-sample.pdf (plus a bill from gen-carrier-pairs.mjs, not yet written)"],
  "C5-claim-form-as-bill": ["claim-ub04-montana.pdf", "claim-cms1500-montana.pdf"],
  "C6-member-booklet": ["test-fixtures/private/booklet.pdf — a member's own, not fetchable"],
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let copied = 0;
for (const [plan, files] of Object.entries(PLANS)) {
  const dir = join(OUT, plan);
  mkdirSync(dir, { recursive: true });
  for (const [src, as] of files) {
    const from = join(ROOT, src);
    if (!existsSync(from)) throw new Error(`missing canonical fixture: ${src} (needed by ${plan})`);
    copyFileSync(from, join(dir, as || src.split("/").pop()));
    copied++;
  }
}

// S1: a bill with NO text layer. 110 DPI matches the resolution the plan was
// last verified at, which is deliberately poor — a clean 300 DPI render would
// not test anything a digital PDF doesn't already cover.
function rasterise() {
  const dir = join(OUT, "S1-scan-read-by-model");
  const stem = join(dir, "scanned-bill");
  try {
    execFileSync("pdftoppm", ["-png", "-r", "110", join(ROOT, "fake-bill.pdf"), stem], { stdio: "pipe" });
  } catch {
    console.warn("! pdftoppm not found — S1's scanned bill was not generated (brew install poppler)");
    return 0;
  }
  return readdirSync(dir).filter((f) => f.endsWith(".png")).length;
}
const pages = rasterise();

for (const [plan, why] of Object.entries(NO_FILES)) {
  mkdirSync(join(OUT, plan), { recursive: true });
  // A .gitkeep would be silent about WHY the folder is empty.
  writeFileSync(join(OUT, plan, "NO-FILES.txt"), `${why}\n`);
}

for (const [plan, files] of Object.entries(NOT_COMMITTED)) {
  mkdirSync(join(OUT, plan), { recursive: true });
  writeFileSync(join(OUT, plan, "NOT-COMMITTED.txt"),
    `${files.join("\n")}\n\nlive in test-fixtures/carrier/, which is gitignored. Rebuild with:\n` +
    `    test-fixtures/carrier/fetch.sh\n`);
}

console.log(`by-plan/: ${Object.keys(PLANS).length} plans with files, ${copied} copied, ` +
  `${pages} scanned page(s) for S1, ${Object.keys(NO_FILES).length} upload-nothing plans, ` +
  `${Object.keys(NOT_COMMITTED).length} with gitignored carrier documents`);
