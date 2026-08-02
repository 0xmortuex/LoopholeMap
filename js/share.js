/* =========================================================================
   Copy & Share — plain-text reports and self-contained shareable links.

   The app is a static site with no result storage, so a shared link carries
   the whole analysis in its URL fragment: JSON → gzip → base64url. The
   fragment never leaves the browser (it isn't sent to the server), and the
   recipient's page rebuilds the board from it without a rescan.
   ========================================================================= */

import {
  POSSIBILITY_LABELS, DIFFICULTY_LABELS, EFFECTIVENESS_LABELS, IMPORTANCE_LABELS
} from './parser.js';

const SHARE_VERSION = 1;
const SHARE_PARAM = 'r';
// Browsers handle far longer URLs, but chat apps and mail clients start
// truncating well before this. Past the cap we copy the report text instead.
const MAX_SHARE_URL_CHARS = 8000;

/* ===== Plain-text report ===== */

const RULE = '='.repeat(60);
const THIN_RULE = '-'.repeat(60);

function titleCase(value) {
  return String(value || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Stakeholders and scenario steps come back either as plain strings or as
// objects, depending on how the model shaped them.
function stakeholderLine(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return `${entry.who || ''}${entry.how ? ` — ${entry.how}` : ''}`;
  return '';
}

function stepLine(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') return entry.description || entry.step || '';
  return '';
}

function pushSection(lines, heading, body) {
  if (!body || !String(body).trim()) return;
  lines.push(heading);
  lines.push(String(body).trim());
  lines.push('');
}

function relatedIssueLines(node, data) {
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const related = [];
  (data.connections || []).forEach(c => {
    const source = typeof c.source === 'object' ? c.source.id : c.source;
    const target = typeof c.target === 'object' ? c.target.id : c.target;
    const otherId = source === node.id ? target : target === node.id ? source : null;
    if (!otherId) return;
    const other = byId.get(otherId);
    if (!other) return;
    const relation = c.type ? ` (${titleCase(c.type)})` : '';
    const why = c.description ? ` — ${c.description}` : '';
    related.push(`- ${other.title}${relation}${why}`);
  });
  return related;
}

/**
 * Full plain-text report.
 * `deepDives` is an optional Map of nodeId -> parsed detail response; any node
 * present there gets its deep analysis, exploit scenario, stakeholders, and
 * closing strategies included.
 */
function buildIssuesReport(data, rpMode, deepDives = new Map()) {
  const lines = [];
  const count = data.nodes.length;

  lines.push(RULE);
  lines.push('LOOPHOLEMAP ANALYSIS');
  lines.push(data.title);
  lines.push(RULE);
  lines.push('');
  lines.push(`Mode:          ${rpMode ? 'CUSA / RP Law' : 'Real-World Law'}`);
  lines.push(`Overall risk:  ${String(data.overallRisk).toUpperCase()}`);
  lines.push(`Issues found:  ${count}`);
  lines.push('');
  pushSection(lines, 'SUMMARY', data.summary);

  data.nodes.forEach((n, i) => {
    lines.push(THIN_RULE);
    lines.push(`ISSUE ${i + 1} OF ${count} — ${String(n.severity).toUpperCase()}`);
    lines.push(n.title);
    lines.push(THIN_RULE);
    lines.push('');
    lines.push(`Type:           ${titleCase(n.type)}`);
    if (n.section) lines.push(`Section:        ${n.section}`);
    lines.push(`Severity:       ${titleCase(n.severity)}`);
    lines.push(`Possibility:    ${POSSIBILITY_LABELS[n.possibility] || '—'}   (how likely it is to happen)`);
    lines.push(`Difficulty:     ${DIFFICULTY_LABELS[n.difficulty] || '—'}   (how hard it is to exploit)`);
    lines.push(`Effectiveness:  ${EFFECTIVENESS_LABELS[n.effectiveness] || '—'}   (impact if exploited)`);
    lines.push(`Importance:     ${IMPORTANCE_LABELS[n.importance] || '—'}   (priority to fix)`);
    lines.push('');

    pushSection(lines, "WHAT'S THE ISSUE", n.description);
    pushSection(lines, 'HOW IT CAN BE EXPLOITED', n.exploitation);
    pushSection(lines, 'REAL-WORLD PARALLEL', n.realWorldParallel);
    pushSection(lines, 'SUGGESTED FIX', n.suggestedFix);

    const related = relatedIssueLines(n, data);
    if (related.length) {
      lines.push('RELATED ISSUES');
      lines.push(...related);
      lines.push('');
    }

    const detail = deepDives.get(n.id);
    if (detail) {
      pushSection(lines, 'DEEP ANALYSIS', detail.deepDive);

      const scenario = (detail.exploitScenario || []).map(stepLine).filter(Boolean);
      if (scenario.length) {
        const diff = detail.exploitDifficulty ? ` (difficulty: ${titleCase(detail.exploitDifficulty)})` : '';
        lines.push(`EXPLOIT SCENARIO${diff}`);
        scenario.forEach((step, si) => lines.push(`${si + 1}. ${step}`));
        lines.push('');
      }

      const benefits = (detail.stakeholders?.benefits || []).map(stakeholderLine).filter(Boolean);
      const harmed = (detail.stakeholders?.harmed || []).map(stakeholderLine).filter(Boolean);
      if (benefits.length || harmed.length) {
        lines.push('STAKEHOLDER IMPACT');
        if (benefits.length) {
          lines.push('  Who benefits:');
          benefits.forEach(b => lines.push(`  - ${b}`));
        }
        if (harmed.length) {
          lines.push("  Who's harmed:");
          harmed.forEach(h => lines.push(`  - ${h}`));
        }
        lines.push('');
      }

      const strategies = detail.closingStrategies || [];
      if (strategies.length) {
        lines.push('WAYS TO CLOSE IT');
        strategies.forEach((s, si) => {
          lines.push(`${si + 1}. ${s.approach || 'Approach'}${s.difficulty ? ` (${titleCase(s.difficulty)})` : ''}`);
          if (s.description) lines.push(`   ${s.description}`);
          if (s.sideEffects) lines.push(`   Side effects: ${s.sideEffects}`);
        });
        lines.push('');
      }
    }
  });

  if (data.filteredOwnershipTeamNodes > 0) {
    lines.push(THIN_RULE);
    lines.push(`Note: ${data.filteredOwnershipTeamNodes} Ownership Team-only finding${data.filteredOwnershipTeamNodes === 1 ? ' was' : 's were'} excluded (OT authority is supreme in this RP setting).`);
    lines.push('');
  }

  lines.push(RULE);
  lines.push('Generated by LoopholeMap');
  return lines.join('\n');
}

/* ===== Clipboard ===== */

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path below */
    }
  }

  // execCommand is deprecated but remains the only clipboard route on
  // insecure origins and older mobile browsers.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/* ===== base64url <-> bytes ===== */

