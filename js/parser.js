const VALID_TYPES = [
  'loophole', 'exemption', 'gray-area', 'contradiction',
  'missing-definition', 'weak-enforcement', 'scope-gap', 'sunset-clause',
  'constitutional-conflict', 'coj-inconsistency', 'requires-amendment'
];

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low'];

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

  const nodes = parsed.nodes.map((n, i) => validateNode(n, i)).filter(Boolean);

  if (nodes.length === 0) {
    throw new Error('No valid nodes found in response');
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  const connections = (parsed.connections || [])
    .map(c => validateConnection(c, nodeIds))
    .filter(Boolean);

  return {
    title: typeof parsed.title === 'string' ? parsed.title : 'Regulation Analysis',
    overallRisk: VALID_RISK_LEVELS.includes(parsed.overallRisk) ? parsed.overallRisk : 'medium',
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'Analysis complete.',
    nodes,
    connections
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

  return { id, title, type, severity, section, description, exploitation, realWorldParallel, suggestedFix };
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
    exploitDifficulty: ['easy', 'moderate', 'hard'].includes(parsed.exploitDifficulty)
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

export { parseAnalysisResponse, parseDetailResponse, parseAskResponse, VALID_TYPES, VALID_RELATIONSHIP_TYPES };
