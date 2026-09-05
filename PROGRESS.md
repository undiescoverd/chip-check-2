# PROGRESS — Chip Check v2

**Spec:** `chipcheck_v2.md` (Part H is the phased build plan). This file is the running status.
**Rhythm:** one phase per session. Don't start the next phase until the current one's DoD is
ticked — agent items by the agent, **(Ian)** items by Ian. The agent never ticks an (Ian) item.

---

## Current status

**Phase 1 — agent side complete.** The whole orders write path is built and, unexpectedly,
*verified* rather than merely written: the Firestore emulator turns out to run in the sandbox
(deviation 9), so the security rules and the transaction semantics are proven here rather than
taken on trust. Two DoD items remain, both needing Ian's Firebase/Vercel setup: the smoke
script against a real Preview, and the composite indexes showing Enabled in the console.

Phase 0's four credential-dependent items are still open on the same runbook.

| Phase | Model used | State |
|---|---|---|
| 0 | Opus 5 | Agent half done; 4 DoD items blocked on Ian |
| — | Opus 5 | PRD amendment applied (seven review findings + spec/reality reconciliation) |
| 1 | Opus 5 | Agent side complete; 220 tests green; 2 DoD items blocked on Ian |
| 2–7 | see §28b | Not started — Phase 2 next |

**Test counts this session:** 148 unit, 28 rules, 44 emulator integration. Lint, typecheck and
`next build` clean.

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

### Added in Phase 1

9. **§28's "no emulator in the sandbox" is wrong — in our favour.** The whole Phase 1 test
   strategy was designed around the builder having no emulator, with rules tests marked CI-only.
   Java 21 and `firebase-tools` are both present and the emulator jar downloads, so the rules
   suite and a new emulator-backed integration suite both run here. This matters more than it
   sounds: §10's rules are the only thing between the public internet and the write path, and
   they are now *proven* in-session rather than deployed on faith. Later phases should assume the
   emulator is available. Added `npm run test:integration` and a second `emulators:exec` step in
   CI.

10. **`adminApp()` gained an emulator branch.** Taken only when `FIRESTORE_EMULATOR_HOST` is set,
    and it throws rather than proceeding if `NODE_ENV` or `VERCEL_ENV` is `production`. The
    project id comes from `FIREBASE_EMULATOR_PROJECT_ID`, never a credential. With the variable
    unset the fail-closed path is exactly as before.

11. **`X-Dev-Staff-Token` — a deliberate temporary hole. Phase 2 task 4 must remove it.**
    Specified by Part H task 2: the orders route is authorised by a header equal to
    `STAFF_SESSION_SECRET` until the `cc_staff` cookie exists. It is inert whenever
    `NODE_ENV === "production"`, compared in constant time, and cannot be shop-scoped — which is
    the point. `tests/unit/auth.test.ts` asserts the production refusal so this cannot rot
    quietly.

12. **`clearAll` filters in memory rather than in Firestore.** The amendment's
    `{ status, olderThanSeconds }` filters, expressed as a query, would need a composite index on
    `(cleared, status, readyAt)` that §9's index table does not declare — and §9's stated
    principle is that the file declares exactly the queries issued. `clearAll` already reads every
    uncleared order for the shop, so filtering the result costs nothing and no third index is
    needed. A gap the amendment itself created; recorded rather than silently indexed around.

13. **Batches chunk at 250 orders, not 500.** §13 says "batched writes of 500", but clearing one
    order is *two* writes — the order update and its lock delete — so 500 orders would be 1000
    writes and exceed Firestore's cap. `tests/integration` clears 260 orders to prove the
    chunking.

14. **Emulator integration tests in place of the in-memory Admin stub.** Part H task 5 asks for an
    in-memory Admin stub for the route test. The route test instead mocks the service module and
    asserts the HTTP contract, while the data layer is tested against the real emulator. A stub of
    Firestore's transaction semantics would only prove the stub agrees with itself, and the dedupe
    race is precisely what §28b says fails silently.

