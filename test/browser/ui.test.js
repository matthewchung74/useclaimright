// The zero-audit half of the suite: layout, extraction and rendered copy.
//
// These are the checks that were manual until 2026-08-29 — and every stale
// claim found that day lived in this tier. A removed banner, a control that
// silently went back under 16px, a hero card that drifts below the fold: none
// of it costs an audit to catch, and none of it was being caught.
//
//   npm --prefix test/browser test
//
// Runs against web/ served locally, NOT production, so it tests the working
// tree — a failure here means "you broke it", not "the deploy is behind".
// Nothing here signs in: every assertion is a function of DOM + CSS, which is
// what makes the authenticated screens testable without an account.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "web");
// The canonical committed copies. by-plan/ is derived and gitignored, so a
// clean checkout has these and may not have the plan folders yet.
const FIXTURES = join(ROOT, "test-fixtures", "img1");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "application/pdf",
};

let server, browser, page, origin;

before(async () => {
  server = createServer(async (req, res) => {
    // Strip the query string, then normalise — a path that escapes web/ is a
    // request for something this server has no business serving.
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(WEB, rel);
    if (rel === "/" || rel === "\\") file = join(WEB, "index.html");
    if (!file.startsWith(WEB)) { res.writeHead(403).end(); return; }
    // /app is served as app.html, matching the hosting rewrite.
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  // iPhone SE / iPhone 12 mini width — the narrowest phone worth supporting.
  page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(`${origin}/app`, { waitUntil: "domcontentloaded" });
});

after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

// Shows one screen and hides the rest. app.js may not have booted (it needs
// Firebase over the network), so this drives the DOM directly — the layout
// under test is a function of markup and CSS, not of sign-in.
const showSection = (id) =>
  page.evaluate((want) => {
    document.body.className = "authed";
    document.querySelectorAll("section[id]").forEach((s) => { s.hidden = s.id !== want; });
    return want;
  }, id);

const sectionIds = () => page.evaluate(() =>
  [...document.querySelectorAll("section[id]")].map((s) => s.id));

// ---------------------------------------------------------------------------
// PHONE1 — the app is designed against a 960px column
// ---------------------------------------------------------------------------

test("phone: no screen scrolls sideways", async () => {
  const offenders = [];
  for (const id of await sectionIds()) {
    await showSection(id);
    const bad = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll("*")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && r.height && (r.right > vw + 1 || r.left < -1);
        })
        .map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""))
        .slice(0, 5);
    });
    if (bad.length) offenders.push(`${id}: ${bad.join(", ")}`);
  }
  assert.deepEqual(offenders, [], `elements past the viewport at 375px:\n${offenders.join("\n")}`);
});

test("phone: no form control is under 16px", async () => {
  // iOS Safari zooms the page on focus below 16px and does not zoom back. This
  // is the check that keeps the sign-in screen usable on an iPhone.
  const small = [];
  for (const id of await sectionIds()) {
    await showSection(id);
    // The tracker form is hidden until an EOB remark offers it; open it so its
    // four controls are measured rather than skipped.
    await page.evaluate(() => {
      const w = document.getElementById("tracker-form-wrap");
      if (w) { w.hidden = false; w.open = true; }
    });
    const found = await page.evaluate((sec) =>
      [...document.getElementById(sec).querySelectorAll("input,select,textarea")]
        .filter((el) => getComputedStyle(el).display !== "none")
        .filter((el) => el.type !== "checkbox" && el.type !== "radio")
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => `${sec}: #${el.id || el.name || el.type}`), id);
    small.push(...found);
  }
  assert.deepEqual(small, [], `controls under 16px — iOS will zoom on focus:\n${small.join("\n")}`);
});

test("phone: tap targets reach 44px", async () => {
  // The documented exception: reCAPTCHA's attribution links are inline in a
  // wrapped 12px paragraph, where a 44px band would overlap its neighbours.
  const ALLOWED = ["Privacy Policy", "Terms of Service", "Full privacy policy"];
  const short = [];
  for (const id of await sectionIds()) {
    await showSection(id);
    const found = await page.evaluate((sec) =>
      [...document.getElementById(sec).querySelectorAll("button,a,select,summary")]
        .map((el) => ({ r: el.getBoundingClientRect(), t: (el.textContent || "").trim() }))
        .filter((x) => x.r.width && x.r.height && x.r.height < 44)
        .map((x) => `${sec}: "${x.t.slice(0, 30)}" ${Math.round(x.r.height)}px`), id);
    short.push(...found.filter((f) => !ALLOWED.some((a) => f.includes(a))));
  }
  assert.deepEqual(short, [], `tap targets under 44px:\n${short.join("\n")}`);
});

