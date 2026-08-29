# Design System — UseClaimRight

## Product Context
- **What this is:** A free, self-serve web app that audits medical bills against EOBs (and soon SBCs) with AI, redacting PHI on-device before anything is sent.
- **Who it's for:** US healthcare consumers who suspect a bill is wrong and want to verify it themselves instead of hiring an advocate.
- **Space/industry:** Consumer health-fintech; peers are Goodbill, Resolve, HealthLock, mediloop — all paid advocate services with warm-trust or fear-based design.
- **Project type:** Web app (vanilla HTML/JS + Firebase) with a marketing landing page.

## The Memorable Thing
**"It found money I didn't owe."** Every design decision serves the moment a finding appears with its quoted evidence and dollar amount. If a choice doesn't sharpen that moment, it doesn't ship.

## Aesthetic Direction
- **Direction:** "Evidence Desk" — editorial/industrial hybrid. A calm forensic workspace: paper surfaces, teal ink, one highlighter. The product is a precision instrument that catches billing mistakes in the act, not an advocate brochure.
- **Decoration level:** Intentional — document material (visible rules, clipped-sheet cards, evidence marks). No ambient decoration, no illustrations of people, no medical stock photography, no fear imagery.
- **Mood:** Deputized, not soothed. The user gets a green eyeshade and a red pen, and catching an error feels satisfying.
- **Reference sites:** goodbill.com (dollar social proof), resolvemedicalbills.com (savings ticker), mediloop.ai (editorial serif accents), rocketmoney.com (money as hero), hioscar.com (plain-language calm), healthlock.com (anti-pattern: fear + stock photos), turquoise.health (teal = health-money territory).

## Typography
- **Display/Hero:** Newsreader 600 — editorial authority for headlines and large dollar outcomes; audit journalism, not hospital portal.
- **Body:** Instrument Sans — neutral grotesk with character; navigation, controls, explanations, findings prose.
- **UI/Labels:** Instrument Sans (same as body), 600–650 for labels.
- **Data/Tables/Evidence:** IBM Plex Mono, tabular-nums — every dollar amount, CPT code, date, and quoted document line. Money is never set in the body font.
- **Code:** IBM Plex Mono.
- **Loading:** Google Fonts, `display=swap`, preconnect; subset to latin.
- **Scale:** 13px mono-small · 14px body-small · 15px body · 18px h3 · 22px h2 · 30px h1 · 44px+ display/dollar-hero.

## Color
- **Approach:** Restrained-semantic. 90% of any screen is paper + ink. Color only ever means something happened to your money.
- **Primary (accent):** `#087E78` — deepened teal "evidence ink"; actions, active states, links. Hover `#056A65`. Soft `#DCEFED`.
- **Highlighter:** `#E8F25C` (soft `#F5F8BD`) — reserved EXCLUSIVELY for found money, mismatches, and evidence marks. Never decorative. This is the signature.
- **Neutrals:** paper `#F2F6F4` (background) · surface `#FFFFFF` · rule `#C9D7D4` · muted text `#607473` · ink `#123232` (primary text) · shadow `rgba(18,50,50,0.09)`.
- **Semantic:** success `#0A8A5F` · warning `#C98A2B` (legacy gold, being retired in favor of highlighter for money contexts) · error/danger `#B84635` · info `#DCEFED` on ink.
- **Dark mode:** Not currently shipped; when added, redesign surfaces (ink paper, paper ink) and desaturate teal ~15%.

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Hybrid — grid-disciplined app screens; asymmetric editorial landing. Findings render as a vertical evidence narrative (amount → the bill's claim → the contradicting quote → the calculation → the action), with visual width scaled to importance rather than equal card rows.
- **Grid:** Single 960px column app; landing may split asymmetric (2/5 headline, 3/5 evidence artifact).
- **Max content width:** 960px
- **Border radius:** sm 8px (controls, rows) · md 10-12px (inputs, notes) · lg 16px (cards/"clipped sheets") · full 9999px (progress bars). Radius is hierarchy — do not flatten to one value.

## Motion
- **Approach:** Minimal-mechanical. Scan lines during redaction, snapping alignment, an evidence-highlight sweep when a finding renders. Nothing floats, nothing ambient.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms) long(400-700ms)

## Signature Patterns
- **Evidence quote:** mono type, narrow teal left rule, source label (Bill/EOB/SBC); every conclusion visibly points to its source. Never show a dollar result without where it came from.
- **Redaction as visible behavior:** PHI chips and the review gate are the privacy story — shown happening ("Removed on this device"), never reduced to a shield icon.
- **The receipt:** the audit summary is styled as a perforated thermal receipt — mono figures, "WORTH DISPUTING" total, "PHI REDACTED ON-DEVICE" stamp — built to be screenshotted.
- **Plan card ("Your plan"):** styled like the benefits card in a wallet — mono values (deductible, OOP max, copays); plan-mismatch findings draw the cross-reference explicitly ("Your SBC says $60 copay → this bill applies $175").

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-08 | Initial design system created | /design-consultation: deep research (7 sites) + Codex "Evidence Desk" + Claude subagent "Receipt Printer" outside voices; both independently converged on evidence-first layout, mono money, and a highlighter-yellow found-money marker. Foundation evolves existing teal rather than rebranding. |
| 2026-08-28 | Form controls are **16px on phones** (≤560px), not the 14px control size | iOS Safari zooms the whole page whenever a focused control is under 16px, shifting the layout mid-typing with no way to pinch back. It fired on the first tap of the sign-in screen. This is a platform floor, not a type choice; the 14px control size still holds everywhere above 560px. |
| 2026-08-28 | On phones, "Worth disputing" renders **first** among the four totals | The cards stack in a single column below 560px, which put the hero figure fourth — off the bottom of an iPhone SE. "The Memorable Thing" is that number; burying it contradicts the stated principle that every decision serves the moment a finding appears. CSS `order` only, so the desktop reading order is unchanged. |
| 2026-08-08 | Highlighter `#E8F25C` replaces gold for money-at-stake contexts | Both outside voices picked nearly identical yellows independently; it becomes the product signature, used only where money/evidence is found. |
