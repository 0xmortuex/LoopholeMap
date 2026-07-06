const RP_LEGAL_REFERENCES_ENABLED = true;

const REFERENCE_FILES = [
  {
    id: 'constitution',
    label: 'RP Constitution',
    path: 'docs/rp-law/constitution.md',
    defaultBoost: 2
  },
  {
    id: 'codeOfJustice',
    label: 'RP Code of Justice',
    path: 'docs/rp-law/code-of-justice.md',
    defaultBoost: 1
  },
  {
    id: 'allLegislation',
    label: 'RP All Legislation Reference',
    path: 'docs/rp-law/all-legislation.md',
    defaultBoost: 2
  }
];

const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'been', 'being',
  'before', 'between', 'both', 'case', 'cases', 'cause', 'civil', 'code',
  'could', 'court', 'does', 'done', 'each', 'from', 'have', 'into', 'itself',
  'just', 'laws', 'legal', 'made', 'make', 'must', 'only', 'other', 'over',
  'party', 'people', 'person', 'persons', 'public', 'rule', 'same', 'shall',
  'should', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'this', 'through', 'under', 'upon', 'when', 'where', 'which', 'while',
  'with', 'within', 'without', 'would'
]);

const BOOST_RULES = [
  {
    triggers: ['congress', 'senate', 'house', 'representatives', 'bill', 'legislation', 'legislative'],
    targets: ['legislative branch', 'congress', 'legislation becomes official', 'subpoena', 'impeachment']
  },
  {
    triggers: ['president', 'veto', 'executive', 'cabinet', 'appointment', 'pardon', 'war'],
    targets: ['executive branch', 'president', 'presidential powers', 'veto', 'cabinet']
  },
  {
    triggers: ['judge', 'justice', 'trial', 'jury', 'appeal', 'court', 'judicial', 'sentence'],
    targets: ['judicial branch', 'supreme court', 'fair trial', 'judicial', 'sentencing', 'appeal']
  },
  {
    triggers: ['speech', 'religion', 'privacy', 'search', 'seizure', 'warrant', 'protest', 'arms', 'rights'],
    targets: ['bill of rights', 'right of speech', 'right of privacy', 'unreasonable searches', 'peaceful protest', 'bear arms']
  },
  {
    triggers: ['arrest', 'detain', 'detention', 'apprehend', 'apprehension', 'law enforcement'],
    targets: ['apprehension', 'habeas corpus', 'unreasonable searches', 'false imprisonment', 'resisting arrest']
  },
  {
    triggers: ['retroactive', 'retroactively', 'ex-post', 'criminalization'],
    targets: ['ex-post facto criminalization', 'retroactive']
  },
  {
    triggers: ['amend', 'amendment', 'constitutional amendment', 'supermajority'],
    targets: ['amendment procedure', 'constitutional amendment', 'amending foundational articles']
  },
  {
    triggers: ['classified', 'national security', 'espionage', 'leak', 'privacy'],
    targets: ['classified', 'national security', 'espionage', 'misuse of classified information', 'privacy']
  }
];

const IMPORTANT_HEADINGS = [
  'article i',
  'article iv',
  'article v',
  'article vi',
  'rights of the citizens',
  'right to a fair trial',
  'habeas corpus',
  'unreasonable searches',
  'ex-post facto',
  'judicial sentencing',
  'apprehension'
];

let referenceCache = null;

