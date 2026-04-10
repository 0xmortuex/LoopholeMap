import { getNodeDetail, askAI } from './api.js';
import { parseDetailResponse, parseAskResponse } from './parser.js';
import { TYPE_COLORS, centerOnNode } from './graph.js';

const deepDiveCache = new Map();
const sectionChats = new Map(); // key: `${nodeId}-${sectionKey}` -> { messages: [] }
let currentNodeId = null;
let allNodes = [];
let allConnections = [];

const SECTION_SUGGESTIONS = {
  issue: [
    'Why is this specific language problematic?',
    'Are there jurisdictions that handle this better?',
    'What was the likely legislative intent here?'
  ],
  exploit: [
    'How likely is this exploitation in practice?',
    'Has this type of exploit been used before?',
    'What would it cost to exploit this?'
  ],
  parallel: [
    'What was the outcome in that real-world case?',
    'How did regulators eventually respond?',
    'Could that happen under this regulation?'
  ],
  fix: [
    'Would this fix create new loopholes?',
    'How have other jurisdictions solved this?',
    'What is the easiest version of this fix to implement?'
  ],
  stakeholders: [
    'Which stakeholder group is most affected?',
    'Are there hidden beneficiaries not listed?',
    'How would closing this shift the power balance?'
  ],
  strategies: [
    'Which strategy has the best cost-benefit ratio?',
    'What political obstacles would each strategy face?',
    'Can these strategies be combined?'
  ],
  scenario: [
    'How long would this exploitation take to execute?',
    'What resources would an exploiter need?',
    'How could regulators detect this in progress?'
  ]
};

function initModal(nodes, connections) {
  allNodes = nodes;
  allConnections = connections;
}

function openModal(node) {
  currentNodeId = node.id;
  const backdrop = document.getElementById('modal-backdrop');
  const modal = backdrop.querySelector('.modal');

  renderModalContent(modal, node);
  backdrop.classList.add('active');

  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };

  document.addEventListener('keydown', handleEsc);
}

function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.classList.remove('active');
  currentNodeId = null;
  document.removeEventListener('keydown', handleEsc);
}

function handleEsc(e) {
  if (e.key === 'Escape') closeModal();
}

function buildSectionHeader(title, sectionKey, nodeId) {
  return `
    <div class="modal-section-title">
      ${title}
      <button class="section-ask-btn" data-section="${sectionKey}" data-node-id="${nodeId}">Ask AI</button>
    </div>
  `;
}

function buildInlineChatSlot(sectionKey, nodeId) {
  const chatId = `chat-${nodeId}-${sectionKey}`;
  return `<div class="inline-chat" id="${chatId}" data-section="${sectionKey}" data-node-id="${nodeId}"></div>`;
}

function renderModalContent(modal, node) {
  const typeLabel = node.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const typeColor = TYPE_COLORS[node.type] || '#64748b';
  const connected = getConnectedNodes(node.id);
  const hasDeepDive = deepDiveCache.has(node.id);

  modal.innerHTML = `
    <div class="modal-header" style="border-bottom-color: ${typeColor}20">
      <button class="modal-close" onclick="window._closeModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
      <div class="modal-badges">
        <span class="type-badge ${node.type}">${typeLabel}</span>
        <span class="severity-badge ${node.severity}">${node.severity}</span>
      </div>
      <h2 class="modal-title">${escapeHtml(node.title)}</h2>
      ${node.section ? `<div class="modal-section-ref">${escapeHtml(node.section)}</div>` : ''}
    </div>
    <div class="modal-body">
      ${node.description ? `
        <div class="modal-section issue" style="border-left-color: ${typeColor}">
          ${buildSectionHeader("What's the Issue", 'issue', node.id)}
          <div class="modal-section-text">${escapeHtml(node.description)}</div>
          ${buildInlineChatSlot('issue', node.id)}
        </div>
      ` : ''}
      ${node.exploitation ? `
        <div class="modal-section exploit">
          ${buildSectionHeader('How It Can Be Exploited', 'exploit', node.id)}
          <div class="modal-section-text">${escapeHtml(node.exploitation)}</div>
          ${buildInlineChatSlot('exploit', node.id)}
        </div>
      ` : ''}
      ${node.realWorldParallel ? `
        <div class="modal-section parallel">
          ${buildSectionHeader('Real-World Parallel', 'parallel', node.id)}
          <div class="modal-section-text">${escapeHtml(node.realWorldParallel)}</div>
          ${buildInlineChatSlot('parallel', node.id)}
        </div>
      ` : ''}
      ${node.suggestedFix ? `
        <div class="modal-section fix">
          ${buildSectionHeader('Suggested Fix', 'fix', node.id)}
          <div class="fix-block">${escapeHtml(node.suggestedFix)}</div>
          ${buildInlineChatSlot('fix', node.id)}
        </div>
      ` : ''}
      ${connected.length > 0 ? `
        <div class="modal-section" style="border-left-color: var(--accent-indigo)">
          <div class="modal-section-title">Connected Issues</div>
          <div class="connected-chips">
            ${connected.map(c => `
              <span class="connected-chip" data-node-id="${c.id}">
                <span class="chip-dot" style="background: ${TYPE_COLORS[c.type] || '#64748b'}"></span>
                ${escapeHtml(c.title.length > 30 ? c.title.slice(0, 28) + '...' : c.title)}
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div id="deep-dive-container">
        ${hasDeepDive ? renderDeepDive(deepDiveCache.get(node.id), node.id) : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary btn-sm" onclick="window._copyAnalysis()">Copy Analysis</button>
      <button class="btn btn-primary btn-sm" id="deep-dive-btn" onclick="window._toggleDeepDive()">
        ${hasDeepDive ? 'Hide Deep Dive' : 'Deep Dive'}
      </button>
      <button class="btn btn-ghost btn-sm" onclick="window._closeModal()">Close</button>
    </div>
  `;

  // Wire Ask AI buttons
  modal.querySelectorAll('.section-ask-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sectionKey = btn.dataset.section;
      const nodeId = btn.dataset.nodeId;
      toggleInlineChat(nodeId, sectionKey);
    });
  });

  // Wire connected chips
  modal.querySelectorAll('.connected-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = chip.dataset.nodeId;
      const targetNode = allNodes.find(n => n.id === targetId);
      if (targetNode) {
        closeModal();
        centerOnNode(targetId);
        setTimeout(() => openModal(targetNode), 400);
      }
    });
  });
}

