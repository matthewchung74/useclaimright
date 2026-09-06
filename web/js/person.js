// Who a document is about.
//
// One question, asked in four places: the cross-bill duplicate check (is this
// the same person billed twice, or two family members?), the visit tracker (is
// this household at ONE person's limit?), the wrong-EOB guard (is this EOB for
// the person on the bill?), and the dashboard (whose row is this?). Those four
// must agree, or the app contradicts itself about how many people are on the
// account — a real double-bill goes unreported while a member past their visit
// limit is not warned.
//
// They used to be four separate implementations, three of which agreed by
// accident and one of which did not normalise at all. The rule lives here now.

// Documents write a name every way there is:
//
//   Matthew T. Testpatient      the bill
//   TESTPATIENT, MATTHEW T      the payer's claim line
//   Matthew Testpatient         the same payer, a different form
//
// So compare the two parts that survive all of them — surname and first name.
// Middle initials go because they appear on one document and not the next, and
// a middle initial has never been what tells two members of a household apart.
export function personKey(raw) {
  const cleaned = String(raw || "")
    .toLowerCase()
    // Apostrophes and hyphens are part of a name, not punctuation to split on:
    // "O'Brien" and "Smith-Jones" must survive as single words.
    .replace(/[^a-z',\- ]/g, " ")
    // "Testpatient, Matthew" and "Matthew Testpatient" are the same person.
    .replace(/^([a-z'\-]+)\s*,\s*(.+)$/, "$2 $1")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1); // drops middle initials and stray letters
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned[cleaned.length - 1]}|${cleaned[0]}`; // surname|first
}

export const samePerson = (a, b) => {
  const ka = personKey(a);
  return !!ka && ka === personKey(b);
};
