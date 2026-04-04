import { getNodeDetail } from './api.js';
import { parseDetailResponse } from './parser.js';
import { TYPE_COLORS, centerOnNode } from './graph.js';

const deepDiveCache = new Map();
let currentNodeId = null;
let allNodes = [];
let allConnections = [];

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
          <div class="modal-section-title">What's the Issue</div>
          <div class="modal-section-text">${escapeHtml(node.description)}</div>
        </div>
      ` : ''}
      ${node.exploitation ? `
        <div class="modal-section exploit">
          <div class="modal-section-title">How It Can Be Exploited</div>
          <div class="modal-section-text">${escapeHtml(node.exploitation)}</div>
        </div>
      ` : ''}
      ${node.realWorldParallel ? `
        <div class="modal-section parallel">
          <div class="modal-section-title">Real-World Parallel</div>
          <div class="modal-section-text">${escapeHtml(node.realWorldParallel)}</div>
        </div>
      ` : ''}
      ${node.suggestedFix ? `
        <div class="modal-section fix">
          <div class="modal-section-title">Suggested Fix</div>
          <div class="fix-block">${escapeHtml(node.suggestedFix)}</div>
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
        ${hasDeepDive ? renderDeepDive(deepDiveCache.get(node.id)) : ''}
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
      container.innerHTML = renderDeepDive(deepDiveCache.get(currentNodeId));
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
    container.innerHTML = renderDeepDive(detail);
    btn.textContent = 'Hide Deep Dive';
  } catch (err) {
    container.innerHTML = `<div class="deep-dive-loading" style="color: var(--accent-red)">Failed to load: ${escapeHtml(err.message)}</div>`;
    btn.textContent = 'Retry Deep Dive';
  }
  btn.disabled = false;
}

function renderDeepDive(detail) {
  return `
    <div class="deep-dive-section">
      ${detail.stakeholders.benefits.length || detail.stakeholders.harmed.length ? `
        <div class="modal-section" style="border-left-color: var(--accent-purple)">
          <div class="modal-section-title">Stakeholder Impact</div>
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
        </div>
      ` : ''}
      ${detail.closingStrategies.length ? `
        <div class="modal-section" style="border-left-color: var(--accent-green)">
          <div class="modal-section-title">Closing Strategies</div>
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
        </div>
      ` : ''}
      ${detail.exploitScenario.length ? `
        <div class="modal-section" style="border-left-color: var(--accent-red)">
          <div class="modal-section-title">Exploit Scenario</div>
          <ol class="scenario-steps">
            ${detail.exploitScenario.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
          </ol>
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
