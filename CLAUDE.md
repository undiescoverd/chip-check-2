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