async function buildRpLegalAnalysisText(billText, options = {}) {
  const maxTotalChars = options.maxTotalChars || 24000;
  const trimmedBill = billText.trim();
  const wrapperBudget = 2600;
  const referenceBudget = Math.max(2500, maxTotalChars - trimmedBill.length - wrapperBudget);

  if (referenceBudget < 2500) {
    throw new Error(
      'That bill is too long to scan with the RP Constitution and Code of Justice. ' +
      'Please trim the bill text so there is room for the legal references.'
    );
  }

  const referenceContext = await buildRpLegalReferenceContext(trimmedBill, {
    maxChars: Math.min(referenceBudget, options.maxReferenceChars || 12000)
  });

  const requestText = [
    'RP LEGAL ANALYSIS MODE',
    '',
    'Analyze ONLY the proposed bill/regulation in the final section. Use the RP legal references as controlling in-universe law, including the Constitution, Code of Justice, and the all-legislation reference.',
    'Do not report loopholes in the reference documents themselves. Report only issues in the proposed bill/regulation.',
    '',
    'When applicable, classify issues with these exact types:',
    '- constitutional-conflict: the proposal conflicts with the RP Constitution or exceeds constitutional authority.',
    '- coj-inconsistency: the proposal conflicts with, duplicates, weakens, or ambiguously changes the Code of Justice.',
    '- requires-amendment: the goal requires a constitutional amendment or formal legal-code amendment.',
    '',
    'For every node, include these JSON fields:',
    '- possibility: how likely the issue is to actually happen in RP practice. Use exactly one of: very-low, low, medium, high, very-high.',
    '- difficulty: how hard it would be for someone to exploit or trigger the issue. Use exactly one of: easy, moderate, hard, very-hard.',
    '- effectiveness: if the loophole/issue is actually used, how effective it would be at achieving the exploit or defeating the bill\'s intent. Use exactly one of: very-low, low, medium, high, very-high.',
    '- importance: how important this issue is for the legislature to address (its overall significance to the bill and legal framework). Use exactly one of: very-low, low, medium, high, very-high.',
    'Do not confuse severity with possibility. A severe issue can still have very-low possibility if it is unlikely to occur. effectiveness is about impact if exploited; importance is about how much it matters to fix.',
    '',
    'Ownership Team / OT rule: treat the Ownership Team as supreme in-universe authority. Do not flag OT powers, approvals, overrides, exemptions, discretion, or actions as loopholes, constitutional conflicts, Code of Justice inconsistencies, or amendment requirements.',
    'Never create a node whose main issue is Ownership Team authority. Exclude OT-only findings from the nodes array entirely, even if they look broad, undefined, discretionary, or powerful.',
    'Only mention OT in a node when the proposed bill gives OT power to a non-OT actor or lets someone impersonate OT. In that case, title and frame the issue around the non-OT delegation or impersonation, not OT itself.',
    '',
    'For each relevant node, cite the bill section and the Constitution article/section, Code of Justice article, or all-legislation reference bill number/title that creates the issue.',
    'If the references do not contain enough information for a claim, say so instead of inventing a rule.',
    '',
    referenceContext.text,
    '',
    'PROPOSED BILL / REGULATION TO SCAN',
    trimmedBill
  ].join('\n');

  if (requestText.length > maxTotalChars) {
    throw new Error(
      `The combined scan request is too long (${requestText.length.toLocaleString()} characters, ` +
      `limit is ${maxTotalChars.toLocaleString()}). Please trim the bill text and try again.`
    );
  }

  return {
    text: requestText,
    metadata: referenceContext.metadata
  };
}

async function buildRpLegalReferenceContext(queryText, options = {}) {
  const maxChars = options.maxChars || 10000;
  const references = await loadRpLegalReferences();
  const chunks = selectRelevantChunks(references, queryText, maxChars);

  if (!chunks.length) {
    throw new Error('RP legal references loaded, but no usable Constitution or Code of Justice excerpts were found.');
  }

  const grouped = new Map();
  chunks.forEach(chunk => {
    if (!grouped.has(chunk.referenceId)) grouped.set(chunk.referenceId, []);
    grouped.get(chunk.referenceId).push(chunk);
  });

  const sections = ['RP LEGAL REFERENCE EXCERPTS'];
  references.forEach(ref => {
    const refChunks = grouped.get(ref.id);
    if (!refChunks || !refChunks.length) return;
    sections.push('', `[${ref.label}]`);
    refChunks.forEach(chunk => {
      sections.push(`--- ${chunk.heading}`);
      sections.push(chunk.text.trim());
    });
  });

  return {
    text: sections.join('\n'),
    metadata: {
      enabled: RP_LEGAL_REFERENCES_ENABLED,
      sources: references.map(ref => ({ id: ref.id, label: ref.label, path: ref.path })),
      excerpts: chunks.map(chunk => ({
        source: chunk.referenceId,
        heading: chunk.heading,
        score: chunk.score
      }))
    }
  };
}

async function loadRpLegalReferences() {
  if (referenceCache) return referenceCache;

  referenceCache = Promise.all(REFERENCE_FILES.map(async ref => {
    let response;
    try {
      response = await fetch(ref.path, { cache: 'no-cache' });
    } catch (err) {
      throw new Error(
        `Could not load ${ref.label} from ${ref.path}. Serve the project locally or deploy it so the browser can fetch docs/rp-law files.`
      );
    }

    if (!response.ok) {
      throw new Error(`Could not load ${ref.label} from ${ref.path} (${response.status}).`);
    }

    const text = await response.text();
    if (!text.trim() || text.includes('TODO: Add the RP')) {
      throw new Error(`${ref.label} is missing from ${ref.path}. Add the full source text before scanning.`);
    }

    return {
      ...ref,
      text,
      chunks: splitReferenceIntoChunks(ref, text)
    };
  })).catch(err => {
    referenceCache = null;
    throw err;
  });

  return referenceCache;
}

