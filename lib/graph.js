// Shared Meta Graph API helpers + tiny file store.
// Extracted out of server.js so both the live dashboard and the weekly
// analysis module can reuse the same token/cache/account plumbing.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.META_ACCESS_TOKEN;
const VERSION = process.env.GRAPH_VERSION || 'v23.0';
const DAYS = 28;

// ---------- accounts.json ----------
const isId = (v) => typeof v === 'string' && /^\d+$/.test(v.trim());
let ACCOUNTS;
try {
  ACCOUNTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'accounts.json'), 'utf8'));
} catch (e) {
  console.error('\n  Could not read accounts.json: ' + e.message + '\n');
  process.exit(1);
}
ACCOUNTS.forEach((a) => {
  a.facebookPageId = isId(a.facebookPageId) ? a.facebookPageId.trim() : '';
  a.instagramId = isId(a.instagramId) ? a.instagramId.trim() : '';
});

// ---------- tiny file store ----------
const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const readJSON = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return fallback; }
};
const writeJSON = (f, v) => {
  const full = path.join(DATA_DIR, f);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(v, null, 2));
};
const todayStr = (d = new Date()) => d.toISOString().slice(0, 10);

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

// ---------- Graph API core ----------
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
function resetPageTokens() { pageTokens = null; }

const num = (v) => (typeof v === 'number' ? v : null);

module.exports = {
  TOKEN, VERSION, DAYS, ACCOUNTS,
  DATA_DIR, readJSON, writeJSON, todayStr,
  recordSnapshot, snapshotTrend,
  graph, settle, cache, cached,
  loadPageTokens, resetPageTokens,
  num, isId,
};
