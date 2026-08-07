// Pure pairing logic for batch mode. No DOM, no globals — unit-testable in Node.
// Input: [{name}] (File objects work — only .name is read for classification).

const EOB_TOKENS = /\b(eob|eobs|explanation|benefits?|remittance|claim)\b/;
const BILL_TOKENS = /\b(bill|bills|statement|invoice|itemized|charges)\b/;

// Separators (-, _, .) defeat \b against digits/letters, so normalize first.
const norm = (name) => name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[-_.\s]+/g, " ").trim();

export function classifyFile(name) {
  const n = norm(name);
  const eob = EOB_TOKENS.test(n);
  const bill = BILL_TOKENS.test(n);
  if (eob && !bill) return "eob";
  if (bill && !eob) return "bill";
  return "unknown";
}

// Shared prefix key: normalized name minus classification tokens.
// "t3-bill.pdf" and "t3-eob.pdf" → "t3".
export function stemOf(name) {
  return norm(name)
    .replace(/\b(eob|eobs|bill|bills|explanation|of|benefits?|statement|invoice|itemized|remittance|claim|charges)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Group by stem, pair one bill with one eob per group (zipped by name order
// when a group has several of each). Files the caller classified explicitly
// can carry a .role of "bill"|"eob" to override filename classification.
// Unknown-role files join the group whose stem is a prefix of theirs (or vice
// versa) and fill whichever side that group is missing.
// Returns { pairs: [{bill, eob}], billOnly: [file], orphanEobs: [file] }.
export function pairFiles(files) {
  const groups = new Map(); // stem -> {bills, eobs}
  const group = (stem) => {
    if (!groups.has(stem)) groups.set(stem, { bills: [], eobs: [] });
    return groups.get(stem);
  };

  const unknowns = [];
  for (const f of files) {
    const role = f.role || classifyFile(f.name);
    if (role === "unknown") unknowns.push(f);
    else group(stemOf(f.name))[role === "eob" ? "eobs" : "bills"].push(f);
  }

  for (const u of unknowns.sort(byName)) {
    const su = stemOf(u.name);
    let best = null;
    for (const stem of groups.keys()) {
      const related = stem === su || (stem && su.startsWith(stem)) || (su && stem.startsWith(su));
      if (related && (!best || stem.length > best.length)) best = stem;
    }
    const g = group(best ?? su);
    (g.bills.length <= g.eobs.length ? g.bills : g.eobs).push(u);
  }

  // A lone EOB whose stem is a prefix of bill-carrying groups is a
  // consolidated statement: share it into each of those groups.
  for (const [stem, g] of groups) {
    if (!stem || g.eobs.length !== 1 || g.bills.length) continue;
    const targets = [...groups.entries()]
      .filter(([s2, g2]) => s2 !== stem && s2.startsWith(stem) && g2.bills.length > g2.eobs.length);
    if (targets.length) {
      for (const [, g2] of targets) g2.eobs.push(g.eobs[0]);
      g.eobs = [];
    }
  }

  const pairs = [], billOnly = [], orphanEobs = [];
  for (const g of groups.values()) {
    g.bills.sort(byName); g.eobs.sort(byName);
    if (g.eobs.length === 1 && g.bills.length > 1) {
      // Consolidated EOB: one statement covering several claims — every bill
      // in the group audits against the same EOB.
      for (const b of g.bills) pairs.push({ bill: b, eob: g.eobs[0] });
      continue;
    }
    const n = Math.max(g.bills.length, g.eobs.length);
    for (let i = 0; i < n; i++) {
      if (g.bills[i] && g.eobs[i]) pairs.push({ bill: g.bills[i], eob: g.eobs[i] });
      else if (g.bills[i]) billOnly.push(g.bills[i]);
      else orphanEobs.push(g.eobs[i]);
    }
  }
  pairs.sort((a, b) => byName(a.bill, b.bill));
  billOnly.sort(byName);
  orphanEobs.sort(byName);
  return { pairs, billOnly, orphanEobs };
}

const byName = (a, b) => a.name.localeCompare(b.name);