function toggleInlineChat(nodeId, sectionKey) {
  const chatId = `chat-${nodeId}-${sectionKey}`;
  const chatEl = document.getElementById(chatId);
  if (!chatEl) return;

  if (chatEl.classList.contains('open')) {
    chatEl.classList.remove('open');
    setTimeout(() => { chatEl.innerHTML = ''; }, 300);
    return;
  }

  const cacheKey = `${nodeId}-${sectionKey}`;
  if (!sectionChats.has(cacheKey)) {
    sectionChats.set(cacheKey, { messages: [] });
  }

  const chat = sectionChats.get(cacheKey);
  const suggestions = SECTION_SUGGESTIONS[sectionKey] || ['Tell me more about this.'];

  chatEl.innerHTML = `
    <button class="inline-chat-close" data-chat-id="${chatId}" data-cache-key="${cacheKey}">Close</button>
    <div class="chat-thread" id="thread-${chatId}">
      ${renderChatMessages(chat.messages)}
    </div>
    ${chat.messages.length >= 10 ? `
      <div class="chat-limit-msg">Thread limit reached. <button class="chat-reset-btn" data-cache-key="${cacheKey}" data-chat-id="${chatId}">Start new thread</button></div>
    ` : `
      <div class="chat-suggestions" id="suggestions-${chatId}">
        ${(chat.messages.length === 0 ? suggestions : []).map(s =>
          `<span class="chat-suggestion-chip" data-chat-id="${chatId}" data-cache-key="${cacheKey}">${escapeHtml(s)}</span>`
        ).join('')}
      </div>
      <div class="chat-input-row">
        <input class="chat-input" id="input-${chatId}" placeholder="Ask about this section..." data-chat-id="${chatId}" data-cache-key="${cacheKey}" data-section="${sectionKey}" data-node-id="${nodeId}">
        <button class="chat-send-btn" id="send-${chatId}" data-chat-id="${chatId}" data-cache-key="${cacheKey}" data-section="${sectionKey}" data-node-id="${nodeId}">Ask</button>
      </div>
    `}
  `;

  // Force reflow then open
  chatEl.offsetHeight;
  chatEl.classList.add('open');

  // Wire events
  chatEl.querySelector('.inline-chat-close')?.addEventListener('click', () => {
    chatEl.classList.remove('open');
    setTimeout(() => { chatEl.innerHTML = ''; }, 300);
  });

  chatEl.querySelector('.chat-reset-btn')?.addEventListener('click', (e) => {
    sectionChats.set(e.target.dataset.cacheKey, { messages: [] });
    toggleInlineChat(nodeId, sectionKey);
    toggleInlineChat(nodeId, sectionKey);
  });

  chatEl.querySelectorAll('.chat-suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = chatEl.querySelector('.chat-input');
      if (input) {
        input.value = chip.textContent;
        submitInlineQuestion(chatId, sectionKey, nodeId);
      }
    });
  });

  const sendBtn = chatEl.querySelector('.chat-send-btn');
  const inputEl = chatEl.querySelector('.chat-input');
  sendBtn?.addEventListener('click', () => submitInlineQuestion(chatId, sectionKey, nodeId));
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitInlineQuestion(chatId, sectionKey, nodeId);
  });
  inputEl?.focus();
}

