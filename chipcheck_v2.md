# Chip Check v2 — PRD + Build Plan

**Working name:** "Chip Check" (placeholder — the app may be renamed before launch; nothing in this document depends on the name except copy strings marked `{appName}`).
**Version:** 2.0 spec, 2026-09-05
**Status:** Approved for build. One phase per session. `PROGRESS.md` in the new repo is the running status; this file is the spec.
**Predecessor:** Chip Check v1 (`undiescoverd/chip-check`, Next.js 14 + Supabase + NextUI v2, single shop, Two Little Fish pilot). This document is self-contained — the v1 repo, PRD and build plan are **not** required to build from it.

> **How to read this document.**
> Every deliberate difference from v1 is tagged **[v2 change]**. Every v1 defect that v2 fixes rather than ports is tagged **[v1 gap fixed]**. Everything untagged is a straight port of v1 behaviour, quoted at class/value level so the screens are pixel-identical.
> Parts A–G are the PRD. Part H is the phased build plan with Definitions of Done. Part I is open questions.

---

## Contents

**Part A — Product**
1. Summary & goals
2. Users & personas
3. Locked decisions & stack
4. What stays identical to v1 / what changes

**Part B — Multi-tenancy & auth**
5. Tenant model
6. Roles
7. Auth flows
8. Onboarding

**Part C — Data model (Firestore)**
9. Collections
10. Security rules
11. Realtime
12. Optimistic UI

**Part D — API**
13. Endpoints
14. Validation & errors
15. Entitlement check

**Part E — Billing (Stripe, feature-flagged)**
16. Model
17. Feature flag
18. UI when billing is on
19. Test mode

**Part F — Screens & design**
20. Design tokens
21. Route map
22. Per-screen specs
23. Copy inventory
24. Responsive & device matrix
25. Accessibility

**Part G — Ops**
26. Environment variables
27. Deployment
28. Testing in a cloud sandbox
28a. Agent / Ian responsibility split
28b. Model per phase
29. Data migration
30. Kiosk setup
31. Appendix: `CLAUDE.md` for the v2 repo

**Part H — Build plan** (Phases 0–7)

**Part I — Open questions & risks**

---

# Part A — Product

## 1. Summary & goals

