/*
 * LoopholeMap analysis proxy — Cloudflare Worker.
 *
 * Sits between the static frontend and the Anthropic API so the API key never
 * ships to the browser. Deploy via the Cloudflare dashboard (paste this file)
 * or `wrangler deploy`, and set the ANTHROPIC_API_KEY secret on the worker.
 *
 * Request:  POST / with JSON body:
 *   { action: "analyze", text, rpLegalContext? }
 *   { action: "detail",  nodeData, rpLegalContext? }
 *   { action: "ask",     contextType, contextData, question, rpLegalContext? }
 * Response: { result: "<model text, JSON per js/parser.js>" } or { error }.
 */

// Origins allowed to call this worker from a browser. Add your custom domain
// here when you attach one.
const ALLOWED_ORIGINS = [
  'https://0xmortuex.github.io',
  'http://localhost:8000',
  'http://localhost:8899',
  'http://127.0.0.1:8000',
];

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';

// The frontend's scan timeout is ~92s, so responses must fit inside that.
// max_tokens bounds thinking + response text together on this model.
const LIMITS = {
  analyze: { maxTokens: 8000, maxInputChars: 60000 },
  detail: { maxTokens: 3000, maxInputChars: 30000 },
  ask: { maxTokens: 1500, maxInputChars: 30000 },
};

const ANALYZE_SYSTEM = [
  'You are LoopholeMap, an expert legislative analyst. You find loopholes, exemptions, gray areas, contradictions, missing definitions, weak enforcement, scope gaps, and sunset clauses in bills, laws, and regulations.',
  '',
  'The user message may begin with an analysis-mode header (RP LEGAL ANALYSIS MODE or REAL-WORLD LEGAL ANALYSIS MODE) containing additional instructions and reference material. Follow those instructions exactly — they control which issue types are allowed and how to treat the reference sources.',
  '',
  'Respond with ONLY a JSON object — no markdown fences, no prose before or after. Schema:',
  '{',
  '  "title": "short title of the analyzed bill/regulation",',
  '  "overallRisk": "low" | "medium" | "high" | "critical",',
  '  "summary": "2-3 sentence overall assessment",',
  '  "nodes": [',
  '    {',
  '      "id": "n1",',
  '      "title": "short issue title",',
  '      "type": "loophole" | "exemption" | "gray-area" | "contradiction" | "missing-definition" | "weak-enforcement" | "scope-gap" | "sunset-clause" | "constitutional-conflict" | "coj-inconsistency" | "requires-amendment",',
  '      "severity": "critical" | "high" | "medium" | "low",',
  '      "section": "the exact bill section, e.g. Sec. 4(b)",',
  '      "description": "what the issue is and why it matters",',
  '      "exploitation": "how the language could be exploited",',
  '      "realWorldParallel": "a real or historical parallel, if any",',
  '      "suggestedFix": "a concrete drafting fix",',
  '      "possibility": "very-low" | "low" | "medium" | "high" | "very-high",',
  '      "difficulty": "easy" | "moderate" | "hard" | "very-hard",',
  '      "effectiveness": "very-low" | "low" | "medium" | "high" | "very-high",',
  '      "importance": "very-low" | "low" | "medium" | "high" | "very-high",',
  '      "connectedNodes": ["n2"]',
  '    }',
  '  ],',
  '  "connections": [',
  '    { "source": "n1", "target": "n2", "type": "enables" | "weakens" | "contradicts" | "depends-on" | "amplifies", "description": "how they relate" }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- Report 4-10 nodes: every real issue you find, ordered by importance. Do not pad with trivial nits.',
  '- possibility = how likely the issue is to actually arise; difficulty = how hard it is to exploit; effectiveness = impact if exploited; importance = how much it matters to fix. Do not conflate them with severity.',
  '- Cite the specific section of the analyzed text in each node. If the text has no section numbers, quote a short identifying phrase.',
  '- Only create connections between issues that genuinely interact.',
  '- If the text is not a bill, law, regulation, or policy, return {"title":"Not a regulation","overallRisk":"low","summary":"<explain briefly>","nodes":[],"connections":[]}.',
].join('\n');

const DETAIL_SYSTEM = [
  'You are LoopholeMap, an expert legislative analyst. The user gives you one flagged issue from a bill analysis (as JSON, possibly with legal reference excerpts). Produce a deep dive on that single issue.',
  '',
  'If the issue description contains an analysis-mode note (RP LEGAL ANALYSIS MODE or REAL-WORLD LEGAL ANALYSIS MODE), follow it — it controls which legal sources you may reason against.',
  '',
  'Respond with ONLY a JSON object — no markdown fences, no prose. Schema:',
  '{',
  '  "deepDive": "2-3 paragraph detailed analysis of the issue",',
  '  "stakeholders": {',
  '    "benefits": [ { "who": "actor", "how": "how they benefit" } ],',
  '    "harmed": [ { "who": "actor", "how": "how they are harmed" } ]',
  '  },',
  '  "closingStrategies": [',
  '    { "approach": "short name", "description": "how it closes the issue", "difficulty": "easy" | "moderate" | "hard", "sideEffects": "downsides, if any" }',
  '  ],',
  '  "exploitScenario": [ "step 1", "step 2", "step 3" ],',
  '  "exploitDifficulty": "easy" | "moderate" | "hard" | "very-hard"',
  '}',
  '',
  'Give 2-3 closing strategies and a 3-5 step exploit scenario. Ground every claim in the issue and references provided; do not invent legal provisions.',
].join('\n');

