# Rajat Agarwal, Startup Coach: completion report, 15 Oct 2026

Live: https://rajat-agarwal-startup-coach.pages.dev (HTTP 200). Deployed 15 Oct 2026 by direct wrangler deploy, this one project only (deployment e4054bbe).

## Proof by gate
| # | Gate | Proof | Result |
|---|------|-------|--------|
| 1 | Unit tests: payment order/verify/webhook, ledger C, consent, booking guards, retention, confirmation mail once per payment | `bun test`, 94 tests in 6 files | PASS 94/94 |
| 2 | Build and site checker (pages, links, SEO, sitemap, manifest, icons, no dark colours, no internal wording) | `node build.cjs`, `node tools/check-site.mjs dist` | PASS, 7 pages |
| 3 | Real Chrome run on the built site with a stand-in payment (no Razorpay, no card details) | `test/e2e/coach.e2e.mjs`, 26 checks | PASS 26/26 |
| 4 | Booking form: three consent boxes, name/startup/e-mail/mobile checks, total follows quantity, price never taken from the browser, access link after payment | same run, E06-E10 | PASS |
| 5 | Phone fit 320 / 360 / 390 / 430 px, no sideways scroll, on all 5 content pages | same run, E11 | PASS |
| 6 | Accessibility basics: labels, alt text, language, skip link first | same run, E12-E13 | PASS |
| 7 | Installable app: manifest, 4 icons, service worker, offline page; new logo loads | same run, E05, E14 | PASS |
| 8 | Legal and pricing pages (Terms, Privacy, Legal position, Pricing); seller named as IT Services by Rajat Agarwal; no forbidden wording | same run, E01, E03 | PASS |
| 9 | Public copy: "programme" spelling everywhere, WhatsApp text fixed | commit 5ed693b plus this pass | DONE |
| 10 | Contact: rajatsiroffice@gmail.com and (+91) 96503 97480 on every page | E03, grep of all sources | PASS |
| 11 | Ledger C live: owner view answers with the key, 404 without it; no paid bookings yet, so C = B = A = 0 | live calls | PASS |
| 12 | Retention job live dry run: counts only, 0 rows due | live call | PASS (kept OFF, see below) |
| 13 | Live web-quality suite C01-C14 | `games-ops/e2e/live_common.mjs COA` | 13 PASS; C07 failed only on network resets during the link check, and a by-hand check shows every footer link opens (the four legal pages answer with a normal redirect) |

## Retention job: decision
Left OFF. It needs the secret `RETENTION_LIVE=1` and a schedule in the shared scheduler. Both are outside this task's limits (no secret changes, no other repos). Nothing is due today (0 unpaid bookings older than 30 days), so waiting costs nothing. Billing data is never removed by it (proved by the tests).

## Percent
| Item | % |
|------|---|
| Site, pages, copy, logo, PWA, phone fit, accessibility | 100 done |
| Booking and payment code, ledger C, once-only mails, consents | 100 done and tested with stand-ins |
| Deploy and live checks | 100 done |
| Retention job switched on | 0, deliberately off, safe to leave |
| **After-payment product (Proof Forge)** | **BLOCKED, see below** |
| Real Rs 1 payment end to end (A/B/C ledgers match, confirmation mail arrives) | 0, owner-only: Claude may not enter card or UPI details |

## BLOCKER found: the link a buyer gets after paying is dead
The confirmation mail and the "Open Proof Forge" button point to https://proof-forge.pages.dev. That Cloudflare Pages project exists but has never been deployed, so it answers HTTP 522 on every address. The code is in `C:\ct\proof-forge` (latest commit 769aba6). Payment is on LIVE keys, so a real buyer today would pay and land on an error page. Deploying Proof Forge is a different repo and project, so it was not touched here. The PM session should deploy it (or switch booking off with the existing `off` flag) before any real sale.

## Owner-only
- A real Rs 1 payment to prove the money path and the mail.
- Razorpay dashboard webhook secret check (ledger spec L12).
- Retention switch-on (secret plus schedule), when wanted.