Chip Check is a real-time ticket-number board for food places that hand customers a numbered ticket. Staff type a number on a tablet; the number appears on a TV (and on customers' phones via a QR code) under **Preparing**; staff tap **Ready** and the number jumps to the green **Ready · Collect** column; a chime can play; the number drops off the board after a timeout or when staff clear it.

v1 proved the product at one shop (Two Little Fish). v2 is a rebuild with the same screens and the same design, and three structural changes:

| Goal | What it means |
|---|---|
| **Backend swap** | Supabase → Firebase (Auth + Firestore + Admin SDK). Same read-direct / write-through-server split as v1. **[v2 change]** |
| **Multi-tenant** | Any shop owner signs in with Google, creates a shop, sets a PIN, and gets `/{slug}/display`, `/{slug}/staff`, `/{slug}/qr`. No forking, no per-shop deploys. Small number of tenants expected (tens, not thousands). **[v2 change]** |
| **Billing-ready** | One Stripe monthly plan, behind a feature flag that is **off** for the pilot. Pilot shops are grandfathered. Flipping the flag needs no rebuild. **[v2 change]** |
| **Fix, don't port, v1's gaps** | Server-side validation, atomic dedupe, a stale purge that actually runs, a real PIN check with lockout, real optimistic UI, tests. **[v1 gap fixed]** |

### Non-goals (v2)

- **No POS integration.** Numbers are typed by hand, as in v1.
- **No private per-customer tracking page.** v1's `/order/[number]` stub is dropped; a private page would need a per-order token on the receipt (see Part I). Deferred indefinitely (v1 commit `e11e143`).
- **No buzzer / pager hardware integration.** Shops that hand out pagers can simply enter the pager number as the ticket number — the per-shop 1–6 digit setting covers this. Whether staff *want* to do that is an open question (Part I).
- **No invited co-managers.** One Google account owns a shop. Deferred (§6).
- **No collection verification (name/initial on the board).** Still deferred from v1 (Part I).
- **No native apps.** PWA manifest only (§24).

### Success criteria

- A new shop owner can go from `/login` to a working TV board in under five minutes with no help from Ian.
- Two staff tablets and one TV stay in sync within 1.5 s (v1 target).
- The display runs unattended for a full service day (≥ 8 h) without manual reload.
- With `BILLING_ENABLED=true` in Preview, a shop can subscribe in Stripe test mode and lose/regain the ability to add orders as its subscription changes, with no code changes.

## 2. Users & personas

| Persona | Device | Auth | What they do |
|---|---|---|---|
| **Shop owner** | Laptop or phone, occasionally | Google sign-in | Creates the shop, sets ticket digits / ready timeout / sound, sets and rotates the staff PIN, prints the QR, manages billing (when on). Usually one person per shop. |
| **Floor staff** (cashier, packer) | iPad or Android tablet at the counter / pass, sometimes a phone | Shop PIN, entered once per device session | Add ticket numbers, mark ready, recall, clear. Hands may be wet or greasy; attention split between customer and kitchen. |
| **Customer** | Wall TV (read-only), own phone via QR | None | Watches for their number. Reads from a short distance under harsh lighting. |
| **Superadmin** (Ian) | Laptop | Google sign-in, UID in `SUPERADMIN_UIDS` | Sees all shops, toggles pilot status per shop. |

**Environment** (from v1 PRODUCT.md, still true): busy, loud, fast-paced counter; glare; imprecise taps. The job is one or two taps per state change, legible from across the counter, no hunting for controls.

## 3. Locked decisions & stack

Decisions taken with Ian before this document. **Do not relitigate.**

| Decision | Choice |
|---|---|
| Write path | Next.js Route Handlers on Vercel (Node runtime, Fluid Compute) using `firebase-admin`. Browser reads Firestore directly via the web SDK. **The browser never writes orders.** |
| Staff access | Owner signs in with Google (creates/manages shop, sets PIN). Floor tablets unlock `/{slug}/staff` with the shop's PIN. |
| Sign-up | Open self-serve with Google. No allowlist. |
| Ticket format | Per-shop digit length: `ticketMinDigits`/`ticketMaxDigits`, each in 1–6, min ≤ max, **default 1–4**. Digits only. Leading zeros preserved (stored as a string). |
| URLs | Path slug: `/{shop}/display`, `/{shop}/staff`, `/{shop}/qr`. |
| Ready auto-clear | **300 s** default, per-shop configurable (`readyTimeoutSeconds`). Display-layer concern only. |
| Billing | Stripe, one monthly plan, behind a feature flag. Pilot shops grandfathered via `isPilot`. |
| Scope of this doc | PRD **and** phased build plan (Phase 0–7, Definition of Done per phase, `PROGRESS.md` style). |
| Build environment | **Claude Code on the web** (Anthropic cloud sandbox). No browser, no local emulators, no `stripe listen`, no device testing in the sandbox. Verification runs against the dev Firebase project and Vercel Preview deployments. |
| App name | "Chip Check" is a placeholder. |

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 14** App Router + TypeScript | `create-next-app@14` pinned. `@latest` ships Next 16 + Tailwind v4, which breaks NextUI v2 (v1 deviation, carried forward). |
| Components | **NextUI v2** (`@nextui-org/react` ^2.6) | NOT HeroUI, despite deprecation notices. Used only for `Alert`, `Button`, `Modal`, `Spinner`. |
| Styling | **Tailwind v3** (`tailwind.config.ts`) + NextUI plugin | Not Tailwind v4 CSS config. |
| Auth | **Firebase Auth** (Google provider) + Firebase session cookies | **[v2 change]** |
| Database + realtime | **Firestore** (web SDK `onSnapshot` on the client; Admin SDK on the server) | **[v2 change]** |
| Billing | **Stripe** (Checkout, Customer Portal, webhooks) | **[v2 change]**, flag-gated |
| Hosting | **Vercel** (Git integration, Preview per PR, Cron) | |
| Icons | `lucide-react` | v1 uses only `Delete` (keypad backspace). |
| Animation | `framer-motion` ^12 (explicit peer dep for NextUI) | |
| QR | `qrcode` + `@types/qrcode` | |
| Validation | `zod` | **[v1 gap fixed]** v1 had no body validation |
| Hashing / signing | Node `crypto` (`scrypt`, HMAC-SHA256) | no extra deps |
| Tests | `vitest`; `@firebase/rules-unit-testing` (in CI only); Playwright smoke (Phase 6) | **[v1 gap fixed]** v1 had zero tests |
| Package manager | npm | |

Dependencies to drop from v1: `@supabase/supabase-js`, the bundled Geist fonts (`app/fonts/*.woff`, declared but never used in any class). Keep `server-only`.

## 4. What stays identical to v1 / what changes

### Identical (pixel and behaviour parity required)

- All three shop screens: **display**, **staff** (PIN gate + console), **qr** — layout, Tailwind classes, breakpoints, copy, timers, sound, animations (§22).
- Design tokens, font (Archivo 700/800/900), dark-only theme, flat/no-shadow doctrine, named design rules (§20).
- Order state machine: `preparing → ready → (cleared)`, with `recall` (`ready → preparing`). Soft delete only.
- Ready auto-clear is a **display-only visual filter**; the staff console shows ready orders until staff clear them.
- 6-hour stale purge as a **code constant**.
- Order numbers stored as **strings**.
- Read path direct from the browser; write path only through Route Handlers.

### Changes

| Area | v1 | v2 |
|---|---|---|
| Backend | Supabase Postgres + Realtime, publishable/secret keys | Firebase Auth + Firestore + Admin SDK **[v2 change]** |
| Tenancy | One shop, hardcoded | `shops/{shopId}` with slug routing **[v2 change]** |
| Owner auth | None (no owner concept) | Google sign-in + session cookie **[v2 change]** |
| Staff auth | Plaintext PIN in `sessionStorage`, sent in every write body, compared to `STAFF_PIN` env var; **fails open if env var unset** | PIN unlock endpoint → hashed compare → signed HttpOnly cookie; rate-limited; fail-closed **[v1 gap fixed]** |
| Settings | Env vars (`NEXT_PUBLIC_READY_TIMEOUT_SECONDS`) and constants (4 digits) | Per-shop `settings` document, editable by owner **[v2 change]** |
| Ticket length | Fixed 4 digits | 1–6 digits, per-shop min/max **[v2 change]** |
| Dedupe | Client read-then-write (racy) | Server transaction with `activeNumbers/{orderNumber}` lock doc → 409 **[v1 gap fixed]** |
| Validation | None (`request.json()` cast to a union type) | zod on every body; malformed JSON → 400 **[v1 gap fixed]** |
| State guards | None (`recall` on a preparing order silently "succeeds") | `markReady` only from `preparing`; `recall` only from `ready`; all require `cleared == false` → 409 otherwise **[v1 gap fixed]** |
| Stale purge | Route action, never scheduled | Vercel Cron every 30 min + opportunistic per-shop purge on `add` **[v1 gap fixed]** |
| Optimistic UI | `upsertOrder` exported, never called | Pending overlay keyed by order id until snapshot confirms **[v1 gap fixed]** |
| Composite index | `orders(status, cleared)` declared but the only query is `cleared + created_at` | `firestore.indexes.json` declares exactly the queries used **[v1 gap fixed]** |
| QR target | `window.location.origin` (prints `localhost` if printed locally) | `NEXT_PUBLIC_SITE_URL` with origin fallback **[v1 gap fixed]** |
| Billing | None | Stripe behind `BILLING_ENABLED` **[v2 change]** |
| `/order/[number]` | Placeholder page | Dropped **[v2 change]** |
| `/` | Three links (Staff / Display / Print QR) | Landing + sign-in **[v2 change]** |
| Tests | None | Vitest + rules tests + Playwright smoke **[v1 gap fixed]** |
| Display robustness | None | Wake Lock, `prefers-reduced-motion`, safe-area insets, `aria-live`, PWA manifest **[v2 change]** |
| Staff connection state | Console destructures `{ orders, loading }` and drops `status`; a tablet with a stale listener looks completely healthy, because its own writes still succeed over HTTP | Live/Reconnecting dot on the console header, same markup as the display **[v1 gap fixed]** |
| Order age | Not shown; a ticket added at 12:01 is visually identical to one added at 12:20, so a forgotten order is invisible until a customer complains | Elapsed counter on every card, escalating past `targetPrepSeconds` **[v2 change]** |
| Undo | Individual `Clear` — the one fat-fingered on a greasy tablet 100× a service — is instant and unrecoverable from the UI, while `Clear All` gets a confirmation | 10 s undo affordance backed by an `unclear` action; `Clear All` keeps its modal **[v1 gap fixed]** |
| Ready backlog | Staff list grows all service and nothing ever prompts a clear | Nudge to shed ready orders the customers can no longer see **[v2 change]** |
| Write rate limit | None on the orders route | Per-shop limit on `add` and `clearAll` **[v1 gap fixed]** |

---

# Part B — Multi-tenancy & auth

## 5. Tenant model

- **One shop = one Firestore document** `shops/{shopId}`. `shopId` is a Firestore auto-id (20 chars). The **slug** is the public, human-readable key used in URLs and is stored both on the shop doc and as a lookup doc `slugs/{slug} → { shopId }`.
- **Owner** = the Google account's Firebase UID (`ownerUid`). One owner per shop; an owner may own several shops (rare).
- **Slug rules:** lowercase, `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$` (3–40 chars, no leading/trailing/double hyphen), unique across the system, immutable after creation (changing it would break printed QR codes; if a rename is ever needed it's a superadmin operation that also writes a redirect doc — out of scope).
- **Reserved slugs** (cannot be created): `staff`, `display`, `qr`, `api`, `login`, `logout`, `app`, `admin`, `new`, `settings`, `billing`, `about`, `pricing`, `help`, `terms`, `privacy`, `www`, `static`, `_next`, `favicon.ico`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`.
- **Slug suggestion:** on `/app/new`, derive from the name (`"Two Little Fish"` → `two-little-fish`), check `slugs/{slug}`, append `-2`, `-3`, … until free. Owner can edit before submitting.

## 6. Roles

| Role | How obtained | Can |
|---|---|---|
| `owner` | Google sign-in; `shops/{id}.ownerUid == uid` | Create shops; read/update settings; rotate PIN; open billing Checkout/Portal; print QR; see everything `staff` can. |
| `staff` | Valid staff cookie for that `shopId` | `add`, `markReady`, `recall`, `clear`, `clearAll` on that shop's orders. Nothing else. |
| `public` | Nothing | Read `shops/{id}` public fields, `slugs/*`, and the active orders list. (The board is public by design, as in v1.) |
| `superadmin` | Google sign-in; UID ∈ `SUPERADMIN_UIDS` | `/admin`: list all shops, toggle `isPilot`, see billing status. |

An owner using `/{slug}/staff` still enters the PIN like anyone else — keeps the console code path single and lets owners test what staff see. **Deferred:** invited co-managers (`members/{uid}` with roles). The data model leaves room (`users/{uid}.shopIds`) but no UI or rules for it in v2.

## 7. Auth flows

### 7.1 Owner: Google sign-in → session cookie

1. `/login` renders a single "Continue with Google" button. Client calls `signInWithPopup(auth, new GoogleAuthProvider())`; on `auth/popup-blocked` or `auth/operation-not-supported-in-this-environment` (in-app browsers, some tablets) fall back to `signInWithRedirect` and handle `getRedirectResult` on load.
2. Client gets the ID token (`user.getIdToken()`) and POSTs it to `POST /api/auth/session`.
3. Server verifies with `admin.auth().verifyIdToken(idToken)`, requires `auth_time` within the last 5 minutes (Firebase rule for `createSessionCookie`), then `admin.auth().createSessionCookie(idToken, { expiresIn: 14 days })`.
4. Server sets cookie `cc_session` = session cookie; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`. Upserts `users/{uid}` `{ email, displayName, lastLoginAt }`.
5. Client signs out of the Firebase client SDK (`signOut(auth)`) — the **cookie** is the session, not the client SDK state. This avoids two sources of truth and keeps Firestore client reads anonymous (rules never depend on `request.auth` for reads).
6. Server pages under `/app/*` and `/admin` read the cookie in a shared helper `requireOwner()` → `admin.auth().verifySessionCookie(cookie, true /* checkRevoked */)`. Missing/invalid → redirect to `/login?next=…`.
7. `DELETE /api/auth/session` clears the cookie and calls `revokeRefreshTokens(uid)`.

**Firebase Auth authorized domains.** Google sign-in only works on hostnames listed in Firebase Console → Authentication → Settings → Authorized domains. Wildcards are not supported, so per-PR Preview URLs cannot sign in. Mitigation (Phase 0): a long-lived `dev` branch gets a stable Vercel branch alias (`chipcheck-git-dev-<team>.vercel.app`, or a custom `dev.<domain>`), and that hostname plus the production hostname are the authorized domains. Feature PRs merge into `dev` for auth testing, then `dev` → `main`.

### 7.2 Staff: PIN unlock → signed staff cookie **[v1 gap fixed]**

v1 stored the plaintext PIN in `sessionStorage`, sent it in every write body, compared it with `===` against an env var, and — because `undefined === undefined` — **accepted any request if `STAFF_PIN` was unset**. It also "accepted" any PIN on the gate screen until the first write returned 401.

v2:

1. `/{slug}/staff` renders the PIN gate (identical UI to v1). Submit → `POST /api/shops/{slug}/staff/unlock` `{ pin }`.
2. Server resolves `slugs/{slug}` → `shopId`; reads `shops/{shopId}/private/auth.pinHash`.
3. **Rate limit first:** read `shops/{shopId}/private/pinAttempts` in a transaction. Key = SHA-256 of the client IP (`x-forwarded-for` first hop, or `x-real-ip`). If `attempts[key].count ≥ 5` and `attempts[key].windowStart > now − 15 min` → 429 `{ error: "pin_locked", retryAfterSeconds }`. (In-memory counters are not enough on Fluid Compute — instances come and go.)
4. Compare with `crypto.timingSafeEqual` on `scrypt(pin, salt, 64)` (N=2^15, r=8, p=1; stored as `scrypt$<N>$<salt-b64>$<hash-b64>`). Wrong → increment counter, 401 `{ error: "invalid_pin" }`. Right → reset counter.
5. Set cookie `cc_staff` = `base64url(payload) + "." + base64url(HMAC-SHA256(payload, STAFF_SESSION_SECRET))`, payload `{ shopId, role: "staff", iat, exp }`, `exp = iat + 12 h`. `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`. Response body `{ ok: true, expiresAt }`.
6. Every order write calls `requireStaff(shopId)` → parses/verifies the cookie, checks `payload.shopId === shopId` and `exp > now`. Fail → 401 `{ error: "unauthorized" }`. The client shows the PIN gate again.
7. "Change PIN" link on the console → `DELETE /api/shops/{slug}/staff/unlock` clears the cookie and shows the gate. (Copy stays "Change PIN" for parity; it means "re-enter", as in v1.)
8. **PIN rules:** 4–8 digits. Owner sets it at shop creation and can rotate it at `/app/{slug}`; rotation does not invalidate existing staff cookies (they expire within 12 h). Owner never sees the PIN after setting it.

### 7.3 Fail-closed configuration **[v1 gap fixed]**

`lib/env.ts` parses `process.env` with zod on the server. Any missing **required** server secret (`FIREBASE_SERVICE_ACCOUNT_JSON`, `STAFF_SESSION_SECRET`, `CRON_SECRET`) throws, so every Route Handler returns 500 rather than silently opening writes. Stripe vars are required only when `BILLING_ENABLED=true`.

**Corrected in Phase 0:** the parse is *lazy and memoised* (`serverEnv()`, called at the top of each handler), not run at module load. A module-load throw would fail `next build` in any environment without runtime secrets — including CI, which is itself a Phase 0 Definition of Done item. The fail-closed guarantee is identical and is now unit-tested, including that error messages never echo a value.

## 8. Onboarding

```
/login  ──Google──▶  /app  (list of the owner's shops; empty state → "Create your first shop")
                       │
                       ▼
                    /app/new   name · slug (auto-suggested, editable) · ticket digits (min/max, default 1–4)
                               · ready timeout (default 300 s) · sound on display (default off) · staff PIN (4–8 digits, entered twice)
                       │  POST /api/shops
                       ▼
                    /app/{slug}   settings (same fields, PIN rotate as a separate form)
                                  + big links: Open Display · Open Staff · Print QR
                                  + "Set up your screens" notes (kiosk doc, §30)
                                  + plan card (only when billing is on, §18)
```

- Creating a shop writes, in one transaction: `shops/{id}`, `shops/{id}/private/auth`, `shops/{id}/private/billing`, `slugs/{slug}`, and adds `id` to `users/{uid}.shopIds`. If `slugs/{slug}` already exists the transaction aborts → 409 `{ error: "slug_taken" }`.
- Time zone defaults from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`), used only for the display clock label and any future reports; the display itself uses the device clock as v1 did.

---

# Part C — Data model (Firestore)

## 9. Collections

```
shops/{shopId}                              PUBLIC (readable by anyone)
  name: string (1–60)
  slug: string
  ownerUid: string                          (opaque Firebase UID — not PII)
  createdAt: Timestamp
  settings: {
    ticketMinDigits: number (1–6)           default 1
    ticketMaxDigits: number (1–6, ≥ min)    default 4
    readyTimeoutSeconds: number (30–3600)   default 300
    targetPrepSeconds: number (60–3600)     default 480     age-escalation threshold (§22.2)
    soundEnabled: boolean                   default false   (display chime without ?sound=1)
    timezone: string                        IANA, e.g. "Europe/London"
  }
  isPilot: boolean                          default = !billingEnabled at creation time (§17)

shops/{shopId}/private/auth                 SERVER ONLY
  pinHash: string                           "scrypt$N$salt$hash"
  pinUpdatedAt: Timestamp

shops/{shopId}/private/pinAttempts          SERVER ONLY
  attempts: { [sha256(ip)]: { count: number, windowStart: Timestamp } }

shops/{shopId}/private/billing              SERVER ONLY (keeps Stripe IDs off the public doc)
  status: "pilot" | "none" | "trialing" | "active" | "past_due" | "canceled"
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  currentPeriodEnd?: Timestamp
  pastDueSince?: Timestamp
  updatedAt: Timestamp

shops/{shopId}/orders/{orderId}             PUBLIC read (list/get), server-only write
  orderNumber: string                       digits only, leading zeros preserved
  status: "preparing" | "ready"
  createdAt: Timestamp                      serverTimestamp()
  readyAt: Timestamp | null
  cleared: boolean
  clearedAt: Timestamp | null
  clearedBy: "staff" | "purge" | "clearAll" | null

shops/{shopId}/activeNumbers/{orderNumber}  SERVER ONLY — uniqueness lock for active numbers
  orderId: string
  createdAt: Timestamp

slugs/{slug}                                PUBLIC read
  shopId: string

users/{uid}                                 owner reads own doc only (via server); server writes
  email: string
  displayName: string
  shopIds: string[]
  lastLoginAt: Timestamp

config/flags                                SERVER ONLY
  billingEnabled?: boolean                  overrides BILLING_ENABLED env var when present

stripeEvents/{eventId}                      SERVER ONLY — webhook idempotency
  receivedAt: Timestamp
  type: string
```

### Notes

- **`orderNumber` stays a string** (v1 locked decision; `"0042"` ≠ `"42"`). Validation regex per shop: `^\d{min,max}$`.
- **Soft delete** via `cleared`; there are no hard deletes of orders. `clearedBy` is new **[v2 change]** (was implicit in v1) and costs nothing.
- **Dedupe is atomic** **[v1 gap fixed]**: `add` runs a transaction that `get`s `activeNumbers/{orderNumber}`; if it exists → 409 `{ error: "duplicate_order", order: {...existing} }`; otherwise it creates the order doc **and** the lock doc. `clear`, `clearAll` and the purge delete the lock doc in the same batch/transaction that sets `cleared = true`. `markReady`/`recall` don't touch it. Because the lock doc id **is** the number, two tablets adding `0042` at once cannot both succeed.
- **Timestamps:** always `FieldValue.serverTimestamp()` on the server. On the client, `createdAt` is `null` while a local write is pending; v2's client never writes, but `onSnapshot` with `includeMetadataChanges` can still surface docs before the server timestamp resolves — sort with `createdAt ?? now`.
- **Indexes** (`firestore.indexes.json`) **[v1 gap fixed]**:

  | Collection | Scope | Fields | Used by |
  |---|---|---|---|
  | `orders` | collection | `cleared ASC, createdAt ASC` | display/staff listener; `clearAll`; opportunistic purge |
  | `orders` | **collection group** | `cleared ASC, createdAt ASC` | cron purge across all shops |

  Firestore rejects the query at runtime with a "requires an index" error if these are missing — the GitHub Action deploys them (§27).

- **Document sizes:** `pinAttempts` is bounded by pruning entries older than 15 min on every write. Orders per shop per day are in the hundreds — no sharding concerns.

## 10. Security rules (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Public shop metadata (name, slug, settings). Never writable from clients.
    match /shops/{shopId} {
      allow get: if true;
      allow list: if false;
      allow write: if false;

      // The board is public by design (v1 parity).
      match /orders/{orderId} {
        allow get, list: if true;
        allow write: if false;
      }

      // Everything else under a shop is server-only.
      match /private/{doc}        { allow read, write: if false; }
      match /activeNumbers/{num}  { allow read, write: if false; }
    }

    match /slugs/{slug} {
      allow get: if true;
      allow list: if false;
      allow write: if false;
    }

    // Owners read their own user doc through the server; clients never touch it.
    match /users/{uid}          { allow read, write: if false; }
    match /config/{doc}         { allow read, write: if false; }
    match /stripeEvents/{id}    { allow read, write: if false; }
  }
}
```

- **All client writes are denied.** The Admin SDK bypasses rules, which is the only write path.
- **Reads:** `get` on a shop doc and a slug doc; `get`/`list` on a shop's orders. `list` on `shops` is denied so nobody can enumerate tenants (the slug is the "capability"). The public shop doc must therefore contain nothing sensitive: **Stripe IDs and billing status live in `private/billing`**, PIN material in `private/auth`.
- Rules do not reference `request.auth` at all — the client SDK is used unauthenticated (§7.1 step 5), so tests are simple and the rules can't drift into "owner can write" by accident.
- Rules tests (`@firebase/rules-unit-testing`, run in CI, §28) must prove: anonymous `get shops/x` ✓, `list shops` ✗, `get/list shops/x/orders` ✓, any write to any path ✗, any read of `private/*`, `activeNumbers/*`, `users/*`, `config/*`, `stripeEvents/*` ✗.

## 11. Realtime

Client hook `useOrders(shopId)` (port of v1 `lib/useOrders.ts`):

```ts
const q = query(
  collection(db, "shops", shopId, "orders"),
  where("cleared", "==", false),
  orderBy("createdAt", "asc")
);
onSnapshot(q, { includeMetadataChanges: true }, snap => …, err => …);
```

- Returns `{ orders, status, loading, pending, markPending, clearPending, upsertLocal }` where `status: "connecting" | "connected" | "disconnected"` (same union as v1 so the display header's "Live"/"Reconnecting" dot is unchanged).
- **Status derivation:** `connecting` until the first snapshot; then `connected` when the latest snapshot has `!metadata.fromCache`; `disconnected` when `metadata.fromCache && navigator.onLine === false`, or the error callback fires, or no server-sourced snapshot has arrived for 60 s while `document.visibilityState === "visible"` (Firestore's backoff can leave a tab serving cache silently). `online`/`offline` window events and `visibilitychange` re-evaluate immediately.
- Firestore's client replays state on reconnect, so v1's manual "refetch on resubscribe" reconciliation is unnecessary **[v2 change]**. A `visibilitychange → visible` handler still forces a status re-check so an overnight-backgrounded tab shows "Reconnecting" honestly until the next server snapshot.
- Sort key: `createdAt?.toMillis() ?? Date.now()` ascending (v1 sorted by `created_at` string).
- Latency target: **< 1.5 s** from a tap on tablet A to the tile moving on the TV and tablet B (v1 target; Firestore typically delivers in 200–600 ms).
- Cost: one listener per open device; a shop with two tablets and a TV generates ~3 listeners and a few hundred document reads a day. Well inside the free tier (Part I).

## 12. Optimistic UI (real this time) **[v1 gap fixed]**

v1 exported `upsertOrder` from `useOrders` but never called it; the console just waited for the round-trip. v2 keeps the rule minimal because `onSnapshot` already delivers the confirmed state fast:

- Every mutation goes: `markPending(orderId or "add:"+orderNumber)` → `fetch` the Route Handler → on success apply the returned order via `upsertLocal(order)` (so the row flips immediately even if the snapshot is a few hundred ms behind) → `clearPending` when the **snapshot** contains the confirmed state, or after 5 s, whichever first. On error → `clearPending` immediately and show the error `Alert`.
- While an id is pending its `OrderCard` buttons are `disabled` (v1's `busy` prop, now driven by the pending set) so buttons can't double-fire.
- `add` uses key `"add:" + orderNumber`; the Add button is disabled while that key is pending (v1's `adding` state).
- The local overlay never *invents* rows; it only applies rows the server returned. Snapshot data always wins on conflict.
- `unclear` (§13) uses the restored order's own id as its pending key. A failed undo — 409 because the number went active again, or because the 60 s server window closed — clears pending and shows the mapped copy (§23); it never re-inserts the row locally. The rule above already covers this, but the undo path is where "the overlay invents a row" would be most tempting and most wrong.

---

# Part D — API (Next.js Route Handlers, Admin SDK, Node runtime)

All handlers: `export const runtime = "nodejs"` (default; never `edge`), `export const dynamic = "force-dynamic"`. All responses are JSON. All errors are `{ error: string, ...details }`. Shared helpers in `lib/server/`:

| Helper | Does |
|---|---|
| `env` | zod-parsed env (§7.3, §26); throws at import if invalid |
| `adminApp()` / `adminDb()` / `adminAuth()` | singleton `firebase-admin` init from `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `requireOwner(req)` | verifies `cc_session`; returns `{ uid }` or throws 401 |
| `requireOwnerOf(req, shopId)` | `requireOwner` + `shop.ownerUid === uid` or throws 403 |
| `requireStaff(req, shopId)` | verifies `cc_staff` for that shop or throws 401 |
| `requireSuperadmin(req)` | `requireOwner` + uid ∈ `SUPERADMIN_UIDS` or throws 403 |
| `requireEntitled(shopId)` | §15; throws 402 |
| `resolveSlug(slug)` | `slugs/{slug}` → `shopId` or throws 404 |
| `parseBody(req, schema)` | `await req.json()` in try/catch → 400 `{ error: "invalid_json" }`; zod parse → 400 `{ error: "invalid_body", issues }` |
| `apiHandler(fn)` | wraps a handler, converts thrown `ApiError(status, code, details)` into responses, logs 500s |

## 13. Endpoints

| Method & path | Auth | Body (zod) | 2xx | Errors |
|---|---|---|---|---|
| `POST /api/auth/session` | public | `{ idToken: string }` | `200 { uid }` + sets `cc_session` | 400 `invalid_body`; 401 `invalid_token` (bad/expired token or `auth_time` > 5 min) |
| `DELETE /api/auth/session` | owner cookie (best effort) | — | `204`, clears cookie, revokes refresh tokens | — |
| `POST /api/shops` | owner | `{ name, slug, settings: { ticketMinDigits, ticketMaxDigits, readyTimeoutSeconds, soundEnabled, timezone }, pin }` | `201 { shop }` | 400; 409 `slug_taken`; 400 `slug_reserved` |
| `PATCH /api/shops/{shopId}` | owner of shop | partial `{ name?, settings? }` (slug not editable) | `200 { shop }` | 400; 403; 404 |
| `POST /api/shops/{shopId}/pin` | owner of shop | `{ pin: string /^\d{4,8}$/ }` | `204` | 400; 403; 404 |
| `POST /api/shops/{slug}/staff/unlock` | public (rate-limited) | `{ pin: string }` | `200 { ok: true, expiresAt }` + sets `cc_staff` | 400; 401 `invalid_pin`; 404 `shop_not_found`; 429 `pin_locked { retryAfterSeconds }` |
| `DELETE /api/shops/{slug}/staff/unlock` | any | — | `204`, clears `cc_staff` | — |
| `POST /api/shops/{shopId}/orders` | staff cookie for `shopId` | discriminated union, below | `200 { order }` or `200 { cleared: n }` for `clearAll` | 400; 401 `unauthorized`; 402 `subscription_required` (`add` only); 404 `order_not_found`; 409 `duplicate_order` / `invalid_transition`; 429 `rate_limited { retryAfterSeconds }` (`add` and `clearAll` only, §14.1) |
| `GET /api/cron/purge-stale` | `Authorization: Bearer ${CRON_SECRET}` | — | `200 { shopsTouched, ordersCleared }` | 401 |
| `POST /api/billing/checkout` | owner of shop | `{ shopId }` | `200 { url }` (Stripe Checkout URL) | 403; 404; 409 `already_subscribed`; 503 `billing_disabled` |
| `POST /api/billing/portal` | owner of shop | `{ shopId }` | `200 { url }` (Customer Portal URL) | 403; 404 `no_customer`; 503 `billing_disabled` |
| `POST /api/billing/webhook` | Stripe signature (`stripe-signature` header, raw body) | Stripe event | `200 { received: true }` | 400 `invalid_signature`; 200 on already-processed event ids |
| `POST /api/admin/shops/{shopId}/pilot` | superadmin | `{ isPilot: boolean }` | `200 { shop }` | 403; 404 |
| `GET /api/slugs/{slug}` | public | — | `200 { available: boolean, reason?: "taken" \| "reserved" \| "invalid" }` | — (never leaks shop data) |
| `GET /api/health` | public | — | `200 { ok: true, project }` (Admin SDK initialised; no secrets) | 500 if env invalid |

**Orders action body** (same shape as v1 minus `pin` and minus `purgeStale` **[v2 change]**):

```ts
const OrdersBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"),       orderNumber: z.string() }),   // digit rule applied per shop after parse
  z.object({ action: z.literal("markReady"), id: DocId }),
  z.object({ action: z.literal("recall"),    id: DocId }),
  z.object({ action: z.literal("clear"),     id: DocId }),
  z.object({ action: z.literal("unclear"),   id: DocId }),   // undo a staff clear (§22.2)
  z.object({ action: z.literal("clearAll"),
             status: z.enum(["preparing", "ready"]).optional(),
             olderThanSeconds: z.number().int().min(0).optional() }),
]);
const DocId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
```

**Action semantics**

| Action | Precondition | Effect | Returns |
|---|---|---|---|
| `add` | `orderNumber` matches `^\d{min,max}$` for the shop; entitled (§15); no `activeNumbers/{orderNumber}` | Transaction: create `orders/{auto}` `{ orderNumber, status: "preparing", createdAt: server, readyAt: null, cleared: false, clearedAt: null, clearedBy: null }` + create lock doc. Then (outside the transaction, best-effort) run the opportunistic purge for this shop (§13.1). | the created order (with `createdAt` resolved by re-reading) |
| `markReady` | order exists, `cleared == false`, `status == "preparing"` | `status = "ready"`, `readyAt = server` | updated order |
| `recall` | exists, `cleared == false`, `status == "ready"` | `status = "preparing"`, `readyAt = null` | updated order |
| `clear` | exists, `cleared == false` | `cleared = true`, `clearedAt = server`, `clearedBy = "staff"`; delete lock doc. `status` is **not** changed, so an undo restores the order exactly as it was. | updated order |
| `unclear` | exists; `cleared == true`; `clearedBy == "staff"`; `clearedAt > now − 60 s`; no `activeNumbers/{orderNumber}` currently held | Transaction: `cleared = false`, `clearedAt = null`, `clearedBy = null`, **and re-create the lock doc** pointing at this order id. `status` is untouched — an order cleared while `ready` comes back `ready`. | restored order |
| `clearAll` | — | query `cleared == false`, then apply the optional filters: `status` matches, and `olderThanSeconds` measured against `readyAt` when `status == "ready"` else `createdAt`. Batched writes of 500: set cleared/clearedAt/`clearedBy = "clearAll"`, delete each lock doc | `{ cleared: n }` |

Precondition failures → 409 `{ error: "invalid_transition", status, cleared }` (never silently succeed — v1 did) **[v1 gap fixed]**. Unknown id → 404.

**Why `unclear` is not a flag flip** **[v1 gap fixed]**: `clear` deletes `activeNumbers/{orderNumber}` in the same transaction that sets `cleared = true`, so undo has to *re-acquire* that lock. If the number went active again in the meantime the undo genuinely cannot succeed — that returns 409 `{ error: "duplicate_order", order: {...the active one} }`, the same shape `add` uses. The `clearedBy == "staff"` guard means a purge or a `clearAll` can never be unpicked one row at a time, and the 60 s server window is deliberately longer than the console's 10 s affordance (§22.2) so the UI never offers an undo the server will refuse. Two concurrent `unclear`s on the same order resolve the same way: the lock doc id is the number, so exactly one wins.

`unclear` is **not** entitlement-gated (§15) and **not** rate-limited (§14.1).

### 13.1 Stale purge **[v1 gap fixed]**

- `STALE_HOURS = 6` — a code constant in `lib/server/purge.ts` (v1 locked decision).
- `purgeShop(shopId, now)`: query `orders where cleared == false and createdAt < now − 6 h`, batch-set `cleared = true, clearedAt = server, clearedBy = "purge"`, delete lock docs. Idempotent.
- **Cron:** `GET /api/cron/purge-stale` runs a **collection-group** query `orders where cleared == false and createdAt < cutoff`, groups by parent shop, calls `purgeShop` per shop. Scheduled in `vercel.ts` `crons: [{ path: "/api/cron/purge-stale", schedule: "*/30 * * * *" }]`. Vercel invokes crons with **GET** and sends `Authorization: Bearer <CRON_SECRET>`; the handler rejects anything else. (Plan draft said POST — corrected here.)
- **Opportunistic:** `add` also calls `purgeShop` for its own shop after the transaction commits. This means a shop that is in use cleans itself up even if the Vercel plan limits cron frequency (Hobby allows only daily crons — Part I). The display never triggers it (the display cannot write).
- **`preparing` orders never auto-clear on the display**; only this purge touches them (v1 invariant).
- The purge sets `clearedBy = "purge"`, so purged orders are **never undoable** — `unclear` only accepts `clearedBy == "staff"` (§13). Same for `clearAll`.

