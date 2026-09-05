# Chip Check v2

A real-time ticket-number board for food places that hand customers a numbered ticket.
Staff type a number on a tablet; it appears on a TV (and on customers' phones via a QR code)
under **Preparing**; staff tap **Ready** and it moves to the green **Ready · Collect** column.

Multi-tenant: any shop owner signs in with Google, creates a shop, and gets
`/{slug}/display`, `/{slug}/staff` and `/{slug}/qr`.

*"Chip Check" is a working name.*

## Where things are

| | |
|---|---|
| `chipcheck_v2.md` | The spec. Parts A–G are the PRD, Part H the phased build plan. |
| `PROGRESS.md` | Running status: current phase, Definitions of Done, deviations. |
| `CLAUDE.md` | Agent guide — read alongside `PROGRESS.md` at the start of every session. |
| `docs/setup-ian.md` | Infrastructure runbook (Firebase, Vercel, GitHub secrets). |

## Stack

Next.js 14 (App Router, TypeScript) · Firebase Auth + Firestore + Admin SDK · Tailwind v3 ·
NextUI v2 · Stripe behind a feature flag · Vercel.

Versions are pinned deliberately — `create-next-app@latest` ships Next 16 and Tailwind v4,
which break NextUI v2. See `chipcheck_v2.md` §3 before upgrading anything.

## Architecture invariants

- **The browser never writes Firestore.** Reads go direct via `onSnapshot`; every write goes
  through a Route Handler using the Admin SDK. `firestore.rules` denies all client writes.
- Order numbers are **strings** — `"0042"` is not `"42"`.
- Soft delete only; `preparing` orders never auto-clear on the display.
- Missing server secrets throw rather than defaulting open.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build (also typechecks)
npm run lint
npm run typecheck
npm test            # vitest
npm run test:rules  # Firestore rules — needs the emulator, CI only
npm run test:e2e    # Playwright against a Preview URL
```

Requires **Node 22+** (`firebase-admin@14` declares `engines: node >=22`).

Copy `.env.local.example` to `.env.local` for local runs. Never commit `.env.local`.