15. **The rate-limit window counts accepted adds.** The check is folded into the `add`
    transaction per §14.1, so a rejected request — duplicate or over-limit — aborts the
    transaction and does not increment the counter. "61st add in a minute → 429" holds exactly as
    the DoD states; a client spamming duplicates is bounded by the lock rather than the counter.

16. **Timestamps are epoch milliseconds above the Firestore layer.** `lib/server/firestore.ts`
    converts at the boundary. This keeps the decision logic in `lib/orders/rules.ts` pure and
    unit-testable, and it fixes the API's wire format, which Phase 3's `upsertLocal` must match.
    A field written with `serverTimestamp()` reads back null until it resolves, so every consumer
    handles null.

17. **`config/flags` is cached for 60 s.** §17 promises a flag flip takes effect "within 60 s
    without a deploy", so the read is cached for exactly that rather than hitting Firestore on
    every `add`. A failed read falls back to the env var — billing is a commercial gate, and
    taking every shop offline over one config read would be the worse failure.

18. **Known ceiling: `private/rateLimits` is one document per shop.** Firestore sustains roughly
    one write per second per document, and §14.1's `add` ceiling is 60/min — right at it. Real
    shops run nearer 10/min, so this is a documented ceiling rather than a problem. Revisit only
    if a shop ever approaches the limit; sharding would be overkill at pilot scale.

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

**Model:** Claude Opus 5 — transactions, security rules, purge semantics; failures here are silent (§28b). Do not downgrade. Run on Opus 5 as specified.

- [x] `npm test` green (148); rules tests green (28) — run **locally as well as in CI**, see deviation 9.
- [x] Rules tests prove the full §10 matrix, plus that undeclared paths and subcollections are denied. `tests/rules/firestore-rules.test.ts`.
- [ ] `scripts/orders-smoke.sh https://<preview>` against `chipcheck-dev`. — **blocked:** no Vercel project or Firebase project. All 26 assertions pass against a local server on the emulator; the script targets any base URL unchanged.
- [x] Two concurrent `add` requests → exactly one 200 and one 409. Proven over HTTP (`&`-fired, locally) **and** at the service layer, including a five-way race.
- [ ] Firestore console shows the composite indexes as **Enabled** for `chipcheck-dev`. **(Ian)** — **blocked:** no Firebase project. Both indexes are declared in `firestore.indexes.json`; the emulator does not enforce them, so production is the only place this can be confirmed.
- [x] Cron route returns 401 without the bearer and 200 with it; `purgeShop`/`purgeAll` clear a backdated order and are idempotent. `scripts/seed-shop.mjs --stale` seeds the 7 h order.
- [x] `clear` → `unclear` restores the order and re-creates the lock; an order cleared while `ready` comes back `ready`.
- [x] `unclear` after a re-add → 409 `duplicate_order` carrying the active order; the re-added order is untouched.
- [x] `unclear` on a purge- or `clearAll`-cleared order → 409 `invalid_transition`.
- [x] `unclear` past 60 s → 409 `invalid_transition` with the lock left free — every guard throws before any write, so there is no partial state to clean up.
- [x] `clearAll` with `{ status: "ready", olderThanSeconds: N }` sheds only ready orders past the timeout; age measured from `readyAt`, not `createdAt`.
- [x] 61st `add` from one IP → 429 with `retryAfterSeconds`; 6th `clearAll` → 429; 60 markReady/recall cycles plus clear/unclear are never limited. Limits are per IP, and the two budgets are independent.
- [x] No `NEXT_PUBLIC_` variable contains a secret (grep passes).

**Also closed this session (beyond the written DoD):**
- [x] 44 emulator-backed integration tests over the real write path (deviation 9).
- [x] All 26 assertions in `scripts/orders-smoke.sh` pass end to end over HTTP against a local
      server on the emulator — including the concurrent-add race and both cron cases.
- [x] `firestore.rules` replaced the deny-all stub; `passWithNoTests` removed from the rules
      config (Phase 0 deviation 7 discharged).
- [x] The Phase 1 dev auth header is proven inert in production by test, not by inspection.

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