function splitReferenceIntoChunks(ref, text) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const lines = normalizedText.split('\n');
  const chunks = [];
  let currentHeading = ref.label;
  let currentLines = [];

  const pushChunk = () => {
    const chunkText = currentLines.join('\n').trim();
    if (!chunkText) return;
    if (/^Custodianship/i.test(currentHeading)) return;
    if (/^(SPONSORS?|Signed,|Respectfully submitted,?)/i.test(currentHeading)) return;
    if (chunkText.replace(/\s+/g, ' ').length < 120) return;
    if (currentHeading === ref.label && !/^(ARTICLE|TITLE|§|DEFINITIONS)/im.test(chunkText)) return;
    chunks.push({
      referenceId: ref.id,
      referenceLabel: ref.label,
      heading: currentHeading,
      text: chunkText,
      searchText: normalizeText(`${currentHeading}\n${chunkText}`),
      order: chunks.length,
      score: 0
    });
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (isReferenceHeading(trimmed)) {
      if (currentLines.length) pushChunk();
      currentHeading = trimmed || ref.label;
      currentLines = [line];
      return;
    }

    currentLines.push(line);

    if (currentLines.join('\n').length > 3200) {
      pushChunk();
      currentHeading = `${currentHeading} (continued)`;
      currentLines = [];
    }
  });

  pushChunk();
  return chunks;
}

function isReferenceHeading(line) {
  const heading = line.replace(/^#{1,6}\s*/, '');
  if (/^(A BILL|AN ACT)\.?$/i.test(heading)) return false;
  return /^(ARTICLE\s+([IVXLC]+|\d[\d-]*)\.?|TITLE\s+[IVXLC]+|§\s*\d+|DEFINITIONS\b|Sponsors?\b|Signed,\b|Respectfully submitted,?\b|AS OF:|Simple Resolutions\b|Concurrent Resolutions\b|Custodianship\b|H\.?\s*R\.?\s*\d+|H\.?\s*J\.?\s*RES\.?\s*\d+|HR\s+\d+|S\.?\s*\d+|S\.?\s*J\.?\s*RES\.?\s*\d+|.+\.(pdf|docx?)$|[A-Z][A-Za-z0-9 &,'’:/_-]+(Act|Resolution|Bill)\.?$)/i.test(heading);
}

function selectRelevantChunks(references, queryText, maxChars) {
  const keywords = extractKeywords(queryText);
  const normalizedQuery = normalizeText(queryText);
  const scored = references.flatMap(ref => {
    return ref.chunks.map(chunk => ({
      ...chunk,
      score: scoreChunk(chunk, keywords, normalizedQuery, ref.defaultBoost)
    }));
  }).sort((a, b) => b.score - a.score);

  const selected = [];
  const selectedKeys = new Set();
  const sourceChars = new Map();
  let usedChars = 0;

  const tryAdd = (chunk, sourceLimit = maxChars) => {
    const key = `${chunk.referenceId}:${chunk.heading}:${chunk.text.slice(0, 80)}`;
    if (selectedKeys.has(key)) return false;
    const nextCost = chunk.text.length + chunk.heading.length + 24;
    if (usedChars + nextCost > maxChars) return false;
    const usedForSource = sourceChars.get(chunk.referenceId) || 0;
    if (usedForSource + nextCost > sourceLimit) return false;
    selected.push(chunk);
    selectedKeys.add(key);
    sourceChars.set(chunk.referenceId, usedForSource + nextCost);
    usedChars += nextCost;
    return true;
  };

  const perSourceSoftLimit = Math.max(1800, Math.floor(maxChars * 0.42));
  references.forEach(ref => {
    scored
      .filter(chunk => chunk.referenceId === ref.id && chunk.score > 0)
      .forEach(chunk => tryAdd(chunk, perSourceSoftLimit));
  });

  scored.forEach(chunk => {
    if (chunk.score <= 0) return;
    tryAdd(chunk);
  });

  if (!selected.length) {
    references.forEach(ref => {
      ref.chunks.slice(0, 2).forEach(tryAdd);
    });
  }

  return selected.sort((a, b) => {
    if (a.referenceId !== b.referenceId) {
      return REFERENCE_FILES.findIndex(ref => ref.id === a.referenceId) -
        REFERENCE_FILES.findIndex(ref => ref.id === b.referenceId);
    }
    return a.order - b.order;
  });
}

function scoreChunk(chunk, keywords, normalizedQuery, defaultBoost) {
  let score = 0;

  keywords.forEach(({ token, weight }) => {
    if (chunk.searchText.includes(token)) score += weight;
  });

  BOOST_RULES.forEach(rule => {
    const hasTrigger = rule.triggers.some(trigger => normalizedQuery.includes(trigger));
    if (!hasTrigger) return;
    const hasTarget = rule.targets.some(target => chunk.searchText.includes(target));
    if (hasTarget) score += 12;
  });

  if (IMPORTANT_HEADINGS.some(heading => chunk.searchText.includes(heading))) {
    score += 4;
  }

  return score > 0 ? score + defaultBoost : 0;
}

function extractKeywords(text) {
  const counts = new Map();
  const tokens = normalizeText(text).match(/[a-z0-9][a-z0-9-]{2,}/g) || [];

  tokens.forEach(token => {
    if (token.length < 4 || STOP_WORDS.has(token)) return;
    counts.set(token, (counts.get(token) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([token, count]) => ({ token, weight: Math.min(count, 5) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 80);
}

function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9§-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export {
  RP_LEGAL_REFERENCES_ENABLED,
  buildRpLegalAnalysisText,
  buildRpLegalReferenceContext
};
