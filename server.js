require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.META_ACCESS_TOKEN;
const VERSION = process.env.GRAPH_VERSION || 'v23.0';
const PORT = process.env.PORT || 3000;
// Hosted (NODE_ENV=production) listens publicly and requires a password; on your own computer it stays private.
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = HOST !== '127.0.0.1' && HOST !== 'localhost';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const USERNAME = process.env.DASHBOARD_USER || 'reechd';
const DAYS = 28;

if (!TOKEN || TOKEN.startsWith('PASTE_')) {
  console.error('\n  Missing META_ACCESS_TOKEN. Copy .env.example to .env and paste your token.\n');
  process.exit(1);
}

if (PUBLIC && !PASSWORD) {
  console.error('\n  Refusing to start publicly without a password.\n  Set DASHBOARD_PASSWORD in your hosting environment variables.\n');
  process.exit(1);
}

// ---------- config ----------
const isId = (v) => typeof v === 'string' && /^\d+$/.test(v.trim());
let ACCOUNTS;
try {
  ACCOUNTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'accounts.json'), 'utf8'));
} catch (e) {
  console.error('\n  Could not read accounts.json: ' + e.message + '\n');
  process.exit(1);
}
ACCOUNTS.forEach((a) => {
  a.facebookPageId = isId(a.facebookPageId) ? a.facebookPageId.trim() : '';
  a.instagramId = isId(a.instagramId) ? a.instagramId.trim() : '';
  if (!a.facebookPageId && !a.instagramId) console.warn(`  ! "${a.name}" has no IDs yet in accounts.json`);
});

// ---------- tiny file store (planner + follower snapshots) ----------
const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const readJSON = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return fallback; }
};
const writeJSON = (f, v) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(v, null, 2));
const todayStr = () => new Date().toISOString().slice(0, 10);

function recordSnapshot(key, followers) {
  if (typeof followers !== 'number') return;
  const s = readJSON('snapshots.json', {});
  (s[key] = s[key] || {})[todayStr()] = followers;
  writeJSON('snapshots.json', s);
}
function snapshotTrend(key) {
  const s = readJSON('snapshots.json', {})[key] || {};
  const days = Object.keys(s).sort();
  const values = days.map((d) => s[d]);
  let delta = null;
  if (values.length > 1) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const base = days.filter((d) => d <= weekAgo).pop() || days[0];
    delta = values[values.length - 1] - s[base];
  }
  return { values, delta };
}

