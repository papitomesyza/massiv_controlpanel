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

## CoS spine + export (2026-10-08, LIVE)
- Chief of Staff now MANAGES the panel (Andi's call). Full build plan/status: C:\Users\mssvh\projects\massiv-cos-integration\.
- New: `audit_log` table + recordAudit middleware (server.js). Every mutating /api request logs actor
  (andi|hermes) and source (panel|api|telegram|desktop, via X-CoS-Source header).
- New reads: `GET /api/audit/changes?since=<cursor>` (cursor stream), `GET /api/audit` (newest first),
  `GET /api/export` (one-call board snapshot: settings minus secrets, clients, projects+phases+money, crew, finances).
- Verified live: /api/export 200 JSON (17 clients, 20 projects, 28 crew); /api/audit/changes 200 JSON.
- Commits: 8274586 (P0 cleanup: Anthropic AI + flowSync removed), b9f8bda (audit spine + export).
