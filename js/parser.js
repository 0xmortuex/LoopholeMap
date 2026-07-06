const VALID_TYPES = [
  'loophole', 'exemption', 'gray-area', 'contradiction',
  'missing-definition', 'weak-enforcement', 'scope-gap', 'sunset-clause',
  'constitutional-conflict', 'coj-inconsistency', 'requires-amendment'
];

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];

const VALID_POSSIBILITIES = ['very-low', 'low', 'medium', 'high', 'very-high'];

const POSSIBILITY_LABELS = {
  'very-low': 'Very low',
  'low': 'Low',
  'medium': 'Medium',
  'high': 'High',
  'very-high': 'Very high'
};

const VALID_DIFFICULTIES = ['easy', 'moderate', 'hard', 'very-hard'];

const DIFFICULTY_LABELS = {
  'easy': 'Easy',
  'moderate': 'Moderate',
  'hard': 'Hard',
  'very-hard': 'Very hard'
};

const VALID_EFFECTIVENESS = ['very-low', 'low', 'medium', 'high', 'very-high'];

const EFFECTIVENESS_LABELS = {
  'very-low': 'Very low',
  'low': 'Low',
  'medium': 'Medium',
  'high': 'High',
  'very-high': 'Very high'
};

const VALID_IMPORTANCE = ['very-low', 'low', 'medium', 'high', 'very-high'];

const IMPORTANCE_LABELS = {
  'very-low': 'Very low',
  'low': 'Low',
  'medium': 'Medium',
  'high': 'High',
  'very-high': 'Very high'
};

const VALID_RELATIONSHIP_TYPES = ['enables', 'weakens', 'contradicts', 'depends-on', 'amplifies'];

const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

// Robustly recover a JSON object from a model response that may be wrapped in
// prose or markdown fences, or truncated by the model's max_tokens limit.
// Returns the parsed object, or undefined if nothing usable could be recovered.
function extractJsonObject(raw) {
  if (raw == null) return undefined;
  let s = String(raw).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  if (start === -1) return undefined;
  s = s.slice(start);

  // Fast path: the response contains a complete object.
  const lastClose = s.lastIndexOf('}');
  if (lastClose !== -1) {
    try { return JSON.parse(s.slice(0, lastClose + 1)); } catch { /* fall through to salvage */ }
  }

  // Salvage a truncated object: trim to the last complete element and close any
  // still-open arrays/objects so the recovered portion parses.
  const salvaged = closeTruncatedJson(lastClose !== -1 ? s.slice(0, lastClose + 1) : s);
  if (salvaged) {
    try { return JSON.parse(salvaged); } catch { /* unrecoverable */ }
  }
  return undefined;
}

// Balance unclosed { and [ in a JSON fragment (ignoring brackets inside
// strings) and drop a dangling trailing comma. Returns null if the fragment
// ends mid-string (unsafe to close).
function closeTruncatedJson(fragment) {
  let s = fragment.replace(/[\s,]+$/, '');
  const closers = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') closers.push('}');
    else if (c === '[') closers.push(']');
    else if (c === '}' || c === ']') closers.pop();
  }
  if (inStr) return null;
  while (closers.length) s += closers.pop();
  return s;
}

function parseAnalysisResponse(raw) {
  let parsed;

  if (typeof raw === 'string') {
    parsed = extractJsonObject(raw);
    if (parsed === undefined) {
      throw new Error('Could not read the AI response — it may have been cut off. Try again, or scan a shorter bill.');
    }
  } else {
    parsed = raw;
  }

  if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
    throw new Error('Response missing nodes array');
  }

  const validatedNodes = parsed.nodes.map((n, i) => validateNode(n, i)).filter(Boolean);
  const nodes = validatedNodes.filter(node => !isOwnershipTeamAuthorityNode(node));
  const filteredOwnershipTeamNodes = validatedNodes.length - nodes.length;

  if (nodes.length === 0) {
    if (filteredOwnershipTeamNodes > 0) {
      return buildOwnershipTeamOnlyResult(parsed, filteredOwnershipTeamNodes);
    }
    throw new Error('No valid nodes found in response');
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  let connections = (parsed.connections || [])
    .map(c => validateConnection(c, nodeIds))
    .filter(Boolean);

  // Fall back to nodes[].connectedNodes when the model didn't return a
  // connections array (or returned an empty one) — still gives the graph
  // something to link.
  if (connections.length === 0) {
    connections = buildConnectionsFromConnectedNodes(nodes, nodeIds);
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title : 'Regulation Analysis',
    overallRisk: VALID_RISK_LEVELS.includes(parsed.overallRisk) ? parsed.overallRisk : 'medium',
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'Analysis complete.',
    nodes,
    connections,
    filteredOwnershipTeamNodes
  };
}

