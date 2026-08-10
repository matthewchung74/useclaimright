// Pure aggregation functions for the usage & benefits tracker.
// No imports, no globals — unit-testable in Node, used by app.js in the browser.
// Audits are passed in normalized form:
//   { id, serviceDates: string[], occurrenceTable: [{code, count, dates?, description}],
//     accumulators?: {...}|null, payerRemarks?: string[], provider?: string,
//     createdAtDate: "YYYY-MM-DD" }
// All dates are ISO YYYY-MM-DD strings — lexical comparison is date comparison.

export function planYearWindow(startMonth, todayISO) {
  const m = Math.min(12, Math.max(1, startMonth || 1));
  const [y, mo] = todayISO.split("-").map(Number);
  const startYear = mo >= m ? y : y - 1;
  const start = `${startYear}-${String(m).padStart(2, "0")}-01`;
  // end = day before the same date next year (day 0 = last day of prior month)
  const end = new Date(Date.UTC(startYear + 1, m - 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const inWindow = (d, w) => typeof d === "string" && d >= w.start && d <= w.end;

export function visitsUsed(audits, tracker, window) {
  const codes = new Set((tracker.codes || []).map((c) => String(c).trim().toUpperCase()));
  const contributions = [];
  for (const a of audits) {
    for (const row of a.occurrenceTable || []) {
      if (!codes.has(String(row.code).trim().toUpperCase())) continue;
      // Best available dates for this row: row dates → audit serviceDates → createdAt fallback.
      let dates = (row.dates || []).filter(Boolean);
      let approximate = false;
      if (!dates.length) {
        dates = (a.serviceDates || []).filter(Boolean);
        approximate = true;
      }
      if (!dates.length) {
        dates = a.createdAtDate ? [a.createdAtDate] : [];
        approximate = true;
      }
      const uniq = [...new Set(dates)];
      const inWin = uniq.filter((d) => inWindow(d, window));
      if (!inWin.length) continue; // entirely outside the plan year
      const allInWin = inWin.length === uniq.length;
      // Full-window rows contribute the larger of billed count vs distinct dates
      // (double-billed visits count twice, flagged approximate). Partially-in-window
      // rows contribute only their in-window dates.
      const n = allInWin ? Math.max(row.count || 0, inWin.length) : inWin.length;
      if (!allInWin || (row.count || 0) > inWin.length) approximate = true;
      contributions.push({
        auditId: a.id,
        code: row.code,
        description: row.description || "",
        provider: a.provider || "",
        dates: inWin,
        count: n,
        approximate,
      });
    }
  }
  const count = contributions.reduce((s, c) => s + c.count, 0);
  return { count, contributions };
}

function auditDate(a) {
  const ds = (a.serviceDates || []).filter(Boolean);
  return ds.length ? ds.reduce((x, y) => (y > x ? y : x)) : a.createdAtDate || "";
}

export function latestAccumulators(audits, window) {
  let snapshot = null;
  let asOf = "";
  let summedApplied = 0;
  let anyApplied = false;
  for (const a of audits) {
    const d = auditDate(a);
    if (!inWindow(d, window)) continue;
    const acc = a.accumulators;
    if (!acc) continue;
    if (typeof acc.deductibleAppliedThisClaim === "number") {
      summedApplied += acc.deductibleAppliedThisClaim;
      anyApplied = true;
    }
    const hasSnapshot = ["deductibleToDate", "deductibleLimit", "oopToDate", "oopLimit"]
      .some((k) => typeof acc[k] === "number");
    if (hasSnapshot && d >= asOf) {
      snapshot = acc;
      asOf = d;
    }
  }
  const disagreement =
    snapshot && anyApplied && typeof snapshot.deductibleToDate === "number"
      ? Math.abs(snapshot.deductibleToDate - summedApplied) > 1
      : false;
  return { snapshot, asOf, summedApplied: anyApplied ? summedApplied : null, disagreement };
}

const LIMIT_REMARK = /(benefit\s+maximum|maximum\s+reached|visit\s+limit|visits?\s+(?:per|allowed)|\d+\s+of\s+\d+\s+(?:covered\s+)?visits)/i;

// When the remark PRINTS the limit ("5 of 6 visits used", "covers 6 ... visits
// per calendar year"), extract it so tracking needs zero typing. Null when the
// remark only hints that a limit exists.
const LIMIT_FROM_REMARK = [
  /\d+\s*of\s*(\d+)\s*(?:covered\s+)?visits/i,
  /(?:covers|allows|limited\s+to)\s+(\d+)\b[^.]*?visits/i,
  /(\d+)\s+visits?\s+per\s+(?:calendar\s+|plan\s+)?year/i,
];
function limitFromRemark(remark) {
  for (const re of LIMIT_FROM_REMARK) {
    const m = remark.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export function suggestedTrackers(audits, existingTrackers = []) {
  const covered = new Set();
  for (const t of existingTrackers) for (const c of t.codes || []) covered.add(String(c).toUpperCase());
  const out = new Map();
  for (const a of audits) {
    const remark = (a.payerRemarks || []).find((r) => LIMIT_REMARK.test(r));
    if (!remark) continue;
    for (const row of a.occurrenceTable || []) {
      const code = String(row.code).toUpperCase();
      if (covered.has(code) || out.has(code)) continue;
      out.set(code, { code: row.code, description: row.description || "", remark, limit: limitFromRemark(remark) });
    }
  }
  return [...out.values()];
}

export function warningLevel(count, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "ok";
  if (count > limit) return "over";
  if (count === limit) return "at";
  if (count === limit - 1) return "near";
  return "ok";
}
