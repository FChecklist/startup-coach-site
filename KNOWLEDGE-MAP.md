# Knowledge map (updated 14 Nov 2026)

Written by BOSS for every repository, so any session knows what is done and what the other repositories are for. Status is as of 14 Nov 2026; for the live state always check the site's /version.json and this repository's own docs. This file holds no secrets and no business figures.

## This repository

**Startup Coach site** (startup-coach-site). Single-page site for the Startup Coach programme with booking and payment.

- Runs at: rajat-agarwal-startup-coach.pages.dev

- Status: Live on pages.dev; a merged one-page rajatsir.com version exists and DNS has not been switched.

## All products and repositories

| Repository | Product | What it is for | Status 14 Nov 2026 |
|---|---|---|---|
| corporate-tambola | Corporate Tambola | Housie/Tambola for company events: organizer makes a game, shares one link, players join on phones. | Live. The exact live commit is in /version.json on the site. |
| corporate-bingo | Corporate Bingo | 75-ball Bingo for company events. A separate product copied from another game's source, then rebuilt. | Live. See /version.json. |
| corporate-snakes-and-ladders | Corporate Snakes and Ladders | Snakes and ladders for company events; non-cash gifts only, players never pay. | Live. See /version.json. |
| corporate-luck-by-chance | Corporate Luck by Chance | Pure-luck dice game for company events. | Live. See /version.json. |
| corporate-luckydraw | Corporate Lucky Draw | Lucky draw game for company events. | Live. See /version.json. |
| corporate-tic-tac-toe | Corporate Tic Tac Toe | Knockout tic-tac-toe tournaments for teams, up to 10,000 players. | Live. See /version.json. |
| corporate-game-core | Corporate Game Core | The common engine for the six Corporate Games, extracted by copy from Corporate Tambola 1.9.0 (frozen). | Spec and rules modules; games stay separate products. |
| corporate-home | Corporate Games home | home.corporatetambola.com: the one page that shows all Corporate Games products. | Live (marketing pages). AI access for home is not live yet (see the AI gateway). |
| corporate-console | Corporate Games master console | One sign-in, six games, billing; plus test tools shared by every game repo. | Built; see its README for what is deployed. |
| Corporate-Games | Corporate Games index | The list of Corporate Games products, repositories and websites. Also holds the open change for the Tambola AI gateway. | Index. The AI gateway change here is marked do-not-merge-or-deploy until audited. |
| corporate-games-site | Corporate Games site (older) | Earlier site for the Corporate Games family. | Older; the home site above is the current front page. |
| games-testing | Games testing programme | Notes, plans and runner scripts for the 99.99% confidence programme across all games, home and console. | Programme notes and scripts; start with notes/TARGET-9999-SAMPLING-PLAN-2026-11-08.md. |
| scheduler | Scheduler | Runs scheduled work (housekeeping ticks, reports) for the products from one repository. | Running; touches no product code. |
| ledger-reports | Ledger reports | Daily reports of the payment ledgers (Razorpay, central ledger, each site's ledger). | Daily reports; owner only. |
| itservices-site | IT Services site and central ledger | The website registered with the payment provider and the central payment ledger; products pay through it. | Live. Payments for all products go only through this one payee and gateway. |
| compliance-tracker | VERIDIAN AI OS core | Multi-tenant Next.js app on Supabase: the backend behind the VERIDIAN brand and its thin-client products; holds the governance files (ai-os/). | Active. Read ai-os/boss/ACTIVE-CLAIMS.yaml and CONSTITUTION.yaml first. |
| projexa | PROJEXA | Construction, architecture and interior-design project-management frontend; its data is proxied from compliance-tracker. | Live. A separate repository from compliance-tracker. |
| veridian-dpdp | Veridian DPDP | The DPDP-compliance product: website app, payment and e-mail functions, inbound-mail worker. | Live. Started as a copy of compliance-tracker code on 3 Nov 2026; read its README for which repo a deploy comes from. |
| townhall-records | Townhall Records | Meetings, elections and the voter list for AOA, RWA and HOA societies (the minutes-of-meetings and voter-list apps belong to this family). | Engine and screens built; the voter-list preview is tested; nothing new is live yet. |
| proof-forge | Proof Forge (Startup Coach levels) | A 12-step, tap-only founder programme that runs in the founder's browser. | Prototype and trust-and-vendor work; see its README. |
| startup-coach-site | Startup Coach site | Single-page site for the Startup Coach programme with booking and payment. | Live on pages.dev; a merged one-page rajatsir.com version exists and DNS has not been switched. |
| lucifer-site | LUCIFER site | Website of the LUCIFER brand. | Private; ask BOSS. |
| marketing-ledger | Marketing ledger | One private memory for all digital marketing: e-mail, LinkedIn, YouTube, Facebook, Instagram, daily video ads, partner-circle design, API Hub plan, BOSS state. | Updated daily. Read first for marketing and for the newest product state. |

## Folders on the BOSS laptop that are not on GitHub yet

| Folder | Product | What it is for | Status |
|---|---|---|---|
| games-ai-gateway | Corporate Games AI gateway | One public, key-based API through which an AI can organize or host a Corporate Game (Tambola first). | Built; test and second-pass audit pending; planned as the first card of the API Hub. |
| partner-circle | Partner Circle | Growth-partner and Refer-and-Earn portal for all products, with an integration API. | Design v3 approved 14 Nov; preview only. |
| voter-list | Voter List | Single-page voter list for societies (part of Townhall Records). | Preview tested; review pending; not live. |
| mom-app | MOM (Minutes of Meeting) | Meeting notes with numbered action points (part of the Townhall family). | v2 app built; v3 UI preview exists. |
| rajatsir-site | rajatsir.com one-page site | Startup Coach plus student workshop, one installable page. | DNS not switched. |
| drdigital-site | Dr. Digital site | One-page marketing site for a digital-image agency for doctors. | Not deployed. |
| taxicab-site | Taxi ad agency site | Rebuilt installable site for a taxi and cab ad agency. | Not deployed. |
| shobha-site | Company site | Company website. | See BOSS notes. |

## API Hub (planned, 14 Nov 2026)
One portal where every product shows its AI-facing API on one page, built step by step. Today the Tambola AI links, the PROJEXA AI link, the DPDP AI link and the compliance-tracker API with MCP exist in separate forms; the Corporate Games AI gateway is built but not deployed. Nothing about the Hub is live yet. The plan and inventory are in the marketing-ledger repository under api-hub/.

## Rules that apply in every repository
- Payments for all products go only through the one payee and one gateway on the IT Services site. No product takes money any other way.
- Deploy only when the owner says so. Writing code or docs is never a reason to deploy.
- Never store keys, tokens, passwords, e-mail lists or phone numbers in a repository.
- Fairness wording is per product and must be true in code (for example: no one knows the next number).
- Check this map before building anything, so you do not rebuild what another repository already does.

Other older repositories (jyotish-*, veridian-brain, veridian-ai-os, veridian-bridge and similar) are outside this map unless their own README says otherwise. Ask BOSS.
