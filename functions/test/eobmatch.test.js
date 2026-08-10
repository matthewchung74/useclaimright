import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSavedEob } from "../../web/js/eobmatch.js";

const pt = { id: "pt", label: "Testville PT · 2026-03-20", provider: "Testville Physical Therapy Group", serviceDates: ["2026-03-20"], codes: ["97110"] };
const mh = { id: "mh", label: "Behavioral · 2026-01-15", provider: "Testville Behavioral Health Associates", serviceDates: ["2026-01-15", "2026-02-12"], codes: ["90837"] };
const bare = { id: "old", label: "Legacy entry", redactedText: "..." }; // pre-metadata library entry

test("matchSavedEob: provider + date beats provider-only", () => {
  const billText = "TESTVILLE PHYSICAL THERAPY GROUP itemized statement Date of service: 2026-03-20 97110 $210.00";
  const m = matchSavedEob([mh, pt], billText);
  assert.equal(m.eob.id, "pt");
  assert.equal(m.score, 3);
  assert.match(m.reason, /provider and service date/);
});

test("matchSavedEob: provider-only match, case-insensitive", () => {
  const m = matchSavedEob([pt, mh], "bill from testville behavioral health associates, date of service 2026-06-01");
  assert.equal(m.eob.id, "mh");
  assert.equal(m.score, 2);
  assert.match(m.reason, /provider/);
});

test("matchSavedEob: date-only match scores lowest but still reports", () => {
  const m = matchSavedEob([pt], "SOME OTHER CLINIC visit on 2026-03-20");
  assert.equal(m.eob.id, "pt");
  assert.equal(m.score, 1);
  assert.match(m.reason, /service date/);
});

test("matchSavedEob: entries without metadata are skipped; no hits returns null", () => {
  assert.equal(matchSavedEob([bare], "Testville Physical Therapy Group 2026-03-20"), null);
  assert.equal(matchSavedEob([pt, mh], "Unrelated Hospital 2027-01-01"), null);
  assert.equal(matchSavedEob([], "anything"), null);
});

test("matchSavedEob: ties break toward the earlier (most recent) entry", () => {
  const a = { id: "a", provider: "Same Clinic", serviceDates: ["2026-05-01"] };
  const b = { id: "b", provider: "Same Clinic", serviceDates: ["2026-04-01"] };
  const m = matchSavedEob([a, b], "SAME CLINIC statement, no dates printed");
  assert.equal(m.eob.id, "a");
});
