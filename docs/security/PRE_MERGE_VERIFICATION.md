# Security Branch: Pre-merge Verification

**Date:** 2026-11-25 · **Branch:** `security/remediation-2026-11` (verified at `c922268`, on top of `main` `ff782cd`). Not merged, not deployed. Everything below was run locally; no production system was contacted.

## 1. The `xlsx` artifact (supply chain)
| Check | Result |
|---|---|
| Source | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (the vendor's official distribution; the npm registry stops at the vulnerable 0.18.5). HTTPS, certificate verified |
| Integrity | sha512 of the downloaded file = the `integrity` in **both** `Server/package-lock.json` and `Client/package-lock.json`: `sha512-oLDq3jw7…H+3AJA==` (sha256 `8dc73fc3…99fe8`) |
| Contents | `package.json` name `xlsx`, version `0.20.3`, Apache-2.0; runtime `XLSX.version` is `0.20.3` |
| Install-time code | None: no `preinstall`/`install`/`postinstall` scripts and no dependencies (its scripts are developer-only: test, build, lint) |
| Tamper test | Changing one character of the lockfile integrity makes `npm ci` fail with `EINTEGRITY`, and nothing is installed |
| Fixes present | The changelog lists CVE-2023-30533 (prototype pollution, fixed in 0.19.3) and CVE-2024-22363 (ReDoS, fixed in 0.20.2) |
| **Exploit check** | A crafted workbook with a comment at address `__proto__`: **0.18.5 (on `main` today) pollutes `Object.prototype`**; 0.20.3 does not. The server reads uploaded workbooks in the HR attendance import |

**Residual risk:** builds now depend on `cdn.sheetjs.com` being reachable. Integrity pinning means the CDN cannot substitute different code; an outage would fail the build, not the running service.

## 2. Build reproducibility
| Build | Result |
|---|---|
| `npm ci` twice from clean exports, each with an **empty** npm cache (Server and Client) | Identical installed trees (Server 383 packages, Client 235); installed `xlsx` files are byte-identical to the downloaded tarball; the cache shows `xlsx` was fetched from `cdn.sheetjs.com` |
| **Railway's own build command** (`railway.json`: `npm install --omit=dev --prefix Server`) on a clean export, empty cache | Succeeds (357 packages); lockfile **not rewritten**; dev dependencies omitted; `xlsx` 0.20.3 |
| Railway's start command (`npm start --prefix Server`) on that build, against a fresh local PostgreSQL 17.5 | Boots; all 174 migrations; `/api/health` ok; inquiry for an unknown listing 404; bad login 401; Socket.IO handshake 200; no errors logged |
| Vercel-style client build (`npm install`, `vite build`) on a clean export, empty cache | Succeeds; lockfile not rewritten; 193 assets; `npm audit` 0 |

**Hosting, from the repository:** the server deploys on **Railway** (`railway.json`, Nixpacks; `server.js` reads `RAILWAY_GIT_COMMIT_SHA`), and the client on **Vercel** (`Client/vercel.json`, which proxies `/api` to the Railway service). Earlier notes said "Render"; that was wrong and is corrected.

**Not testable here:** that Railway's and Vercel's build networks can reach `cdn.sheetjs.com`. It is publicly reachable from this machine; the first build after merging confirms it.

## 3. Timezones
The repository does not set `TZ`, and production's value is not visible here, so both realistic cases were tested: **unset/UTC** (the platform default) and **Africa/Cairo** (the business zone the code formats with). Also Asia/Dubai and Europe/London. Each was set in the process environment.

| Test | UTC / London | Cairo / Dubai |
|---|---|---|
| Old vs new, 7 fixtures (SheetJS .xlsx, BIFF8/BIFF5 .xls, serial and text times, exceljs-made .xlsx, export) | 7/7 identical rows and identical parsed attendance | 3/7 identical; differences are 1-minute punch times |
| **Accuracy against the time stored in the file** (112 punches) | 0.18.5: 104/112 · 0.20.3: 104/112 | 0.18.5: **56**/112 · 0.20.3: **104**/112 |
| `attendanceWorkbook.test.js` | 5/5 | 5/5 |

Conclusion: under UTC the upgrade changes nothing. Under Cairo time, 0.20.3 fixes a misreading in 0.18.5, which applied the zone's 1899 local-mean-time offset of +2:05:09, not a whole number of minutes.

**Separate, pre-existing (not caused by this branch; same in both versions):** the 8 misses in every zone are times stored a fraction of a millisecond before a whole minute. The library returns `17:57:59.999` and `hrRules.excelTimeToHhMm` truncates to `17:57`, where Excel shows `17:58`. Rounding to the nearest second would fix it. That changes attendance results, so it is HR's decision and is not changed here.

## 4. Email transport (from the repository only)
- **One selector,** `Server/src/services/email.js`, used by inquiries, Become-a-Host, receipts, guest emails, guest-care emails and staff task emails.
- **Resend** is used when `RESEND_API_KEY` is set and is not a placeholder.
- **SMTP** (nodemailer) is used when Resend isn't configured and `SMTP_HOST` is set.
- **Otherwise** the message is written to the console and reported as sent. Only staff task emails raise an error in production.
- `.env.example` lists both sets of variables, blank. The default sender is `onboarding@resend.dev`.
- **Which one production uses cannot be determined from the repository.** It is a deployer check (`NPM_AUDIT_REMEDIATION.md`, check 2).
- Tested locally: the SMTP path end to end against a local SMTP server (7/7), and Resend's precedence.

## 5. Deployment requirements (this branch)
1. Owner's authorisation to merge and to deploy.
2. Railway build log: Node 20 or later; `xlsx` fetched from `cdn.sheetjs.com` without `EINTEGRITY`.
3. Read the Railway service's `TZ`, `RESEND_API_KEY` and `SMTP_HOST` settings (presence only) and record them.
4. Vercel build of the client succeeds.
5. Click-through: live updates, one inquiry, one attendance import compared with the previous month, one receipt PDF, one Excel export.
6. Rollback: revert the merge commit and redeploy. There are no schema or data changes.
