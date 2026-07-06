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

const VALID_RELATIONSHIP_TYPES = ['enables', 'weakens', 'contradicts', 'depends-on', 'amplifies'];

const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical'];

function parseAnalysisResponse(raw) {
  let parsed;

  if (typeof raw === 'string') {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse AI response as JSON');
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
  const connectedNodes = Array.isArray(node.connectedNodes)
    ? node.connectedNodes.filter(x => typeof x === 'string')
    : [];

  return {
    id, title, type, severity, section, description, exploitation,
    realWorldParallel, suggestedFix, possibility, difficulty, connectedNodes
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
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse detail response');
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
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
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
  POSSIBILITY_LABELS, DIFFICULTY_LABELS
};
