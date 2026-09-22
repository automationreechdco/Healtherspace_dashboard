// Builds the structured 7-day / 28-day analytics payload that gets sent to
// Claude for the weekly analysis. Every number here either comes straight off
// the Meta Graph API or is a plain arithmetic derivation of two such numbers
// (marked "calculated" so Claude can tell the difference) — nothing is guessed.
const { graph, settle, loadPageTokens, num } = require('./graph');

const DAY = 86400000;
const round1 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 10) / 10 : null);
const pctChange = (curr, prev) => {
  if (typeof curr !== 'number' || typeof prev !== 'number' || prev === 0) return null;
  return round1(((curr - prev) / Math.abs(prev)) * 100);
};
const sum = (arr) => arr.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

function engagementRate(engagements, reachOrFollowers) {
  if (typeof engagements !== 'number' || typeof reachOrFollowers !== 'number' || reachOrFollowers === 0) return null;
  return round1((engagements / reachOrFollowers) * 100);
}

// ---------- Instagram ----------
async function instagramWeekly(acc) {
  const id = acc.instagramId;
  const pt = await loadPageTokens();
  const tokens = [require('./graph').TOKEN, pt.ig[id]];
  const now = Math.floor(Date.now() / 1000);
  const notes = [];

  const totalValue = (metric, sinceSec, untilSec) =>
    graph(`${id}/insights`, { metric, period: 'day', metric_type: 'total_value', since: sinceSec, until: untilSec }, tokens)
      .then((j) => num(j.data?.[0]?.total_value?.value))
      .catch((e) => { notes.push(`Instagram ${metric}: ${e.message}`); return null; });

  const windows = {
    current7: [now - 7 * 86400, now],
    previous7: [now - 14 * 86400, now - 7 * 86400],
    previous28: [now - 28 * 86400, now],
  };

  const [profile, media, followSeries] = await Promise.all([
    graph(id, { fields: 'username,followers_count' }, tokens).catch((e) => { notes.push(`Instagram profile: ${e.message}`); return null; }),
    graph(`${id}/media`, {
      fields: 'caption,permalink,timestamp,like_count,comments_count,media_type,media_product_type',
      limit: 50,
    }, tokens).then((j) => j.data || []).catch((e) => { notes.push(`Instagram media list: ${e.message}`); return []; }),
    graph(`${id}/insights`, { metric: 'follower_count', period: 'day', since: now - 29 * 86400, until: now }, tokens)
      .then((j) => (j.data?.[0]?.values || []).map((v) => v.value))
      .catch(() => []),
  ]);

  if (!profile) return { platform: 'instagram', connected: false, notes };
  const followersNow = num(profile.followers_count);
  const followerDelta7 = followSeries.length ? sum(followSeries.slice(-7)) : null;
  const followersPrev7 = typeof followersNow === 'number' && typeof followerDelta7 === 'number' ? followersNow - followerDelta7 : null;

  const aggFor = async (rangeKey) => {
    const [since, until] = windows[rangeKey];
    const [reach, interactions] = await Promise.all([
      totalValue('reach', since, until),
      totalValue('total_interactions', since, until),
    ]);
    return { reach, engagements: interactions };
  };
  const [current7, previous7, previous28] = await Promise.all([aggFor('current7'), aggFor('previous7'), aggFor('previous28')]);

  const cutoff7 = Date.now() - 7 * DAY;
  const cutoff28 = Date.now() - 28 * DAY;
  const postsWindow7 = media.filter((m) => new Date(m.timestamp).getTime() >= cutoff7);
  const postsWindow28 = media.filter((m) => new Date(m.timestamp).getTime() >= cutoff28);

  current7.posts_published = postsWindow7.length;
  current7.engagement_rate = engagementRate(current7.engagements, current7.reach);
  previous7.posts_published = null; // Graph API doesn't retro-count deleted/older posts reliably; left unknown rather than guessed
  previous7.engagement_rate = engagementRate(previous7.engagements, previous7.reach);
  previous28.engagement_rate = engagementRate(previous28.engagements, previous28.reach);

  const contentType = (m) => {
    if (m.media_product_type === 'REELS') return 'Reel';
    if (m.media_type === 'VIDEO') return 'Video';
    if (m.media_type === 'CAROUSEL_ALBUM') return 'Carousel';
    return 'Image';
  };

  // Per-post insights (reach / saved / shares / video_views) — best-effort, IG's
  // available metrics vary by media type & API version, so failures are silent per-post.
  const postDetails = await Promise.all(postsWindow7.map(async (m) => {
    let reach = null, saved = null, shares = null, videoViews = null;
    try {
      const j = await graph(`${m.id}/insights`, { metric: 'reach,saved,shares,total_interactions' }, tokens);
      (j.data || []).forEach((d) => {
        const v = d.values?.[0]?.value;
        if (d.name === 'reach') reach = num(v);
        if (d.name === 'saved') saved = num(v);
        if (d.name === 'shares') shares = num(v);
      });
    } catch { /* metric not available for this media type/version; leave null */ }
    if (m.media_type === 'VIDEO' || m.media_product_type === 'REELS') {
      try {
        const j = await graph(`${m.id}/insights`, { metric: 'video_views' }, tokens);
        videoViews = num(j.data?.[0]?.values?.[0]?.value);
      } catch { /* ignore */ }
    }
    const likes = num(m.like_count) ?? 0;
    const comments = num(m.comments_count) ?? 0;
    const engagements = likes + comments + (shares || 0) + (saved || 0);
    return {
      platform: 'instagram',
      post_id: m.id,
      url: m.permalink,
      timestamp: m.timestamp,
      content_type: contentType(m),
      caption: m.caption || '',
      views: videoViews,
      reach,
      impressions: null, // Meta no longer exposes impressions separately for IG media
      likes,
      comments,
      shares,
      saves: saved,
      clicks: null,
      engagement_rate: engagementRate(engagements, reach ?? videoViews),
    };
  }));

  return {
    platform: 'instagram',
    connected: true,
    handle: '@' + profile.username,
    account: {
      followers_current: followersNow,
      followers_previous_7d: followersPrev7,
      follower_growth_7d: followerDelta7,
      follower_growth_7d_pct: pctChange(followersNow, followersPrev7),
    },
    current_7d: current7,
    previous_7d: previous7,
    previous_28d: previous28,
    posts: postDetails,
    posts_published_28d: postsWindow28.length,
    notes,
  };
}

