# PROGRESS — Chip Check v2

**Spec:** `chipcheck_v2.md` (Part H is the phased build plan). This file is the running status.
**Rhythm:** one phase per session. Don't start the next phase until the current one's DoD is
ticked — agent items by the agent, **(Ian)** items by Ian. The agent never ticks an (Ian) item.

---

## Current status

**Phase 0 — in progress.** Agent half complete; every credential-dependent item is blocked on
Ian's infrastructure setup. See `docs/setup-ian.md` for the ordered runbook.

| Phase | Model used | State |
|---|---|---|
| 0 | Opus 5 | Agent half done; 4 DoD items blocked on Ian |
| — | Opus 5 | PRD amendment applied (seven review findings + spec/reality reconciliation) |
| 1–7 | see §28b | Not started — Phase 1 next, with the amended orders API |

---

## Amendment applied

The seven v1-review findings are now folded into `chipcheck_v2.md` (§4, §9, §11–§15, §20, §22,
§23–§25, Part H, Part I, §31). Three were already fixed in v2 and needed no change; three were
carried forward untouched (staff connection indicator, undo on clear, ready-list shed nudge) and
are now specified; one was new scope (order age counter). The same pass reconciled the spec with
what Phase 0 actually built — see deviations 1–4 below, which are now reflected in the spec
itself rather than only here.

---

## Deviations

Recorded rather than silently worked around (per CLAUDE.md).

1. **`create-next-app` flag.** The PRD's Phase 0 task 1 specifies `--src-dir=false`. That is not
   a valid form — `create-next-app@14 --help` lists `--src-dir` as a bare boolean, so `=false`
   is either truthy (scaffolding into `src/`, contradicting every path in §22 and §31) or leaves
   the prompt unanswered and hangs a non-interactive session. Used `--no-src-dir`; verified
   `app/` is at the repo root and no `src/` exists.

2. **Node 22, not 20.** §27 says "Node 20 or 24". `firebase-admin@14.3.0` declares
   `engines: { node: ">=22" }`, so Node 20 breaks it. Pinned via `.nvmrc`, `package.json`
   `engines`, and `node-version: 22` in CI. **Ian: set the Vercel project to Node 22+.**

3. **`lib/env.ts` parses lazily, not at module load.** §7.3 specifies a module-load throw. That
   would fail `next build` in any environment without runtime secrets — including CI, which is
   itself a Phase 0 DoD item. `serverEnv()` is memoised and called at the top of each handler,
   giving the identical fail-closed guarantee while remaining unit-testable. Proven by
   `tests/unit/env.test.ts` (9 assertions, including that error messages never echo a value).

4. **`@types/node` bumped to ^22.** `create-next-app@14` scaffolds `^20`; `vitest@5` requires
   `^22 || >=24`. Bumped rather than reaching for `--legacy-peer-deps`, and consistent with
   deviation 2.

5. **`vercel.ts` confirmed correct.** `@vercel/config@0.7.0` is a real Vercel package
   ("TypeScript SDK for programmatically configuring Vercel projects") and its bundled types
   define `crons: CronJob[]` where `CronJob = { schedule: string; path: string }`. Config is
   imported from the `@vercel/config/v1` subpath — the bare package has no root export.
   `vercel.com` is egress-blocked from the sandbox, so this was verified from `node_modules`.

6. **`w9jds/firebase-action` pinned to `@v13`** as §27 states. Re-check the current release tag
   before the first rules deploy.

7. **`passWithNoTests` on the rules suite.** Phase 1 writes the real §10 rules tests; until then
   an empty run must not fail CI.

8. **npm audit reports vulnerabilities** in the transitive tree from `create-next-app@14`'s
   pinned Next 14.2.35. Not addressed — `npm audit fix --force` would pull Next 16 and break
   NextUI v2 (§3). Revisit at Phase 6.

---

## Phase checklists

### Phase 0 — Scaffold, projects, pipeline

**Model:** Claude Opus 5 — stepped up from §28b's Sonnet 5. Phase 0's risk is version traps
and foundations seven later phases inherit, not typing volume; three of the deviations above
were caught by not taking the spec's install instructions at face value.

