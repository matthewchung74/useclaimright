// Cross-bill analysis — the part no single audit can do. Pure functions, no
// DOM, no globals. Operates on the client-normalized audit shape built in
// loadHistory(): {id, billKey, provider, serviceDates[], occurrenceTable[],
// atStake, findingTypes[], summary, createdAtDate}.

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const inWindow = (d, w) => !w || (typeof d === "string" && d >= w.start && d <= w.end);
const lowercaseCount = (s) => (String(s).match(/[a-z]/g) || []).length;
const auditDate = (a) => (a.serviceDates || []).filter(Boolean)[0] || a.createdAtDate || "";

// The same service, on the same day, from the same provider, appearing on TWO
// DIFFERENT bills — a provider billing you twice for one visit.
//
// billKey is the identity of the paper: audits sharing it are the same bill
// re-audited (e.g. once against an individual EOB, once against a consolidated
// one), which is the user re-running us, not a double-bill. Without a billKey
// we cannot tell those apart, so we say nothing rather than guess.
export function crossBillDuplicates(audits) {
  const charges = new Map(); // "provider|code|date" -> Map(billKey -> {auditId, amount, statementDate})
  for (const a of audits || []) {
    if (!a.billKey) continue;
    for (const row of a.occurrenceTable || []) {
      const dates = (row.dates || []).filter(Boolean).length
        ? row.dates.filter(Boolean)
        : (a.serviceDates || []).filter(Boolean);
      const amount = (row.unitCharges || []).find((n) => typeof n === "number");
      for (const date of new Set(dates)) {
        const key = `${norm(a.provider)}|${String(row.code).trim().toUpperCase()}|${date}`;
        if (!charges.has(key)) charges.set(key, { code: row.code, description: row.description || "", provider: a.provider, date, bills: new Map() });
        const entry = charges.get(key);
        if (!entry.bills.has(a.billKey)) {
          entry.bills.set(a.billKey, { auditId: a.id, amount: amount ?? null, statementDate: a.createdAtDate || "" });
        }
      }
    }
  }
  const out = [];
  for (const entry of charges.values()) {
    if (entry.bills.size < 2) continue;
    const bills = [...entry.bills.values()];
    const amounts = bills.map((b) => b.amount).filter((n) => typeof n === "number");
    out.push({
      provider: entry.provider,
      code: entry.code,
      description: entry.description,
      date: entry.date,
      amount: amounts.length ? Math.min(...amounts) : null, // you likely owe one, not both
      bills,
    });
  }
  return out.sort((x, y) => (y.amount || 0) - (x.amount || 0));
}

// Plan-year totals across every audit — nothing else on the app sums anything.
export function runningTotals(audits, window = null) {
  let audited = 0, findings = 0, atStake = 0;
  for (const a of audits || []) {
    if (!inWindow(auditDate(a), window)) continue;
    audited += 1;
    findings += (a.findingTypes || []).length;
    atStake += a.atStake || 0;
  }
  return { audited, findings, atStake };
}

// The audits from the run that just finished, in the order the list already
// holds them. Ids with no matching audit are dropped — a deleted audit should
// not leave a hole in the pinned block.
export function splitJustAudited(audits, ids) {
  const want = new Set(ids || []);
  return want.size ? (audits || []).filter((a) => want.has(a.id)) : [];
}

// Bills grouped by provider, money first. Bills with no findings move to a
// separate "clean" list so the main list only holds things needing action.
export function groupAuditsByProvider(audits) {
  const clean = [], byProvider = new Map();
  for (const a of audits || []) {
    if (!(a.findingTypes || []).length) { clean.push(a); continue; }
    const raw = a.provider?.trim() || "Provider not read";
    // Extraction varies the casing of the same provider between audits, so key
    // on the normalized name and display the most readable variant seen.
    const key = norm(raw);
    if (!byProvider.has(key)) byProvider.set(key, { provider: raw, bills: [], atStake: 0 });
    const g = byProvider.get(key);
    if (lowercaseCount(raw) > lowercaseCount(g.provider)) g.provider = raw;
    g.bills.push(a);
    g.atStake += a.atStake || 0;
  }
  const groups = [...byProvider.values()].sort((x, y) => y.atStake - x.atStake);
  for (const g of groups) g.bills.sort((x, y) => (y.atStake || 0) - (x.atStake || 0));
  return { groups, clean };
}
