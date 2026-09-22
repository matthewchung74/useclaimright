import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// THE MESSAGE MATRIX.
//
// Every HttpsError the server can throw, and whether the member reads it or a
// generic fallback. Three separate bugs came out of this one seam in a day: a
// path that matched too few codes hid the kill switch behind "please try
// again"; a path that matched too many blamed a member's own usage for a global
// ceiling; and three actionable invalid-argument messages on the audit path
// were dropped entirely, so someone with an oversized scan was told to retry.
//
// The rule this enforces: a message written in sentences, for a person, must
// reach that person. If it should not, it belongs in `console.error`, not in an
// HttpsError message. Adding a throw without classifying it fails this test.

const root = new URL("../../", import.meta.url).pathname;
const src = (p) => readFileSync(root + p, "utf8");

// Every `new HttpsError("code", ...)` in the functions. A quoted message is
// taken whole; a template literal is taken up to its first interpolation; a
// message built at runtime is recorded as <computed> so it still needs a row —
// that is how ajv's validation text would otherwise slip past unclassified.
function thrownErrors() {
  const out = [];
  for (const f of readdirSync(root + "functions").filter((f) => f.endsWith(".js"))) {
    for (const m of src(`functions/${f}`).matchAll(/new HttpsError\(\s*"([a-z-]+)",\s*(.)/g)) {
      const [, code, open] = m;
      const rest = src(`functions/${f}`).slice(m.index + m[0].length);
      const message =
        open === '"' ? rest.slice(0, rest.indexOf('"'))
        : open === "`" ? rest.split(/[`$]/)[0]
        : "<computed>";
      out.push({ code, message: message.trim() });
    }
  }
  return out;
}

// seen: "member"  — the member reads this exact sentence
//       "generic" — deliberately replaced by a fallback; the text is for logs
const MATRIX = [
  // The spend guard. Both explain why retrying now cannot work.
  ["unavailable", "Audits are paused right now. Please try again later.", "member"],
  ["unavailable", "Plan uploads are paused right now. Please try again later.", "member"],
  // Allowances. The global one is marked so it does not open the personal dialog.
  ["resource-exhausted", "We've hit today's limit across all users. Please try again tomorrow.", "member"],
  ["resource-exhausted", "Daily feedback limit reached — thank you for all the notes!", "member"],
  // claimDaily's caller supplies the text: "Daily limit of 10 audits reached."
  // and "Daily limit of 3 plan uploads reached." Both open the limit dialog.
  ["resource-exhausted", "<computed>", "member"],
  ["resource-exhausted", "This document produced more output than we can handle. Try auditing fewer pages at once.", "member"],
  // Documents: what a member can actually do something about.
  ["invalid-argument", "The bill is required, as text or page images.", "member"],
  ["invalid-argument", "The SBC is required, as text or page images.", "member"],
  ["invalid-argument", "Those pages are too large. Try a lower-resolution scan.", "member"],
  ["invalid-argument", "Too many pages (", "member"],
  ["invalid-argument", "Too many pages; the limit is", "member"],
  ["invalid-argument", "This doesn't look like a Summary of Benefits.", "member"],
  ["invalid-argument", "That is not one of the plans in your document.", "member"],
  // Malformed requests and schema errors: our bugs, not their reading.
  ["invalid-argument", "Which audit?", "generic"],
  ["invalid-argument", "<computed>", "generic"], // feedback validation, ajv error text
  // Diagnostics. A member gets nothing from the wording, so it is not surfaced.
  ["internal", "Analysis failed. Please try again.", "generic"],
  ["internal", "Analysis produced invalid output. Please try again.", "generic"],
  ["internal", "Plan extraction failed. Please try again.", "generic"],
  ["internal", "Plan extraction produced invalid output. Please try again.", "generic"],
  // Auth and payment gates, handled by their own screens rather than an error line.
  ["unauthenticated", "Sign in to run an audit.", "generic"],
  ["unauthenticated", "Sign in to add your plan.", "generic"],
  ["unauthenticated", "Sign in to send feedback.", "generic"],
  ["unauthenticated", "Sign in to generate a letter.", "generic"],
  ["unauthenticated", "Sign in first.", "generic"],
  ["unauthenticated", "Sign in to choose your plan.", "generic"],
  // A state bug, not something the member did. The chooser cannot be shown
  // without candidates, so reaching this means our own data is wrong.
  ["failed-precondition", "There is no plan document to choose from.", "generic"],
  ["not-found", "That audit no longer exists.", "generic"],
  ["permission-denied", "This letter needs to be purchased first.", "generic"],
  ["failed-precondition", "Payments are not switched on.", "generic"],
];

const key = (code, message) => `${code} :: ${message}`;

test("every HttpsError the server throws is classified", () => {
  const declared = new Set(MATRIX.map(([c, m]) => key(c, m)));
  const unclassified = thrownErrors()
    .map(({ code, message }) => key(code, message))
    .filter((k) => !declared.has(k));
  assert.deepEqual([...new Set(unclassified)], [],
    "a new HttpsError needs a row in MATRIX saying whether the member reads it");
});

test("no row describes an error the server no longer throws", () => {
  const thrown = new Set(thrownErrors().map(({ code, message }) => key(code, message)));
  const stale = MATRIX.map(([c, m]) => key(c, m)).filter((k) => !thrown.has(k));
  assert.deepEqual(stale, []);
});

// The client decides what to surface by CODE, so a code carrying any
// member-facing message must be surfaced — and one carrying only diagnostics
// must not be, or the diagnostics leak.
test("the client surfaces exactly the codes that carry member-facing messages", () => {
  const app = src("web/js/app.js");
  const surfaced = new Set(
    [...app.matchAll(/e\??\.code === "functions\/([a-z-]+)"/g)].map((m) => m[1])
  );
  const forMembers = new Set(MATRIX.filter(([, , seen]) => seen === "member").map(([c]) => c));
  for (const code of forMembers) {
    assert.ok(surfaced.has(code), `${code} carries a message written for a member but the client never surfaces it`);
  }
});

// Codes alone are too coarse: before 2026-09-10 the plan path surfaced
// invalid-argument and the two audit paths did not, and a whole-file check saw
// the code somewhere and passed. So name the helper each path must use.
test("both document paths surface the errors a member can act on", () => {
  const app = src("web/js/app.js");
  // Drop docMessage's own declaration — it calls serverMessage, and counting
  // that as a call site would mean the helper hides the thing it is checking.
  const decl = app.indexOf("const docMessage");
  const body = app.slice(0, decl) + app.slice(app.indexOf("\n\n", decl));
  const sites = [...body.matchAll(/(serverMessage|docMessage)\(e\)/g)].map((m) => m[1]);
  assert.equal(sites.filter((s) => s === "docMessage").length, 4,
    "analyze (single and batch), extractPlan and the plan chooser must all use docMessage");
  assert.equal(sites.filter((s) => s === "serverMessage").length, 1,
    "only submitFeedback stays on serverMessage — its invalid-argument is ajv text");
  assert.match(app, /const docMessage[\s\S]{0,200}functions\/invalid-argument/,
    "docMessage is what adds invalid-argument on top of serverMessage");
});

// The bug that made "Audits are paused right now" read as "please try again".
test("serverMessage covers both spend-guard codes", () => {
  const app = src("web/js/app.js");
  const decl = app.slice(app.indexOf("const serverMessage"), app.indexOf("const docMessage"));
  for (const code of ["resource-exhausted", "unavailable"]) {
    assert.ok(decl.includes(`functions/${code}`), `serverMessage must surface ${code}`);
  }
});

// The bug that told someone with eight audits used that they had hit ten.
test("the personal limit dialog is withheld from the global ceiling", () => {
  const app = src("web/js/app.js");
  assert.match(app, /showLimitIfPersonal/, "the dialog must go through the scope-aware helper");
  assert.match(app, /scope !== "global"/, "and that helper must exclude the global ceiling");
  assert.doesNotMatch(app, /=== "functions\/resource-exhausted"\) showLimitDialog/,
    "no call site may open the dialog on the bare code again");
  assert.match(src("functions/guard.js"), /scope: "global"/, "the ceiling must mark itself");
});