- [x] `npm run build` and `npm run lint` pass in the sandbox.
- [ ] PR to `dev` produces a green Vercel Preview; `/` renders the landing with Archivo and the dark canvas. — **blocked:** no Vercel project, and no `dev` branch to target (runbook 1, 3)
- [ ] The Firestore rules Action ran on `dev` and the Firebase console shows the deny-all rules for `chipcheck-dev`. **(Ian)** — **blocked:** no Firebase project, no repo secrets (runbook 2, 5)
- [ ] Vercel → Settings → Cron Jobs lists `/api/cron/purge-stale` (route may 404 until Phase 1). **(Ian)** — **blocked:** no Vercel project (runbook 3)
- [ ] `curl https://<dev alias>/api/health` returns `{ ok: true, project: "chipcheck-dev" }` (a tiny route that proves the Admin SDK initialises from `FIREBASE_SERVICE_ACCOUNT_JSON`). — **blocked:** route written and building; needs the service account (runbook 2, 4)
- [ ] Sandbox can run `node scripts/admin-ping.mjs` and read `chipcheck-dev` (proves sandbox env vars). — **blocked:** script written; needs `FIREBASE_SERVICE_ACCOUNT_JSON` in the sandbox env (runbook 4)
- [x] `PROGRESS.md` and `CLAUDE.md` committed; `.env.local` absent from git.

**Also closed this session (beyond the written DoD):**
- [x] `npx tsc --noEmit` clean.
- [x] `npm test` green — 9 assertions proving `lib/env.ts` fails closed on a missing secret.
- [x] `app/` at the repo root, no `src/` directory.
- [x] All fourteen §20 colour tokens and the NextUI content path present in `tailwind.config.ts`.
- [x] `docs/setup-ian.md` written — the ordered runbook for every blocked item above.

### Phase 1 — Data model, rules, orders API, purge

**Model:** Claude Opus 5 — transactions, security rules, purge semantics; failures here are silent (§28b). Do not downgrade.

- [ ] `npm test` green; rules tests green in CI (`firebase emulators:exec`).
- [ ] Rules tests prove: anonymous can `get` a shop and `list` its orders; **cannot** write any path; **cannot** read `private/*`, `activeNumbers/*`, `users/*`, `config/*`, `stripeEvents/*`; cannot `list` `shops`.
- [ ] `scripts/orders-smoke.sh https://<preview>` passes every assertion against `chipcheck-dev`.
- [ ] Two concurrent `add` requests for the same number → exactly one 200 and one 409 (script fires them with `&`).
- [ ] Firestore console shows the composite indexes as **Enabled** for `chipcheck-dev`. **(Ian)**
- [ ] Cron route returns 401 without the bearer, 200 with it, and clears a seeded order whose `createdAt` was set 7 h in the past by the seed script.
- [ ] `clear` then `unclear` restores the order **and** re-creates `activeNumbers/{orderNumber}`; an order cleared while `ready` comes back `ready`, not `preparing`.
- [ ] `unclear` after the same number has been re-added → 409 `duplicate_order` carrying the active order; the re-added order is untouched.
- [ ] `unclear` on an order cleared by the purge or by `clearAll` → 409 `invalid_transition`.
- [ ] `unclear` more than 60 s after the clear → 409 `invalid_transition`, and the lock doc is left free.
- [ ] `clearAll` with `{ status: "ready", olderThanSeconds: N }` clears only matching orders and leaves preparing orders and newer ready orders active.
- [ ] 61st `add` within a minute from one IP → 429 `rate_limited` with `retryAfterSeconds`; 6th `clearAll` → 429; `markReady`/`recall`/`clear`/`unclear` are never rate-limited.
- [ ] No `NEXT_PUBLIC_` variable contains a secret (grep in CI).

### Phase 2 — Owner auth, shops, PIN

**Model:** Claude Opus 5 — crypto, session cookies, rate limiting, fail-closed config (§28b). Do not downgrade.

