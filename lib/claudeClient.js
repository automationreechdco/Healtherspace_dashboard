// Talks to the Anthropic API to turn one account's weekly analytics payload
// into a structured report. Uses forced tool-use so Claude's reply IS the
// JSON object (no prose to parse out of), then validates the shape and
// retries once if anything is missing or malformed.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const ANTHROPIC_VERSION = '2023-06-01';
const API_URL = 'https://api.anthropic.com/v1/messages';

const TOOL_NAME = 'submit_weekly_analysis';

const ANALYSIS_TOOL = {
  name: TOOL_NAME,
  description: 'Submit the completed structured weekly social media analysis.',
  input_schema: {
    type: 'object',
    required: [
      'executive_summary', 'improvements', 'declines', 'top_posts',
      'content_patterns', 'engagement_analysis', 'platform_comparison',
      'posting_consistency', 'recommendations', 'next_week_plan', 'data_limitations',
    ],
    properties: {
      executive_summary: { type: 'string', description: '3-5 sentences summarizing the week, based only on supplied data.' },
      improvements: {
        type: 'array',
        items: {
          type: 'object',
          required: ['metric', 'comparison', 'detail'],
          properties: {
            metric: { type: 'string' },
            change_pct: { type: ['number', 'null'] },
            comparison: { type: 'string', description: 'e.g. "vs previous 7 days"' },
            detail: { type: 'string' },
          },
        },
      },
      declines: {
        type: 'array',
        items: {
          type: 'object',
          required: ['metric', 'comparison', 'detail'],
          properties: {
            metric: { type: 'string' },
            change_pct: { type: ['number', 'null'] },
            comparison: { type: 'string' },
            detail: { type: 'string' },
          },
        },
      },
      top_posts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['platform', 'caption_or_title', 'url', 'why_it_stands_out'],
          properties: {
            platform: { type: 'string' },
            caption_or_title: { type: 'string' },
            date: { type: ['string', 'null'] },
            url: { type: ['string', 'null'] },
            views: { type: ['number', 'null'] },
            reach: { type: ['number', 'null'] },
            engagement: { type: ['number', 'null'] },
            engagement_rate: { type: ['number', 'null'] },
            why_it_stands_out: { type: 'string' },
          },
        },
      },
      content_patterns: { type: 'array', items: { type: 'string' } },
      engagement_analysis: { type: 'array', items: { type: 'string' } },
      platform_comparison: {
        type: 'array',
        items: {
          type: 'object',
          required: ['platform'],
          properties: {
            platform: { type: 'string' },
            follower_growth: { type: ['number', 'null'] },
            reach: { type: ['number', 'null'] },
            impressions: { type: ['number', 'null'] },
            engagement: { type: ['number', 'null'] },
            engagement_rate: { type: ['number', 'null'] },
            content_volume: { type: ['number', 'null'] },
            note: { type: ['string', 'null'] },
          },
        },
      },
      posting_consistency: {
        type: 'object',
        properties: {
          posts_this_week: { type: ['number', 'null'] },
          posts_by_platform: { type: 'object' },
          days_active: { type: ['number', 'null'] },
          longest_gap_description: { type: ['string', 'null'] },
          change_vs_previous_week: { type: ['string', 'null'] },
        },
      },
      recommendations: { type: 'array', items: { type: 'string' }, description: '3-5 recommendations, each tied to a specific data point.' },
      next_week_plan: {
        type: 'array',
        items: {
          type: 'object',
          required: ['day', 'platform', 'format', 'topic', 'reason'],
          properties: {
            day: { type: 'string' },
            platform: { type: 'string' },
            format: { type: 'string' },
            topic: { type: 'string' },
            hook: { type: ['string', 'null'] },
            reason: { type: 'string' },
          },
        },
      },
      data_limitations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Plain statements of what data was unavailable or missing this period.',
      },
    },
  },
};

const SYSTEM_PROMPT = `You are an AI social media analyst producing a weekly performance report for a small business's Instagram, Facebook and LinkedIn accounts.

Rules you must follow:
- Use only the analytics data supplied in the user message. Never invent metrics, posts, or platform information.
- If a metric is null or missing, say so plainly in "data_limitations" — do not guess a value or silently skip it.
- Distinguish correlation from causation. Never claim a specific post caused a follower or reach change unless the data directly establishes it.
- Every figure you cite in prose should trace back to a number in the supplied data; when you compute a percentage yourself, treat it as calculated, not platform-provided.
- Do not rank platforms as "best" unless the user data makes the comparison metric unambiguous.
- Keep the executive summary to 3-5 sentences.
- Call the submit_weekly_analysis tool exactly once with the complete result. Do not write any text outside the tool call.`;

function buildUserMessage(payload) {
  return [
    'Here is this account\'s analytics data for the week. Analyze it and call submit_weekly_analysis.',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');
}

async function callAnthropic(payload, { correctionNote } = {}) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const messages = [{ role: 'user', content: buildUserMessage(payload) }];
  if (correctionNote) {
    messages.push({ role: 'user', content: `Your previous tool call was invalid: ${correctionNote}. Please call submit_weekly_analysis again with a complete, valid result.` });
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages,
    }),
  });
  const json = await res.json().catch(() => { throw new Error(`Claude API returned an unexpected response (HTTP ${res.status})`); });
  if (!res.ok) throw new Error(json.error?.message || `Claude API error (HTTP ${res.status})`);
  const toolUse = (json.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUse) throw new Error('Claude did not return a submit_weekly_analysis tool call');
  return { input: toolUse.input, raw: json, model: json.model };
}

// Minimal structural validation — required keys present with the right JS type.
// This is deliberately not a full JSON-schema validator; it exists to catch a
// malformed/truncated tool call and trigger the one retry, not to police prose.
function validateAnalysis(obj) {
  const problems = [];
  if (!obj || typeof obj !== 'object') return ['result is not an object'];
  const isArr = (k) => Array.isArray(obj[k]) || problems.push(`"${k}" must be an array`);
  const isStr = (k) => typeof obj[k] === 'string' || problems.push(`"${k}" must be a string`);
  isStr('executive_summary');
  ['improvements', 'declines', 'top_posts', 'content_patterns', 'engagement_analysis', 'platform_comparison', 'recommendations', 'next_week_plan', 'data_limitations']
    .forEach(isArr);
  if (!obj.posting_consistency || typeof obj.posting_consistency !== 'object') problems.push('"posting_consistency" must be an object');
  return problems;
}

async function generateWeeklyAnalysis(payload) {
  let attempt = await callAnthropic(payload);
  let problems = validateAnalysis(attempt.input);
  if (problems.length) {
    attempt = await callAnthropic(payload, { correctionNote: problems.join('; ') });
    problems = validateAnalysis(attempt.input);
    if (problems.length) {
      throw new Error('Claude returned an invalid analysis twice in a row: ' + problems.join('; '));
    }
  }
  return { analysis: attempt.input, model: attempt.model };
}

module.exports = { generateWeeklyAnalysis, CLAUDE_MODEL };