// ---------- Graph API helpers ----------
async function graph(pathname, params = {}, tokens = TOKEN) {
  let lastErr;
  for (const token of [].concat(tokens).filter(Boolean)) {
    try {
      const url = new URL(`https://graph.facebook.com/${VERSION}/${pathname}`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      url.searchParams.set('access_token', token);
      const res = await fetch(url);
      const json = await res.json().catch(() => { throw new Error(`Meta returned an unexpected response (HTTP ${res.status})`); });
      if (json.error) throw new Error(json.error.message);
      return json;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No token');
}

async function settle(obj) {
  const keys = Object.keys(obj);
  const results = await Promise.allSettled(Object.values(obj));
  const ok = {}, errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok[keys[i]] = r.value;
    else errors[keys[i]] = r.reason.message;
  });
  return { ok, errors };
}

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// Page access tokens (a system user token can list these via /me/accounts)
let pageTokens = null;
function loadPageTokens() {
  if (!pageTokens) pageTokens = fetchPageTokens();
  return pageTokens;
}
async function fetchPageTokens() {
  const map = { pages: {}, ig: {} };
  try {
    const j = await graph('me/accounts', { fields: 'id,access_token,instagram_business_account{id}', limit: 100 });
    (j.data || []).forEach((p) => {
      map.pages[p.id] = p.access_token;
      if (p.instagram_business_account) map.ig[p.instagram_business_account.id] = p.access_token;
    });
  } catch (e) {
    console.warn('  ! Could not list pages via /me/accounts:', e.message);
  }
  return map;
}

const num = (v) => (typeof v === 'number' ? v : null);

// ---------- date range (Channels metrics window: 1 week / 1 month / 3 months / custom) ----------
function resolveRange(query = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (query.range === 'custom' && query.since && query.until) {
    const s = Math.floor(new Date(query.since + 'T00:00:00Z').getTime() / 1000);
    const u = Math.floor(new Date(query.until + 'T23:59:59Z').getTime() / 1000);
    if (!isNaN(s) && !isNaN(u) && u > s) {
      return { sinceSec: s, untilSec: u, since: query.since, until: query.until, label: `${query.since} to ${query.until}` };
    }
  }
  const days = { '7': 7, '30': 30, '90': 90 }[query.range] || DAYS;
  const sinceSec = now - days * 86400;
  const label = days === 7 ? 'Last 7 days' : days === 90 ? 'Last 3 months' : days === 30 ? 'Last 30 days' : `Last ${days} days`;
  return {
    sinceSec, untilSec: now, days,
    since: new Date(sinceSec * 1000).toISOString().slice(0, 10),
    until: new Date(now * 1000).toISOString().slice(0, 10),
    label,
  };
}

async function rangeSum(id, metrics, tokens, sinceSec, untilSec) {
  for (const metric of [].concat(metrics)) {
    try {
      const j = await graph(`${id}/insights`, { metric, period: 'day', since: sinceSec, until: untilSec }, tokens);
      const vals = j.data?.[0]?.values || [];
      if (vals.length) return vals.reduce((a, v) => a + (typeof v.value === 'number' ? v.value : 0), 0);
    } catch { /* try next metric name */ }
  }
  return null;
}

// ---------- Instagram ----------
async function getInstagram(acc, range) {
  const id = acc.instagramId;
  const pt = await loadPageTokens();
  const tokens = [TOKEN, pt.ig[id]];
  const now = Math.floor(Date.now() / 1000);

  const total = (metric) =>
    graph(`${id}/insights`, { metric, period: 'day', metric_type: 'total_value', since: range.sinceSec, until: range.untilSec }, tokens)
      .then((j) => num(j.data?.[0]?.total_value?.value));

  const { ok, errors } = await settle({
    profile: graph(id, { fields: 'username,followers_count' }, tokens),
    reach: total('reach'),
    interactions: total('total_interactions'),
    follows: graph(`${id}/insights`, { metric: 'follower_count', period: 'day', since: now - 29 * 86400, until: now }, tokens)
      .then((j) => (j.data?.[0]?.values || []).map((v) => v.value)),
    media: graph(`${id}/media`, { fields: 'caption,permalink,timestamp,like_count,comments_count', limit: 30 }, tokens)
      .then((j) => j.data || []),
  });

  if (!ok.profile) throw new Error(errors.profile);
  const followers = ok.profile.followers_count;
  const key = `${acc.id}:instagram`;
  recordSnapshot(key, followers);

  let trend = null, delta = null, trendLabel = 'Followers, last 30 days';
  if (ok.follows && ok.follows.length > 1) {
    const v = ok.follows, out = [];
    let running = followers;
    for (let i = v.length - 1; i >= 0; i--) { out.unshift(running); running -= v[i]; }
    trend = out;
    delta = v.slice(-7).reduce((a, b) => a + b, 0);
  } else {
    const snap = snapshotTrend(key);
    trend = snap.values; delta = snap.delta; trendLabel = 'Followers, tracked daily';
  }

  const media = ok.media || [];
  const notes = ['reach', 'interactions', 'follows', 'media'].filter((k) => errors[k]).map((k) => `Instagram ${k}: ${errors[k]}`);
  return {
    channel: { handle: '@' + ok.profile.username, followers, engagements: ok.interactions ?? null, reach: ok.reach ?? null, delta, trend, trendLabel, rangeLabel: range.label },
    latest: media[0] ? { caption: media[0].caption || '', likes: media[0].like_count ?? 0, comments: media[0].comments_count ?? 0, timestamp: media[0].timestamp, url: media[0].permalink } : null,
    recent: media.map((m) => ({ ch: 'instagram', caption: m.caption || '', url: m.permalink, timestamp: m.timestamp })),
    notes,
  };
}

// ---------- Facebook Page ----------
async function getFacebook(acc, range) {
  const id = acc.facebookPageId;
  const pt = await loadPageTokens();
  let pageToken = pt.pages[id];
  if (!pageToken) {
    try { pageToken = (await graph(id, { fields: 'access_token' })).access_token; } catch { /* use system token */ }
  }
  const tokens = [pageToken, TOKEN];
  const now = Math.floor(Date.now() / 1000);

  const { ok, errors } = await settle({
    profile: graph(id, { fields: 'name,followers_count,fan_count' }, tokens),
    posts: graph(`${id}/posts`, {
      fields: 'message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)',
      limit: 50,
    }, tokens).then((j) => (j.data || []).map((p) => ({
      caption: p.message || '', timestamp: p.created_time, url: p.permalink_url,
      reactions: p.reactions?.summary?.total_count || 0, comments: p.comments?.summary?.total_count || 0, shares: p.shares?.count || 0,
    }))),
    follows: graph(`${id}/insights`, { metric: 'page_follows', period: 'day', since: now - 28 * 86400, until: now }, tokens)
      .then((j) => (j.data?.[0]?.values || []).map((v) => v.value).filter((v) => typeof v === 'number')),
    reach: rangeSum(id, ['page_total_media_view_unique', 'page_impressions_unique'], tokens, range.sinceSec, range.untilSec),
    engaged: rangeSum(id, ['page_post_engagements'], tokens, range.sinceSec, range.untilSec),
  });

  if (!ok.profile) throw new Error(errors.profile);
  const followers = num(ok.profile.followers_count) ?? num(ok.profile.fan_count);
  const key = `${acc.id}:facebook`;
  recordSnapshot(key, followers);

  const posts = ok.posts || [];
  const cutoffLo = range.sinceSec * 1000, cutoffHi = range.untilSec * 1000;
  const fromPosts = posts.filter((p) => {
    const t = new Date(p.timestamp).getTime();
    return t >= cutoffLo && t <= cutoffHi;
  }).reduce((a, p) => a + p.reactions + p.comments + p.shares, 0);
  const engagements = ok.engaged ?? (ok.posts ? fromPosts : null);

  let trend, delta, trendLabel = 'Followers, last 28 days';
  if (ok.follows && ok.follows.length > 1) {
    trend = ok.follows;
    delta = trend[trend.length - 1] - trend[Math.max(0, trend.length - 8)];
  } else {
    const snap = snapshotTrend(key);
    trend = snap.values; delta = snap.delta; trendLabel = 'Followers, tracked daily';
  }

  const notes = [];
  if (errors.posts) notes.push(`Facebook posts: ${errors.posts}`);
  if (ok.reach == null) notes.push('Facebook reach: Meta did not return this metric for this Page');
  const p0 = posts[0];
  return {
    channel: { handle: ok.profile.name, followers, engagements, reach: ok.reach, delta, trend, trendLabel, rangeLabel: range.label },
    latest: p0 ? { caption: p0.caption, likes: p0.reactions, comments: p0.comments, timestamp: p0.timestamp, url: p0.url } : null,
    recent: posts.map((p) => ({ ch: 'facebook', caption: p.caption, url: p.url, timestamp: p.timestamp })),
    notes,
  };
}

// ---------- assemble one account ----------
async function buildAccount(acc, range) {
  const out = {
    id: acc.id, name: acc.name, handle: acc.handle || '',
    channels: { instagram: null, facebook: null },
    channelErrors: {},
    published: {}, recent: [], notes: [],
  };
  const jobs = [];
  for (const [ch, fn, has] of [['instagram', getInstagram, acc.instagramId], ['facebook', getFacebook, acc.facebookPageId]]) {
    if (!has) continue;
    jobs.push(fn(acc, range).then((r) => {
      out.channels[ch] = r.channel;
      if (r.latest) out.published[ch] = r.latest;
      out.recent.push(...r.recent);
      out.notes.push(...r.notes);
    }).catch((e) => { out.channelErrors[ch] = e.message; }));
  }
  await Promise.all(jobs);
  return out;
}

// ---------- routes ----------
const app = express();

// Password protection (HTTP Basic auth) when DASHBOARD_PASSWORD is set
if (PASSWORD) {
  const crypto = require('crypto');
  const same = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  app.use((req, res, next) => {
    if (req.path === '/healthz') return next();
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const i = decoded.indexOf(':');
      if (same(decoded.slice(0, i), USERNAME) && same(decoded.slice(i + 1), PASSWORD)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Reechd Dashboard", charset="UTF-8"');
    res.status(401).send('Login required');
  });
}
app.get('/healthz', (_req, res) => res.send('ok'));

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/accounts', async (req, res) => {
  try {
    if (req.query.refresh === '1') { cache.clear(); pageTokens = null; }
    const range = resolveRange(req.query);
    const cacheKey = `accounts:${range.since}:${range.until}`;
    const data = await cached(cacheKey, 5 * 60 * 1000, async () => ({
      fetchedAt: new Date().toISOString(),
      range,
      accounts: await Promise.all(ACCOUNTS.map((a) => buildAccount(a, range))),
    }));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// All Posts explorer — every post across both channels in an arbitrary date range.
const { fetchAccountPosts } = require('./lib/postsExplorer');
app.get('/api/posts/:account', async (req, res) => {
  const acc = ACCOUNTS.find((a) => a.id === req.params.account);
  if (!acc) return res.status(400).json({ error: 'Unknown account' });
  const range = resolveRange(req.query);
  try {
    const cacheKey = `posts:${acc.id}:${range.since}:${range.until}`;
    const data = await cached(cacheKey, 5 * 60 * 1000, async () => {
      const { posts, errors } = await fetchAccountPosts(acc, range.sinceSec, range.untilSec);
      return { account_id: acc.id, range, fetchedAt: new Date().toISOString(), posts, errors };
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Weekly post planner (saved in data/planner.json)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const known = (id) => ACCOUNTS.some((a) => a.id === id);

app.get('/api/planner', (_req, res) => res.json(readJSON('planner.json', {})));

app.put('/api/planner/:account/:date', (req, res) => {
  const { account, date } = req.params;
  const { ch, caption, link } = req.body || {};
  if (!known(account) || !DATE_RE.test(date)) return res.status(400).json({ error: 'Bad account or date' });
  if (!['instagram', 'facebook'].includes(ch) || typeof caption !== 'string' || !caption.trim()) return res.status(400).json({ error: 'Channel and caption are required' });
  const plan = readJSON('planner.json', {});
  (plan[account] = plan[account] || {})[date] = { ch, caption: caption.trim().slice(0, 1000), link: String(link || '').trim().slice(0, 300) };
  writeJSON('planner.json', plan);
  res.json(plan[account][date]);
});

app.delete('/api/planner/:account/:date', (req, res) => {
  const { account, date } = req.params;
  if (!known(account) || !DATE_RE.test(date)) return res.status(400).json({ error: 'Bad account or date' });
  const plan = readJSON('planner.json', {});
  if (plan[account]) delete plan[account][date];
  writeJSON('planner.json', plan);
  res.json({ ok: true });
});

// ---------- Claude Weekly Intelligence ----------
const weeklyAnalysis = require('./lib/weeklyAnalysis');
const { startWeeklyScheduler } = require('./lib/scheduler');

// Latest analysis for one account (what the dashboard card renders).
app.get('/api/weekly-analysis/:account', async (req, res) => {
  const { account } = req.params;
  if (!known(account)) return res.status(400).json({ error: 'Unknown account' });
  try {
    const record = weeklyAnalysis.getLatestAnalysis(account);
    res.json(record || { account_id: account, analysis: null, message: 'No analysis has been generated yet.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Past weeks for that account, newest first (for "View Full Analysis" history).
app.get('/api/weekly-analysis/:account/history', (req, res) => {
  const { account } = req.params;
  if (!known(account)) return res.status(400).json({ error: 'Unknown account' });
  try {
    res.json(weeklyAnalysis.listAnalyses(account, Number(req.query.limit) || 12));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// "Regenerate Analysis" button — forces a fresh Claude call for this account, today.
app.post('/api/weekly-analysis/:account/regenerate', async (req, res) => {
  const { account } = req.params;
  if (!known(account)) return res.status(400).json({ error: 'Unknown account' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  try {
    const record = await weeklyAnalysis.runWeeklyAnalysis(account, { force: true });
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// "Generate Report" button — plain-text report of the latest analysis, downloadable.
app.get('/api/weekly-analysis/:account/report', (req, res) => {
  const { account } = req.params;
  if (!known(account)) return res.status(400).json({ error: 'Unknown account' });
  const record = weeklyAnalysis.getLatestAnalysis(account);
  if (!record) return res.status(404).json({ error: 'No analysis has been generated yet.' });
  const text = weeklyAnalysis.generateReportText(record);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${account}-weekly-report-${record.period_label.split(' to ')[0]}.txt"`);
  res.send(text);
});

startWeeklyScheduler();

app.listen(PORT, HOST, () => console.log(`\n  Reechd dashboard running on port ${PORT}${PUBLIC ? ' (public, password protected)' : ` at http://localhost:${PORT}`}\n`));