- [ ] On the `dev` alias, Google sign-in completes and `/app` shows "No shops yet." **(Ian)**
- [ ] Creating `test-shop` via the UI writes `shops/{id}`, `slugs/test-shop`, `private/auth` (hash only, no plaintext), `private/billing` `{ status: "pilot" }`, and `users/{uid}.shopIds` — verified in the Firestore console. **(Ian)**
- [ ] Creating a shop with a reserved slug → 400 `slug_reserved`; with a taken slug → 409 `slug_taken` (curl with the session cookie).
- [ ] `PATCH` by a different Google account → 403 (agent uses two seeded session cookies from a second test account Ian creates, or Ian verifies manually). **(Ian if manual)**
- [ ] `curl -X POST …/staff/unlock` with the right PIN → 200 + `Set-Cookie: cc_staff…; HttpOnly; Secure; SameSite=Lax`; wrong PIN → 401; sixth wrong attempt within 15 min → 429 with `retryAfterSeconds`.
- [ ] Orders route now rejects requests without `cc_staff` (401) and accepts with it; a cookie for shop A is rejected on shop B (401).
- [ ] With `STAFF_SESSION_SECRET` removed from a throwaway Preview env, every API route returns 500 (fail-closed), not 200. **(Ian sets the env, agent curls)**
- [ ] `DELETE /api/auth/session` clears the cookie; a subsequent `/app` request redirects to `/login`.

### Phase 3 — Staff console per shop

**Model:** Claude Sonnet 5 for the port; Claude Opus 5 for `lib/useOrders.ts` (pending reducer + status derivation) (§28b).

- [ ] `test-shop` set to digits 2–5: the Add button enables only for 2–5 digit input; keypad stops at 5; server rejects a 6-digit number with 400 even if forced via curl.
- [ ] Add on tablet A → card appears on tablet B within 1.5 s (Ian, two devices or two browsers on the `dev` alias; measured by eye against the display clock). **(Ian)**
- [ ] Double-tapping Ready fires exactly one request (Playwright counts network calls).
- [ ] Wrong PIN shows "Wrong PIN" inline without leaving the gate; correct PIN shows the console without reload flicker.
- [ ] Kill the network on the tablet for 30 s: the header dot flips to amber "Reconnecting" (this is the whole point — writes would still succeed over HTTP, so without the dot the tablet looks healthy while its list goes stale), buttons produce "Couldn't reach the server", state reconciles when back online. **(Ian)**
- [ ] With `targetPrepSeconds` set low on `test-shop`, a card's age crosses the threshold and switches to the heavier pill treatment, with no colour change to the row.
- [ ] `Clear` shows the undo alert; Undo within 10 s restores the card; the alert dismisses on the next mutation; undoing a number that has been re-added shows "Couldn't undo — #{orderNumber} is active again".
- [ ] The shed nudge appears only when ready orders exceed `readyTimeoutSeconds`, its count matches, and clearing it leaves preparing orders untouched.
- [ ] Layout matches v1 at 390, 768, 1024, 1280 widths (Ian compares against the v1 site side by side; agent provides Playwright screenshots at those widths as PR artefacts). **(Ian)**
- [ ] Playwright smoke green in CI against the `dev` alias.

### Phase 4 — Customer display + QR per shop

**Model:** Claude Sonnet 5 — §22.1/§22.3 are near-complete markup (§28b).

- [ ] TV at 1920×1080: two columns, tiles ≥ 190 px, header at `md:` sizes, no scrollbars with 12 tiles per column. **(Ian)**
- [ ] Phone 390×844 via the printed QR: stacked columns, both headers visible, footer copy when empty. **(Ian)**
- [ ] `?sound=1`: chime plays once per newly-ready number after one tap; no chime for numbers already ready at load. **(Ian)**
- [ ] A display left open and untouched from load, then tapped once, chimes on the next ready order — proving `ctx.resume()` runs on the gesture; the "Tap to enable sound" hint disappears at that point. **(Ian)**
- [ ] Wake Lock keeps the TV/tablet awake ≥ 15 min with the toggle on (device with screen timeout set to 2 min). **(Ian)**
- [ ] Setting `readyTimeoutSeconds` in `/app/{slug}` changes how long ready tiles stay, with no deploy.
- [ ] `/{slug}/qr` encodes `https://<NEXT_PUBLIC_SITE_URL>/{slug}/display` (the text under the QR shows it); printed page is white with only the card. **(Ian prints)**
- [ ] `prefers-reduced-motion` emulated in Playwright → tiles have no transform animation.
- [ ] Manifest validates (Lighthouse PWA "installable" check on the `dev` alias). **(Ian)**
- [ ] Playwright display tests green.