function validateNode(node, index) {
  if (!node || typeof node !== 'object') return null;

  const id = node.id || `node-${index}`;
  const title = typeof node.title === 'string' ? node.title : `Issue ${index + 1}`;
  const type = VALID_TYPES.includes(node.type) ? node.type : 'loophole';
  const severity = VALID_SEVERITIES.includes(node.severity) ? node.severity : 'medium';
  const section = typeof node.section === 'string' ? node.section : '';
  const description = typeof node.description === 'string' ? node.description : '';
  const exploitation = typeof node.exploitation === 'string' ? node.exploitation : '';
  const realWorldParallel = typeof node.realWorldParallel === 'string' ? node.realWorldParallel : '';
  const suggestedFix = typeof node.suggestedFix === 'string' ? node.suggestedFix : '';
  const possibility = normalizePossibility(
    node.possibility ?? node.possibilityOfHappening ?? node.likelihood ?? node.probability ?? node.chance
  );
  const difficulty = normalizeDifficulty(node.difficulty ?? node.exploitDifficulty ?? node.exploitationDifficulty);
  const effectiveness = normalizeEffectiveness(
    node.effectiveness ?? node.effect ?? node.impact ?? node.exploitEffectiveness
  );
  const importance = normalizeImportance(
    node.importance ?? node.significance ?? node.priority ?? node.materiality
  );
  const connectedNodes = Array.isArray(node.connectedNodes)
    ? node.connectedNodes.filter(x => typeof x === 'string')
    : [];

  return {
    id, title, type, severity, section, description, exploitation,
    realWorldParallel, suggestedFix, possibility, difficulty,
    effectiveness, importance, connectedNodes
  };
}

function buildOwnershipTeamOnlyResult(parsed, filteredOwnershipTeamNodes) {
  return {
    title: typeof parsed.title === 'string' ? parsed.title : 'Regulation Analysis',
    overallRisk: 'low',
    summary: `No reportable non-OT vulnerabilities found. ${filteredOwnershipTeamNodes} Ownership Team-only finding${filteredOwnershipTeamNodes === 1 ? ' was' : 's were'} excluded because OT authority is supreme in this RP setting.`,
    nodes: [],
    connections: [],
    filteredOwnershipTeamNodes
  };
}

function isOwnershipTeamAuthorityNode(node) {
  const text = normalizeOwnershipFilterText([
    node.title,
    node.type,
    node.section,
    node.description,
    node.exploitation,
    node.realWorldParallel,
    node.suggestedFix,
    ...(node.connectedNodes || [])
  ].join(' '));

  if (!hasOwnershipTeamReference(text)) return false;

  // OT itself is not a loophole in this RP setting. Keep findings only when
  // the issue is a non-OT actor receiving or pretending to have OT authority.
  return !isNonOtDelegationOrImpersonationIssue(text);
}

function hasOwnershipTeamReference(text) {
  return /\bownership team\b|\bot\b/.test(text);
}

function isNonOtDelegationOrImpersonationIssue(text) {
  const exceptionPatterns = [
    /\bnon[-\s]?ot\b/,
    /\bnon[-\s]?ownership team\b/,
    /\bnot (?:the )?ownership team\b/,
    /\boutside (?:the )?ownership team\b/,
    /\bunauthorized\b.*\b(?:ownership team|ot)\b/,
    /\b(?:impersonat|pretend|masquerad|pose as|claim(?:s|ed|ing)? to be)\b.*\b(?:ownership team|ot)\b/
  ];
  return exceptionPatterns.some(pattern => pattern.test(text));
}

function normalizeOwnershipFilterText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePossibility(value) {
  const normalized = normalizeRating(value);
  const aliases = {
    'verylow': 'very-low',
    'very-low': 'very-low',
    'very low': 'very-low',
    'very unlikely': 'very-low',
    'rare': 'very-low',
    'unlikely': 'low',
    'low': 'low',
    'possible': 'medium',
    'medium': 'medium',
    'moderate': 'medium',
    'likely': 'high',
    'high': 'high',
    'veryhigh': 'very-high',
    'very-high': 'very-high',
    'very high': 'very-high',
    'very likely': 'very-high',
    'almost certain': 'very-high'
  };
  return aliases[normalized] || 'medium';
}

function normalizeDifficulty(value) {
  const normalized = normalizeRating(value);
  const aliases = {
    'easy': 'easy',
    'low': 'easy',
    'simple': 'easy',
    'moderate': 'moderate',
    'medium': 'moderate',
    'hard': 'hard',
    'high': 'hard',
    'difficult': 'hard',
    'veryhard': 'very-hard',
    'very-hard': 'very-hard',
    'very hard': 'very-hard',
    'very difficult': 'very-hard',
    'extreme': 'very-hard'
  };
  return aliases[normalized] || 'moderate';
}

