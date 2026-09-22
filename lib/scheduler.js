// Runs the weekly analysis automatically every Monday, for every account in
// accounts.json, without pulling in a cron library. It wakes up on an
// interval, and the moment it notices "it's Monday and we haven't run for
// this ISO week yet" it fires once, then goes back to sleep.
const fs = require('fs');
const path = require('path');
const { DATA_DIR, ACCOUNTS } = require('./graph');
const { runWeeklyAnalysisForAllAccounts, generateReportText } = require('./weeklyAnalysis');
const { emailReport } = require('./emailer');

const MARKER_FILE = path.join(DATA_DIR, 'weekly-analysis', '.last-auto-run.json');
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // check twice an hour; cheap and plenty timely for a once-a-week job

function isoWeekKey(d = new Date()) {
  // Monday-based ISO week key, e.g. "2026-W38" — stable regardless of what
  // hour/day the check happens to run.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function readMarker() {
  try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); } catch { return {}; }
}
function writeMarker(v) {
  fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true });
  fs.writeFileSync(MARKER_FILE, JSON.stringify(v, null, 2));
}

async function checkAndRun() {
  const now = new Date();
  const isMonday = now.getDay() === 1; // 0=Sun..6=Sat, local server time
  if (!isMonday || !ACCOUNTS.length) return;

  const week = isoWeekKey(now);
  const marker = readMarker();
  if (marker.week === week) return; // already ran this ISO week

  console.log(`  [weekly-analysis] Monday auto-run starting for ${week}...`);
  const results = await runWeeklyAnalysisForAllAccounts({ force: false });
  for (const r of results) {
    if (!r.ok) { console.warn(`  [weekly-analysis] ${r.account_id} failed: ${r.error}`); continue; }
    try {
      const emailResult = await emailReport(r.record, generateReportText(r.record));
      if (emailResult.sent) console.log(`  [weekly-analysis] emailed report for ${r.account_id}`);
    } catch (e) {
      console.warn(`  [weekly-analysis] email failed for ${r.account_id}: ${e.message}`);
    }
  }
  writeMarker({ week, ranAt: now.toISOString() });
  console.log(`  [weekly-analysis] Monday auto-run finished for ${week}.`);
}

function startWeeklyScheduler() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ! ANTHROPIC_API_KEY not set — Claude Weekly Intelligence automation is disabled.');
    return;
  }
  checkAndRun().catch((e) => console.warn('  [weekly-analysis] startup check failed:', e.message));
  setInterval(() => { checkAndRun().catch((e) => console.warn('  [weekly-analysis] check failed:', e.message)); }, CHECK_INTERVAL_MS);
}

module.exports = { startWeeklyScheduler, isoWeekKey };
