# MASSIV TV control panel (local read-only clone of papitomesyza/massiv_controlpanel)
Goal: agency OS/CRM for Andi (clients, projects, crew, finances, invoices, pitches, shotlists, vault).
Stack: Node 20 + Express + better-sqlite3 (single DB, data/ dir), React+Vite frontend, PDFKit/sharp, Docker, deployed on Zeabur. Single-user, password login, bearer sessions (30d).
Read 2026-10-06: 98 commits since 2026-06-11, last 2026-09-24. ~16.6k lines backend.
Open: no README/tests; see chat summary for risks.
Next: Andi decides what to build/fix.

## Hermes agent access (2026-10-08)
- Goal: standing read+write access for Hermes, revocable by Andi, vault out of scope.
- Change (commit 83cf07c, local clone, not pushed): server.js requireAuth now also accepts a
  bearer equal to env `HERMES_API_TOKEN` (constant-time compare). Unset/change the env var to revoke.
  Service token blocked (403) on: /api/vault*, /api/settings/change-password, /api/settings/backup/download.
  Everything else (clients, projects, budgets, finances, invoices, calendar, settings, uploads) allowed.
- Token value: stored locally at ~/.massiv_token. Same value must be set as Zeabur env
  HERMES_API_TOKEN on the panel service.
- Deploy: GitHub repo papitomesyza/massiv_controlpanel, branch main; Zeabur auto-builds on push.
- Verified: node --check OK; auth + path rules tested against real server.js text. Live 200 on root.
- PENDING: Andi sets env + redeploys, then Hermes verifies live (GET /api/clients with the token).

## VERIFIED LIVE (2026-10-08)
- Commits pushed to GitHub main: 83cf07c, 1e6b85c. Zeabur auto-builds + redeploys from the repo.
- Service token works: clients/projects/budgets/invoices/calendar/settings/crew all 200; real data returns.
- Blocked 403: /api/vault*, change-password, backup/download. No/bad token 401.
- Access recipe for Hermes: `curl -H "Authorization: Bearer $(cat ~/.massiv_token)" https://mssv.zeabur.app/api/<route>`.
- Revoke: change or unset HERMES_API_TOKEN on Zeabur (env var), redeploy.
