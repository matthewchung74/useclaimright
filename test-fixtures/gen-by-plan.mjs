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

import { copyFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
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
  "FAM3-consolidated-eob-different-name": [
    ["family/matthew-bill.pdf"], ["family/family-eob.pdf"],
  ],
  "P1-real-sbcs": [
    ["real-sbc/cms-2025.pdf"], ["real-sbc/cms-2019.pdf"], ["real-sbc/cms-older.pdf"],
  ],
  // S1's rasterised bill is written by rasterise() below, not copied.
  "S1-scan-read-by-model": [],
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
  execFileSync("/bin/sh", ["-c", `printf '%s\\n' ${JSON.stringify(why)} > ${JSON.stringify(join(OUT, plan, "NO-FILES.txt"))}`]);
}

console.log(`by-plan/: ${Object.keys(PLANS).length} plans with files, ${copied} copied, ` +
  `${pages} scanned page(s) for S1, ${Object.keys(NO_FILES).length} upload-nothing plans`);