## 14. Validation & errors **[v1 gap fixed]**

- Every body passes through `parseBody` — malformed JSON → `400 { error: "invalid_json" }`, schema failure → `400 { error: "invalid_body", issues }`. v1 threw an HTML 500.
- `orderNumber`: after zod, re-validate against the shop's `settings` with `new RegExp("^\\d{" + min + "," + max + "}$")` → `400 { error: "invalid_order_number", min, max }`.
- Doc ids validated with `DocId` above; slugs with the slug regex (§5).
- Error codes are stable strings the client maps to copy (§23). HTTP status by class: 400 validation, 401 unauthenticated, 402 unentitled, 403 wrong owner, 404 missing, 409 conflict, 429 rate-limited, 500 unexpected (logged with a request id), 503 feature disabled.
- No stack traces or Firestore error messages in responses.

### 14.1 Rate limiting the orders route **[v1 gap fixed]**

v1 had no limit on `/api/orders` at all. v2's staff cookie (§7.2) already closes the "bored teenager finds the URL" case — a write needs a valid `cc_staff` cookie for that shop — so what remains is a shared tablet whose 12-hour cookie leaks, a stuck client retry loop, or a mis-scripted test. `clearAll` is the one that hurts.

Reuses the `pinAttempts` mechanism rather than inventing a second one:

- Doc `shops/{shopId}/private/rateLimits`, server-only, keyed by `sha256(ip)` (`x-forwarded-for` first hop, or `x-real-ip`), pruned of entries older than 15 min on every write so the document stays bounded — same discipline as §9's `pinAttempts`.
- **`add`: 60/min** per shop per IP. Folded into the existing `activeNumbers` transaction, so it costs no extra round trip.
- **`clearAll`: 5/min** per shop per IP. Its own check — it is the destructive one.
- **`markReady`, `recall`, `clear`, `unclear`: not limited.** Each acts on one existing order, so they are already bounded by the size of the active list. Adding a Firestore round trip to each would tax the < 1.5 s sync target (§11) to guard nothing.
- Over the limit → `429 { error: "rate_limited", retryAfterSeconds }`.

In-memory counters are not enough on Fluid Compute — instances come and go — which is why this is a Firestore document, exactly as for the PIN.

## 15. Entitlement check

`requireEntitled(shopId)` in `lib/server/entitlement.ts`:

```
billingEnabled = flags.billingEnabled ?? env.BILLING_ENABLED
if (!billingEnabled)                      → entitled
if (shop.isPilot)                         → entitled
b = shops/{id}/private/billing
if (b.status ∈ {"trialing","active"})     → entitled
if (b.status == "past_due"
    && b.pastDueSince > now − 7 days)     → entitled (grace)
else                                      → throw ApiError(402, "subscription_required", { status: b.status })
```

- Applied to **`add` only**. Staff can always mark ready / recall / clear existing orders and the display is always public, so a lapsed shop degrades gracefully mid-service instead of bricking the board. `unclear` is covered by that same principle — it restores an order that already existed rather than creating one, so it is never gated.
- Pure function over `(flags, shop, billing, now)` → unit-tested in Vitest with no network.

---

# Part E — Billing (Stripe, feature-flagged)

## 16. Model

- **One product, one recurring monthly price**, `STRIPE_PRICE_ID`. Amount TBD (placeholder **£X/month**), **14-day trial** configured on the Checkout session (`subscription_data.trial_period_days: 14`). Per shop, not per owner.
- **Subscribe:** `POST /api/billing/checkout` creates (or reuses) a Stripe Customer (`metadata.shopId`, `email` from the owner), then a Checkout Session `mode: "subscription"`, `client_reference_id: shopId`, `metadata.shopId`, `success_url: {SITE}/app/{slug}?billing=success`, `cancel_url: {SITE}/app/{slug}`. Hosted Checkout — no card UI in the app.
- **Manage / cancel:** `POST /api/billing/portal` → Customer Portal session, `return_url: {SITE}/app/{slug}`.
- **Webhook** `POST /api/billing/webhook` (raw body via `await req.text()`, `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`):

  | Event | Effect on `private/billing` |
  |---|---|
  | `checkout.session.completed` | `stripeCustomerId`, `stripeSubscriptionId`; `status` from the subscription (`trialing`/`active`) |
  | `customer.subscription.updated` | `status` ← Stripe status mapped (`trialing`, `active`, `past_due`, `canceled`, `unpaid`→`past_due`, `incomplete*`→`none`), `currentPeriodEnd` |
  | `customer.subscription.deleted` | `status = "canceled"` |
  | `invoice.payment_failed` | `status = "past_due"`, `pastDueSince = now` if not already set |
  | `invoice.paid` | clear `pastDueSince` |

- **Idempotent by event id:** transaction creates `stripeEvents/{event.id}`; if it already exists → 200 without reprocessing. Shop is located by `metadata.shopId` (Checkout) or by `stripeCustomerId` (subscription/invoice events; keep a `customers/{stripeCustomerId} → shopId` doc written at Checkout time for O(1) lookup).
- Webhook always returns 200 for handled and already-seen events, 400 for bad signatures, 500 for unexpected errors (Stripe retries).

## 17. Feature flag

- **Source of truth:** `config/flags.billingEnabled` in Firestore if the doc/field exists, else `BILLING_ENABLED` env var (default `false`). Read server-side per request (cached 60 s in module scope). Exposed to client components through a server layout prop, never `NEXT_PUBLIC_`.
- **When off** (pilot): no billing UI anywhere; `requireEntitled` always passes; new shops are created with `isPilot = true` and `private/billing.status = "pilot"`.
- **When on:** new shops are created with `isPilot = false`, `status = "none"`; the owner is sent to the plan card. Existing shops keep `isPilot = true` until Ian clears it per shop in `/admin` (§21). So flipping the flag never cuts off a pilot shop.
- **Admin:** `/admin` (gated by `SUPERADMIN_UIDS`) lists every shop with name, slug, owner email, `isPilot`, billing status, `currentPeriodEnd`, and a toggle that calls `POST /api/admin/shops/{id}/pilot`.

## 18. UI when billing is on

- **Owner settings `/app/{slug}` plan card:**
  - `status ∈ {none, canceled}`: title "Plan", body "Subscribe to keep adding orders after your trial.", button **Subscribe** → Checkout.
  - `trialing`: "Trial — ends {date}", button **Add payment method** → Portal.
  - `active`: "Active — renews {date}", button **Manage billing** → Portal.
  - `past_due`: amber card "Payment failed — update your card within {n} days to keep adding orders.", button **Update payment** → Portal.
  - `isPilot`: "Pilot — free during the pilot. Thanks for testing!" and no buttons.
- **Staff console:** non-blocking amber `Alert` at the top when `past_due` and within grace: "Payment problem — ask the owner to update billing." When `add` returns 402: NextUI `Modal` titled "Subscription needed", body "This shop's subscription has ended, so new orders can't be added. Existing orders still work. Ask the owner to visit Settings.", single **OK** button.
- **Display:** never shows billing state.

## 19. Test mode

- Dev Firebase project + Vercel Preview use Stripe **test** keys; Production uses live keys only.
- No `stripe listen` in the primary workflow (cloud sandbox has no long-running local server). Webhook endpoints are created by Ian in the Stripe dashboard, one per environment: the stable `dev` branch URL and the production URL. Their signing secrets go into the matching Vercel environment.
- The agent can exercise the webhook against Preview by signing a fixture: `stripe.webhooks.generateTestHeaderString({ payload, secret })` in a one-off script, then `curl -X POST …/api/billing/webhook`. Ian can also press "Send test webhook" in the Stripe dashboard.

---

# Part F — Screens & design (identical to v1, now per-shop)

## 20. Design tokens

**Source of truth is v1's `tailwind.config.ts` and `globals.css`**, not v1's `DESIGN.md` (which drifted). Where they disagree the values below are the code-verified ones.

### Colors (`theme.extend.colors`)

| Token | Hex | Use |
|---|---|---|
| `background` | `var(--background)` = `#0d1117` | body background |
| `foreground` | `var(--foreground)` = `#e6e6e6` | body text colour |
| `canvas` | `#0d1117` | app background ("the cabinet") |
| `canvas-elevated` | `#161b22` | raised surfaces: order-number field, PIN input, secondary buttons |
| `keypad` | `#21262d` | digit keys |
| `muted-gray` | `#9aa4b2` | secondary labels, nav links, status text |
| `empty-muted` | `#3a434f` | empty-state copy |
| `preparing` | `#ea9602` | preparing fill |
| `preparing-text` | `#1a1205` | text on preparing |
| `preparing-key` | `#2d2410` | keypad "C" key, Recall button fill |
| `preparing-bright` | `#faab3f` | text on `preparing-key` |
| `preparing-muted` | `#7b530c` | declared, **unused** in v1 — keep declared |
| `ready` | `#35c26d` | ready fill |
| `ready-text` | `#06210f` | text on ready; Ready button fill |
| `ready-muted` | `#216942` | declared, **unused** in v1 — keep declared |

`globals.css`: `:root { --background:#0d1117; --foreground:#e6e6e6 }`, `body { color: var(--foreground); background: var(--background); font-family: Arial, Helvetica, sans-serif }`, a `.text-balance` utility, and the print block (§22.3).

### Typography

