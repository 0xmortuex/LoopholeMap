import { getNodeDetail, askAI } from './api.js';
import { parseDetailResponse, parseAskResponse } from './parser.js';
import { TYPE_COLORS } from './graph.js';

const deepDiveCache = new Map();
let allNodes = [];
let allConnections = [];
let currentNode = null;
let overallContext = '';
let chatMessages = [];
let activeTab = 'detail';
let onJumpToNode = null;

function $(id) { return document.getElementById(id); }

function initPanel(nodes, connections, callbacks = {}) {
  allNodes = nodes;
  allConnections = connections;
  currentNode = null;
  chatMessages = [];
  onJumpToNode = callbacks.onJumpToNode || null;

  $('detail-view').innerHTML = `<div class="detail-placeholder">Click a node in the graph to see its full analysis here.</div>`;
  $('chat-messages').innerHTML = '';
  $('chat-context').textContent = '';
  renderChatStarters();
  setTab('detail');
}

function setOverallContext(text) {
  overallContext = text;
}

function openPanel() {
  $('side-panel').classList.add('open');
}

function closePanel() {
  $('side-panel').classList.remove('open');
}

function setTab(tab) {
  activeTab = tab;
  $('tab-detail').classList.toggle('active', tab === 'detail');
  $('tab-ask').classList.toggle('active', tab === 'ask');
  $('detail-view').hidden = tab !== 'detail';
  $('chat-view').hidden = tab !== 'ask';
}

function wireTabs() {
  $('tab-detail').addEventListener('click', () => setTab('detail'));
  $('tab-ask').addEventListener('click', () => { setTab('ask'); updateChatContextLabel(); });
  $('panel-close').addEventListener('click', closePanel);
  $('chat-send-btn').addEventListener('click', submitQuestion);
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitQuestion();
  });
}

function openNodeDetail(node) {
  currentNode = node;
  renderDetail(node);
  openPanel();
  setTab('detail');
  fetchDeepDive(node);
}

function openChatGeneral() {
  openPanel();
  setTab('ask');
  updateChatContextLabel();
}

function updateChatContextLabel() {
  const ctxEl = $('chat-context');
  if (currentNode) {
    ctxEl.textContent = `Asking about: ${currentNode.title}`;
  } else {
    ctxEl.textContent = overallContext ? 'Asking about the overall analysis' : '';
  }
}

function renderDetail(node) {
  const typeLabel = node.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const typeColor = TYPE_COLORS[node.type] || '#64748b';
  const connected = getConnectedNodes(node.id);
  const view = $('detail-view');
  view.innerHTML = '';

  const badges = el('div', 'detail-badges');
  const typeBadge = el('span', 'type-badge');
  typeBadge.style.setProperty('--type-color', typeColor);
  typeBadge.textContent = typeLabel;
  const sevBadge = el('span', `severity-badge ${node.severity}`);
  sevBadge.textContent = node.severity;
  badges.append(typeBadge, sevBadge);
  view.appendChild(badges);

  const title = el('h2', 'detail-title');
  title.textContent = node.title;
  view.appendChild(title);

  if (node.section) {
    const ref = el('div', 'detail-section-ref');
    ref.textContent = node.section;
    view.appendChild(ref);
  }

  const blocks = [
    ['What’s the Issue', node.description, typeColor, false],
    ['How It Can Be Exploited', node.exploitation, '#f97316', false],
    ['Real-World Parallel', node.realWorldParallel, '#6366f1', false],
    ['Suggested Fix', node.suggestedFix, '#22c55e', true]
  ];

  blocks.forEach(([label, text, color, isFix]) => {
    if (!text) return;
    const block = el('div', 'detail-block');
    block.style.setProperty('--block-color', color);
    const heading = el('div', 'detail-block-title');
    heading.textContent = label;
    block.appendChild(heading);
    const body = el('div', isFix ? 'fix-block' : 'detail-block-text');
    body.textContent = text;
    block.appendChild(body);
    view.appendChild(block);
  });

  if (connected.length) {
    const block = el('div', 'detail-block');
    block.style.setProperty('--block-color', 'var(--accent-2)');
    const heading = el('div', 'detail-block-title');
    heading.textContent = 'Connected Issues';
    block.appendChild(heading);
    const chips = el('div', 'connected-chips');
    connected.forEach(c => {
      const chip = el('span', 'connected-chip');
      const dot = el('span', 'chip-dot');
      dot.style.background = TYPE_COLORS[c.type] || '#64748b';
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(c.title.length > 30 ? c.title.slice(0, 28) + '…' : c.title));
      chip.addEventListener('click', () => {
        if (onJumpToNode) onJumpToNode(c.id);
        openNodeDetail(c);
      });
      chips.appendChild(chip);
    });
    block.appendChild(chips);
    view.appendChild(block);
  }

  const deepDiveContainer = el('div', '');
  deepDiveContainer.id = 'deep-dive-container';
  view.appendChild(deepDiveContainer);
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

