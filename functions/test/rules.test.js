// Firestore security rules tests. Requires the emulator:
//   firebase emulators:exec --only firestore "npm --prefix functions test"
// Skips itself when no emulator is present so plain `npm test` stays green.
import { test } from "node:test";
import assert from "node:assert/strict";

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

if (!EMULATOR) {
  test("firestore rules (SKIPPED — no emulator; run via firebase emulators:exec)", { skip: true }, () => {});
} else {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import(
    "@firebase/rules-unit-testing"
  );
  const { readFileSync } = await import("node:fs");

  const env = await initializeTestEnvironment({
    projectId: "useclaimright-test",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8") },
  });

  const alice = env.authenticatedContext("alice").firestore();
  const mallory = env.authenticatedContext("mallory").firestore();
  const anon = env.unauthenticatedContext().firestore();

  // Seed an audit as the server would (rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().doc("users/alice/audits/a1").set({ findings: [], createdAt: new Date() });
  });

  test("owner can read their own audit", async () => {
    await assertSucceeds(alice.doc("users/alice/audits/a1").get());
  });

  test("owner can delete their own audit", async () => {
    await assertSucceeds(alice.doc("users/alice/audits/a1").delete());
  });

  test("another user cannot read someone else's audit", async () => {
    await assertFails(mallory.doc("users/alice/audits/a1").get());
  });

  test("unauthenticated cannot read audits", async () => {
    await assertFails(anon.doc("users/alice/audits/a1").get());
  });

  test("clients cannot create audits (Function is the sole writer)", async () => {
    await assertFails(alice.doc("users/alice/audits/forged").set({ findings: [{ fake: true }] }));
  });

  test("clients cannot update audits (no findings tampering)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("users/alice/audits/a2").set({ findings: [] });
    });
    await assertFails(alice.doc("users/alice/audits/a2").update({ findings: [{ fake: true }] }));
  });

  test("clients cannot touch rate-limit counters", async () => {
    await assertFails(alice.doc("users/alice/meta/usage").get());
    await assertFails(alice.doc("users/alice/meta/usage").set({ count: 0 }));
  });

  test("owner can create, read, and delete their trackers", async () => {
    await assertSucceeds(alice.doc("users/alice/trackers/th").set({ label: "Psychotherapy", codes: ["90837"], limit: 6, planYearStartMonth: 1 }));
    await assertSucceeds(alice.doc("users/alice/trackers/th").get());
    await assertSucceeds(alice.doc("users/alice/trackers/th").delete());
  });

  test("another user cannot read or write my trackers", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc("users/alice/trackers/th2").set({ label: "PT", codes: ["97110"], limit: 20 });
    });
    await assertFails(mallory.doc("users/alice/trackers/th2").get());
    await assertFails(mallory.doc("users/alice/trackers/th2").set({ limit: 999 }));
  });

  test("unauthenticated cannot read trackers", async () => {
    await assertFails(anon.doc("users/alice/trackers/th2").get());
  });

  test.after(async () => { await env.cleanup(); });
}