- **Display font:** Archivo via `next/font/google`, `weight: ["700","800","900"]`, `subsets: ["latin"]`, CSS variable `--font-archivo`; Tailwind `fontFamily.display = ["var(--font-archivo)", "Helvetica Neue", "Arial", "sans-serif"]`, used as `font-display`.
- **Body font:** browser Arial/Helvetica (inputs' placeholders use `font-sans`). The Geist local fonts declared in v1's `layout.tsx` were never referenced by any class — **dropped [v2 change]**.
- **Weights used:** `font-bold` (700), `font-extrabold` (800), `font-black` (900). Nothing lighter.
- **Sizes actually used:** `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`, `text-5xl`, `text-6xl`, `text-7xl`, `text-8xl`, and the tile clamp `text-[clamp(1.75rem,5.5vw,4rem)]`.
- `tabular-nums` on every number. `uppercase tracking-wide` on titles, `uppercase tracking-wider` on labels.

### Shape, elevation, motion

- **Radii:** `rounded-xl` = **12 px** (row buttons, keypad keys, Clear All), `rounded-2xl` = **16 px** (cards, tiles, inputs, primary buttons). (v1 DESIGN.md said 16/24 — wrong; Tailwind defaults are used.)
- **No shadows, no gradients, no borders** on state surfaces. Depth = canvas → canvas-elevated → keypad tonal steps.
- **Focus:** `outline-none focus:ring-2 focus:ring-white/20`.
- **Disabled:** `disabled:opacity-40` (primary), `disabled:opacity-50` (row buttons), `disabled:opacity-30` (Clear All).
- **Key heights:** 44 px (`h-11` Clear All and the shed nudge — **[v2 change]**, v1's `h-10` was under the 44 px touch-target minimum; §22.2/§24 are authoritative), 48 (`h-12` row buttons), 56 (`h-14` primary), 64 (`h-16` keys, PIN input, home links), 80 (`h-20` order field), 112 (`h-28` order field ≥ lg).
- **Breakpoints:** Tailwind defaults only — `sm` 640, `md` 768, `lg` 1024, `xl` 1280.
- **Animation:** framer-motion only; no custom CSS keyframes. Spec in §22.1.
- **Theme:** `<html lang="en" className="dark">` hardcoded; `NextUIProvider` with no props wraps `{children}` in `app/layout.tsx`. NextUI components used: `Alert` (`color="danger"`, `isClosable`), `Button` (`color="primary"`, `color="danger"`, `variant="light"`, `isLoading`, `isDisabled`), `Modal`/`ModalContent`/`ModalHeader`/`ModalBody`/`ModalFooter`, `Spinner` (`label`). All at stock NextUI dark-theme values — do not restyle them.
- **Metadata:** `title: "{appName}"`, `description: "Real-time order queue display"` (v1 had `title: "ChipQueue"`; use the placeholder name).

### Named rules (verbatim from v1 DESIGN.md — carry forward)

**The Full-Bleed Rule.** State color (amber/green) always fills the entire row or tile it applies to — never a small dot, tint, or left-border accent. If it's not full-bleed, it's not a state indicator.

**The Color-Plus-Label Rule.** Every state color ships with its text label ("PREPARING" / "READY") in the same view. Color alone never carries meaning.

**The Numerals-First Rule.** Order numbers are always the largest, heaviest element in any row or tile. No other element competes with them for weight.

**Button-previews-destination-state.** The "Ready" row action is filled with the *destination* state's dark text colour (`ready-text`) even while the row is amber; "Recall" always uses the amber undo treatment (`preparing-key`/`preparing-bright`); "Clear" (no state change) is the quiet translucent `bg-black/[0.14]` pill in the row's own text colour.

**Do:** keep state color full-bleed; pair every state color with its label; use extra width on desktop/iPad to show more of the queue, not to centre a narrow column; size touch targets for busy, imprecise hands (44 px+).
**Don't:** drop shadows, gradients, glassmorphism; soft-pastel SaaS palette or cutesy iconography; color alone for state; side-stripe/border-left status accents.

**The No-Third-Colour Rule** **[v2 change]**. Time pressure — how long a ticket has been waiting (§22.2) — is expressed as weight and opacity *within* the row's own state colour, never as a new hue. The row's fill is already carrying the state at full bleed; a third colour would break the Full-Bleed Rule and cost more legibility across a counter than the escalation buys. Where extra separation is needed, use the `bg-black/[0.14]` pill the Clear button already uses.

**Creative north star:** "The Diner Order Board" — a physical order board bolted to the wall, not a SaaS admin panel on a tablet.

## 21. Route map

```
/                          landing: one-line pitch + "Sign in with Google" + link to /login   [v2 change]
/login                     Google sign-in (popup, redirect fallback); ?next= supported          [v2 change]
/logout                    calls DELETE /api/auth/session then → /                             [v2 change]
/app                       owner dashboard: list of the owner's shops; empty state → /app/new [v2 change]
/app/new                   create shop                                                          [v2 change]
/app/{slug}                settings + links + PIN rotate + plan card (flag)                     [v2 change]
/admin                     superadmin: shops table + pilot toggle (SUPERADMIN_UIDS)             [v2 change]
/{slug}                    302 → /{slug}/display
/{slug}/display            customer board            (v1 /display)
/{slug}/staff              PIN gate + console        (v1 /staff)
/{slug}/qr                 printable QR → {SITE}/{slug}/display   (v1 /qr)
/api/…                     §13
/manifest.webmanifest      PWA manifest (§24)                                                    [v2 change]
```

- Dropped: v1 `/order/[number]` stub **[v2 change]**; v1 `/` three-link menu (replaced by landing; the three links now live on `/app/{slug}`).
- `app/[slug]/layout.tsx` (server) resolves `slugs/{slug}` → shop doc once and passes `{ shopId, name, settings }` to the client screens; unknown slug → `notFound()`. Reserved words never reach this layout because `/app`, `/login`, `/admin` etc. are static routes that take precedence.
- Display header shows the **shop name** in place of v1's "Order Board" (open question in Part I; default is shop name).

## 22. Per-screen specs

### 22.1 `/{slug}/display` — customer board (port of v1 `app/display/page.tsx`, `Column.tsx`, `OrderTile.tsx`)

**Data:** `useOrders(shopId)`; `readyTimeoutSeconds` and `soundEnabled` from the shop layout.

**Timers**

| Timer | Interval | Purpose |
|---|---|---|
| clock | 1 000 ms | header time, `toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`; rendered only after mount (`now !== null`) to avoid hydration mismatch |
| tick | 2 000 ms | forces re-evaluation of the ready-timeout filter even with no snapshot |
| ready filter | — | `visible = orders.filter(o => o.status !== "ready" || !o.readyAt || readyAt > now − readyTimeoutSeconds·1000)` |

**Sound**

- Enabled when `?sound=1` **or** `settings.soundEnabled` **[v2 change]** (`?sound=0` forces off).
- One module-level `AudioContext`, created lazily on first chime (Chrome caps live contexts at ~6 — v1 bug fixed and kept).
- Chime: `OscillatorNode` sine **880 Hz**, gain `0.0001 → 0.3` over 20 ms (`exponentialRampToValueAtTime`), `→ 0.0001` at 0.5 s, `osc.stop(+0.5 s)`. Errors swallowed (autoplay policy).
- **Seeding:** the set of "already-seen ready ids" is seeded from the first snapshot after `status === "connected"`, never from the initial empty render — so pre-existing ready orders don't chime on page load. Thereafter chime once per newly-ready id.
- iOS/Chrome autoplay: a first user gesture is needed; the kiosk doc (§30) says "tap the screen once after opening". Add a small muted-gray "Tap to enable sound" hint at the footer position until the first gesture when sound is enabled and the context is `suspended` **[v2 change]**.
- **The first gesture must call `ctx.resume()`** **[v2 change]**. A context created before any gesture starts `suspended`, and it does *not* leave that state merely because an oscillator is constructed and started — `osc.start()` returns normally, nothing plays, and the `catch` swallows it. That is the actual mechanism by which a TV that was switched on and left alone stays silent all service, with no error anywhere. Attach a one-shot `pointerdown`/`keydown` handler that awaits `ctx.resume()` and then hides the hint.
- **No order age on the display** (§22.2 adds it to the staff console only). The customer-facing board shows numbers, not how late they are.

**Layout (exact v1 classes)**

```
<main class="h-[100dvh] flex flex-col bg-canvas text-white overflow-hidden">
  <header class="flex flex-col gap-2 px-4 py-3 md:px-10 md:py-6">
    <h1 class="font-display text-2xl sm:text-3xl md:text-4xl font-extrabold uppercase tracking-wide">{shopName}</h1>
    <div class="flex items-center gap-4">
      <a href="/{slug}/staff" class="font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap">Staff →</a>
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full {connected ? 'bg-ready' : 'bg-preparing'}"/>
        <span class="font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap">{connected ? 'Live' : 'Reconnecting'}</span>
      </div>
      <span class="font-display text-xs md:text-sm font-bold text-muted-gray tabular-nums whitespace-nowrap">{HH:MM}</span>
    </div>
  </header>
  <LayoutGroup>
    <div class="flex-1 flex flex-col md:flex-row min-h-0">
      <Column title="Preparing"       count headerClass="bg-preparing text-preparing-text" variant="preparing"/>
      <Column title="Ready · Collect" count headerClass="bg-ready text-ready-text"         variant="ready"/>
    </div>
  </LayoutGroup>
  {bothEmpty && <footer class="text-center py-4 font-display font-bold text-muted-gray text-sm md:text-base uppercase tracking-wide">Order at the counter — your number will appear here</footer>}
</main>
```

**Column**

```
<div class="flex-1 flex flex-col min-h-0">
  <div class="px-6 py-3 md:px-8 md:py-4 flex items-center justify-between {headerClass}">
    <h2 class="font-display text-xl md:text-3xl font-black uppercase tracking-wider">{title}</h2>
    <span class="font-display text-xl md:text-3xl font-extrabold tabular-nums">{count}</span>
  </div>
  <div class="flex-1 min-h-0 overflow-y-auto p-4 md:p-6" aria-live={variant==='ready' ? 'polite' : undefined}>
    empty → <p class="h-full flex items-center justify-center text-empty-muted font-display font-bold text-2xl md:text-4xl">No orders</p>
    else  → <div class="grid gap-3 md:gap-4" style="grid-template-columns: repeat(auto-fill, minmax(190px, 1fr))">
              <AnimatePresence>{tiles}</AnimatePresence>
            </div>
  </div>
</div>
```

**OrderTile**

```
<motion.div layout layoutId={order.id}
  initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
  transition={{ type: "spring", stiffness: 350, damping: 28 }}
  class="rounded-2xl px-4 py-4 md:px-6 md:py-6 flex items-center justify-center {ready ? 'bg-ready text-ready-text' : 'bg-preparing text-preparing-text'}">
  <span class="font-display font-black tabular-nums text-[clamp(1.75rem,5.5vw,4rem)]">{orderNumber}</span>
</motion.div>
```

Because both columns share a `LayoutGroup` and tiles use `layoutId = order.id`, a tile **slides** from Preparing to Ready rather than fading out/in.

**States:** loading = both columns show "No orders" (v1 behaviour; the header dot is amber "Reconnecting" until connected); disconnected = amber dot + "Reconnecting", tiles stay as last seen; error from `onSnapshot` = same as disconnected (no error text on the public screen).

**v2 additions on this screen [v2 change]:** `aria-live="polite"` on the ready column scroll area; `prefers-reduced-motion: reduce` → `transition={{ duration: 0 }}` and no scale; Wake Lock (`navigator.wakeLock.request("screen")` on first gesture and on `visibilitychange`, re-requested on release) with a "Keep screen on" toggle in the header link row (muted-gray label style, shows "Screen: on/off"); a "Fullscreen" text link in the same row (hidden if unsupported); safe-area padding `pt-[env(safe-area-inset-top)]` etc. via `viewport-fit=cover`.

### 22.2 `/{slug}/staff` — PIN gate + console (port of v1 `app/staff/page.tsx`, `Keypad.tsx`, `OrderCard.tsx`)

**Session:** the `[slug]/staff/page.tsx` server component reads `cc_staff`, verifies it for this shop, and passes `unlocked: boolean` to the client console, which renders the gate when it is false. No client-side session check is needed. No `sessionStorage` **[v1 gap fixed]**. After a successful unlock the client calls `router.refresh()`.

**PIN gate**

```
<main class="flex min-h-screen items-center justify-center p-4 bg-canvas">
  <form class="flex flex-col gap-4 w-full max-w-xs">
    <h1 class="font-display text-xl font-extrabold uppercase tracking-wide text-center text-white">Staff PIN</h1>
    <input type="password" inputMode="numeric" placeholder="PIN" autoFocus
      class="h-16 rounded-2xl bg-canvas-elevated text-center font-display text-3xl font-black tabular-nums text-white placeholder:text-base placeholder:font-sans placeholder:font-normal placeholder:text-muted-gray outline-none focus:ring-2 focus:ring-white/20"/>
    <button type="submit" disabled={!pinInput || submitting}
      class="h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase tracking-wide disabled:opacity-40">Unlock</button>
    {error && <p class="text-center font-display text-sm font-bold text-preparing-bright">{message}</p>}   [v2 change: inline error]
  </form>
</main>
```

Errors: `invalid_pin` → "Wrong PIN"; `pin_locked` → "Too many attempts — try again in {m} min"; network → "Couldn't reach the server". v1 showed nothing on the gate and only failed on the first write.

**Console**

```
<main class="min-h-screen lg:h-screen lg:overflow-hidden p-4 md:p-6 flex flex-col gap-4 lg:gap-6 bg-canvas text-white">
  <header class="flex flex-col gap-2">
    <h1 class="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide">{shopName} — Staff</h1>
    <div class="flex items-center gap-6">
      <a href="/{slug}/display" class="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray whitespace-nowrap">Display →</a>
      <button class="(same classes)">Change PIN</button>
      <div class="flex items-center gap-2">                                          [v1 gap fixed]
        <span class="w-2.5 h-2.5 rounded-full {connected ? 'bg-ready' : 'bg-preparing'}"/>
        <span class="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray whitespace-nowrap">{connected ? 'Live' : 'Reconnecting'}</span>
      </div>
    </div>
  </header>
  {error && <Alert color="danger" title={error} isClosable onClose/>}
  {pastDueBanner && <Alert color="warning" title="Payment problem — ask the owner to update billing."/>}   [flag on only]

  <div class="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-8 lg:flex-1 lg:min-h-0">
    <section class="flex flex-col items-center gap-4 lg:h-full lg:w-[380px] xl:w-[440px] lg:shrink-0 lg:items-stretch">
      <input inputMode="numeric" placeholder="Order number" value={n} onChange={digits only, slice(0, maxDigits)}
        class="w-full sm:max-w-xs lg:max-w-none lg:shrink-0 h-20 lg:h-28 rounded-2xl bg-canvas-elevated text-center font-display text-5xl lg:text-7xl font-black tabular-nums text-white placeholder:text-base placeholder:font-sans placeholder:font-normal placeholder:text-muted-gray outline-none focus:ring-2 focus:ring-white/20"/>
      <Keypad value onChange maxDigits/>
      <button disabled={!validLength || addPending}
        class="h-14 lg:h-16 lg:shrink-0 w-full sm:max-w-xs lg:max-w-none rounded-2xl bg-white text-canvas font-display text-lg lg:text-2xl font-extrabold uppercase tracking-wide disabled:opacity-40">
        {addPending ? "Adding…" : "+ Add Order"}</button>
    </section>

    <section class="flex flex-col gap-3 lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-1">
      <div class="flex items-center justify-between lg:shrink-0">
        <h2 class="font-display text-sm font-extrabold uppercase tracking-wider text-muted-gray lg:text-base">Active Orders</h2>
        <div class="flex items-center gap-4">
          <span class="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray lg:text-sm">{loading ? "" : `${orders.length} in queue`}</span>
          {shedCount > 0 && <button class="h-11 px-4 rounded-xl bg-white/5 text-muted-gray font-display text-xs font-extrabold uppercase tracking-wider">{shedCount} ready over {m} min — clear?</button>}   [v2 change]
          <button disabled={orders.length===0}
            class="h-11 px-4 rounded-xl bg-white/5 text-muted-gray font-display text-xs font-extrabold uppercase tracking-wider disabled:opacity-30">Clear All</button>   [v2: h-11 (44px) was h-10]
        </div>
      </div>
      <div class="flex flex-col gap-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        {loading && <div class="flex justify-center py-8"><Spinner label="Loading orders..."/></div>}
        {!loading && empty && <p class="text-center text-empty-muted font-display font-bold text-xl py-8">No active orders.</p>}
        {orders.map(o => <OrderCard order busy={pending.has(o.id)} …/>)}
      </div>
    </section>
  </div>
  <Modal duplicate/> <Modal clearAll/> <Modal subscriptionRequired/>
</main>
```

- **Valid length:** `n.length >= ticketMinDigits && n.length <= ticketMaxDigits` (v1: `length === 4`). The field and keypad cap input at `ticketMaxDigits` **[v2 change]**.
- **Add flow:** no client-side duplicate pre-check **[v1 gap fixed]** — call `add`; on 409 `duplicate_order` open the duplicate modal with the returned existing order; on 402 open the subscription modal; on success clear the field. Errors → `Alert` with the mapped copy (§23).
- **Staff console never applies the ready-timeout filter** — ready orders stay until cleared (v1 invariant). The shed nudge below *surfaces* the stale ones; it never hides them.

**Connection state** **[v1 gap fixed]**: the console renders the same dot and word as the display, from the same `status` (§11). v1 destructured `{ orders, loading }` and dropped it. This is the nastiest failure mode in the product: writes go over HTTP to a Route Handler, so a tablet whose Firestore listener has gone stale keeps returning clean 200s and feels completely normal while its board silently diverges from the other tablet's — two people confidently working from different lists. §11's 60-second no-server-snapshot heuristic exists precisely to detect this, and is wasted if the console doesn't render it.

**Order age** **[v2 change]**: every `OrderCard` shows how long the order has been waiting, escalating past `settings.targetPrepSeconds`. Without it an order added at 12:01 is visually identical to one added at 12:20, so a forgotten ticket stays invisible until a customer asks. `createdAt` is already on the order — no schema change. The escalation is weight and opacity inside the row's existing state colour, never a new hue (§20, The No-Third-Colour Rule). Recomputed on the same 2 s tick the display uses (§22.1), so no per-card timers.

**Undo on clear** **[v1 gap fixed]**: v1 put a confirmation modal on `Clear All` — done a few times a service — and left individual `Clear` instant and unrecoverable, which is the one staff fat-finger on a wet tablet a hundred times a service. Since the delete is soft, undo is nearly free. After a successful `clear`, show a NextUI `Alert` in the same slot as the error alert with an **Undo** action, dismissed on the next mutation or after **10 s**, whichever comes first. Undo calls `unclear` (§13). 10 s rather than 5 s for two reasons: greasy hands under pressure, and WCAG 2.2.1 — a purely timed 5-second window to recover a destructive action is thin. A confirmation dialog on `Clear` would be the wrong fix; it adds a tap to the most-repeated action in the service.

**Shed nudge** **[v2 change]**: `{n} ready over {m} min — clear?` beside `{n} in queue`, shown only when `n > 0`, where the threshold is `settings.readyTimeoutSeconds` — so it names exactly the orders that have already dropped off the customer display and that nobody is coming to collect. Tapping it opens the Clear All modal with scoped copy and calls `clearAll` with `{ status: "ready", olderThanSeconds: readyTimeoutSeconds }`. Without this the list only grows: by the end of a service the packer is scrolling past forty stale ready orders to reach the live ones.

**Keypad** (`KEYS = ["1".."9","clear","0","back"]`):

```
<div class="grid grid-cols-3 grid-rows-4 gap-3 w-full sm:max-w-xs lg:max-w-none lg:flex-1 lg:min-h-0">
  <button aria-label={back ? "Backspace" : clear ? "Clear" : key}
    class="h-16 lg:h-auto lg:min-h-[3.5rem] min-w-[44px] rounded-xl font-display text-3xl lg:text-4xl font-bold transition-colors active:opacity-80 {clear ? 'bg-preparing-key text-preparing-bright' : 'bg-keypad text-white'}">
    {back ? <Delete size={24} class="mx-auto"/> : clear ? "C" : key}
  </button>
</div>
press: back → value.slice(0,-1); clear → ""; digit → (value+key).slice(0, maxDigits)
```

**OrderCard**

```
<div class="w-full rounded-2xl px-5 py-4 lg:px-6 lg:py-5 xl:px-8 xl:py-6 flex items-center justify-between gap-4 {ready ? 'bg-ready text-ready-text' : 'bg-preparing text-preparing-text'}">
  <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 lg:gap-4 xl:gap-5 min-w-0">   [v2: stacks below sm so the age never has to be hidden]
    <span class="font-display text-3xl lg:text-4xl xl:text-5xl font-black tabular-nums truncate">{orderNumber}</span>
    <div class="flex items-center gap-2">
      <span class="font-display text-xs sm:text-sm lg:text-base xl:text-lg font-extrabold uppercase tracking-wider opacity-70">{ready ? "Ready" : "Preparing"}</span>   [v2: visible at all widths; v1 had hidden sm:inline]
      <span class="font-display text-xs sm:text-sm lg:text-base tabular-nums {overTarget ? 'font-black px-2 py-0.5 rounded-xl bg-black/[0.14]' : 'font-bold opacity-70'}">{age}</span>   [v2 change]
    </div>
  </div>
  <div class="flex gap-2 lg:gap-3 shrink-0">
    {!ready && <button class="h-12 lg:h-14 xl:h-16 min-w-[44px] px-5 lg:px-5 xl:px-7 rounded-xl bg-ready-text text-white font-display font-extrabold lg:text-lg xl:text-xl disabled:opacity-50">Ready</button>}
    { ready && <button class="h-12 lg:h-14 xl:h-16 min-w-[44px] px-5 lg:px-5 xl:px-7 rounded-xl bg-preparing-key text-preparing-bright font-display font-extrabold lg:text-lg xl:text-xl disabled:opacity-50">Recall</button>}
    <button class="h-12 lg:h-14 xl:h-16 min-w-[44px] px-5 lg:px-5 xl:px-7 rounded-xl bg-black/[0.14] font-display font-bold lg:text-lg xl:text-xl disabled:opacity-50 {textColor}">Clear</button>
  </div>
</div>
```

Three padding tiers (base / lg / xl) are deliberate: iPad landscape (1024) and desktop (1280+) get progressively roomier rows.

**Modals** (NextUI, stock styling):

| Modal | Header | Body | Footer |
|---|---|---|---|
| Duplicate | `Order already active` | `Order #{orderNumber} is already active ({status}). Clear it first, or use a different number.` | `Button color="primary"` **OK** |
| Clear all | `Clear all orders?` | `This will clear all {n} active orders from the board. This can't be undone.` | `Button variant="light"` **Cancel** (disabled while clearing) · `Button color="danger" isLoading` **Clear All** |
| Shed ready **[v2 change]** | `Clear {n} ready orders?` | `These have already dropped off the customer display. This can't be undone.` | `Button variant="light"` **Cancel** · `Button color="danger" isLoading` **Clear All** |
| Subscription (flag on) | `Subscription needed` | `This shop's subscription has ended, so new orders can't be added. Existing orders still work. Ask the owner to visit Settings.` | `Button color="primary"` **OK** |

### 22.3 `/{slug}/qr` — printable QR (port of v1 `app/qr/page.tsx`)

- Target URL = `${NEXT_PUBLIC_SITE_URL ?? window.location.origin}/${slug}/display` **[v1 gap fixed]**. `QRCode.toDataURL(url, { width: 512, margin: 2 })`.

```
<main class="min-h-screen flex flex-col items-center gap-6 p-4 md:p-8 bg-canvas text-white">
  <header class="no-print flex flex-col items-center gap-2 w-full">
    <h1 class="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide">Print QR</h1>
    <a href="/app/{slug}" class="font-display text-xs md:text-sm font-bold uppercase tracking-wider text-muted-gray whitespace-nowrap">← Settings</a>   [v2: was "← Home" → /]
  </header>
  <section class="print-card flex flex-col items-center gap-4 bg-white text-canvas rounded-2xl p-8 max-w-sm w-full">
    <h2 class="font-display text-lg font-extrabold uppercase tracking-wide text-center">Scan to see your order</h2>
    {error && <p class="text-center text-sm text-red-600">{error}</p>}
    {!error && !dataUrl && <div class="w-64 h-64 flex items-center justify-center"><span class="font-display text-sm font-bold uppercase tracking-wider text-canvas/60">Generating…</span></div>}
    {dataUrl && <img src={dataUrl} alt="QR code linking to the live order display" class="w-64 h-64"/>}
    <p class="text-center text-xs text-canvas/60 break-all">{target}</p>
    <p class="font-display text-base font-extrabold uppercase tracking-wide text-center">{shopName}</p>   [v2 change: shop name on the card]
  </section>
  <div class="no-print flex flex-col sm:flex-row gap-3 w-full max-w-sm">
    <a href={dataUrl} download="{slug}-qr.png" class="flex-1 h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase tracking-wide flex items-center justify-center">Download PNG</a>
    <button onClick={window.print} class="flex-1 h-14 rounded-2xl bg-white/5 text-white font-display text-lg font-extrabold uppercase tracking-wide">Print</button>
  </div>
</main>
```

Print CSS (from v1 `globals.css`, keep verbatim): `@media print { .no-print{display:none!important} html,body{background:#fff!important} main{background:#fff!important;min-height:0!important;padding:0!important;display:block!important} .print-card{background:#fff!important;color:#0d1117!important;box-shadow:none!important;border-radius:0!important;margin:0 auto!important;padding:0!important;max-width:100%!important} }`.

### 22.4 New owner screens **[v2 change]** — same tokens, no new components

Shared primitives (plain Tailwind, not NextUI, to match the shop screens):

| Primitive | Classes |
|---|---|
| Page | `min-h-screen bg-canvas text-white p-4 md:p-8 flex flex-col items-center` with an inner `w-full max-w-lg flex flex-col gap-6` |
| Page title | `font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide` |
| Section label | `font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray` |
| Text input | `h-14 w-full rounded-2xl bg-canvas-elevated px-4 font-display text-lg font-bold text-white placeholder:font-sans placeholder:font-normal placeholder:text-muted-gray outline-none focus:ring-2 focus:ring-white/20` |
| Number stepper | same input, `inputMode="numeric"`, `tabular-nums text-center` |
| Toggle | NextUI `Switch` is **not** used; a `button role="switch"` `h-8 w-14 rounded-full` with `bg-ready` on / `bg-keypad` off and a label |
| Primary button | `h-14 rounded-2xl bg-white text-canvas font-display text-lg font-extrabold uppercase tracking-wide disabled:opacity-40` |
| Secondary button / link-button | `h-14 rounded-2xl bg-canvas-elevated text-white …` (v1 home "Display"/"Print QR" treatment) |
| Card | `rounded-2xl bg-canvas-elevated p-6 flex flex-col gap-4` |
| Inline error | `font-display text-sm font-bold text-preparing-bright` |
| Muted help text | `text-sm text-muted-gray` (body font) |

Screens:

- **`/`** — title `{appName}`, one sentence "A live ticket-number board for your counter — TV, tablet and phone, in sync.", primary **Sign in with Google** → `/login`, secondary **See a demo board** → `/{DEMO_SLUG}/display` if `NEXT_PUBLIC_DEMO_SLUG` is set. Nothing else.
- **`/login`** — title "Sign in", primary **Continue with Google**, inline error on failure ("Sign-in failed — try again"). Redirects to `?next` or `/app`.
- **`/app`** — title "Your shops"; a card per shop (name, slug, three secondary buttons **Display**, **Staff**, **Print QR**, and a primary-style **Settings** link); empty state: "No shops yet." + primary **Create your first shop**; footer link **Sign out** (muted label style).
- **`/app/new`** — title "New shop"; fields: Shop name; URL (`{SITE}/` prefix shown, slug input, live availability check debounced 400 ms → "Available" / "Taken"); Ticket numbers — "Shortest" and "Longest" steppers 1–6 with help "Most shops use 1–4 digits. Pager numbers are usually 1–3."; Ready timeout (seconds, 30–3600, default 300) with help "How long a ready number stays on the TV."; Play a sound when an order is ready (toggle); Staff PIN + Confirm PIN (`type="password" inputMode="numeric"`, 4–8 digits). Primary **Create shop**.
- **`/app/{slug}`** — title `{shopName}`; **Links** card with three secondary buttons (Open Display / Open Staff / Print QR) and a muted line showing the display URL; **Settings** card (name, digits, timeout, sound) with primary **Save**; **Staff PIN** card (new PIN + confirm, primary **Change PIN**, help "Staff who are already unlocked stay unlocked for up to 12 hours."); **Plan** card (only when billing on, §18); **Set up your screens** card with the kiosk summary (§30) and a link to the full doc; **Danger**: none (no shop deletion in v2 — superadmin only, out of scope).
- **`/admin`** — table: name · slug · owner email · pilot (toggle) · billing status · period end · created. Title "Admin". 403 page for non-superadmins.

## 23. Copy inventory

Exact strings. `{shopName}`, `{n}`, `{orderNumber}`, `{status}`, `{m}`, `{date}`, `{appName}` are substitutions.

### Carried from v1

| Screen | String | Note |
|---|---|---|
| display | `{shopName}` | v1: `Order Board` — **[v2 change]**, see Part I |
| display | `Staff →` | |
| display, staff | `Live` / `Reconnecting` | same strings on both headers **[v1 gap fixed]** — v1 showed them only on the display |
| display | `Preparing` | column |
| display | `Ready · Collect` | column (middle dot U+00B7) |
| display | `No orders` | per-column empty |
| display | `Order at the counter — your number will appear here` | footer when both empty (em dash U+2014) |
| staff gate | `Staff PIN` / placeholder `PIN` / `Unlock` | |
| staff | `{shopName} — Staff` | v1: `Chip Check — Staff` |
| staff | `Display →` / `Change PIN` | |
| staff | placeholder `Order number` | |
| staff | `+ Add Order` / `Adding…` | |
| staff | `Active Orders` / `{n} in queue` / `Clear All` | |
| staff | `Loading orders...` | Spinner label (three ASCII dots, as v1) |
| staff | `No active orders.` | |
| staff card | `Ready` / `Preparing` (label); `Ready` / `Recall` / `Clear` (buttons) | |
| staff modal | `Order already active` / `Order #{orderNumber} is already active ({status}). Clear it first, or use a different number.` / `OK` | |
| staff modal | `Clear all orders?` / `This will clear all {n} active orders from the board. This can't be undone.` / `Cancel` / `Clear All` | |
| staff errors | `Failed to add order` / `Failed to mark order ready` / `Failed to recall order` / `Failed to clear order` / `Failed to clear all orders` | fallback when no mapped code |
| qr | `Print QR` / `Scan to see your order` / `Generating…` / `Download PNG` / `Print` / `Failed to generate QR code` | |
| qr | alt `QR code linking to the live order display` | |
| keypad | aria `Backspace` / `Clear` / digit | `C` glyph on the clear key |
| metadata | description `Real-time order queue display` | |

Dropped from v1: `Order Board` (replaced), `← Home` (→ `← Settings`), `Invalid PIN` (→ `Wrong PIN`), `Unknown action` (zod message), home-page `Staff`/`Display`/`Print QR` (moved to `/app`), `/order` stub strings (`Track your order here soon — for now, watch the board.`, `Go to Display`).

### New in v2

| Screen | String |
|---|---|
| gate | `Wrong PIN` · `Too many attempts — try again in {m} min` · `Couldn't reach the server` |
| staff card age | `{m}m` · `{h}h {m}m` (tabular numerals; no unit word) |
| staff undo | `Cleared #{orderNumber}` · `Undo` · `Undone` · `Couldn't undo — #{orderNumber} is active again` · `Too late to undo` |
| staff shed | `{n} ready over {m} min — clear?` · `Clear {n} ready orders?` · `These have already dropped off the customer display. This can't be undone.` |
| display | `Tap to enable sound` · `Keep screen on` · `Screen: on` / `Screen: off` · `Fullscreen` |
| landing | `{appName}` · `A live ticket-number board for your counter — TV, tablet and phone, in sync.` · `Sign in with Google` · `See a demo board` |
| login | `Sign in` · `Continue with Google` · `Sign-in failed — try again` |
| app | `Your shops` · `No shops yet.` · `Create your first shop` · `Settings` · `Sign out` |
| new/settings | `New shop` · `Shop name` · `URL` · `Available` / `Taken` / `Reserved` · `Ticket numbers` · `Shortest` · `Longest` · `Most shops use 1–4 digits. Pager numbers are usually 1–3.` · `Ready timeout (seconds)` · `How long a ready number stays on the TV.` · `Play a sound when an order is ready` · `Staff PIN` · `Confirm PIN` · `PINs don't match` · `PIN must be 4–8 digits` · `Create shop` · `Save` · `Saved` · `Change PIN` · `Staff who are already unlocked stay unlocked for up to 12 hours.` · `Links` · `Open Display` · `Open Staff` · `Print QR` · `Set up your screens` |
| billing | `Plan` · `Subscribe to keep adding orders after your trial.` · `Subscribe` · `Trial — ends {date}` · `Add payment method` · `Active — renews {date}` · `Manage billing` · `Payment failed — update your card within {n} days to keep adding orders.` · `Update payment` · `Pilot — free during the pilot. Thanks for testing!` · `Payment problem — ask the owner to update billing.` · `Subscription needed` · `This shop's subscription has ended, so new orders can't be added. Existing orders still work. Ask the owner to visit Settings.` |
| admin | `Admin` · `Pilot` · `Not allowed` |
| errors (code → copy) | `invalid_order_number` → `Enter {min}–{max} digits` (or `Enter {min} digits` when equal) · `duplicate_order` → duplicate modal when it came from `add`, but the inline `Couldn't undo — #{orderNumber} is active again` when it came from `unclear` (same code, two treatments — the client maps by the action it sent) · `invalid_transition` → `That order changed — refresh` · `order_not_found` → `That order was already cleared` · `unauthorized` → gate re-shown · `subscription_required` → subscription modal · `pin_locked` → gate message · `slug_taken` → `Taken` · `slug_reserved` → `Reserved` · `invalid_json`/`invalid_body` → `Something went wrong` · `rate_limited` → `Slow down a moment` · network → `Couldn't reach the server` |

## 24. Responsive & device matrix

| Device | Viewport | Display | Staff | Notes |
|---|---|---|---|---|
| TV (Chromecast/Fire stick browser, or laptop → HDMI) | 1920×1080 | two columns side by side (`md:flex-row`), header `md:px-10 md:py-6`, tiles ~6–8 per row | — | Wake Lock; `?sound=1`; fullscreen |
| iPad landscape | 1024×768 | two columns | **two-column** console (`lg:` keypad 380 px + list) | primary staff device |
| iPad portrait | 768×1024 | two columns (`md`) | stacked (`< lg`), keypad `sm:max-w-xs` centred | |
| Android tablet 10" | ~1280×800 | two columns | two-column, `xl:` tier (440 px keypad, roomier rows) | |
| Phone | 390×844 | **stacked** columns (`flex-col`), header `px-4 py-3` | stacked, keypad full width | customers via QR; staff in a pinch |
| Desktop | ≥1280 | two columns | two-column `xl` tier | owner screens designed here |

**v2 fixes on top of v1 [v2 change]:**

- `viewport-fit=cover` in the viewport meta + `env(safe-area-inset-*)` padding on `/{slug}/display` and `/{slug}/staff` (notched phones / home-indicator iPads).
- `prefers-reduced-motion: reduce` → no spring, no scale; tiles just appear/disappear.
- `OrderCard` status word visible at all widths (v1 hid it below `sm`, violating the Color-Plus-Label Rule).
- `OrderCard` left group stacks (`flex-col sm:flex-row`) below `sm` so the order age fits without hiding anything — hiding the age at phone width would repeat exactly the mistake above.
- Live/Reconnecting indicator on the staff console header, not just the display.
- Clear All to `h-11` (44 px) — v1's `h-10` was under the touch-target minimum.
- `aria-live="polite"` on the ready column.
- Wake Lock API on `/{slug}/display` with a "Keep screen on" toggle; re-acquired on `visibilitychange`.
- Optional Fullscreen button (`document.documentElement.requestFullscreen()`).
- PWA: `app/manifest.ts` (`name: {appName}`, `display: "standalone"`, `background_color/theme_color: #0d1117`, `start_url: "/"`), icons 192/512 (flat amber "CC" placeholder until the rename), `apple-touch-icon`. Lets the display and staff pages be added to the home screen; no service worker (no offline requirement — Firestore handles transient loss).

## 25. Accessibility

- Status never by colour alone (Color-Plus-Label Rule, now enforced at every width).
- Contrast: `#1a1205` on `#ea9602` ≈ 7.8:1; `#06210f` on `#35c26d` ≈ 7.4:1; white on `#0d1117` ≈ 18.9:1; `#9aa4b2` on `#0d1117` ≈ 7.5:1; `#3a434f` on `#0d1117` ≈ 1.9:1 (empty-state text — decorative, large, acceptable as in v1).
- Touch targets ≥ 44 px everywhere (`min-w-[44px]` on keys and row buttons; heights listed in §20).
- Keyboard: PIN and order fields are real `<input>`s, Enter submits; modals are NextUI (focus-trapped, Esc closes).
- `aria-label`s on keypad keys; `aria-live` on the ready column; `alt` on the QR.
- Order age escalation is carried by the numeral itself plus weight and opacity — never colour alone, so it satisfies the Color-Plus-Label Rule by construction (§20, The No-Third-Colour Rule).
- The undo `Alert` is `role="status"`, keyboard-reachable, and never traps focus. Its 10 s window is deliberately longer than the 5 s a first instinct suggests: WCAG 2.2.1 discourages short, purely timed windows for recovering a destructive action, and the next mutation dismisses it anyway.
- Reduced motion respected (§24).
- No auto-playing audio without a gesture; sound is opt-in per shop or per URL.

---

# Part G — Ops

## 26. Environment variables

```
# Firebase — client (safe to expose; Firestore rules are the security boundary)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=            # <project>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase — server only
FIREBASE_SERVICE_ACCOUNT_JSON=               # base64 of the service-account JSON (one line)

# App secrets — server only
STAFF_SESSION_SECRET=                        # ≥ 32 random bytes, base64; signs staff cookies
CRON_SECRET=                                 # Vercel sends it as "Authorization: Bearer …" to cron routes
SUPERADMIN_UIDS=                             # comma-separated Firebase UIDs allowed on /admin

# Billing (feature-flagged)
BILLING_ENABLED=false                        # overridden by Firestore config/flags.billingEnabled when set
STRIPE_SECRET_KEY=                           # required only when billing is enabled
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=          # not needed for hosted Checkout; reserved

# Site
NEXT_PUBLIC_SITE_URL=                        # e.g. https://chipcheck.example — QR target + Stripe return URLs
NEXT_PUBLIC_DEMO_SLUG=                       # optional; "See a demo board" link on /
```

- **Dropped v1 variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (backend swap), `STAFF_PIN` (PIN is now per shop, hashed in Firestore), `NEXT_PUBLIC_READY_TIMEOUT_SECONDS` (now `settings.readyTimeoutSeconds` per shop). **[v2 change]**
- `.env.local.example` is committed with these names and comments; `.env.local` is gitignored and **only used if someone runs locally** — the cloud sandbox and Vercel get values from their own environment settings.
- **Two Firebase projects:** `chipcheck-dev` (cloud sandbox scripts + Vercel Preview + the stable `dev` branch) and `chipcheck-prod` (Vercel Production only). Each has its own service account, Google provider config, authorized domains, and Firestore rules/indexes deploy.
- **No local emulator in the primary workflow.** The dev project is the shared test backend. The emulator is used only inside GitHub Actions for rules tests (§28).
- **Ian creates:** both Firebase projects; enables Google sign-in (Authentication → Sign-in method) and sets the OAuth consent screen in Google Cloud (app name, support email; "External" audience, no verification needed for basic profile scopes); adds authorized domains; creates a service account per project (Project settings → Service accounts → Generate new private key) and base64-encodes it (`base64 -i key.json | tr -d '\n'`); pastes values into Vercel (Settings → Environment Variables, scoped Preview vs Production, or `vercel env add`) and into the Claude Code web session's environment settings (the dev set only). **Secrets never go in the repo or the chat.**
- Generating `STAFF_SESSION_SECRET` / `CRON_SECRET`: `openssl rand -base64 48` — Ian runs it locally and pastes into Vercel; the agent must not generate and echo secrets in a transcript.

## 27. Deployment

- **Vercel Git integration:** push to `main` → Production; every PR → Preview; the long-lived `dev` branch → Preview with a stable alias (authorized domain for Google sign-in, §7.1). Vercel project framework preset: Next.js; **Node 22 or later** — `firebase-admin@14` declares `engines: { node: ">=22" }`, so Node 20 breaks at runtime (corrected in Phase 0; an earlier draft said "Node 20 or 24").
- **`vercel.ts`** (`@vercel/config`): `framework: "nextjs"`, `crons: [{ path: "/api/cron/purge-stale", schedule: "*/30 * * * *" }]`. **Confirmed in Phase 0:** `@vercel/config` is a real Vercel package whose bundled types define `crons: CronJob[]` with `CronJob = { schedule: string; path: string }`; import from the `@vercel/config/v1` subpath — the bare package has no root export. Not `vercel.json`. If the Vercel plan is Hobby, crons are limited to once per day — change the schedule to `0 4 * * *` and rely on the opportunistic purge (§13.1); record the choice in `PROGRESS.md`.
- **Firestore rules and indexes** are deployed by a GitHub Action, never by an interactive `firebase login`:

  ```yaml
  # .github/workflows/firebase.yml
  name: Firestore rules & indexes
  on:
    push:
      branches: [main, dev]
      paths: [firestore.rules, firestore.indexes.json, .github/workflows/firebase.yml]
  jobs:
    deploy:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: w9jds/firebase-action@v13   # pin to the latest release tag at build time
          with:
            args: deploy --only firestore:rules,firestore:indexes --project ${{ github.ref_name == 'main' && secrets.FIREBASE_PROJECT_PROD || secrets.FIREBASE_PROJECT_DEV }}
          env:
            GCP_SA_KEY: ${{ github.ref_name == 'main' && secrets.GCP_SA_KEY_PROD || secrets.GCP_SA_KEY_DEV }}
  ```

  Ian adds four repo secrets: `FIREBASE_PROJECT_DEV`, `FIREBASE_PROJECT_PROD`, `GCP_SA_KEY_DEV`, `GCP_SA_KEY_PROD` (raw JSON, the action expects un-encoded). PR branches don't deploy rules; they run the rules **tests** instead.
- **Rules tests** workflow (`.github/workflows/test.yml`): on every PR — `npm ci`, `npm run lint`, `npm run build`, `npm run test` (Vitest), then `npx firebase emulators:exec --only firestore "npm run test:rules"`.
- **Stripe webhooks:** Ian creates two endpoints in the Stripe dashboard (test mode → `https://<dev alias>/api/billing/webhook`; live mode → `https://<prod>/api/billing/webhook`) with the five events from §16, and puts each signing secret in the matching Vercel environment.
- **Vercel Deployment Protection:** if Preview URLs are protected, Ian enables "Protection Bypass for Automation" and gives the agent the `VERCEL_AUTOMATION_BYPASS_SECRET` (sandbox env only) so `curl`/Playwright can pass `x-vercel-protection-bypass`. Alternatively disable protection on Preview for this project.
- **Deploying without a PR:** the agent can also run `vercel deploy` with a `VERCEL_TOKEN` in the sandbox, but the PR → Preview flow is the default so every change has a URL and a review.

## 28. Testing in a cloud sandbox

v1 had zero tests. v2's test matrix is designed around the fact that the builder has **no browser, no emulator, no device** in the sandbox:

| Layer | Tool | Runs where | Needs network? |
|---|---|---|---|
| Pure logic: zod schemas, slug rules, `orderNumber` regex per settings, entitlement, purge cutoff, PIN hash/verify, staff-cookie sign/verify, status derivation from snapshot metadata, ready-timeout filter | **Vitest** | sandbox + CI | no |
| Route Handlers with a mocked Admin SDK (in-memory Firestore stub implementing `get/set/update/runTransaction/batch` for the paths used) | Vitest | sandbox + CI | no |
| Firestore rules | `@firebase/rules-unit-testing` + emulator | **CI only** (`firebase emulators:exec`) | no (emulator) |
| API integration against Preview | `curl` / `node` scripts in `scripts/` — unlock with a known dev PIN, add/markReady/recall/clear/clearAll, assert codes and bodies; a second script seeds/reads orders through the Admin SDK against `chipcheck-dev` | sandbox | yes (Preview URL + dev project) |
| Stripe webhook | signed fixture posted to Preview (§19); Ian's "Send test webhook" | sandbox / Ian | yes |
| Visual & device | Ian's checklist per phase (TV, iPad, phone, two-tab sync, sound, Wake Lock, print) | Ian | — |
| Browser smoke | Playwright against Preview: load display, unlock staff, add → tile appears on a second page, mark ready → moves column, clear → gone. Runs in CI on `dev` pushes; the agent may use the Playwright MCP against Preview where available | CI / sandbox | yes |

Conventions: `npm test` = Vitest; `npm run test:rules` = rules suite; `npm run test:e2e` = Playwright (needs `E2E_BASE_URL`, `E2E_SHOP_SLUG`, `E2E_STAFF_PIN`). Test shop in `chipcheck-dev`: slug `test-shop`, PIN known to Ian and stored only in the sandbox/CI env.

## 28a. Agent / Ian responsibility split

| Phase | Agent does (in the sandbox) | Ian does (console / dashboard / device) |
|---|---|---|
| 0 | Scaffold repo, NextUI setup, `vercel.ts`, Actions workflows, `.env.local.example`, `PROGRESS.md`, `CLAUDE.md`, first PR | Create GitHub repo (or accept the agent's `gh repo create`), Vercel project + Git link, both Firebase projects, Google provider + consent screen, service accounts, all env vars in Vercel + sandbox, repo secrets, `dev` branch alias + authorized domains, confirm first Preview is green |
| 1 | Data model types, rules, indexes, Admin SDK init, orders route, purge, cron, Vitest + rules tests, seed script, curl integration script | Confirm the rules Action deployed to dev (Firebase console → Rules), confirm the cron shows in Vercel → Cron Jobs, run nothing else |
| 2 | Session route, `/login`, `/app`, `/app/new`, `/app/{slug}`, shops routes, PIN unlock + rate limit, tests | Sign in on the `dev` alias with a real Google account, create `test-shop`, set the PIN, confirm the shop docs in the Firestore console, try a wrong PIN ×6 |
| 3 | Port staff console per shop, pending overlay, per-shop digits, tests, Playwright smoke | Two-tablet (or two-tab) sync check on the `dev` alias, touch-target feel on an iPad, wrong-length numbers |
| 4 | Port display + QR per shop, Wake Lock, reduced motion, a11y, PWA manifest | TV at 1920×1080 (real or scaled), phone via a printed/scanned QR, sound after a tap, Wake Lock over 15 min, print the QR page |
| 5 | Billing routes, webhook, entitlement, plan card, admin page, fixtures | Stripe product/price (test + live), webhook endpoints + secrets, flip `BILLING_ENABLED=true` on Preview, subscribe with a test card, cancel in Portal, watch the staff console react |
| 6 | Error toasts audit, Playwright suite, kiosk doc, soak-test script, manifest icons | 1-hour soak on the real TV + tablets, sign off the kiosk doc by following it cold |
| 7 | Create the pilot shops via the admin/seed script, monitoring notes, feedback log in `PROGRESS.md` | Set Production env (prod Firebase + live Stripe keys, flag off), onboard Two Little Fish + 1–2 shops, collect feedback, decide price, flip the flag |

Each phase's Definition of Done (Part H) marks Ian's items with **(Ian)**. The agent must not tick those.

## 28b. Model per phase

Each phase is one session, and the phases are not the same kind of work — some are transcription against an exact spec, some are security-critical logic where a mistake is silent. Pick the model per phase rather than leaving one selected for the whole build. In Claude Code the choice is `/model`; the IDs matter only if a session is ever driven through the API.

| Model | ID | Context | $/1M in | $/1M out |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | 1M | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $2 | $10 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1 | $5 |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M | $10 | $50 |

Prices are per million tokens as of 2026-06-24; check `/model` for the live list before assuming.

**The rule this table follows:** Opus 5 wherever a mistake is *silent and expensive* — money, auth, data integrity, security rules. Sonnet 5 wherever the spec is exact and the job is transcription — the pixel-identical ports and the scaffold. Haiku 4.5 for mechanical edits with no judgement in them. Fable 5.1 exactly once, for the pre-pilot security review.

| Phase | Model | Why | Escape hatch |
|---|---|---|---|
| **0** Scaffold | **Opus 5** *(revised after the fact)* | Originally Sonnet 5, on the reasoning that §20/§31 dictate every value. Run on Opus 5 instead, and it earned it: three of the four Phase 0 deviations came from *not* taking the spec's own install instructions at face value — `--src-dir=false` is not a valid `create-next-app@14` flag, `firebase-admin@14` needs Node ≥22, and a module-load env throw would have failed CI. The risk in a scaffold is inherited foundations, not typing volume. | — |
| **1** Data model, rules, orders API, purge | **Opus 5** | The highest-stakes phase in the build. Firestore transaction semantics for the `activeNumbers` dedupe lock, the security rules that are the *only* thing standing between the public and a write path, batched 500-doc clears, collection-group purge. Every failure here is silent — a racy transaction looks fine until two tablets collide mid-service. | None. Do not run this phase on Sonnet. |
| **2** Owner auth, shops, PIN | **Opus 5** | Crypto and session handling: scrypt parameters, `timingSafeEqual`, HMAC cookie sign/verify, Firestore-backed rate limiting, fail-closed env parsing. v1's headline defect was an auth check that failed open — this phase exists to not repeat it. | None. |
| **3** Staff console | **Sonnet 5** for the port, **Opus 5** for `lib/useOrders.ts` | §22.2 gives exact classes, heights and copy — that part is careful transcription and Sonnet does it well and cheaply. The pending-set reducer and the snapshot-metadata status derivation (§11, §12) are genuinely subtle and worth switching up for. | Split the session, or run the whole phase on Opus 5 if switching mid-phase is more friction than it's worth. |
| **4** Display + QR | **Sonnet 5** | Same reasoning: §22.1/§22.3 are near-complete markup. The novel parts (Wake Lock, AudioContext seeding, `prefers-reduced-motion`) are small, self-contained and testable. | Opus 5 if the shared-`LayoutGroup` slide animation or the chime-seeding logic misbehaves in a way tests don't catch. |
| **5** Billing | **Opus 5** | Money, and a state machine with more corners than it looks: entitlement across flag × pilot × status × grace, webhook status mapping, event idempotency, raw-body signature verification. Wrong here means a shop that can't take orders, or one that never pays. | None. |
| **6** Hardening | **Opus 5**, plus **one Fable 5.1 pass** | The error-handling and copy audit spans the whole codebase at once — that breadth is what Opus is for. Then spend one Fable 5.1 session on an adversarial read of `firestore.rules`, the auth/PIN path and the Stripe webhook together, before real shops and real cards touch it. It is the last cheap moment to find a hole. | Skip the Fable pass if Phase 5 was never enabled in Production — but not the Opus audit. |
| **7** Pilot | **Sonnet 5** | Monitoring, the pilot log, small bug-fix PRs against a codebase that is by then well-understood. | Opus 5 for any incident that touches auth, billing or data integrity — i.e. anything a pilot shop would notice mid-service. |

### Notes

- **Haiku 4.5 for grunt work.** Worth its own short session for jobs with no judgement in them: the `{appName}` search-and-replace at rename time (Part I #4 — slug, `cc_*` cookies, manifest, copy strings), bulk transcription of the §23 copy inventory into constants, ticking `PROGRESS.md`. Don't give it anything from the "why" column above.
- **Fast mode on the port phases.** Phases 3 and 4 are long stretches of markup where you're watching output scroll. `/fast` runs Opus 5 at up to ~2.5× output speed at premium pricing ($10/$50) — worth it there if Sonnet needs stepping up, pointless on the reasoning-heavy phases where the model spends its time thinking rather than typing.
- **Subagents inherit unless told otherwise.** An `Explore`-style search subagent inside an Opus phase can run on Haiku or Sonnet without hurting the main thread's judgement; the deciding work should stay on the phase's model.
- **Record what actually ran.** `PROGRESS.md` gets a `Model:` line per phase alongside the DoD. If a phase was downgraded to get through it, that belongs in **Deviations** — it's context for whoever reviews the diff.
- **Don't switch mid-phase silently.** Switching model resets the reasoning context the session has built. If a phase needs a step up, say so in `PROGRESS.md` and treat it as a new session against the same DoD.

## 29. Data migration

None. v1 orders are ephemeral (6 h). Steps at Phase 7:

1. Ian signs in on Production with the Google account that will own Two Little Fish.
2. Create shop: name `Two Little Fish`, slug `two-little-fish`, digits **4–4**, ready timeout **300**, sound off (TV uses `?sound=1` as in v1), a new PIN.
3. Admin: ensure `isPilot = true` (automatic while the flag is off).
4. Re-print the QR from `/two-little-fish/qr` (new URL). Update the tablets' bookmarks to `/two-little-fish/staff` and the TV to `/two-little-fish/display?sound=1`.
5. Leave v1 running until the new board has done one full service; then Ian pauses the v1 Vercel project.

## 30. Kiosk setup (doc requirement carried from v1 Phase 5)

Written as `docs/kiosk-setup.md` in the repo and summarised on `/app/{slug}`:

- **Tablets (staff):** open `{SITE}/{slug}/staff`, Add to Home Screen (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen), open from the icon, enter the PIN. Turn on Guided Access (iPad) / screen pinning (Android) so the tablet stays on the page. Set auto-lock to Never during service. The PIN session lasts 12 h; re-enter each morning.
- **TV:** any device with a browser (Chromecast with Google TV, Fire stick Silk browser, a cheap Chromebook, or an old laptop on HDMI). Open `{SITE}/{slug}/display?sound=1` (or without `?sound=1` if the shop setting is on), tap the screen once so sound and Keep-screen-on can start, then Fullscreen. If the device sleeps anyway, disable screen timeout in its settings; the "Keep screen on" toggle only works in browsers that support the Wake Lock API.
- **QR:** print `/{slug}/qr` on card, laminate, put it by the till. Customers scan → the same board on their phone.
- **Sound:** the TV chimes once per newly-ready number. Volume is the TV's own.
- **Checks each morning:** header dot is green "Live" on every screen; add a test number and clear it.

## 31. Appendix: `CLAUDE.md` for the v2 repo (ready to paste)

```markdown
# Chip Check v2 — Claude Code / Agent Guide

**Project:** Chip Check v2 — multi-tenant real-time ticket-number board (name is a placeholder)
**Stack:** Next.js 14 (App Router, TS) + Firebase (Auth, Firestore, Admin SDK) + Stripe (flag-gated) + Tailwind v3 + NextUI v2 + Vercel
**Build environment:** Claude Code on the web (cloud sandbox). No browser, no emulators, no devices here — verify against the dev Firebase project and Vercel Preview.

## Read this first, every session
1. `PROGRESS.md` — current phase, per-phase Definition of Done, blockers, deviations. Update it at the end of every session.
2. `chipcheck_v2.md` — the PRD + build plan. Part H is the phase you are working on. It is self-contained; do not ask for the v1 repo.

## Working rhythm
- One phase per session. Don't start the next phase until the current one's DoD is ticked (agent items by you, **(Ian)** items by Ian).
- Each phase names the model to run it on (chipcheck_v2.md §28b, repeated at the top of each phase in Part H). Opus 5 for Phases 1, 2, 5 and the Phase 6 audit; Sonnet 5 for the scaffold and the pixel ports; Haiku 4.5 for mechanical edits. Record the model actually used in `PROGRESS.md`; a downgrade is a **Deviation**.
- Work on a branch, open a PR to `dev`; Vercel builds a Preview. `dev` has a stable alias that is a Firebase authorized domain — use it for anything involving Google sign-in. `dev` → `main` merges are Ian's.
- End of session: update `PROGRESS.md`, commit, push, make sure the PR is open.
- If the plan is wrong, record it under **Deviations** in `PROGRESS.md` instead of silently working around it.

## Locked decisions (don't relitigate)
| Decision | Choice |
|---|---|
| Framework | Next.js 14 App Router + TypeScript (`create-next-app@14` pinned; `@latest` breaks NextUI v2) |
| Components | NextUI v2 (`@nextui-org/*`, NOT HeroUI). Only Alert, Button, Modal, Spinner. |
| Styling | Tailwind v3 (`tailwind.config.ts`), tokens exactly as chipcheck_v2.md §20 |
| Database + realtime | Firestore; client reads with `onSnapshot`; **all writes via Route Handlers + firebase-admin** |
| Auth | Owner: Google sign-in → Firebase session cookie `cc_session`. Staff: shop PIN → signed HttpOnly cookie `cc_staff` (12 h). |
| Order numbers | `string`, digits only, per-shop min/max 1–6 (default 1–4), leading zeros preserved |
| Ready auto-clear | display-only filter, `settings.readyTimeoutSeconds` (default 300) |
| Stale purge | 6 h **code constant**; Vercel Cron `GET /api/cron/purge-stale` + opportunistic purge on `add` |
| Billing | Stripe, one monthly price, `BILLING_ENABLED` flag (Firestore `config/flags` overrides env). Off for pilot. Pilot shops `isPilot = true`. |
| URLs | `/{slug}/display`, `/{slug}/staff`, `/{slug}/qr`; owner pages under `/app` |
| Hosting | Vercel Git integration; Firestore rules/indexes deployed by GitHub Action |

## Environment variables
See `.env.local.example`. Client: `NEXT_PUBLIC_FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID/APP_ID`, `NEXT_PUBLIC_SITE_URL`. Server only: `FIREBASE_SERVICE_ACCOUNT_JSON` (base64), `STAFF_SESSION_SECRET`, `CRON_SECRET`, `SUPERADMIN_UIDS`, `BILLING_ENABLED`, `STRIPE_*`. Two Firebase projects: `chipcheck-dev` (sandbox, Preview, `dev`) and `chipcheck-prod` (Production).

## Architecture invariants
- Browser never writes Firestore. `firestore.rules` denies all client writes; keep it that way.
- Public reads: `shops/{id}` (get), `slugs/{slug}` (get), `shops/{id}/orders` (get/list). Everything under `private/` is server-only. Stripe IDs never on the public shop doc.
- Every Route Handler: zod-validated body, `apiHandler` wrapper, stable `{ error: code }` responses (chipcheck_v2.md §13–14). Missing server secrets must throw at boot (fail closed).
- Dedupe is a transaction on `shops/{id}/activeNumbers/{orderNumber}`. State guards: markReady only from preparing, recall only from ready, all require `cleared == false`.
- No hard deletes. `preparing` orders never auto-clear on the display.
- `clear` is soft and staff-undoable for 60 s via `unclear`, which must re-acquire the `activeNumbers` lock doc; purge and `clearAll` set a different `clearedBy` and are never undoable.
- The staff console always shows connection state. A tablet whose listener has gone stale still writes successfully over HTTP, so without the dot it looks healthy while its board diverges.
- Firestore is the single source of truth; no order state in localStorage/sessionStorage.

## Agent vs Ian
You: code, tests, rules/indexes files, Actions workflows, seed/curl scripts, PRs, `PROGRESS.md`.
Ian: Firebase console, Google OAuth consent screen, Vercel env vars, Stripe dashboard, device/visual testing, merging to `main`.
Never run `firebase login`, `vercel login`, or `stripe login` interactively. Never generate or print secrets in the transcript. Never commit `.env*` except `.env.local.example`.

## Commands
npm run dev · npm run build (typechecks) · npm run lint · npm test (Vitest) · npm run test:rules (emulator, CI only) · npm run test:e2e (Playwright vs Preview)

## NextUI gotchas (keep if regenerating config)
1. `framer-motion` must be an explicit dependency.
2. Tailwind `content` must include `./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}`.
3. `NextUIProvider` wraps the app in `app/layout.tsx`; `<html className="dark">`.

## Git
Branches: `main` (prod), `dev` (staging), feature branches → PR to `dev`. Commit messages: concise, imperative, match `git log --oneline`. Never commit secrets.
```

---

# Part H — Build plan

One phase per session. Each phase lists the **Model** to run that session on (reasoning in §28b), **Goal**, **Tasks** (agent unless marked **(Ian)**) and a **Definition of Done** with testable items. Copy each DoD into `PROGRESS.md` as checkboxes at Phase 0, and record the model actually used against each phase.

## Phase 0 — Scaffold, projects, pipeline

**Model:** Claude Opus 5 — revised from Sonnet 5; the risk is version traps and inherited foundations, not typing volume (§28b).

**Goal:** an empty but deployable app with the design shell, both Firebase projects wired, and every credential in place so no later phase blocks on setup.

**Tasks**
1. `npx create-next-app@14 chipcheck --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*"`; remove Geist fonts; add Archivo via `next/font/google`; `tailwind.config.ts` with the §20 tokens and the NextUI content path; `NextUIProvider` + `<html className="dark">`; `globals.css` from §20/§22.3.
2. Install `@nextui-org/react framer-motion lucide-react firebase firebase-admin zod qrcode @types/qrcode server-only`; dev: `vitest @vitest/coverage-v8 @firebase/rules-unit-testing firebase-tools @playwright/test`.
3. `lib/env.ts` (zod, fail-closed), `lib/firebase/client.ts`, `lib/server/admin.ts` (singleton from base64 JSON), stub `firestore.rules` (deny all), empty `firestore.indexes.json`, `firebase.json` pointing at them, `vercel.ts` with the cron entry.
4. Placeholder routes: `/` landing (§22.4), `/{slug}/display` rendering the header shell with the shop name from a hardcoded stub.
5. `.github/workflows/test.yml` and `firebase.yml` (§27). `.env.local.example`. `PROGRESS.md` (all phases, DoDs copied), `CLAUDE.md` (§31), `docs/` folder.
6. **(Ian)** GitHub repo; Vercel project linked to it; `dev` branch created and given a stable alias; Firebase projects `chipcheck-dev` + `chipcheck-prod` with Firestore (Native mode, region `europe-west2`), Google provider enabled, consent screen set, authorized domains (dev alias, prod domain, `localhost`); service accounts; Vercel env vars (Preview ← dev, Production ← prod); repo secrets for the Action; sandbox env (dev set); `openssl rand` secrets.

**Definition of Done**
- [ ] `npm run build` and `npm run lint` pass in the sandbox.
- [ ] PR to `dev` produces a green Vercel Preview; `/` renders the landing with Archivo and the dark canvas.
- [ ] The Firestore rules Action ran on `dev` and the Firebase console shows the deny-all rules for `chipcheck-dev`. **(Ian)**
- [ ] Vercel → Settings → Cron Jobs lists `/api/cron/purge-stale` (route may 404 until Phase 1). **(Ian)**
- [ ] `curl https://<dev alias>/api/health` returns `{ ok: true, project: "chipcheck-dev" }` (a tiny route that proves the Admin SDK initialises from `FIREBASE_SERVICE_ACCOUNT_JSON`).
- [ ] Sandbox can run `node scripts/admin-ping.mjs` and read `chipcheck-dev` (proves sandbox env vars).
- [ ] `PROGRESS.md` and `CLAUDE.md` committed; `.env.local` absent from git.

## Phase 1 — Data model, rules, orders API, purge

**Model:** Claude Opus 5 — transactions, security rules, purge semantics; failures here are silent (§28b). Do not downgrade.

**Goal:** the complete write path for orders on a hardcoded test shop, provably locked down.

**Tasks**
1. `lib/types.ts` (Shop, Settings, Order, Billing); `lib/server/shops.ts` (`getShopBySlug`, `getShop`), `lib/server/orders.ts` (`addOrder` transaction with `activeNumbers`, `markReady`, `recall`, `clear`, `unclear` re-acquiring the lock doc, `clearAll` with the optional `status`/`olderThanSeconds` filters), `lib/server/purge.ts` (`STALE_HOURS = 6`, `purgeShop`, `purgeAll`), `lib/server/rateLimit.ts` (§14.1, `add` and `clearAll` only).
2. `app/api/shops/[shopId]/orders/route.ts` per §13 — temporarily authorised by a `X-Dev-Staff-Token` header equal to `STAFF_SESSION_SECRET` in non-production, to be replaced by the cookie in Phase 2 (note it in `PROGRESS.md` deviations and remove it in Phase 2).
3. `app/api/cron/purge-stale/route.ts` (GET, bearer check).
4. `firestore.rules` per §10; `firestore.indexes.json` per §9; rules tests in `tests/rules/`.
5. Vitest: schemas, `orderNumber` per settings, transitions, the `unclear` guards (window, `clearedBy`, lock re-acquisition), `clearAll` filter predicates, rate-limit window logic, purge cutoff, in-memory Admin stub for the route.
6. `scripts/seed-shop.mjs` (creates `test-shop` in `chipcheck-dev` with settings 1–4 / 300 / PIN hash placeholder) and `scripts/orders-smoke.sh` (curl sequence against a base URL: add → 200, add same → 409, markReady → 200, recall → 200, markReady → 200, recall on preparing → 409, clear → 200, clear again → 409, malformed JSON → 400, bad number → 400, no auth → 401).

**Definition of Done**
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

## Phase 2 — Owner auth, shops, PIN

**Model:** Claude Opus 5 — crypto, session cookies, rate limiting, fail-closed config (§28b). Do not downgrade.

**Goal:** an owner can sign in with Google, create a shop, edit settings, set a PIN; a tablet can unlock with that PIN and receive a staff cookie; Phase 1's dev header is removed.

**Tasks**
1. `POST/DELETE /api/auth/session`; `requireOwner`, `requireOwnerOf`, `requireSuperadmin`.
2. `/login` (popup + redirect fallback), `/logout`, `/app`, `/app/new`, `/app/{slug}` per §22.4 with the slug availability check (`GET /api/slugs/{slug}` → `{ available, reason }` — public, rate-limited by Vercel's defaults, returns no other data).
3. `POST /api/shops`, `PATCH /api/shops/{id}`, `POST /api/shops/{id}/pin`; `lib/server/pin.ts` (scrypt hash/verify, timing-safe).
4. `POST/DELETE /api/shops/{slug}/staff/unlock` with Firestore-backed rate limit; `lib/server/staffCookie.ts` (sign/verify); `requireStaff` wired into the orders route; dev header removed.
5. `app/[slug]/layout.tsx` resolving slug → shop; `/{slug}` redirect.
6. Vitest for slug rules/reserved list, PIN hashing, cookie sign/verify/expiry, rate-limit window logic.

**Definition of Done**
- [ ] On the `dev` alias, Google sign-in completes and `/app` shows "No shops yet." **(Ian)**
- [ ] Creating `test-shop` via the UI writes `shops/{id}`, `slugs/test-shop`, `private/auth` (hash only, no plaintext), `private/billing` `{ status: "pilot" }`, and `users/{uid}.shopIds` — verified in the Firestore console. **(Ian)**
- [ ] Creating a shop with a reserved slug → 400 `slug_reserved`; with a taken slug → 409 `slug_taken` (curl with the session cookie).
- [ ] `PATCH` by a different Google account → 403 (agent uses two seeded session cookies from a second test account Ian creates, or Ian verifies manually). **(Ian if manual)**
- [ ] `curl -X POST …/staff/unlock` with the right PIN → 200 + `Set-Cookie: cc_staff…; HttpOnly; Secure; SameSite=Lax`; wrong PIN → 401; sixth wrong attempt within 15 min → 429 with `retryAfterSeconds`.
- [ ] Orders route now rejects requests without `cc_staff` (401) and accepts with it; a cookie for shop A is rejected on shop B (401).
- [ ] With `STAFF_SESSION_SECRET` removed from a throwaway Preview env, every API route returns 500 (fail-closed), not 200. **(Ian sets the env, agent curls)**
- [ ] `DELETE /api/auth/session` clears the cookie; a subsequent `/app` request redirects to `/login`.

## Phase 3 — Staff console per shop

**Model:** Claude Sonnet 5 for the port; Claude Opus 5 for `lib/useOrders.ts` (pending reducer + status derivation) (§28b).

**Goal:** the v1 staff console, pixel-identical, running on `/{slug}/staff` with per-shop digit rules and a real pending overlay.

**Tasks**
1. Port `Keypad`, `OrderCard`, the console page and the PIN gate per §22.2 (server-side unlocked check, inline gate errors, `h-11` Clear All, status word at all widths, the Live/Reconnecting indicator on the header, the order-age element with target escalation, the undo affordance after `clear`, and the shed nudge).
2. `lib/useOrders.ts` per §11 with the pending overlay per §12; `lib/api.ts` client helpers mapping error codes to copy (§23).
3. Duplicate / clear-all / subscription modals (subscription modal wired but unreachable while the flag is off).
4. `prefers-reduced-motion` and safe-area handling on the console.
5. Playwright smoke: unlock, add, second page sees the card, mark ready, recall, clear, clear all.
6. Vitest for the pending-set reducer and status derivation.

**Definition of Done**
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

## Phase 4 — Customer display + QR per shop

**Model:** Claude Sonnet 5 — §22.1/§22.3 are near-complete markup (§28b).

**Goal:** the v1 display and QR pages, pixel-identical, per shop, with the robustness additions.

**Tasks**
1. Port `Column`, `OrderTile`, the display page per §22.1 (shop name header, per-shop timeout, `soundEnabled`, seed-on-connect chime, "Tap to enable sound" hint, `aria-live`, reduced motion, Wake Lock toggle, Fullscreen link, safe-area).
2. Port `/{slug}/qr` per §22.3 with `NEXT_PUBLIC_SITE_URL`.
3. `app/manifest.ts` + icons; `viewport` export with `viewportFit: "cover"`.
4. Vitest for the ready-timeout filter and chime-seeding logic (pure functions extracted from the page).
5. Playwright: display shows a seeded preparing tile; marking ready via API moves it to the Ready column (same `layoutId` element); after `readyTimeoutSeconds` it disappears from the display but not from the staff list. **Use the §9 minimum of 30 s on `test-shop`** — an earlier draft said "set to 5 for the test", which §9 rejects as out of range (30–3600). Do not loosen a production constraint to speed up a test; if 30 s makes the suite too slow, extract the filter as a pure function and unit-test the boundary there (task 4 already does).

**Definition of Done**
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

## Phase 5 — Billing behind the flag

**Model:** Claude Opus 5 — entitlement matrix, webhook mapping, idempotency, signature verification (§28b). Do not downgrade.

**Goal:** Stripe subscription lifecycle works end to end in test mode on Preview with the flag on, and is invisible with the flag off. Skippable for the pilot: Production ships with `BILLING_ENABLED=false`.

**Tasks**
1. `lib/server/flags.ts` (env + Firestore override, 60 s cache), `lib/server/entitlement.ts` (§15), wired into `add`.
2. `POST /api/billing/checkout`, `/portal`, `/webhook` (§16); `customers/{stripeCustomerId}` lookup docs; `stripeEvents` idempotency.
3. Plan card on `/app/{slug}` (§18); past-due banner + subscription modal on the console; `/admin` page + pilot toggle route.
4. Vitest: entitlement matrix (flag × pilot × status × grace), webhook status mapping, idempotency.
5. `scripts/stripe-fixture.mjs` — signs and posts `customer.subscription.updated` / `deleted` / `invoice.payment_failed` fixtures to a base URL with the test webhook secret.
6. **(Ian)** Stripe product + price (test and live), webhook endpoints, secrets into Vercel; set `BILLING_ENABLED=true` on the Preview environment for the duration of this phase.

**Definition of Done**
- [ ] Flag **off** (default): no plan card, no banner, `add` never returns 402, new shops get `isPilot = true` / `status = "pilot"`. Verified by curl + Playwright.
- [ ] Flag **on** in Preview: new shop → `isPilot = false`, plan card shows **Subscribe**; Checkout with card `4242 4242 4242 4242` → webhook → `status = "trialing"`, card shows "Trial — ends {date}". **(Ian)**
- [ ] Posting the `invoice.payment_failed` fixture → `past_due`, console shows the amber banner, `add` still 200 (grace); fixture with `pastDueSince` older than 7 days (seeded directly) → `add` 402 and the subscription modal appears.
- [ ] Cancel in the Customer Portal → `customer.subscription.deleted` → `canceled` → `add` 402; re-subscribe → 200. **(Ian)**
- [ ] Posting the same event id twice → second returns 200 and changes nothing (`stripeEvents/{id}` exists).
- [ ] Bad signature → 400. Webhook route works with the raw body on Vercel (no body parsing middleware).
- [ ] `/admin` lists shops for a UID in `SUPERADMIN_UIDS`, 403 for others; toggling pilot on a `canceled` shop makes `add` 200 again.
- [ ] Flipping `config/flags.billingEnabled` in the Firestore console changes behaviour within 60 s without a deploy. **(Ian flips, agent curls)**
- [ ] Preview `BILLING_ENABLED` set back to `false` at the end of the phase; Production never had it on. **(Ian)**

## Phase 6 — Hardening

**Model:** Claude Opus 5 for the codebase-wide audit, plus one Claude Fable 5.1 pass over rules + auth + webhook before the pilot (§28b).

**Goal:** the app survives a full service day and a cold read of the docs.

**Tasks**
1. Error handling audit: every `fetch` in the client maps codes to copy; every Route Handler goes through `apiHandler`; 500s log a request id and never leak messages.
2. `scripts/soak.mjs`: for 60 min against the `dev` alias, add/mark/clear numbers every 5–15 s on `test-shop` while Ian watches the TV and a tablet; logs any non-2xx and any snapshot gap > 5 s (measured by a Node Firestore listener in the script).
3. Playwright suite complete (gate, console, display, QR, owner flows, admin 403), running in CI on `dev`.
4. `docs/kiosk-setup.md` (§30) and the summary card on `/app/{slug}`.
5. Manifest icons finalised (still placeholder art), `robots.txt` (`Disallow: /app`, `/admin`), `not-found.tsx` and `error.tsx` in the design system.
6. Lighthouse pass on `/{slug}/display` (performance ≥ 90 on desktop, accessibility ≥ 95) — Ian runs it; agent fixes findings.

**Definition of Done**
- [ ] 60-minute soak: zero non-2xx responses, zero snapshot gaps > 5 s, TV never slept, tablet never showed the gate. **(Ian watches, agent runs the script)**
- [ ] Tab backgrounded overnight on a tablet shows "Reconnecting" then "Live" on wake and the correct list (Ian leaves a tablet open overnight). **(Ian)**
- [ ] Every user-visible error string in §23 is reachable and correct (Playwright asserts the mapped copy for each forced error code via a test-only `?force=` query in non-production, removed before Phase 7 or gated by `NODE_ENV`).
- [ ] Kiosk doc followed cold by Ian on a fresh tablet + TV without asking questions. **(Ian)**
- [ ] Lighthouse thresholds met. **(Ian)**
- [ ] `PROGRESS.md` deviations section reviewed; nothing outstanding except Part I questions.

## Phase 7 — Pilot

**Model:** Claude Sonnet 5; step up to Claude Opus 5 for any incident touching auth, billing or data integrity (§28b).

**Goal:** Two Little Fish and 1–2 other shops on Production with the flag off; feedback collected; price decided; flag flipped when ready.

**Tasks**
1. **(Ian)** Production env: prod Firebase keys/service account, live Stripe keys (present but flag off), `SUPERADMIN_UIDS`, `NEXT_PUBLIC_SITE_URL`, `dev` → `main` merge.
2. **(Ian)** Onboard Two Little Fish per §29; onboard 1–2 further shops (they self-serve; Ian watches the first one).
3. Agent: `docs/pilot-log.md` template (date, shop, issue, severity, fix PR); weekly check of Vercel runtime errors and Firestore usage (via the Vercel MCP / Firebase console screenshots from Ian); bug-fix PRs.
4. **(Ian)** Decide price and trial length; create the live price; confirm the live webhook; flip `config/flags.billingEnabled` (or `BILLING_ENABLED`) on Production; clear `isPilot` per shop only when each shop agrees.

**Definition of Done**
- [ ] Two Little Fish runs a full service day on v2 with no reversion to v1. **(Ian)**
- [ ] At least one other shop created its own board without Ian touching a console. **(Ian)**
- [ ] Every pilot issue is logged with a fix or a "won't fix" and the reason.
- [ ] Price and trial length recorded in `PROGRESS.md`; `STRIPE_PRICE_ID` set on Production. **(Ian)**
- [ ] Flag flipped on Production; pilot shops still `isPilot = true`; a brand-new shop sees the plan card. **(Ian)**
- [ ] v1 Vercel project paused. **(Ian)**

---

# Part I — Open questions & risks

| # | Question / risk | Default in this doc | Decide by |
|---|---|---|---|
| 1 | **Price point and trial length.** | Placeholder £X/month, 14-day trial | Phase 7 |
| 2 | **Display header: shop name or "Order Board"?** Shop name helps customers on phones confirm they scanned the right board; "Order Board" is what v1 shipped. | Shop name | Phase 4 |
| 3 | **Buzzer/pager workflows.** Shops with pagers: do staff enter the pager number as the ticket, or does the kitchen number differ from the pager? Might need a "pager" label mode. | Pager number = ticket number; digits 1–3 | Phase 7 feedback |
| 4 | **App rename.** Everything uses `{appName}`; slug, cookies (`cc_*`) and manifest need a search-and-replace at rename time. | "Chip Check" | Before Phase 7 |
| 5 | **Collection verification** (name/initial on the board) — deferred from v1; PII on a public screen vs. lost-receipt claims. | Not built | Phase 7 feedback |
| 6 | **Firestore costs.** Always-on display = 1 listener, reads only on change. Estimate per shop/day: ~300 order docs × ~4 writes × 3 listeners ≈ 3–4 k reads, ~1.2 k writes — free tier (50 k reads / 20 k writes per day) covers ~10 active shops; Blaze after that at pennies per shop. | Free tier, Blaze enabled on prod with a budget alert | Phase 7 |
| 7 | **Google sign-in on locked-down tablets / in-app browsers.** Redirect flow needs cookies on the auth domain; Safari ITP can break `signInWithRedirect` on `*.firebaseapp.com` auth domains. Owners normally sign in on a laptop; if this bites, set `authDomain` to the app's own domain and proxy `/__/auth/*`. | Popup first, redirect fallback | Phase 2 |
| 8 | **Vercel Hobby cron limit** (daily only). | Opportunistic purge on `add` covers active shops; daily cron sweeps idle ones | Phase 1 |
| 9 | **Preview URL auth.** Per-PR Previews can't do Google sign-in (authorized domains). | Stable `dev` alias | Phase 0 |
| 10 | **Firestore Timestamp skew** for the ready timeout: display uses the device clock vs. server `readyAt`. A TV whose clock is minutes off will show ready tiles too long/short. | Accept; kiosk doc says "set the TV clock to automatic" | — |
| 11 | **Shop deletion / slug rename** — no UI. | Superadmin does it in the console | Later |
| 12 | **Rate limiting the slug-availability and unlock endpoints beyond per-IP** (shared NAT at a shop = one IP). 5/15 min per IP+shop could lock out a whole shop if one tablet mistypes. | Keep 5/15 min; owner can wait or rotate the PIN (rotation resets attempts) | Phase 2 |
| 13 | **Sound autoplay.** Chrome/iOS require a gesture; a rebooted TV device won't chime until touched. Separately: should the TV chime *at all*? A chippy at full service is loud enough that the board may be doing all the work, and a silent TV is a defensible default rather than something to discover on pilot day. | "Tap to enable sound" hint, `ctx.resume()` on the gesture, sound on per `?sound=1` or the shop setting | Phase 4 for the mechanism; Phase 7 feedback for whether it's wanted |
| 14 | **Default `targetPrepSeconds`** for the order-age escalation. 8 min is a guess; a fryer and a grill have different rhythms. | 480 s, per-shop | Phase 7 feedback |
| 15 | **Undo window** — 10 s in the console, 60 s on the server. Long enough for a wet hand, short enough that the number can't be resurrected after someone else reuses it. | 10 s / 60 s | Phase 7 feedback |
| 16 | **Order age on the customer display.** Would show customers how late they are — probably worse for everyone than not knowing. | Not shown; staff console only | Phase 7 feedback |
