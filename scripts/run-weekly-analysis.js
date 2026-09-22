// Manual CLI trigger: node scripts/run-weekly-analysis.js [accountId]
// Runs the same Claude Weekly Intelligence pipeline the Monday scheduler
// and the "Regenerate Analysis" button use — handy for testing your
// ANTHROPIC_API_KEY and accounts.json before waiting for Monday.
require('dotenv').config();
const { ACCOUNTS } = require('../lib/graph');
const { runWeeklyAnalysis, runWeeklyAnalysisForAllAccounts, generateReportText } = require('../lib/weeklyAnalysis');

(async () => {
  const accountId = process.argv[2];
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY in your .env first.');
    process.exit(1);
  }

  if (accountId) {
    if (!ACCOUNTS.some((a) => a.id === accountId)) {
      console.error(`Unknown account "${accountId}". Known ids: ${ACCOUNTS.map((a) => a.id).join(', ')}`);
      process.exit(1);
    }
    const record = await runWeeklyAnalysis(accountId, { force: true });
    console.log(generateReportText(record));
    return;
  }

  const results = await runWeeklyAnalysisForAllAccounts({ force: true });
  results.forEach((r) => {
    console.log(`\n=== ${r.account_id} ===`);
    console.log(r.ok ? generateReportText(r.record) : `FAILED: ${r.error}`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