const ASK_SYSTEM = [
  'You are LoopholeMap\'s analysis assistant. The user asks questions about a bill analysis (the analysis context and any legal reference excerpts are provided).',
  '',
  'If the context contains an analysis-mode note (RP LEGAL ANALYSIS MODE or REAL-WORLD LEGAL ANALYSIS MODE), follow it — it controls which legal sources you may reason against.',
  '',
  'Respond with ONLY a JSON object — no markdown fences, no prose outside it. Schema:',
  '{',
  '  "answer": "your answer in plain conversational text (a few short paragraphs at most)",',
  '  "followUpSuggestions": [ "short follow-up question", "another", "a third" ]',
  '}',
  '',
  'Be direct and specific; cite sections from the context when relevant. Give at most 3 follow-up suggestions.',
].join('\n');

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

function buildPrompt(body) {
  if (body.action === 'analyze') {
    if (typeof body.text !== 'string' || !body.text.trim()) {
      throw new HttpError(400, 'Missing "text" for analyze');
    }
    return { system: ANALYZE_SYSTEM, user: body.text, limits: LIMITS.analyze };
  }

  if (body.action === 'detail') {
    if (!body.nodeData || typeof body.nodeData !== 'object') {
      throw new HttpError(400, 'Missing "nodeData" for detail');
    }
    return {
      system: DETAIL_SYSTEM,
      user: `Flagged issue:\n${JSON.stringify(body.nodeData, null, 2)}`,
      limits: LIMITS.detail,
    };
  }

  if (body.action === 'ask') {
    if (typeof body.question !== 'string' || !body.question.trim()) {
      throw new HttpError(400, 'Missing "question" for ask');
    }
    const context = typeof body.contextData === 'string' ? body.contextData : '';
    return {
      system: ASK_SYSTEM,
      user: `Analysis context (${body.contextType || 'general'}):\n${context}\n\nQuestion: ${body.question}`,
      limits: LIMITS.ask,
    };
  }

  throw new HttpError(400, 'Unknown action — expected "analyze", "detail", or "ask"');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== 'POST') {
      return jsonResponse(request, 405, { error: 'POST only' });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(request, 500, {
        error: 'Worker is missing the ANTHROPIC_API_KEY secret. Add it under Settings → Variables and Secrets.',
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(request, 400, { error: 'Body must be JSON' });
    }

    let prompt;
    try {
      prompt = buildPrompt(body);
    } catch (err) {
      if (err instanceof HttpError) return jsonResponse(request, err.status, { error: err.message });
      throw err;
    }

    if (prompt.user.length > prompt.limits.maxInputChars) {
      return jsonResponse(request, 400, {
        error: `Input too long (${prompt.user.length} chars, limit ${prompt.limits.maxInputChars}).`,
      });
    }

    let apiResponse;
    try {
      apiResponse = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: prompt.limits.maxTokens,
          // Adaptive thinking stays on (the model's default); medium effort
          // keeps analysis quality high while fitting the frontend's ~92s
          // scan timeout.
          output_config: { effort: 'medium' },
          system: ANALYZE_SYSTEM === prompt.system
            ? [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }]
            : prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
    } catch {
      return jsonResponse(request, 502, { error: 'Could not reach the Anthropic API.' });
    }

    let data;
    try {
      data = await apiResponse.json();
    } catch {
      return jsonResponse(request, 502, { error: 'Anthropic API returned a non-JSON response.' });
    }

    if (!apiResponse.ok) {
      const message = data?.error?.message || `Anthropic API error (${apiResponse.status})`;
      // 429/529 pass through their status so clients could back off; other
      // upstream errors surface as 502 from this proxy.
      const status = apiResponse.status === 429 || apiResponse.status === 529 ? apiResponse.status : 502;
      return jsonResponse(request, status, { error: message });
    }

    if (data.stop_reason === 'refusal') {
      return jsonResponse(request, 502, {
        error: 'The analysis model declined this request. Try rephrasing or trimming the text.',
      });
    }

    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text.trim()) {
      return jsonResponse(request, 502, { error: 'The analysis model returned an empty response.' });
    }

    // stop_reason === "max_tokens" can truncate the JSON mid-object; the
    // frontend parser is truncation-tolerant, so still return what we got.
    return jsonResponse(request, 200, { result: text });
  },
};