// ---------- Facebook Page ----------
async function facebookWeekly(acc) {
  const id = acc.facebookPageId;
  const pt = await loadPageTokens();
  let pageToken = pt.pages[id];
  if (!pageToken) {
    try { pageToken = (await graph(id, { fields: 'access_token' })).access_token; } catch { /* use system token */ }
  }
  const tokens = [pageToken, require('./graph').TOKEN];
  const now = Math.floor(Date.now() / 1000);
  const notes = [];

  const rangeValue = async (metrics, since, until) => {
    for (const metric of [].concat(metrics)) {
      try {
        const j = await graph(`${id}/insights`, { metric, period: 'day', since, until }, tokens);
        const vals = j.data?.[0]?.values || [];
        const total = sum(vals.map((v) => (typeof v.value === 'number' ? v.value : 0)));
        if (vals.length) return total;
      } catch { /* try next metric name */ }
    }
    return null;
  };

  const windows = {
    current7: [now - 7 * 86400, now],
    previous7: [now - 14 * 86400, now - 7 * 86400],
    previous28: [now - 28 * 86400, now],
  };

  const { ok, errors } = await settle({
    profile: graph(id, { fields: 'name,followers_count,fan_count' }, tokens),
    posts: graph(`${id}/posts`, {
      fields: 'message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0),attachments{media_type}',
      limit: 50,
    }, tokens).then((j) => (j.data || []).map((p) => ({
      id: p.id, caption: p.message || '', timestamp: p.created_time, url: p.permalink_url,
      reactions: p.reactions?.summary?.total_count || 0, comments: p.comments?.summary?.total_count || 0, shares: p.shares?.count || 0,
      media_type: p.attachments?.data?.[0]?.media_type || null,
    }))),
    followsSeries: graph(`${id}/insights`, { metric: 'page_follows', period: 'day', since: now - 28 * 86400, until: now }, tokens)
      .then((j) => (j.data?.[0]?.values || []).map((v) => v.value).filter((v) => typeof v === 'number')),
  });
  notes.push(...Object.entries(errors).map(([k, v]) => `Facebook ${k}: ${v}`));
  if (!ok.profile) return { platform: 'facebook', connected: false, notes };

  const followersNow = num(ok.profile.followers_count) ?? num(ok.profile.fan_count);
  const followSeries = ok.followsSeries || [];
  // page_follows is a running trend (like the sparkline in the live dashboard),
  // not a daily delta — unlike Instagram's follower_count metric. So the 7-day
  // change is last-value-minus-value-from-8-days-back, never a sum of the series.
  let followerDelta7 = null;
  if (followSeries.length > 7) {
    followerDelta7 = followSeries[followSeries.length - 1] - followSeries[followSeries.length - 8];
  }
  const followersPrev7 = typeof followersNow === 'number' && typeof followerDelta7 === 'number' ? followersNow - followerDelta7 : null;

  const aggFor = async (rangeKey) => {
    const [since, until] = windows[rangeKey];
    const [reach, engaged] = await Promise.all([
      rangeValue(['page_impressions_unique', 'page_total_media_view_unique'], since, until),
      rangeValue(['page_post_engagements'], since, until),
    ]);
    return { reach, engagements: engaged };
  };
  const [current7, previous7, previous28] = await Promise.all([aggFor('current7'), aggFor('previous7'), aggFor('previous28')]);

  const posts = ok.posts || [];
  const cutoff7 = Date.now() - 7 * DAY;
  const cutoff28 = Date.now() - 28 * DAY;
  const postsWindow7 = posts.filter((p) => new Date(p.timestamp).getTime() >= cutoff7);
  const postsWindow28 = posts.filter((p) => new Date(p.timestamp).getTime() >= cutoff28);

  // If Meta didn't return a Page-level engagement number, fall back to summing
  // reactions+comments+shares off the posts we do have (flagged as calculated).
  let current7EngCalculated = false;
  if (current7.engagements == null && posts.length) {
    current7.engagements = sum(postsWindow7.map((p) => p.reactions + p.comments + p.shares));
    current7EngCalculated = true;
  }
  current7.posts_published = postsWindow7.length;
  current7.engagement_rate = engagementRate(current7.engagements, current7.reach);
  current7.engagements_calculated = current7EngCalculated || undefined;
  previous7.posts_published = null;
  previous7.engagement_rate = engagementRate(previous7.engagements, previous7.reach);
  previous28.engagement_rate = engagementRate(previous28.engagements, previous28.reach);

  const contentType = (p) => {
    if (p.media_type === 'video_inline' || p.media_type === 'video_autoplay') return 'Video';
    if (p.media_type === 'album') return 'Carousel';
    if (p.media_type === 'photo') return 'Image';
    return p.media_type ? p.media_type : 'Text';
  };

  const postDetails = await Promise.all(postsWindow7.map(async (p) => {
    let impressions = null, engagedUsers = null, clicks = null;
    try {
      const j = await graph(`${p.id}/insights`, { metric: 'post_impressions_unique,post_engaged_users,post_clicks' });
      (j.data || []).forEach((d) => {
        const v = d.values?.[0]?.value;
        if (d.name === 'post_impressions_unique') impressions = num(v);
        if (d.name === 'post_engaged_users') engagedUsers = num(v);
        if (d.name === 'post_clicks') clicks = num(v);
      });
    } catch { /* not available for this post/token; leave null */ }
    const engagements = p.reactions + p.comments + p.shares;
    return {
      platform: 'facebook',
      post_id: p.id,
      url: p.url,
      timestamp: p.timestamp,
      content_type: contentType(p),
      caption: p.caption,
      views: null,
      reach: impressions,
      impressions,
      likes: p.reactions,
      comments: p.comments,
      shares: p.shares,
      saves: null,
      clicks,
      engagement_rate: engagementRate(engagements, impressions),
      engaged_users: engagedUsers,
    };
  }));

  return {
    platform: 'facebook',
    connected: true,
    handle: ok.profile.name,
    account: {
      followers_current: followersNow,
      followers_previous_7d: followersPrev7,
      follower_growth_7d: followerDelta7,
      follower_growth_7d_pct: pctChange(followersNow, followersPrev7),
    },
    current_7d: current7,
    previous_7d: previous7,
    previous_28d: previous28,
    posts: postDetails,
    posts_published_28d: postsWindow28.length,
    notes,
  };
}

// LinkedIn isn't wired up to the Graph API in this dashboard (README calls it
// a placeholder card) — say so plainly instead of fabricating numbers.
function linkedinPlaceholder() {
  return { platform: 'linkedin', connected: false, notes: ['LinkedIn is not connected in this dashboard yet — no data available.'] };
}

async function buildAccountWeeklyPayload(acc) {
  const channels = {};
  if (acc.instagramId) channels.instagram = await instagramWeekly(acc).catch((e) => ({ platform: 'instagram', connected: false, notes: [e.message] }));
  if (acc.facebookPageId) channels.facebook = await facebookWeekly(acc).catch((e) => ({ platform: 'facebook', connected: false, notes: [e.message] }));
  channels.linkedin = linkedinPlaceholder();

  return {
    account_id: acc.id,
    account_name: acc.name,
    period: {
      current_7d: { since: isoDaysAgo(7), until: isoDaysAgo(0) },
      previous_7d: { since: isoDaysAgo(14), until: isoDaysAgo(7) },
      previous_28d: { since: isoDaysAgo(28), until: isoDaysAgo(0) },
    },
    generated_at: new Date().toISOString(),
    channels,
  };
}

module.exports = { buildAccountWeeklyPayload };
