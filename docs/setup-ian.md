# Setup runbook (Ian)

Everything the agent cannot do from the sandbox: consoles, dashboards, credentials.
Work top to bottom — each step unblocks the ones after it. Roughly 45–60 minutes total.

**Two rules throughout.** Secrets never go in the repo, in a GitHub issue, or in the chat —
paste them straight into Vercel or GitHub. And every value has exactly one destination; if a
step doesn't say where a value goes, it isn't finished.

At the end, tell the agent which steps you completed and it will verify the blocked Definition
of Done items in `PROGRESS.md`.

---

## 1. Git branches (2 min) — unblocks: the pull request

The repo currently has one branch, `claude/prd-phases-review-ucglvr`, and no default branch.

1. Create `main` from that branch (GitHub → Branches, or push locally).
2. Set `main` as the repository's default branch.
3. Create `dev` from `main`.

`dev` is the long-lived staging branch. Feature branches PR into `dev`; `dev` → `main` merges
are yours alone. Until `main` exists there is nothing for a PR to target.

---

## 2. Firebase projects (15 min) — unblocks: health check, admin ping, rules deploy

Create **two** projects at <https://console.firebase.google.com>: `chipcheck-dev` and
`chipcheck-prod`. For **each** one:

1. **Firestore** → Create database → **Native mode** → region **`europe-west2`**.
   Region is permanent; London keeps latency low for UK shops.
2. **Authentication** → Sign-in method → enable **Google**.
3. **OAuth consent screen** (Google Cloud console → APIs & Services → OAuth consent screen):
   audience **External**, app name, support email, developer contact. No verification is needed
   for basic profile scopes.
4. **Authentication → Settings → Authorized domains** — add:
   - `localhost`
   - the stable `dev` alias hostname from step 3 below (dev project only)
   - the production hostname (prod project only)

   Wildcards are not supported, so per-PR Preview URLs can never do Google sign-in. That is why
   the `dev` alias exists.
5. **Project settings → Service accounts → Generate new private key.** Download the JSON, then:

   ```bash
   base64 -i key.json | tr -d '\n'
   ```

   That one-line string is `FIREBASE_SERVICE_ACCOUNT_JSON`. Keep both (dev and prod) to hand for
   steps 3–5, then delete the downloaded JSON files.
6. **Project settings → General → Your apps → Web app.** Register one, and copy the four values
   into the `NEXT_PUBLIC_FIREBASE_*` variables in step 3.

---

## 3. Vercel project (10 min) — unblocks: Preview, cron, health check

1. Import the GitHub repo at <https://vercel.com/new>. Framework preset: **Next.js**.
2. **Settings → General → Node.js Version → 22 or later.**
   Not optional: `firebase-admin@14` declares `engines: node >=22`, and Node 20 will fail at
   runtime. (`PROGRESS.md` deviation 2.)
3. **Settings → Git → Production Branch → `main`.**
4. Give `dev` a stable alias so Google sign-in works against it. Either accept Vercel's branch
   alias (`chipcheck-git-dev-<team>.vercel.app`) or set a custom domain such as
   `dev.<yourdomain>`. **Add that exact hostname to the dev Firebase project's authorized
   domains (step 2.4).**
5. **Settings → Environment Variables.** Add each of the following, scoping carefully —
   **Preview gets the dev project's values, Production gets prod's.** Never cross them.

   | Variable | Preview (dev project) | Production (prod project) |
   |---|---|---|
   | `NEXT_PUBLIC_FIREBASE_API_KEY` | dev web app | prod web app |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `chipcheck-dev.firebaseapp.com` | `chipcheck-prod.firebaseapp.com` |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `chipcheck-dev` | `chipcheck-prod` |
   | `NEXT_PUBLIC_FIREBASE_APP_ID` | dev web app | prod web app |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | dev base64 (step 2.5) | prod base64 |
   | `STAFF_SESSION_SECRET` | `openssl rand -base64 48` | a **different** one |
   | `CRON_SECRET` | `openssl rand -base64 48` | a **different** one |
   | `SUPERADMIN_UIDS` | your dev Firebase UID | your prod Firebase UID |
   | `BILLING_ENABLED` | `false` | `false` |
   | `NEXT_PUBLIC_SITE_URL` | the dev alias URL | the production URL |

   Generate the two secrets locally with `openssl rand -base64 48` — the agent does not generate
   or echo secrets. Use different values per environment so a dev leak cannot touch production.

   Your Firebase UID: sign in once on the deployed app, then Firebase console →
   Authentication → Users → copy the UID. You can leave `SUPERADMIN_UIDS` empty until Phase 5.

6. **Deployment Protection.** If Preview URLs are password-protected, either turn protection off
   for this project or enable **Protection Bypass for Automation** and give the agent
   `VERCEL_AUTOMATION_BYPASS_SECRET` (sandbox env only) so `curl` and Playwright can reach it.

---

## 4. Sandbox environment (2 min) — unblocks: `admin-ping`, integration scripts

In the Claude Code web session's environment settings, add the **dev set only** — never
production values:

- `FIREBASE_SERVICE_ACCOUNT_JSON` (dev base64)
- `NEXT_PUBLIC_SITE_URL` (the dev alias)
- `STAFF_SESSION_SECRET`, `CRON_SECRET` (the dev values)
- `VERCEL_AUTOMATION_BYPASS_SECRET`, if you enabled it in 3.6

---

## 5. GitHub Action secrets (5 min) — unblocks: the rules deploy

Repository → Settings → Secrets and variables → Actions → New repository secret. Four:

| Secret | Value |
|---|---|
| `FIREBASE_PROJECT_DEV` | `chipcheck-dev` |
| `FIREBASE_PROJECT_PROD` | `chipcheck-prod` |
| `GCP_SA_KEY_DEV` | the dev service-account JSON, **raw, not base64** |
| `GCP_SA_KEY_PROD` | the prod service-account JSON, **raw, not base64** |

The `GCP_SA_KEY_*` values are the un-encoded file contents — `w9jds/firebase-action` expects raw
JSON. This is the one place the base64 form is wrong.

---

## 6. Verify (5 min)

Once steps 1–5 are done, tell the agent. It will check:

- `curl https://<dev alias>/api/health` → `{"ok":true,"project":"chipcheck-dev"}`
- `node scripts/admin-ping.mjs` reads `chipcheck-dev` from the sandbox
- Firebase console → Firestore → Rules shows the deny-all stub on `chipcheck-dev`
- Vercel → Settings → Cron Jobs lists `/api/cron/purge-stale` *(it will 404 until Phase 1 — the
  entry existing is what matters here)*
- The landing page renders in Archivo on the dark canvas

Yours to eyeball: the Preview deployment is green, and `/` looks right on a phone.

---

## Notes

- **The cron schedule depends on your Vercel plan.** `vercel.ts` requests every 30 minutes. Hobby
  allows only daily crons — if Vercel rejects it, tell the agent and it will change the schedule
  to `0 4 * * *` and record it. The opportunistic purge on `add` (§13.1) covers active shops
  either way, so this is not urgent.
- **Stripe is not needed yet.** Billing ships behind a flag that stays off through the pilot;
  everything Stripe-related is Phase 5.
- **Nothing here is destructive.** If a step looks wrong, stop and ask rather than guessing —
  the Firestore region and the slug format are the only genuinely permanent choices, and neither
  is made in this runbook.