test("phone: 'Worth disputing' is the first totals card", async () => {
  // The cards stack in one column below 560px. This figure is the product's
  // whole moment; fourth puts it off the bottom of an iPhone SE.
  await showSection("report");
  const first = await page.evaluate(() => {
    const g = document.getElementById("report-totals");
    g.innerHTML = `<div class="tot"><span>Billed</span><b>$2,115.00</b></div>
      <div class="tot"><span>EOB allowed</span><b>$841.75</b></div>
      <div class="tot"><span>Your responsibility</span><b>$186.35</b></div>
      <div class="tot hi"><span>Worth disputing</span><b>$822.15</b></div>`;
    return [...g.children]
      .map((c) => ({ l: c.querySelector("span").textContent, t: c.getBoundingClientRect().top }))
      .sort((a, b) => a.t - b.t)[0].l;
  });
  assert.equal(first, "Worth disputing");
});

// ---------------------------------------------------------------------------
// IMG1 — every real document is an image now, so this path is the product
// ---------------------------------------------------------------------------

const probe = (name) =>
  page.evaluate(async (n) => {
    const m = await import("/js/extract.js");
    const f = document.getElementById("__probe").files[0];
    if (!f || f.name !== n) return { ok: false, err: "fixture not staged" };
    try {
      const r = await m.extractText(f);
      return { ok: true, method: r.method, images: r.images.length, textLen: (r.text || "").length };
    } catch (e) {
      return { ok: false, err: String(e.message || e) };
    }
  }, name);

// A missing fixture must FAIL, not skip. The first run of this suite "passed"
// two extraction tests in 0.18ms because gen-by-plan.mjs had wiped the IMG1
// folder — a green tick for a check that never executed, which is the precise
// failure this whole suite exists to catch.
const fixture = (name) => {
  const f = join(FIXTURES, name);
  assert.ok(existsSync(f),
    `fixture missing: ${name}\nrun: sh test-fixtures/gen-img1.sh`);
  return f;
};

const stage = async (file) => {
  await page.evaluate(() => {
    if (!document.getElementById("__probe")) {
      const i = document.createElement("input");
      i.type = "file"; i.id = "__probe"; i.style.display = "none";
      document.body.appendChild(i);
    }
  });
  await page.setInputFiles("#__probe", file);
};

test("extraction: a PNG scan becomes one page image with no text", async () => {
  await stage(fixture("01-normal-scan.png"));
  const r = await probe("01-normal-scan.png");
  assert.ok(r.ok, r.err);
  assert.equal(r.method, "image");
  assert.equal(r.images, 1);
  assert.equal(r.textLen, 0, "an image carries no text; the model reads it");
});

test("extraction: HEIC is refused with instructions, not a riddle", async () => {
  // Apple's camera default since iOS 11, and Chrome reports it as
  // application/octet-stream — so it misses the image/* branch and used to hit
  // "Unsupported file type… Use PDF, photo, HTML, or text", telling someone who
  // just uploaded a photo to upload a photo.
  await stage(fixture("04-iphone.heic"));
  const r = await probe("04-iphone.heic");
  assert.equal(r.ok, false, "HEIC cannot be decoded by Chrome and must be refused");
  assert.match(r.err, /HEIC/i);
  assert.match(r.err, /Most Compatible|JPEG/, "the message must say what to do instead");
  assert.doesNotMatch(r.err, /Unsupported file type/, "the generic message is the bug");
});

// ---------------------------------------------------------------------------
// Rendered copy — the class of claim that rotted silently in TESTING.md
// ---------------------------------------------------------------------------

test("review screen describes pages, not extracted text", async () => {
  await showSection("review");
  const intro = await page.evaluate(() =>
    document.getElementById("review").innerText.replace(/\s+/g, " "));
  assert.match(intro, /pages go to the model/i);
  assert.doesNotMatch(intro, /What we'll analyze/i,
    "the extracted-text pane was removed when PDFs became page renders");
});


