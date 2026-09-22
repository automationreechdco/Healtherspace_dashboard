// Run with:  npm run ids
// Lists the Facebook Pages and Instagram accounts your token can see, with their IDs,
// and prints diagnostics if something is missing.
require('dotenv').config();
const T = process.env.META_ACCESS_TOKEN;
const V = process.env.GRAPH_VERSION || 'v23.0';
const B = (process.env.BUSINESS_ID || '').trim();
if (!T || T.startsWith('PASTE_')) { console.error('Put your token in .env first.'); process.exit(1); }

async function g(p, params = {}) {
  const url = new URL(`https://graph.facebook.com/${V}/${p}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('access_token', T);
  const j = await (await fetch(url)).json();
  if (j.error) throw new Error(j.error.message.split('Please read')[0].trim());
  return j;
}
const line = (s = '') => console.log(s);

(async () => {
  line('\n=== Token check ===');
  try {
    const me = await g('me', { fields: 'id,name' });
    line(`  Token belongs to: ${me.name} (${me.id})`);
  } catch (e) { line('  Could not read token identity: ' + e.message); }
  try {
    const perms = await g('me/permissions');
    const granted = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
    line('  Permissions: ' + (granted.length ? granted.join(', ') : '(none listed - normal for some system user tokens)'));
  } catch (e) { line('  Permissions: could not list (' + e.message + ')'); }

  line('\n=== Facebook Pages this token can access ===\n');
  try {
    const j = await g('me/accounts', { fields: 'id,name,instagram_business_account{id,username}', limit: 100 });
    if (!j.data.length) line('  (none found - assign Pages to the system user first)');
    j.data.forEach((p) => {
      line(`  ${p.name}`);
      line(`     facebookPageId: ${p.id}`);
      if (p.instagram_business_account) line(`     instagramId:    ${p.instagram_business_account.id}  (@${p.instagram_business_account.username})`);
    });
  } catch (e) { line('  Could not list pages: ' + e.message); }

  // ---- Look up other Instagram accounts by username (works without business permissions) ----
  const usernames = (process.env.IG_USERNAMES || 'healther.mompooch,healther.malayalam')
    .split(',').map((u) => u.trim().replace(/^@/, '')).filter(Boolean);
  let anchor = null;
  try {
    const j = await g('me/accounts', { fields: 'instagram_business_account{id}', limit: 100 });
    anchor = (j.data.find((p) => p.instagram_business_account) || {}).instagram_business_account;
  } catch { /* ignore */ }

  line('\n=== Other Instagram accounts (looked up by username) ===\n');
  if (!anchor) {
    line('  Skipped: no Page-linked Instagram account to look up from.');
  } else {
    for (const u of usernames) {
      try {
        const j = await g(anchor.id, { fields: `business_discovery.username(${u}){id,username,followers_count}` });
        const d = j.business_discovery;
        line(`  @${d.username}   instagramId: ${d.id}   (${d.followers_count} followers)`);
      } catch (e) {
        line(`  @${u}: ${e.message}`);
      }
    }
    line('\n  Usernames come from IG_USERNAMES in .env (comma separated). Default: healther.mompooch, healther.malayalam');
  }

  if (!B) { line(); return; }

  // ---- Optional: business portfolio lookup (needs an Admin system user) ----
  line(`\n=== Business portfolio ${B} ===\n`);
  try {
    const b = await g(B, { fields: 'id,name' });
    line(`  Found: ${b.name} (${b.id})`);
  } catch (e) { line('  Cannot open this business: ' + e.message); }
  const seen = new Set();
  for (const edge of ['owned_instagram_accounts', 'instagram_business_accounts', 'instagram_accounts']) {
    try {
      const j = await g(`${B}/${edge}`, { fields: 'id,username', limit: 100 });
      (j.data || []).forEach((a) => {
        if (seen.has(a.id)) return;
        seen.add(a.id);
        line(`  @${a.username || '(no username)'}   instagramId: ${a.id}   [via ${edge}]`);
      });
    } catch { /* edge not available for this token */ }
  }
  if (!seen.size) line('  No Instagram list available for this token (that is fine, the username lookup above is enough).');
  line();
})();
