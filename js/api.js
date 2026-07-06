import { buildRpLegalAnalysisText, buildRpLegalReferenceContext } from './rpLaw.js';

const PROXY_URL = 'https://loopholemap-proxy.mortuexhavoc.workers.dev';

// The worker caps its analysis response at max_tokens: 8000. Keep the final
// request compact enough to include RP legal excerpts and still return full
// JSON.
const MAX_REQUEST_CHARS = 24000;
const MAX_INPUT_CHARS = 16000;
const WARN_INPUT_CHARS = Math.round(MAX_INPUT_CHARS * 0.85);

// Analyses can be slow (large regulation + AI reasoning). Give it real
// room before treating the request as hung.
// Sonnet 5 with a large legal-context prompt and up to 8000 output tokens can
// legitimately take well over a minute. Kept just under Cloudflare's ~100s
// edge timeout so we still fail gracefully rather than hang forever.
const REQUEST_TIMEOUT_MS = 92000;

function checkInputLength(text) {
  if (typeof text !== 'string') return;
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(
      `That text is too long (${text.length.toLocaleString()} characters, limit is ${MAX_INPUT_CHARS.toLocaleString()}). ` +
      `Very large regulations can exceed the analysis engine's output budget and fail partway through — please trim it down and try again.`
    );
  }
}

async function postToProxy(body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The analysis is taking longer than expected (90s+) and timed out. Please try again — shorter bills respond faster.');
    }
    throw new Error('Could not reach the analysis server. Check your connection and try again.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${errText || 'Server error'}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error('The server returned an unexpected (non-JSON) response. Please try again.');
  }
  if (!data.result) throw new Error('Empty response from server');
  return data.result;
}

async function analyzeRegulation(text) {
  checkInputLength(text);
  const rpLegalRequest = await buildRpLegalAnalysisText(text, {
    maxTotalChars: MAX_REQUEST_CHARS
  });

  return postToProxy({
    action: 'analyze',
    text: rpLegalRequest.text,
    rpLegalContext: rpLegalRequest.metadata
  });
}

async function getNodeDetail(nodeData) {
  const referenceContext = await buildRpLegalReferenceContext(
    `${nodeData.title}\n${nodeData.section || ''}\n${nodeData.type}\n${nodeData.description || ''}`,
    { maxChars: 7000 }
  );

  return postToProxy({
    action: 'detail',
    nodeData: {
      title: nodeData.title,
      section: nodeData.section,
      type: nodeData.type,
      severity: nodeData.severity,
      possibility: nodeData.possibility,
      difficulty: nodeData.difficulty,
      description: [
        nodeData.description,
        '',
        'RP legal reference excerpts for this issue:',
        referenceContext.text
      ].join('\n')
    },
    rpLegalContext: referenceContext.metadata
  });
}

async function askAI(contextType, contextData, question) {
  const referenceContext = await buildRpLegalReferenceContext(
    `${contextData}\n${question}`,
    { maxChars: 7000 }
  );
  const enrichedContextData = [
    contextData,
    '',
    'RP legal reference excerpts for this question:',
    referenceContext.text
  ].join('\n');

  return postToProxy({
    action: 'ask',
    contextType,
    contextData: enrichedContextData,
    question,
    rpLegalContext: referenceContext.metadata
  });
}

export { analyzeRegulation, getNodeDetail, askAI, MAX_INPUT_CHARS, WARN_INPUT_CHARS };