test("phone: a family bill row fits, and the finding keeps full width", async () => {
  // The dashboard groups by provider and shows date, finding and amount — which
  // is everything except WHOSE bill it is, once a household shares an account.
  // Adding the name to a four-column row at 360px squeezed the finding into
  // 61px and wrapped the row to 180px tall, so the row became two lines.
  await showSection("bills");
  const m = await page.evaluate(() => {
    const row = (who) => `<div class="bill-row tap">
        <span class="when">Mar 10, 2026</span>${who ? `<span class="who">${who}</span>` : ""}
        <button class="what">Duplicate charge · Billed above EOB allowed amount</button>
        <span class="money-pill">$85.00</span>
        <button class="rm" title="Delete this audit">✕</button></div>`;
    const read = (html) => {
      // #bill-groups is the DASHBOARD's list. #bill-list is the staged-files
      // list on the upload form, and injecting there measures an element inside
      // a hidden section — which is how the first pass at this check produced
      // confident numbers for the wrong thing.
      document.getElementById("bill-groups").innerHTML =
        `<details class="prov-group" open><summary>Testville Family Medicine</summary>${html}</details>`;
      const vw = document.documentElement.clientWidth;
      const r = document.querySelector(".bill-row");
      const what = r.querySelector(".what");
      return {
        overflow: [...r.children].filter((el) => el.getBoundingClientRect().right > vw + 1).length,
        height: Math.round(r.getBoundingClientRect().height),
        summaryWidth: Math.round(what.getBoundingClientRect().width),
      };
    };
    return { named: read(row("Matthew")), unnamed: read(row(null)) };
  });
  assert.equal(m.named.overflow, 0, "a named row must not push anything past the viewport");
  assert.equal(m.unnamed.overflow, 0);
  assert.equal(m.named.height, m.unnamed.height,
    "the name must cost no vertical space — it shares line one with the date");
  assert.ok(m.named.summaryWidth > 200,
    `the finding summary must keep the second line to itself, got ${m.named.summaryWidth}px`);
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// CONTAIN — nothing escapes the box that draws a border around it
//
// The float that hung below the deductible card passed every check in this file:
// the page did not scroll sideways, tap targets were fine, no text touched the
// screen edge. What it broke was containment, and nothing looked for that. A
// floated child adds no height to its parent, so the card stops short and the
// text sits outside its own frame — visible on a phone, invisible to a suite
// that only measures the viewport.
// ---------------------------------------------------------------------------

const BORDERED = ".card, .usage-card, .banner, .offer, .error, details.explain, .bill-row";

test("phone: no element escapes the bordered box it lives in", async () => {
  const offenders = [];
  for (const id of await sectionIds()) {
    await showSection(id);
    const bad = await page.evaluate((sel) => {
      // A CLOSED <details> still lays out its contents in some engines, so its
      // whole subtree reads as escaped. Only measure what is actually rendered.
      const shown = (el) => !(el.closest("details:not([open])") && !el.closest("summary"))
        && (typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null);
      const out = [];
      for (const box of document.querySelectorAll(sel)) {
        if (!shown(box)) continue;
        if (getComputedStyle(box).overflow !== "visible") continue; // clipped deliberately
        const b = box.getBoundingClientRect();
        if (b.height === 0) continue;
        // Step 2 of the upload form is a grid-row reveal collapsed to 0fr, and
        // its wrapper clips. Its contents still report rects far below the card,
        // which is not an escape — the clip is what the reader actually sees.
        const clipped = (el) => {
          for (let a = el.parentElement; a && a !== box; a = a.parentElement) {
            if (getComputedStyle(a).overflow !== "visible") return true;
          }
          return false;
        };
        for (const child of box.querySelectorAll("*")) {
          if (!shown(child) || clipped(child)) continue;
          const c = child.getBoundingClientRect();
          if (!c.width || !c.height) continue;
          if (c.bottom - b.bottom > 1 || c.right - b.right > 1) {
            out.push(`${child.tagName.toLowerCase()}${child.id ? "#" + child.id : ""} escapes ` +
              `${box.className.split(" ")[0]} by ${(c.bottom - b.bottom).toFixed(1)}px below`);
          }
        }
      }
      return out;
    }, BORDERED);
    for (const b of bad) offenders.push(`${id}: ${b}`);
  }
  assert.deepEqual(offenders, [], `content outside its own card:\n${offenders.join("\n")}`);
});

// FAM2 — the deductible card, the one screen only a signed-in household sees
//
// renderUsage() runs behind auth, so nothing here could reach the card and the
// first thing shipped into it was a layout bug: naming the scope ("Family
// target from your plan (SBC).") lengthened the sourcing line by one word,
// which pushed it onto a third line at 375px. The "to go" figure beside it is
// floated, and a float adds no height to its parent, so it hung 5px below the
// card's bottom border — dollar text sitting outside the box that owns it.
//
// The block is executed verbatim out of app.js rather than retyped, because a
// copy of the card here would keep passing after the real one changed.
// ---------------------------------------------------------------------------

// The verify screen is a hard gate — app.js turns away any unverified account —
// and the mail lands in Gmail's spam folder rather than the inbox. So the one
// sentence telling someone where to look has to be on screen when they arrive,
// not behind the "Send it again" button that only a persistent person presses.
test("verify screen warns about spam without needing a resend first", async () => {
  await showSection("verify");
  const m = await page.evaluate(() => {
    const visible = [...document.querySelectorAll("#verify p, #verify div")]
      .filter((el) => el.offsetParent !== null);
    return {
      text: visible.map((el) => el.textContent).join(" ").toLowerCase(),
      resendStillHidden: document.getElementById("verify-sent").hidden,
    };
  });
  assert.ok(m.resendStillHidden, "the post-resend line must not be what satisfies this test");
  assert.match(m.text, /spam/, "someone who checks an empty inbox must be told where else to look");
});

// A1 step 1 — the sign-up form must not offer to reset a password that does not
// exist yet. Verified by hand on 2026-09-09 for the landing screen and the
// gating; this checkpoint was the one nobody looked at, and it needs no account
// to check, so it should never have depended on someone remembering to look.
// ---------------------------------------------------------------------------
test("sign-up mode hides 'Forgot password?' and asks for a new password", async () => {
  await showSection("signin");
  const read = () => page.evaluate(() => ({
    submit: document.getElementById("password-signin").textContent.trim(),
    toggle: document.getElementById("toggle-signup").textContent.trim(),
    forgotHidden: document.getElementById("forgot-password").hidden,
    autocomplete: document.getElementById("password-input").getAttribute("autocomplete"),
  }));

  const signIn = await read();
  assert.equal(signIn.submit, "Sign in");
  assert.equal(signIn.toggle, "Create an account");
  assert.equal(signIn.forgotHidden, false, "an existing account must be able to reset");

  await page.click("#toggle-signup");
  const signUp = await read();
  assert.equal(signUp.submit, "Create account", "the button carries the verb");
  assert.equal(signUp.toggle, "I already have an account");
  assert.equal(signUp.forgotHidden, true, "there is no password yet to forget");
  assert.equal(signUp.autocomplete, "new-password",
    "otherwise the password manager offers the existing password for a new account");

  // Toggling back must restore it, or the reset path is lost until reload.
  await page.click("#toggle-signup");
  assert.deepEqual(await read(), signIn);
});

// PROXIMITY — a hint belongs to the thing it explains
//
// The spam hint on the verify screen was present, correct, and visible, so the
// test above passed. It sat 24px below the sentence it explained and 0px above
// the "Send it again" button, which reads as a caption for the button. Presence
// is not placement, and nothing measured placement.
//
// Stated generally: a hint between a sentence and a control belongs to the
// sentence, so it must not be nearer the control.
// ---------------------------------------------------------------------------
test("phone: a hint sits with the sentence it explains, not the button below it", async () => {
  const offenders = [];
  for (const id of await sectionIds()) {
    await showSection(id);
    const bad = await page.evaluate(() => {
      const shown = (el) => el && (typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null);
      const SAYS = "P, H1, H2, H3, .lead";
      const DOES = "BUTTON, INPUT, SELECT, A";
      const out = [];
      for (const hint of document.querySelectorAll(".muted")) {
        if (!shown(hint) || !hint.textContent.trim()) continue;
        const above = hint.previousElementSibling, below = hint.nextElementSibling;
        // Only the sandwich this rule can speak about: explained by what is
        // above, followed by something that acts.
        if (!shown(above) || !shown(below)) continue;
        if (!above.matches(SAYS) || !below.matches(DOES)) continue;
        const gapAbove = hint.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
        const gapBelow = below.getBoundingClientRect().top - hint.getBoundingClientRect().bottom;
        if (gapAbove > gapBelow) {
          out.push(`"${hint.textContent.trim().slice(0, 40)}…" is ${Math.round(gapAbove)}px from what it explains ` +
            `and ${Math.round(gapBelow)}px from the ${below.tagName.toLowerCase()} below it`);
        }
      }
      return out;
    });
    offenders.push(...bad.map((b) => `#${id}: ${b}`));
  }
  assert.deepEqual(offenders, [], `a hint reads as belonging to the control below it:\n${offenders.join("\n")}`);
});

test("phone: the deductible card names its scope and keeps the 'to go' inside the card", async () => {
  const src = await readFile(join(WEB, "js", "app.js"), "utf8");
  const between = (a, b) => {
    const i = src.indexOf(a), j = src.indexOf(b, i);
    assert.ok(i >= 0 && j > i, `renderUsage moved — this test can no longer find ${a}`);
    return src.slice(i, j);
  };
  const block = between("const applied = typeof snapshot?.deductibleToDate", '} else {\n    dc.innerHTML = ""');
  const fmtSrc = between("const fmt = (n) =>", "\n");
  const escSrc = between("function escapeHtml(s) {", "\n}\n") + "\n}";

  await showSection("bills");
  // One SBC printing both of the plan's figures; the EOB decides which one the
  // household is measured against, which is the whole point of the label.
  const render = (deductibleLimit, deductibleToDate) => page.evaluate(async (a) => {
    const [block, fmtSrc, escSrc, deductibleLimit, deductibleToDate] = a;
    const { deductibleTarget, targetLabel } = await import("/js/plan.js");
    const fmt = new Function(`${fmtSrc} return fmt;`)();
    const escapeHtml = new Function(`${escSrc} return escapeHtml;`)();
    const card = new Function("snapshot", "summedApplied", "target", "asOf",
      "disagreement", "dc", "fmt", "escapeHtml", "targetLabel", block);
    const snapshot = { deductibleToDate, deductibleLimit };
    const dc = document.getElementById("deductible-card");
    card(snapshot, null, deductibleTarget({ deductible: { individual: 500, family: 1000 } }, snapshot),
      "2026-08-25", false, dc, fmt, escapeHtml, targetLabel);
    const el = dc.querySelector(".usage-card");
    const togo = el.querySelector("span[style*=float]");
    return {
      text: el.innerText.replace(/\s+/g, " "),
      overflow: togo.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom,
    };
  }, [block, fmtSrc, escSrc, deductibleLimit, deductibleToDate]);

  const family = await render(1000, 640);
  assert.match(family.text, /Family target from your plan \(SBC\)/,
    `a household measured against the family figure must be told so, got: ${family.text}`);
  assert.ok(family.overflow <= 0,
    `"to go" escaped the card by ${family.overflow.toFixed(1)}px`);

  const individual = await render(500, 320);
  assert.match(individual.text, /Individual target from your plan \(SBC\)/,
    `the individual figure must be named too, got: ${individual.text}`);
  assert.ok(individual.overflow <= 0,
    `"to go" escaped the card by ${individual.overflow.toFixed(1)}px`);
});

// ---------------------------------------------------------------------------
// A1 — the module boots and every control it wires is actually bound
//
// The one failure that has reached production: app.js referenced an identifier
// nothing bound, and the module threw on load, so the dashboard was blank for
// every signed-in user. Nothing in node --test can see it — the file is only
// ever evaluated by a browser. This is that check, and it is why this test
// loads the page properly (networkidle) instead of reusing the shared page,
// which deliberately does not wait for app.js to boot.
// ---------------------------------------------------------------------------
test("app.js loads clean and binds every control it wires", async () => {
  const p = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  try {
    await p.goto(`${origin}/app`, { waitUntil: "networkidle" });
    const state = await p.evaluate(() => {
      // Every id app.js assigns an onclick to. A typo in either place — the
      // markup or the module — shows up here as an unbound control rather than
      // as a dead button someone finds in production.
      const wired = [
        "google-signin", "password-signin", "toggle-signup", "forgot-password",
        "go-signup", "verify-continue", "verify-resend", "verify-signout",
        "menu-btn", "signout", "reset-account", "skip-onboarding",
      ];
      return {
        missing: wired.filter((id) => !document.getElementById(id)),
        unbound: wired.filter((id) => {
          const el = document.getElementById(id);
          return el && typeof el.onclick !== "function";
        }),
      };
    });
    assert.deepEqual(state.missing, [], `app.js wires ids that app.html does not have: ${state.missing.join(", ")}`);
    assert.deepEqual(state.unbound, [], `controls with no handler — app.js threw before reaching them: ${state.unbound.join(", ")}`);
    // App Check runs reCAPTCHA Enterprise against registered origins only, so
    // 127.0.0.1 always fails it. That one is expected; anything else is not.
    const real = errors.filter((e) => !/app-?check|recaptcha/i.test(e));
    assert.deepEqual(real, [], `errors on load:\n${real.join("\n")}`);
  } finally {
    await p.close();
  }
});

// ---------------------------------------------------------------------------
// The no-upload sample. It is the first thing a visitor sees work, so it has to
// render — and it has to stay free. Both are asserted here because both are the
// kind of thing that breaks silently: a fixture drifts from the schema and the
// groups render unlabelled, or someone wires the sample to a live call and it
// starts costing a model call per curious visitor.
// ---------------------------------------------------------------------------
test("sample: /app?sample=1 renders a real report with no sign-in and no model call", async () => {
  const p = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const calls = [];
  p.on("request", (r) => { if (/analyze|extractPlan|generateLetter/.test(r.url())) calls.push(r.url()); });
  try {
    await p.goto(`${origin}/app?sample=1`, { waitUntil: "networkidle" });
    await p.waitForTimeout(1200);
    const state = await p.evaluate(() => {
      const vis = (id) => { const e = document.getElementById(id); return e && !e.hidden; };
      return {
        section: [...document.querySelectorAll("main > section")].find((s) => !s.hidden)?.id,
        totals: [...document.querySelectorAll("#report-totals .tot")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
        groups: [...document.querySelectorAll("#report h3")].map((e) => e.textContent.trim()),
        evidence: document.querySelectorAll("#report .finding details").length,
        banner: vis("sample-banner"),
        cta: vis("sample-cta"),
        // Nothing may act on a report with no document behind it.
        genEmailHidden: !vis("gen-email"),
        newAuditHidden: !vis("new-audit"),
      };
    });
    assert.equal(state.section, "report", "the sample must land on the report, not the sign-in card");
    assert.ok(state.banner, "the made-up-bill banner must be visible above the totals");
    assert.ok(state.cta, "the sign-up call to action must be visible");
    assert.ok(state.genEmailHidden && state.newAuditHidden,
      "the letter and new-audit buttons act on an audit the sample does not have");
    // The figures a real run produced. If these drift, the fixture was edited by
    // hand — which is the one thing its own _source note forbids.
    for (const want of ["$2,115.00", "$841.75", "$186.35", "$842.39"]) {
      assert.ok(state.totals.some((t) => t.includes(want)), `totals missing ${want}: ${state.totals.join(" | ")}`);
    }
    // Four groups, six findings: the three coinsurance mismatches share one heading.
    assert.equal(state.groups.length, 4, `expected 4 finding groups, got: ${state.groups.join(", ")}`);
    assert.ok(state.evidence >= 1, "at least one finding must carry an openable Evidence block — it is the proof");
    assert.deepEqual(calls, [], `the sample must cost nothing, but called: ${calls.join(", ")}`);
  } finally {
    await p.close();
  }
});

// ---------------------------------------------------------------------------
// The landing page's section padding. `section.block { padding: 64px 0 }` is
// element+class (0,1,1) and beat `.wrap { padding: 0 24px }` (0,1,0), so every
// <section class="block wrap"> silently lost its side padding and ran edge to
// edge below 1040px. Invisible on a desktop, because max-width supplies the
// margin there instead — which is exactly why it survived until someone looked
// at the page on a phone.
// ---------------------------------------------------------------------------
test("landing: no section text touches the screen edge on a phone", async () => {
  const p = await browser.newPage({ viewport: { width: 375, height: 812 } });
  try {
    await p.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    const tight = await p.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll("h1,h2,h3,p,li,a.btn")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // The CONTENT edge, not the border box. An element that supplies its own
        // inset — the footer disclaimer carries `padding: 0 24px` — sits at x=0
        // quite correctly, and measuring the box alone flags it as broken.
        const cs = getComputedStyle(el);
        const left = r.left + parseFloat(cs.paddingLeft);
        const right = r.right - parseFloat(cs.paddingRight);
        // 12px is generous — the design uses 24px — but under it is a layout
        // fault rather than a matter of taste.
        if (left < 12 || right > window.innerWidth - 12) {
          bad.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent || "").trim().slice(0, 30)}" left=${Math.round(left)}`);
        }
      }
      return [...new Set(bad)].slice(0, 8);
    });
    assert.deepEqual(tight, [], `content reaching the viewport edge at 375px:\n${tight.join("\n")}`);
  } finally {
    await p.close();
  }
});
