# Security Remediation: Dependencies and Notification Email

**Date:** 2026-11-25 · **Branch:** `security/remediation-2026-11` (from `main` `ff782cd`). Not merged, not deployed.

## Result
| Scope | Before | After |
|---|---|---|
| `Server` (`npm audit --omit=dev`) | 12 (1 critical, 6 high, 5 moderate) | **3 moderate**, all one accepted `uuid` advisory (below) |
| `Client` (`npm audit`) | 16 (1 critical, 11 high, 4 moderate) | **0** |
| Code: HTML injection into staff emails from public forms | open | fixed |

## Changes (one commit each)
| P | Commit | Change | Verified |
|---|---|---|---|
| 1 | `1cc65b6` | Express 4.22.3; proxy-addr 2.0.8, body-parser 1.20.9, qs 6.16.2 | `npm test`; HTTP smoke on `createApp()` and the same middleware (10/10): raw body for webhook HMAC, JSON and urlencoded, query arrays, `trust proxy` hop count, 2 MB limit, malformed JSON, health routes, login limiter 429 on the 31st attempt |
| 2 | `98038f6` | Socket.IO 4.8.4 (engine.io 6.6.13, socket.io-parser 4.2.7); client socket.io-client 4.8.4 | Real `initSocket()` with both the new and the deployed 4.8.3 client (15/15 each): all transports, delivery, refusal of bad tokens, per-user rooms, reconnect |
| 3 | `7ec10b2` | `src/lib/escapeHtml.js`; inquiry and Become-a-Host email templates in `src/lib/leadEmailHtml.js`, all values escaped; receipt unit label escaped | `leadEmailHtml.test.js` (7, in `npm test`), including a route-level POST that fails on the old code |
| 5 | `c906abb` | Removed unused `csv-parse` | `npm test` |
| 4 | `f5a60cf` | `xlsx` → **SheetJS 0.20.3 from the vendor CDN** (integrity-pinned) instead of exceljs; workbook read moved to `src/lib/attendanceWorkbook.js` | Parity 0.18.5 vs 0.20.3 on Original Records fixtures (SheetJS .xlsx, BIFF8/BIFF5 .xls, serial and text times, exceljs-made .xlsx, the export): identical rows and identical `parseAttendanceRows` output under UTC (7/7). `attendanceWorkbook.test.js` (5, in `npm test`) |
| 6 | `7b325d3` | nodemailer 10.6.1; brace-expansion refreshed | Real `sendEmail()` over SMTP to a local server (7/7): envelope, UTF-8 subject, bodies, attachment, AUTH; Resend still first |
| 7 | `e9cf477` | Client: jspdf 4.2.1; SheetJS 0.20.3; removed unused jspdf-autotable and zod; in-range fixes (axios, react-router, vite, follow-redirects, postcss, others) | `vite build`; headless Chrome with the real `brandDocument.js` (8/8): 3-page receipt PDF with logo and Arabic, both Excel exports read back |

`npm test` after all changes: 100 tests, 99 pass. The one failure is the pre-existing `hrRules.test.js:362` (an HR rule-versus-test decision, unrelated).

## Why SheetJS from the CDN, not exceljs
- exceljs cannot read binary `.xls`, and door systems may export it.
- exceljs builds dates as UTC; the attendance parser reads them with local-time getters, so times could shift.
- SheetJS publishes its fixes only on `cdn.sheetjs.com`. The lockfile pins the tarball by sha512, and the package has no dependencies.
- **Build dependency:** the server build on Railway (`railway.json`: `npm install --omit=dev --prefix Server`) and the client build on Vercel now fetch `xlsx` from `cdn.sheetjs.com`. (An earlier version of this record said "Render"; the repository's deployment configuration is Railway for the server and Vercel for the client.)

## Accepted
- `uuid <11.1.1` (moderate) via exceljs and node-cron. The flaw needs a caller-supplied buffer with v3/v5/v6; both packages only call v4.

## Checks for the deployer
Full evidence: `docs/security/PRE_MERGE_VERIFICATION.md`.

1. **Timezone:** read the Railway service's `TZ` variable (none in the repository). Unset or `UTC`: the attendance import is identical before and after. A zone such as `Africa/Cairo`: 0.20.3 reads stored times correctly where 0.18.5 misread about half of them by a minute, so imports can differ from earlier ones, and the new figures are the correct ones.
2. **Email:** read whether the Railway service has `RESEND_API_KEY` or `SMTP_HOST` set (the code uses Resend first, then SMTP, otherwise only logs). If SMTP, send one test email after deploying. If neither is set, inquiry and Become-a-Host emails are not being delivered today either.
3. **Node version:** confirm in the Railway build log that Node is 20 or later (nodemailer 10 requires it; the root `package.json` declares `>=20`).
4. **Builds reach the CDN:** the first Railway and Vercel builds after merging must download `xlsx-0.20.3.tgz` from `cdn.sheetjs.com`; a failed build shows `EINTEGRITY` or a fetch error, and the running version is unaffected.
5. **Click-through after deploy:** Today board live updates, one website inquiry, one attendance import of a real door file (compare with the previous month's import), one receipt PDF and one Excel export.
6. **Rollback:** revert the individual commit and redeploy. There are no schema or data changes.