### Phase 5 — Billing behind the flag

**Model:** Claude Opus 5 — entitlement matrix, webhook mapping, idempotency, signature verification (§28b). Do not downgrade.

- [ ] Flag **off** (default): no plan card, no banner, `add` never returns 402, new shops get `isPilot = true` / `status = "pilot"`. Verified by curl + Playwright.
- [ ] Flag **on** in Preview: new shop → `isPilot = false`, plan card shows **Subscribe**; Checkout with card `4242 4242 4242 4242` → webhook → `status = "trialing"`, card shows "Trial — ends {date}". **(Ian)**
- [ ] Posting the `invoice.payment_failed` fixture → `past_due`, console shows the amber banner, `add` still 200 (grace); fixture with `pastDueSince` older than 7 days (seeded directly) → `add` 402 and the subscription modal appears.
- [ ] Cancel in the Customer Portal → `customer.subscription.deleted` → `canceled` → `add` 402; re-subscribe → 200. **(Ian)**
- [ ] Posting the same event id twice → second returns 200 and changes nothing (`stripeEvents/{id}` exists).
- [ ] Bad signature → 400. Webhook route works with the raw body on Vercel (no body parsing middleware).
- [ ] `/admin` lists shops for a UID in `SUPERADMIN_UIDS`, 403 for others; toggling pilot on a `canceled` shop makes `add` 200 again.
- [ ] Flipping `config/flags.billingEnabled` in the Firestore console changes behaviour within 60 s without a deploy. **(Ian flips, agent curls)**
- [ ] Preview `BILLING_ENABLED` set back to `false` at the end of the phase; Production never had it on. **(Ian)**

### Phase 6 — Hardening

**Model:** Claude Opus 5 for the codebase-wide audit, plus one Claude Fable 5.1 pass over rules + auth + webhook before the pilot (§28b).

- [ ] 60-minute soak: zero non-2xx responses, zero snapshot gaps > 5 s, TV never slept, tablet never showed the gate. **(Ian watches, agent runs the script)**
- [ ] Tab backgrounded overnight on a tablet shows "Reconnecting" then "Live" on wake and the correct list (Ian leaves a tablet open overnight). **(Ian)**
- [ ] Every user-visible error string in §23 is reachable and correct (Playwright asserts the mapped copy for each forced error code via a test-only `?force=` query in non-production, removed before Phase 7 or gated by `NODE_ENV`).
- [ ] Kiosk doc followed cold by Ian on a fresh tablet + TV without asking questions. **(Ian)**
- [ ] Lighthouse thresholds met. **(Ian)**
- [ ] `PROGRESS.md` deviations section reviewed; nothing outstanding except Part I questions.

### Phase 7 — Pilot

**Model:** Claude Sonnet 5; step up to Claude Opus 5 for any incident touching auth, billing or data integrity (§28b).

- [ ] Two Little Fish runs a full service day on v2 with no reversion to v1. **(Ian)**
- [ ] At least one other shop created its own board without Ian touching a console. **(Ian)**
- [ ] Every pilot issue is logged with a fix or a "won't fix" and the reason.
- [ ] Price and trial length recorded in `PROGRESS.md`; `STRIPE_PRICE_ID` set on Production. **(Ian)**
- [ ] Flag flipped on Production; pilot shops still `isPilot = true`; a brand-new shop sees the plan card. **(Ian)**
- [ ] v1 Vercel project paused. **(Ian)**

---