function normalizeEffectiveness(value) {
  const normalized = normalizeRating(value);
  const aliases = {
    'verylow': 'very-low',
    'very-low': 'very-low',
    'very low': 'very-low',
    'ineffective': 'very-low',
    'negligible': 'very-low',
    'minimal': 'very-low',
    'low': 'low',
    'limited': 'low',
    'weak': 'low',
    'partial': 'medium',
    'medium': 'medium',
    'moderate': 'medium',
    'effective': 'high',
    'high': 'high',
    'strong': 'high',
    'veryhigh': 'very-high',
    'very-high': 'very-high',
    'very high': 'very-high',
    'highly effective': 'very-high',
    'decisive': 'very-high',
    'total': 'very-high'
  };
  return aliases[normalized] || 'medium';
}

function normalizeImportance(value) {
  const normalized = normalizeRating(value);
  const aliases = {
    'verylow': 'very-low',
    'very-low': 'very-low',
    'very low': 'very-low',
    'trivial': 'very-low',
    'negligible': 'very-low',
    'low': 'low',
    'minor': 'low',
    'medium': 'medium',
    'moderate': 'medium',
    'notable': 'medium',
    'high': 'high',
    'important': 'high',
    'major': 'high',
    'significant': 'high',
    'veryhigh': 'very-high',
    'very-high': 'very-high',
    'very high': 'very-high',
    'critical': 'very-high',
    'essential': 'very-high',
    'vital': 'very-high'
  };
  return aliases[normalized] || 'medium';
}

function normalizeRating(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildConnectionsFromConnectedNodes(nodes, nodeIds) {
  const seenPairs = new Set();
  const connections = [];
  nodes.forEach(node => {
    (node.connectedNodes || []).forEach(targetId => {
      if (!nodeIds.has(targetId) || targetId === node.id) return;
      const pairKey = [node.id, targetId].sort().join('|');
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);
      connections.push({ source: node.id, target: targetId, type: 'enables', description: '' });
    });
  });
  return connections;
}

function validateConnection(conn, nodeIds) {
  if (!conn || typeof conn !== 'object') return null;
  if (!nodeIds.has(conn.source) || !nodeIds.has(conn.target)) return null;

  return {
    source: conn.source,
    target: conn.target,
    type: VALID_RELATIONSHIP_TYPES.includes(conn.type) ? conn.type : 'enables',
    description: typeof conn.description === 'string' ? conn.description : ''
  };
}

function parseDetailResponse(raw) {
  let parsed;

  if (typeof raw === 'string') {
    parsed = extractJsonObject(raw);
    if (parsed === undefined) {
      throw new Error('Could not read the detail response — it may have been cut off. Try again.');
    }
  } else {
    parsed = raw;
  }

  return {
    deepDive: typeof parsed.deepDive === 'string' ? parsed.deepDive : '',
    stakeholders: {
      benefits: Array.isArray(parsed.stakeholders?.benefits) ? parsed.stakeholders.benefits : [],
      harmed: Array.isArray(parsed.stakeholders?.harmed) ? parsed.stakeholders.harmed : []
    },
    closingStrategies: Array.isArray(parsed.closingStrategies)
      ? parsed.closingStrategies.map(s => ({
          approach: s.approach || 'Unknown',
          description: s.description || '',
          difficulty: ['easy', 'moderate', 'hard'].includes(s.difficulty) ? s.difficulty : 'moderate',
          sideEffects: s.sideEffects || ''
        }))
      : [],
    exploitScenario: Array.isArray(parsed.exploitScenario) ? parsed.exploitScenario : [],
    exploitDifficulty: VALID_DIFFICULTIES.includes(parsed.exploitDifficulty)
      ? parsed.exploitDifficulty : 'moderate'
  };
}

function parseAskResponse(raw) {
  let parsed;

  if (typeof raw === 'string') {
    parsed = extractJsonObject(raw);
    if (parsed === undefined) {
      return { answer: raw, followUpSuggestions: [] };
    }
  } else {
    parsed = raw;
  }

  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer : 'No answer received.',
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions)
      ? parsed.followUpSuggestions.filter(s => typeof s === 'string').slice(0, 3)
      : []
  };
}

export {
  parseAnalysisResponse, parseDetailResponse, parseAskResponse,
  VALID_TYPES, VALID_RELATIONSHIP_TYPES, VALID_POSSIBILITIES, VALID_DIFFICULTIES,
  VALID_EFFECTIVENESS, VALID_IMPORTANCE,
  POSSIBILITY_LABELS, DIFFICULTY_LABELS, EFFECTIVENESS_LABELS, IMPORTANCE_LABELS
};