function bytesToBase64Url(bytes) {
  let binary = '';
  const CHUNK = 0x8000; // avoid blowing the argument limit on large payloads
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeThrough(transform, bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ===== Share payload encode / decode ===== */

// Prefixes mark the encoding so a link made in a gzip-capable browser still
// decodes in one that lacks CompressionStream, and vice versa.
async function encodeSharePayload(data, rpMode) {
  const payload = { v: SHARE_VERSION, m: rpMode ? 'rp' : 'real', d: data };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));

  if (typeof CompressionStream === 'function') {
    try {
      return 'g' + bytesToBase64Url(await pipeThrough(new CompressionStream('gzip'), bytes));
    } catch {
      /* fall back to the uncompressed form */
    }
  }
  return 'u' + bytesToBase64Url(bytes);
}

const TRUNCATED = 'That share link looks incomplete or damaged — ask for it again, unshortened.';

async function decodeSharePayload(token) {
  const flag = token[0];

  if (flag === 'g' && typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open compressed share links.');
  }
  if (flag !== 'g' && flag !== 'u') {
    throw new Error('Unrecognized share link format.');
  }

  // Base64, gzip, and JSON errors all mean the same thing to the user: the
  // link arrived mangled (usually truncated by a chat app).
  let payload;
  try {
    let bytes = base64UrlToBytes(token.slice(1));
    if (flag === 'g') bytes = await pipeThrough(new DecompressionStream('gzip'), bytes);
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(TRUNCATED);
  }

  if (!payload || payload.v !== SHARE_VERSION || !payload.d || !Array.isArray(payload.d.nodes)) {
    throw new Error('This share link was made by a different version of LoopholeMap.');
  }
  return { data: payload.d, rpMode: payload.m !== 'real' };
}

async function buildShareUrl(data, rpMode) {
  const token = await encodeSharePayload(data, rpMode);
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${SHARE_PARAM}=${token}`;
}

// Returns the token from the current URL fragment, or null.
function readShareToken() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!hash) return null;
  const match = new URLSearchParams(hash).get(SHARE_PARAM);
  return match || null;
}

function clearShareToken() {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

export {
  buildIssuesReport, copyText,
  buildShareUrl, decodeSharePayload, readShareToken, clearShareToken,
  MAX_SHARE_URL_CHARS
};