async function submitInlineQuestion(chatId, sectionKey, nodeId) {
  const input = document.getElementById(`input-${chatId}`);
  const sendBtn = document.getElementById(`send-${chatId}`);
  if (!input || !input.value.trim()) return;

  const question = input.value.trim();
  input.value = '';
  sendBtn.disabled = true;

  const cacheKey = `${nodeId}-${sectionKey}`;
  const chat = sectionChats.get(cacheKey);
  chat.messages.push({ role: 'user', text: question });

  const threadEl = document.getElementById(`thread-${chatId}`);
  threadEl.innerHTML = renderChatMessages(chat.messages);
  threadEl.innerHTML += `<div class="chat-loading"><span class="chat-loading-dot"></span><span class="chat-loading-dot"></span><span class="chat-loading-dot"></span></div>`;
  threadEl.scrollTop = threadEl.scrollHeight;

  // Clear suggestions
  const sugEl = document.getElementById(`suggestions-${chatId}`);
  if (sugEl) sugEl.innerHTML = '';

  const node = allNodes.find(n => n.id === nodeId);
  const sectionContent = getSectionContent(node, sectionKey);

  try {
    const contextData = `Section: ${sectionKey}\nNode: ${node?.title || ''}\nContent: ${sectionContent}`;
    const raw = await askAI('specific', contextData, question);
    const parsed = parseAskResponse(raw);

    chat.messages.push({ role: 'ai', text: parsed.answer });
    threadEl.innerHTML = renderChatMessages(chat.messages);

    if (parsed.followUpSuggestions.length > 0 && sugEl) {
      sugEl.innerHTML = parsed.followUpSuggestions.map(s =>
        `<span class="chat-suggestion-chip" data-chat-id="${chatId}" data-cache-key="${cacheKey}">${escapeHtml(s)}</span>`
      ).join('');
      sugEl.querySelectorAll('.chat-suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const inp = document.getElementById(`input-${chatId}`);
          if (inp) {
            inp.value = chip.textContent;
            submitInlineQuestion(chatId, sectionKey, nodeId);
          }
        });
      });
    }
  } catch (err) {
    chat.messages.push({ role: 'ai', text: `Error: ${err.message}` });
    threadEl.innerHTML = renderChatMessages(chat.messages);
  }

  threadEl.scrollTop = threadEl.scrollHeight;
  sendBtn.disabled = false;
  input?.focus();
}

function getSectionContent(node, sectionKey) {
  if (!node) return '';
  const map = {
    issue: node.description || '',
    exploit: node.exploitation || '',
    parallel: node.realWorldParallel || '',
    fix: node.suggestedFix || ''
  };
  if (map[sectionKey] !== undefined) return map[sectionKey];

  const detail = deepDiveCache.get(node.id);
  if (!detail) return '';
  if (sectionKey === 'stakeholders') {
    return `Benefits: ${detail.stakeholders.benefits.join(', ')}. Harmed: ${detail.stakeholders.harmed.join(', ')}`;
  }
  if (sectionKey === 'strategies') {
    return detail.closingStrategies.map(s => `${s.approach}: ${s.description}`).join('. ');
  }
  if (sectionKey === 'scenario') {
    return detail.exploitScenario.join('. ');
  }
  return '';
}

function renderChatMessages(messages) {
  return messages.map(m =>
    `<div class="chat-msg ${m.role}">${escapeHtml(m.text)}</div>`
  ).join('');
}

function getConnectedNodes(nodeId) {
  const connectedIds = new Set();
  allConnections.forEach(c => {
    const srcId = typeof c.source === 'object' ? c.source.id : c.source;
    const tgtId = typeof c.target === 'object' ? c.target.id : c.target;
    if (srcId === nodeId) connectedIds.add(tgtId);
    if (tgtId === nodeId) connectedIds.add(srcId);
  });
  return allNodes.filter(n => connectedIds.has(n.id));
}

