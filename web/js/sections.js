// Finding the benefits schedule inside a plan booklet.
//
// A real plan document is not a Summary of Benefits. Verified against a member's
// own UMR booklet on 2026-09-10: 135 pages, 351,420 characters, and THREE
// different medical plans in it — EPO with no deductible, PPO at $500/$1,500,
// HDHP at $2,500/$5,000 — with nothing anywhere saying which one the member is
// enrolled in. Sending it whole is 18.6MB of page images against a 10MB
// callable limit, so it failed with "please try again", forever.
//
// So: the text layer says WHERE to look, the images still say WHAT it says.
// That does not contradict extract.js's decision to send pages rather than text
// — a text layer is good enough to find a heading and not good enough to read a
// table, which is exactly how it is used here.
//
// Every guess this makes is shown on the review screen before anything is sent,
// because the guesses will sometimes be wrong and the member is the backstop.

// Insurers name this page differently, so match the family rather than one
// phrase. Anchored on "of benefits"/"summary" to avoid matching prose that
// merely mentions benefits.
const HEADING = new RegExp(
  "(?:medical|transplant|dental|vision|pharmacy|prescription)?\\s*" +
  "(?:schedule of benefits|benefit summary|summary of coverage|summary of benefits|benefits at a glance|what you pay)",
  "i"
);

// A contents line: dotted leaders running to a page number. These name every
// section in the document, so without this a table of contents reads as the
// start of all of them at once.
const CONTENTS_LINE = /\.{4,}\s*\d+\s*$/;

// "(PPO Plan)", "(HDHP Plans)", "(EPO Plan)" — the parenthetical is how a
// booklet distinguishes one plan's schedule from the next.
const QUALIFIER = /\(([^)]{1,40})\)/;

// A heading sits at the top of its page and does not end in a full stop. Both
// halves earn their place: the real booklet says "The Co-pay and out-of-pocket
// maximum are shown on the Schedule of Benefits." in body text on 26 pages, and
// without these that sentence starts 26 sections.
const HEADING_LINES = 6;
const looksLikeHeading = (line) =>
  line.length > 0 && line.length <= 80 && !/[.;:]$/.test(line) &&
  HEADING.test(line) && !CONTENTS_LINE.test(line);

const isContentsPage = (text) =>
  (text.split("\n").filter((l) => CONTENTS_LINE.test(l)).length) >= 3;

// Returns [{ label, start, end }] with 1-based inclusive page numbers, in page
// order. Empty when the document has no headings we recognise — the caller
// falls back rather than being handed a guess dressed as a finding.
export function findPlanSections(pages) {
  const starts = [];
  pages.forEach((text, i) => {
    if (!text || isContentsPage(text)) return;
    const line = text.split("\n").map((l) => l.trim()).filter(Boolean)
      .slice(0, HEADING_LINES).find(looksLikeHeading);
    if (!line) return;
    // Keep the KIND as well as the plan. Labelling a transplant schedule just
    // "EPO Plan" made it indistinguishable from the medical one, and the
    // budget then spent pages on transplant instead of a plan's benefits.
    const plan = line.match(QUALIFIER)?.[1]?.trim() ?? "";
    const kind = line.replace(QUALIFIER, "").replace(/\s+/g, " ").trim();
    starts.push({ page: i + 1, plan, kind, label: [kind, plan].filter(Boolean).join(" ") });
  });

  // A schedule is a table, not a chapter. Without a cap the last heading in the
  // document owns every page after it — in the real booklet that was pages
  // 32-135 labelled as one prescription schedule.
  const MAX_SECTION_PAGES = 15;
  return starts.map((s, i) => ({
    label: s.label, plan: s.plan, kind: s.kind,
    start: s.page,
    end: Math.min(
      (starts[i + 1]?.page ?? pages.length + 1) - 1,
      s.page + MAX_SECTION_PAGES - 1,
    ),
  }));
}

// Which sections to actually send, within the page budget.
//
// By KIND, all or nothing. A booklet has a medical schedule per plan, then a
// prescription one per plan, then transplant — and sending one plan's
// prescription schedule without the other two is a half-answer that invites
// comparing plans that were not all shown. Either a kind fits whole or it waits.
//
// The cost of that rule: one oversized schedule drops every plan of its kind
// and this returns nothing. Callers must handle an empty result as "we could
// not narrow this down" and ask, not as "there is nothing here".
const PRIORITY = ["medical", "prescription", "pharmacy", "transplant", "dental", "vision"];
const rankOf = (kind) => {
  const i = PRIORITY.findIndex((p) => new RegExp(p, "i").test(kind || ""));
  return i === -1 ? PRIORITY.length : i;
};

export function selectSchedulePages(sections, maxPages) {
  const groups = new Map();
  for (const s of sections) {
    const r = rankOf(s.kind ?? s.label);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  }

  const chosen = [];
  let budget = maxPages;
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(rank);
    const size = group.reduce((n, s) => n + (s.end - s.start + 1), 0);
    if (size > budget) continue;
    chosen.push(...group);
    budget -= size;
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// The 1-based page numbers those sections cover.
export const pagesOf = (sections) =>
  sections.flatMap((s) => Array.from({ length: s.end - s.start + 1 }, (_, i) => s.start + i));
