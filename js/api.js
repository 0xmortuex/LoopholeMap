import { buildRpLegalAnalysisText, buildRpLegalReferenceContext } from './rpLaw.js';

const PROXY_URL = 'https://loopholemap-proxy.mortuexhavoc.workers.dev';

// The worker caps its analysis response at max_tokens: 8000, which bounds how
// many nodes come back — not how much text can go in. Input size is limited
// mainly so the request finishes inside the ~100s edge timeout; the parser
// tolerates truncated JSON if a huge bill produces an oversized response.
const MAX_REQUEST_CHARS = 40000;
const MAX_INPUT_CHARS = 32000;
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

// Whether follow-up requests (node detail, Ask AI) should reason against the
// RP legal references. Set from the mode of the most recent successful scan so
// detail/chat always match the board they describe.
let rpReferenceMode = true;

const REAL_WORLD_MODE_NOTE =
  'REAL-WORLD LEGAL ANALYSIS MODE: treat this as real-life law or policy in its actual jurisdiction, not a role-play or game scenario. ' +
  'Do not reference any RP Constitution, RP Code of Justice, Ownership Team, or other fictional legal sources. ' +
  'Cite real statutes, constitutional provisions, or case law only when you are confident they exist; if unsure, describe the legal principle instead of inventing a citation.';

function buildRealWorldAnalysisText(billText) {
  const trimmedBill = billText.trim();
  const requestText = [
    'REAL-WORLD LEGAL ANALYSIS MODE',
    '',
    'Analyze ONLY the proposed bill/regulation in the final section. Treat it as real-life law or policy in its actual jurisdiction — this is NOT a role-play or game scenario.',
    'Do not reference any RP Constitution, RP Code of Justice, Ownership Team, or other fictional legal sources.',
    '',
    'Classify issues with the standard types (loophole, exemption, gray-area, contradiction, missing-definition, weak-enforcement, scope-gap, sunset-clause). Two additional types apply to real-world constitutional questions:',
    '- constitutional-conflict: the proposal likely conflicts with the constitution of its jurisdiction or exceeds constitutional authority. Use only when confident about the real constitutional provision involved.',
    '- requires-amendment: the goal appears achievable only through a constitutional amendment. Use only when confident.',
    'Never use the type coj-inconsistency; it refers to a fictional legal code that does not apply here.',
    '',
    'For every node, include these JSON fields:',
    '- possibility: how likely the issue is to actually arise in practice. Use exactly one of: very-low, low, medium, high, very-high.',
    '- difficulty: how hard it would be for someone to exploit or trigger the issue. Use exactly one of: easy, moderate, hard, very-hard.',
    '- effectiveness: if the loophole/issue is actually used, how effective it would be at achieving the exploit or defeating the law\'s intent. Use exactly one of: very-low, low, medium, high, very-high.',
    '- importance: how important this issue is for lawmakers to address. Use exactly one of: very-low, low, medium, high, very-high.',
    'Do not confuse severity with possibility. A severe issue can still have very-low possibility if it is unlikely to occur.',
    '',
    'For each node, cite the bill/regulation section that creates the issue. When referencing real statutes, constitutional provisions, or case law, cite only sources you are confident exist; if unsure, describe the legal principle instead of inventing a citation.',
    '',
    'PROPOSED BILL / REGULATION TO SCAN',
    trimmedBill
  ].join('\n');

  if (requestText.length > MAX_REQUEST_CHARS) {
    throw new Error(
      `The scan request is too long (${requestText.length.toLocaleString()} characters, ` +
      `limit is ${MAX_REQUEST_CHARS.toLocaleString()}). Please trim the text and try again.`
    );
  }

  return requestText;
}

async function analyzeRegulation(text, rpMode = true) {
  checkInputLength(text);

  let body;
  if (rpMode) {
    const rpLegalRequest = await buildRpLegalAnalysisText(text, {
      maxTotalChars: MAX_REQUEST_CHARS
    });
    body = {
      action: 'analyze',
      text: rpLegalRequest.text,
      rpLegalContext: rpLegalRequest.metadata
    };
  } else {
    body = {
      action: 'analyze',
      text: buildRealWorldAnalysisText(text)
    };
  }

  const result = await postToProxy(body);
  rpReferenceMode = rpMode;
  return result;
}

async function getNodeDetail(nodeData) {
  const baseNode = {
    title: nodeData.title,
    section: nodeData.section,
    type: nodeData.type,
    severity: nodeData.severity,
    possibility: nodeData.possibility,
    difficulty: nodeData.difficulty
  };

  if (!rpReferenceMode) {
    return postToProxy({
      action: 'detail',
      nodeData: {
        ...baseNode,
        description: [nodeData.description, '', REAL_WORLD_MODE_NOTE].join('\n')
      }
    });
  }

  const referenceContext = await buildRpLegalReferenceContext(
    `${nodeData.title}\n${nodeData.section || ''}\n${nodeData.type}\n${nodeData.description || ''}`,
    { maxChars: 7000 }
  );

  return postToProxy({
    action: 'detail',
    nodeData: {
      ...baseNode,
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
  if (!rpReferenceMode) {
    return postToProxy({
      action: 'ask',
      contextType,
      contextData: [contextData, '', REAL_WORLD_MODE_NOTE].join('\n'),
      question
    });
  }

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

// Used when a board is restored from a share link rather than a live scan, so
// node-detail and Ask AI follow the mode the analysis was produced in.
function setReferenceMode(rpMode) {
  rpReferenceMode = !!rpMode;
}

export { analyzeRegulation, getNodeDetail, askAI, setReferenceMode, MAX_INPUT_CHARS, WARN_INPUT_CHARS };