async function toggleDeepDive() {
  if (!currentNodeId) return;

  const container = document.getElementById('deep-dive-container');
  const btn = document.getElementById('deep-dive-btn');

  if (deepDiveCache.has(currentNodeId)) {
    if (container.innerHTML) {
      container.innerHTML = '';
      btn.textContent = 'Deep Dive';
    } else {
      container.innerHTML = renderDeepDive(deepDiveCache.get(currentNodeId), currentNodeId);
      wireDeepDiveAskButtons(container);
      btn.textContent = 'Hide Deep Dive';
    }
    return;
  }

  const node = allNodes.find(n => n.id === currentNodeId);
  if (!node) return;

  container.innerHTML = `
    <div class="deep-dive-loading">
      <div class="deep-dive-spinner"></div>
      Loading deep analysis...
    </div>
  `;
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const raw = await getNodeDetail(node);
    const detail = parseDetailResponse(raw);
    deepDiveCache.set(currentNodeId, detail);
    container.innerHTML = renderDeepDive(detail, currentNodeId);
    wireDeepDiveAskButtons(container);
    btn.textContent = 'Hide Deep Dive';
  } catch (err) {
    container.innerHTML = `<div class="deep-dive-loading" style="color: var(--accent-red)">Failed to load: ${escapeHtml(err.message)}</div>`;
    btn.textContent = 'Retry Deep Dive';
  }
  btn.disabled = false;
}

function wireDeepDiveAskButtons(container) {
  container.querySelectorAll('.section-ask-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInlineChat(btn.dataset.nodeId, btn.dataset.section);
    });
  });
}

function renderDeepDive(detail, nodeId) {
  return `
    <div class="deep-dive-section">
      ${detail.stakeholders.benefits.length || detail.stakeholders.harmed.length ? `
        <div class="modal-section" style="border-left-color: var(--accent-purple)">
          ${buildSectionHeader('Stakeholder Impact', 'stakeholders', nodeId)}
          <div class="stakeholder-grid">
            <div class="stakeholder-card benefits">
              <div class="stakeholder-label">Who Benefits</div>
              <ul class="stakeholder-list">
                ${detail.stakeholders.benefits.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
              </ul>
            </div>
            <div class="stakeholder-card harmed">
              <div class="stakeholder-label">Who's Harmed</div>
              <ul class="stakeholder-list">
                ${detail.stakeholders.harmed.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
              </ul>
            </div>
          </div>
          ${buildInlineChatSlot('stakeholders', nodeId)}
        </div>
      ` : ''}
      ${detail.closingStrategies.length ? `
        <div class="modal-section" style="border-left-color: var(--accent-green)">
          ${buildSectionHeader('Closing Strategies', 'strategies', nodeId)}
          <div style="display: flex; flex-direction: column; gap: 10px;">
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
          ${buildInlineChatSlot('strategies', nodeId)}
        </div>
      ` : ''}
      ${detail.exploitScenario.length ? `
        <div class="modal-section" style="border-left-color: var(--accent-red)">
          ${buildSectionHeader('Exploit Scenario', 'scenario', nodeId)}
          <ol class="scenario-steps">
            ${detail.exploitScenario.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
          </ol>
          ${buildInlineChatSlot('scenario', nodeId)}
        </div>
      ` : ''}
      ${detail.exploitDifficulty ? `
        <div class="modal-section" style="border-left-color: var(--accent-amber)">
          <div class="modal-section-title">Exploit Difficulty</div>
          <span class="exploit-difficulty ${detail.exploitDifficulty}">${detail.exploitDifficulty.charAt(0).toUpperCase() + detail.exploitDifficulty.slice(1)}</span>
        </div>
      ` : ''}
    </div>
  `;
}

function copyAnalysis() {
  if (!currentNodeId) return;
  const node = allNodes.find(n => n.id === currentNodeId);
  if (!node) return;

  let text = `[${node.type.toUpperCase()}] ${node.title}\n`;
  text += `Severity: ${node.severity}\n`;
  if (node.section) text += `Section: ${node.section}\n`;
  text += `\n--- Description ---\n${node.description}\n`;
  if (node.exploitation) text += `\n--- Exploitation ---\n${node.exploitation}\n`;
  if (node.realWorldParallel) text += `\n--- Real-World Parallel ---\n${node.realWorldParallel}\n`;
  if (node.suggestedFix) text += `\n--- Suggested Fix ---\n${node.suggestedFix}\n`;

  const detail = deepDiveCache.get(currentNodeId);
  if (detail) {
    if (detail.exploitScenario.length) {
      text += `\n--- Exploit Scenario ---\n`;
      detail.exploitScenario.forEach((s, i) => { text += `${i + 1}. ${s}\n`; });
    }
    if (detail.closingStrategies.length) {
      text += `\n--- Closing Strategies ---\n`;
      detail.closingStrategies.forEach(s => {
        text += `- ${s.approach} (${s.difficulty}): ${s.description}\n`;
      });
    }
  }

  navigator.clipboard.writeText(text).then(() => {
    window._showToast('Analysis copied to clipboard', 'success');
  }).catch(() => {
    window._showToast('Failed to copy', 'error');
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window._closeModal = closeModal;
window._toggleDeepDive = toggleDeepDive;
window._copyAnalysis = copyAnalysis;

export { initModal, openModal, closeModal };
