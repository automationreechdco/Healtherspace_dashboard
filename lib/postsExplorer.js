// Powers the "All Posts" explorer: every Instagram + Facebook post published
// in an arbitrary date range, each with its own impressions/reach, likes,
// comments, shares and saves — pulled straight from the Meta Graph API.
const { graph, loadPageTokens, num, TOKEN } = require('./graph');

const contentTypeIG = (m) => {
  if (m.media_product_type === 'REELS') return 'Reel';
  if (m.media_type === 'VIDEO') return 'Video';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'Carousel';
  return 'Image';
};
const contentTypeFB = (mediaType) => {
  if (mediaType === 'video_inline' || mediaType === 'video_autoplay') return 'Video';
  if (mediaType === 'album') return 'Carousel';
  if (mediaType === 'photo') return 'Image';
  return mediaType || 'Text';
};

async function instagramPosts(acc, sinceMs, untilMs) {
  const id = acc.instagramId;
  if (!id) return [];
  const pt = await loadPageTokens();
  const tokens = [TOKEN, pt.ig[id]];

  let media;
  try {
    media = (await graph(`${id}/media`, {
      fields: 'caption,permalink,timestamp,like_count,comments_count,media_type,media_product_type',
      limit: 100,
    }, tokens)).data || [];
  } catch (e) {
    return [{ platform: 'instagram', error: e.message }];
  }

  const inRange = media.filter((m) => {
    const t = new Date(m.timestamp).getTime();
    return t >= sinceMs && t <= untilMs;
  });

  return Promise.all(inRange.map(async (m) => {
    let reach = null, saved = null, shares = null, videoViews = null;
    try {
      const j = await graph(`${m.id}/insights`, { metric: 'reach,saved,shares,total_interactions' }, tokens);
      (j.data || []).forEach((d) => {
        const v = d.values?.[0]?.value;
        if (d.name === 'reach') reach = num(v);
        if (d.name === 'saved') saved = num(v);
        if (d.name === 'shares') shares = num(v);
      });
    } catch { /* not available for this media type/version */ }
    if (m.media_type === 'VIDEO' || m.media_product_type === 'REELS') {
      try {
        const j = await graph(`${m.id}/insights`, { metric: 'video_views' }, tokens);
        videoViews = num(j.data?.[0]?.values?.[0]?.value);
      } catch { /* ignore */ }
    }
    return {
      platform: 'instagram',
      post_id: m.id,
      url: m.permalink,
      timestamp: m.timestamp,
      content_type: contentTypeIG(m),
      caption: m.caption || '',
      followers: null,
      impressions: null,
      reach,
      views: videoViews,
      likes: num(m.like_count) ?? 0,
      comments: num(m.comments_count) ?? 0,
      shares,
      saved,
    };
  }));
}

async function facebookPosts(acc, sinceMs, untilMs) {
  const id = acc.facebookPageId;
  if (!id) return [];
  const pt = await loadPageTokens();
  let pageToken = pt.pages[id];
  if (!pageToken) {
    try { pageToken = (await graph(id, { fields: 'access_token' })).access_token; } catch { /* use system token */ }
  }
  const tokens = [pageToken, TOKEN];

  let posts;
  try {
    posts = (await graph(`${id}/posts`, {
      fields: 'message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0),attachments{media_type}',
      limit: 100,
    }, tokens)).data || [];
  } catch (e) {
    return [{ platform: 'facebook', error: e.message }];
  }

  const inRange = posts.filter((p) => {
    const t = new Date(p.created_time).getTime();
    return t >= sinceMs && t <= untilMs;
  });

  return Promise.all(inRange.map(async (p) => {
    let impressions = null, clicks = null;
    try {
      const j = await graph(`${p.id}/insights`, { metric: 'post_impressions_unique,post_clicks' }, tokens);
      (j.data || []).forEach((d) => {
        const v = d.values?.[0]?.value;
        if (d.name === 'post_impressions_unique') impressions = num(v);
        if (d.name === 'post_clicks') clicks = num(v);
      });
    } catch { /* not available for this post/token */ }
    return {
      platform: 'facebook',
      post_id: p.id,
      url: p.permalink_url,
      timestamp: p.created_time,
      content_type: contentTypeFB(p.attachments?.data?.[0]?.media_type || null),
      caption: p.message || '',
      followers: null,
      impressions,
      reach: impressions, // Facebook's per-post reach metric is the unique-impressions figure
      views: null,
      likes: p.reactions?.summary?.total_count || 0,
      comments: p.comments?.summary?.total_count || 0,
      shares: p.shares?.count || 0,
      saved: null,
      clicks,
    };
  }));
}

async function fetchAccountPosts(acc, sinceSec, untilSec) {
  const sinceMs = sinceSec * 1000, untilMs = untilSec * 1000;
  const [ig, fb] = await Promise.all([
    instagramPosts(acc, sinceMs, untilMs).catch((e) => [{ platform: 'instagram', error: e.message }]),
    facebookPosts(acc, sinceMs, untilMs).catch((e) => [{ platform: 'facebook', error: e.message }]),
  ]);
  const errors = [...ig, ...fb].filter((p) => p.error).map((p) => `${p.platform}: ${p.error}`);
  const posts = [...ig, ...fb].filter((p) => !p.error).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { posts, errors };
}

module.exports = { fetchAccountPosts };
