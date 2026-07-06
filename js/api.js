const PROXY_URL = 'https://loopholemap-proxy.mortuexhavoc.workers.dev';

// The worker caps its analysis response at max_tokens: 8000. Very large
// pasted regulations push the output past that budget and the request
// either fails or returns truncated JSON. This cap keeps input text in a
// range the worker can reliably answer in full.
const MAX_INPUT_CHARS = 24000;
const WARN_INPUT_CHARS = Math.round(MAX_INPUT_CHARS * 0.85);

// Analyses can be slow (large regulation + AI reasoning). Give it real
// room before treating the request as hung.
const REQUEST_TIMEOUT_MS = 45000;

function getCusaKey() {
  return localStorage.getItem('loopholemap_cusa_key') || undefined;
}

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
      throw new Error('The analysis is taking longer than expected (45s+) and timed out. Please try again — shorter texts usually respond faster.');
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
  const cusaKey = getCusaKey();
  return postToProxy({ action: 'analyze', text, cusaKey });
}

async function getNodeDetail(nodeData) {
  const cusaKey = getCusaKey();
  return postToProxy({
    action: 'detail',
    nodeData: {
      title: nodeData.title,
      section: nodeData.section,
      type: nodeData.type,
      description: nodeData.description
    },
    cusaKey
  });
}

async function askAI(contextType, contextData, question) {
  const cusaKey = getCusaKey();
  return postToProxy({ action: 'ask', contextType, contextData, question, cusaKey });
}

export { analyzeRegulation, getNodeDetail, askAI, MAX_INPUT_CHARS, WARN_INPUT_CHARS };