async function fetchDeepDive(node) {
  const container = $('deep-dive-container');
  if (!container) return;

  if (deepDiveCache.has(node.id)) {
    renderDeepDive(deepDiveCache.get(node.id));
    return;
  }

  container.innerHTML = `
    <div class="deep-dive-loading">
      <div class="deep-dive-spinner"></div>
      Loading deep analysis...
    </div>
  `;

  try {
    const raw = await getNodeDetail(node);
    const detail = parseDetailResponse(raw);
    deepDiveCache.set(node.id, detail);
    if (currentNode && currentNode.id === node.id) renderDeepDive(detail);
  } catch (err) {
    if (currentNode && currentNode.id === node.id) {
      container.innerHTML = `<div class="deep-dive-loading" style="color: var(--sev-critical)">Failed to load deep dive: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderDeepDive(detail) {
  const container = $('deep-dive-container');
  if (!container) return;

  const hasStakeholders = detail.stakeholders.benefits.length || detail.stakeholders.harmed.length;

  container.innerHTML = `
    ${hasStakeholders ? `
      <div class="detail-block" style="--block-color: var(--accent-purple)">
        <div class="detail-block-title">Stakeholder Impact</div>
        <div class="stakeholder-grid">
          <div class="stakeholder-card benefits">
            <div class="stakeholder-label">Who Benefits</div>
            <ul class="stakeholder-list">${detail.stakeholders.benefits.map(s => `<li>${escapeHtml(stakeholderLine(s))}</li>`).join('')}</ul>
          </div>
          <div class="stakeholder-card harmed">
            <div class="stakeholder-label">Who's Harmed</div>
            <ul class="stakeholder-list">${detail.stakeholders.harmed.map(s => `<li>${escapeHtml(stakeholderLine(s))}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
    ` : ''}
    ${detail.closingStrategies.length ? `
      <div class="detail-block" style="--block-color: var(--accent-green)">
        <div class="detail-block-title">Closing Strategies</div>
        ${detail.closingStrategies.map(s => `
          <div class="strategy-card">
            <div class="strategy-name">${escapeHtml(s.approach)}</div>
            <div class="strategy-desc">${escapeHtml(s.description)}</div>
            <div class="strategy-meta">
              <span class="difficulty-badge ${s.difficulty}">${s.difficulty}</span>
              ${s.sideEffects ? `<span class="strategy-side-effects">${escapeHtml(s.sideEffects)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${detail.exploitScenario.length ? `
      <div class="detail-block" style="--block-color: var(--sev-critical)">
        <div class="detail-block-title">Exploit Scenario</div>
        <ol class="scenario-steps">${detail.exploitScenario.map(step => `<li>${escapeHtml(stepLine(step))}</li>`).join('')}</ol>
      </div>
    ` : ''}
    ${detail.exploitDifficulty ? `
      <div class="detail-block" style="--block-color: var(--sev-medium)">
        <div class="detail-block-title">Exploit Difficulty</div>
        <span class="exploit-difficulty ${detail.exploitDifficulty}">${detail.exploitDifficulty}</span>
      </div>
    ` : ''}
    ${detail.deepDive ? `
      <div class="detail-block" style="--block-color: var(--border)">
        <div class="detail-block-title">Deeper Analysis</div>
        <div class="detail-block-text">${escapeHtml(detail.deepDive)}</div>
      </div>
    ` : ''}
  `;
}

function stakeholderLine(s) {
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object') return `${s.who || ''}${s.how ? ' — ' + s.how : ''}`;
  return '';
}

function stepLine(s) {
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object') return s.description || s.step || JSON.stringify(s);
  return '';
}

function getConnectedNodes(nodeId) {
  const ids = new Set();
  allConnections.forEach(c => {
    const s = typeof c.source === 'object' ? c.source.id : c.source;
    const t = typeof c.target === 'object' ? c.target.id : c.target;
    if (s === nodeId) ids.add(t);
    if (t === nodeId) ids.add(s);
  });
  return allNodes.filter(n => ids.has(n.id));
}

/* ===== Ask AI chat ===== */

function renderChatStarters() {
  const wrap = $('chat-starters');
  const starters = [
    "What's the most dangerous loophole overall?",
    'If I could only fix 3 things, which should I prioritize?',
    'Who benefits most from these loopholes?'
  ];
  wrap.innerHTML = '';
  starters.forEach(s => {
    const chip = el('span', 'chat-suggestion-chip');
    chip.textContent = s;
    chip.addEventListener('click', () => {
      $('chat-input').value = s;
      submitQuestion();
    });
    wrap.appendChild(chip);
  });
  wrap.hidden = false;
}

function buildContext() {
  if (currentNode) {
    return {
      contextType: 'node',
      contextData: `Node: ${currentNode.title} (${currentNode.type}, ${currentNode.severity})\nSection: ${currentNode.section || ''}\nDescription: ${currentNode.description || ''}`
    };
  }
  return { contextType: 'general', contextData: overallContext || 'general' };
}

async function submitQuestion() {
  const input = $('chat-input');
  const sendBtn = $('chat-send-btn');
  const msgsEl = $('chat-messages');
  const startersEl = $('chat-starters');
  if (!input.value.trim()) return;

  const question = input.value.trim();
  input.value = '';
  sendBtn.disabled = true;
  startersEl.hidden = true;

  chatMessages.push({ role: 'user', text: question });
  renderChatMessages();
  const loading = el('div', 'chat-loading');
  loading.innerHTML = '<span class="chat-loading-dot"></span><span class="chat-loading-dot"></span><span class="chat-loading-dot"></span>';
  msgsEl.appendChild(loading);
  msgsEl.scrollTop = msgsEl.scrollHeight;

  try {
    const { contextType, contextData } = buildContext();
    const raw = await askAI(contextType, contextData, question);
    const parsed = parseAskResponse(raw);
    chatMessages.push({ role: 'ai', text: parsed.answer, followUps: parsed.followUpSuggestions });
  } catch (err) {
    chatMessages.push({ role: 'ai', text: `Error: ${err.message}` });
  }

  renderChatMessages();
  msgsEl.scrollTop = msgsEl.scrollHeight;
  sendBtn.disabled = false;
  input.focus();
}

function renderChatMessages() {
  const msgsEl = $('chat-messages');
  msgsEl.innerHTML = '';
  chatMessages.forEach(m => {
    const bubble = el('div', `chat-msg ${m.role}`);
    bubble.textContent = m.text;
    msgsEl.appendChild(bubble);
  });
  const last = chatMessages[chatMessages.length - 1];
  if (last && last.role === 'ai' && last.followUps && last.followUps.length) {
    const wrap = el('div', 'chat-followups');
    last.followUps.forEach(s => {
      const chip = el('span', 'chat-suggestion-chip');
      chip.textContent = s;
      chip.addEventListener('click', () => {
        $('chat-input').value = s;
        submitQuestion();
      });
      wrap.appendChild(chip);
    });
    msgsEl.appendChild(wrap);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

wireTabs();

export { initPanel, setOverallContext, openNodeDetail, openChatGeneral, closePanel };
