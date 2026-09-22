# Reechd Social Performance Dashboard

Same design as your sample, now running on live data from the Meta Graph API.
Node + Express backend (your token never reaches the browser) and a plain HTML/JS frontend.

## Set up (3 things to fill in)

1. **Token** – copy `.env.example` to `.env` and paste your System User token:
   ```
   META_ACCESS_TOKEN=EAAB...
   ```
2. **IDs** – open `accounts.json` and replace each `PASTE_...` with the real ID.
   - `facebookPageId`  = Facebook Page ID
   - `instagramId`     = Instagram professional account ID (numbers only)
   - Leave `""` for a channel an account doesn't have. Delete an account block you don't need.
   - Don't know the IDs? Run `npm run ids` after step 1 and it prints them.
3. **Run**
   ```
   npm install
   npm start
   ```
   Open http://localhost:3000

## Token permissions
`pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`.
Each Instagram account must be a Business/Creator account, and both it and its Facebook Page must be assigned to the system user.

## What each number means
- **Followers** – current follower count.
- **Engagements / Reach** – last 28 days. Facebook engagements fall back to reactions + comments + shares on recent posts if Meta doesn't return the Page metric.
- **This week pill** – follower change over the last 7 days.
- **Sparkline** – Instagram uses Meta's daily follower data (about 30 days). Facebook uses `page_follows`; if unavailable, the dashboard records a snapshot each day into `data/snapshots.json` and the line builds up over time.
- **Last published** – newest post from each feed.
- **This week** – posts that went live show as "Live". The pencil lets you plan a post; plans are saved in `data/planner.json` and survive restarts.

## Notes
- Data is cached for 5 minutes; Refresh forces a new pull.
- Meta renames and retires insight metrics regularly. If a figure shows "–", open "Some numbers could not be loaded" at the bottom to see the exact reason.
- The server only listens on your own computer (127.0.0.1).
- LinkedIn card is a placeholder, as in the sample.
- Never share or commit `.env`.

## Put it online (live URL) with Render

The site is password protected when hosted: it refuses to start online without `DASHBOARD_PASSWORD`.

1. Create a free account at https://github.com and make a new **private** repository.
2. Upload every file from this folder **except** `.env`, `node_modules` and `data`.
   (`accounts.json` is fine to upload, it only holds IDs.)
3. Create a free account at https://render.com and click **New > Blueprint**. Pick your repository.
   Render reads `render.yaml` and asks for two values:
   - `META_ACCESS_TOKEN` – your system user token
   - `DASHBOARD_PASSWORD` – a password you choose
4. Click **Apply**. After a few minutes you get a link like `https://reechd-dashboard.onrender.com`.
5. Open it and log in. Username is `reechd` (change with `DASHBOARD_USER`), password is what you set.

Good to know:
- Free Render sites sleep after ~15 minutes of no visits and take about 30-60 seconds to wake up.
- On the free plan the planner (`data/planner.json`) resets whenever the site restarts or redeploys. A paid plan with a persistent disk mounted at `/opt/render/project/src/data` keeps it.
- Other hosts work too (Railway, a VPS): set `NODE_ENV=production`, `META_ACCESS_TOKEN` and `DASHBOARD_PASSWORD`, and run `npm start`.
- To change accounts later, edit `accounts.json` on GitHub; Render redeploys automatically.

## Claude Weekly Intelligence

An AI social-media analyst that reads each account's real 7-day analytics (with 7-day and 28-day comparisons) and produces a structured weekly report: what improved, what declined, top posts, content patterns, engagement analysis, a platform comparison, posting consistency, recommendations, and a suggested 7-day content plan.

**Setup**
1. Get a key at https://console.anthropic.com and set `ANTHROPIC_API_KEY` in `.env`.
2. Optionally set `CLAUDE_MODEL` (defaults to a current Claude Sonnet model — check https://docs.claude.com for the latest model IDs).
3. Optionally set `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `REPORT_EMAIL_TO` to also email the report. Leave them blank to skip emailing — the report still lives in the dashboard.

**How it runs**
- Automatically every Monday, for every account in `accounts.json` (checked twice an hour by the running server; no cron service needed).
- On demand: `npm run weekly:run` (all accounts) or `npm run weekly:run <accountId>`, or the "Regenerate Analysis" button in the dashboard.

**API**
- `GET /api/weekly-analysis/:account` — latest stored analysis for that account.
- `GET /api/weekly-analysis/:account/history` — past weeks, newest first.
- `POST /api/weekly-analysis/:account/regenerate` — forces a fresh Claude call for today.
- `GET /api/weekly-analysis/:account/report` — downloadable plain-text report.

**How it's built**
- `lib/weeklyMetrics.js` pulls this week's, last week's, and the trailing-28-day Instagram/Facebook numbers plus every post published in the last 7 days straight from the Meta Graph API — no invented figures. LinkedIn reports as not connected, matching the placeholder card.
- `lib/claudeClient.js` sends that data to Claude with forced tool-use, so the reply IS validated JSON rather than prose to parse; an invalid/incomplete reply gets one automatic retry before failing loudly.
- `lib/weeklyAnalysis.js` stores one record per account per day in `data/weekly-analysis/<account>/<date>.json` (same lifetime as the rest of `data/` — see the Render notes above about a persistent disk).
- Your Anthropic key never reaches the browser; the report is fetched and rendered server-side like everything else in this dashboard.

# healtherspace-dashboard
