import { analyzeRegulation, askAI } from './api.js';
import { parseAnalysisResponse, parseAskResponse, VALID_TYPES, VALID_RELATIONSHIP_TYPES } from './parser.js';
import { initGraph, destroyGraph, zoomIn, zoomOut, resetView, toggleLabels, centerOnNode, highlightNode, TYPE_COLORS, LINK_COLORS } from './graph.js';
import { initModal, openModal } from './modal.js';
import { SAMPLE_REGULATION } from './samples.js';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

let analysisData = null;
let panelCollapsed = false;
let generalChatMessages = [];

function init() {
  const textarea = document.getElementById('regulation-input');
  const scanBtn = document.getElementById('scan-btn');
  const sampleBtn = document.getElementById('sample-btn');
  const inputView = document.querySelector('.input-view');
  const graphView = document.querySelector('.graph-view');

  sampleBtn.addEventListener('click', () => {
    textarea.value = SAMPLE_REGULATION;
    textarea.focus();
    showToast('Sample regulation loaded', 'info');
  });

  scanBtn.addEventListener('click', () => startScan(textarea.value));

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      startScan(textarea.value);
    }
  });

  document.getElementById('back-to-input').addEventListener('click', () => {
    graphView.classList.remove('active');
    inputView.classList.remove('hidden');
    document.getElementById('chat-panel')?.classList.remove('open');
    destroyGraph();
    analysisData = null;
    generalChatMessages = [];
  });

  document.getElementById('zoom-in').addEventListener('click', zoomIn);
  document.getElementById('zoom-out').addEventListener('click', zoomOut);
  document.getElementById('reset-view').addEventListener('click', resetView);
  document.getElementById('toggle-labels').addEventListener('click', () => {
    const visible = toggleLabels();
    document.getElementById('toggle-labels').title = visible ? 'Hide Labels' : 'Show Labels';
  });

  document.getElementById('panel-toggle').addEventListener('click', () => {
    panelCollapsed = !panelCollapsed;
    document.querySelector('.side-panel').classList.toggle('collapsed', panelCollapsed);
  });

  // General Ask AI FAB
  document.getElementById('ask-ai-fab')?.addEventListener('click', () => {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('open');
  });

  document.getElementById('chat-panel-close-btn')?.addEventListener('click', () => {
    document.getElementById('chat-panel').classList.remove('open');
  });

  document.getElementById('chat-panel-send')?.addEventListener('click', submitGeneralQuestion);
  document.getElementById('chat-panel-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGeneralQuestion();
  });

  // CUSA mode
  document.getElementById('cusa-lock-btn')?.addEventListener('click', toggleCusaModal);
  document.getElementById('cusa-activate-btn')?.addEventListener('click', activateCusa);
  document.getElementById('cusa-deactivate-btn')?.addEventListener('click', deactivateCusa);
  document.getElementById('cusa-cancel-btn')?.addEventListener('click', toggleCusaModal);

  if (localStorage.getItem('loopholemap_cusa_key')) {
    document.getElementById('cusa-badge').style.display = 'inline';
    document.getElementById('cusa-lock-btn').classList.add('active');
  }

  window._showToast = showToast;
}

async function startScan(text) {
  if (!text.trim()) {
    showToast('Please paste a regulation first', 'error');
    return;
  }

  if (text.trim().length < 50) {
    showToast('Text seems too short — paste a full regulation', 'error');
    return;
  }

  const scanBtn = document.getElementById('scan-btn');
  const textarea = document.getElementById('regulation-input');

  scanBtn.disabled = true;
  scanBtn.innerHTML = '<span class="scan-spinner"></span> Scanning...';
  textarea.classList.add('scanning');

  try {
    const raw = await analyzeRegulation(text);
    analysisData = parseAnalysisResponse(raw);
    showGraphView(analysisData);
    showToast(`Found ${analysisData.nodes.length} vulnerabilities`, 'success');
  } catch (err) {
    showToast(err.message || 'Analysis failed', 'error');
  } finally {
    scanBtn.disabled = false;
    scanBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      Scan for Loopholes
    `;
    textarea.classList.remove('scanning');
  }
}

function showGraphView(data) {
  const inputView = document.querySelector('.input-view');
  const graphView = document.querySelector('.graph-view');

  inputView.classList.add('hidden');
  graphView.classList.add('active');

  document.getElementById('reg-title').textContent = data.title;

  const riskBadge = document.getElementById('risk-badge');
  riskBadge.textContent = data.overallRisk;
  riskBadge.className = `risk-badge ${data.overallRisk}`;

  document.getElementById('node-count').textContent = `${data.nodes.length} nodes`;

  renderSidePanel(data);

  initModal(data.nodes, data.connections);

  // Set up general chat panel
  generalChatMessages = [];
  const ctxEl = document.getElementById('chat-panel-context-text');
  if (ctxEl) ctxEl.textContent = data.summary;
  const msgsEl = document.getElementById('chat-panel-messages');
  if (msgsEl) msgsEl.innerHTML = '';
  setupChatStarters();

  setTimeout(() => {
    const container = document.querySelector('.graph-container');
    initGraph(container, data, {
      onNodeClick: (node) => openModal(node)
    });
  }, 100);
}

function renderSidePanel(data) {
  document.getElementById('assessment-text').textContent = data.summary;

  renderLegend();
  renderNodeList(data.nodes);
  renderStats(data.nodes);
}

const CUSA_TYPES = ['constitutional-conflict', 'coj-inconsistency', 'requires-amendment'];
const CUSA_TYPE_LABELS = {
  'constitutional-conflict': 'Constitutional Conflict',
  'coj-inconsistency': 'CoJ Inconsistency',
  'requires-amendment': 'Requires Amendment'
};

function renderLegend() {
  const container = document.getElementById('legend-content');
  const isCusa = !!localStorage.getItem('loopholemap_cusa_key');
  const shownTypes = isCusa ? VALID_TYPES : VALID_TYPES.filter(t => !CUSA_TYPES.includes(t));

  const typeItems = shownTypes.map(t => {
    const label = CUSA_TYPE_LABELS[t] || t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="legend-item"><span class="legend-dot" style="background: ${TYPE_COLORS[t]}"></span>${label}</div>`;
  }).join('');

  const linkItems = VALID_RELATIONSHIP_TYPES.map(t => {
    const label = t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="legend-item"><span class="legend-line" style="background: ${LINK_COLORS[t]}"></span>${label}</div>`;
  }).join('');

  container.innerHTML = `
    <div class="legend-section">
      <div class="legend-label">Node Types</div>
      <div class="legend-items">${typeItems}</div>
    </div>
    <div class="legend-section">
      <div class="legend-label">Connection Types</div>
      <div class="legend-items">${linkItems}</div>
    </div>
  `;
}

function renderNodeList(nodes) {
  const container = document.getElementById('node-list');

  const groups = {};
  nodes.forEach(n => {
    if (!groups[n.type]) groups[n.type] = [];
    groups[n.type].push(n);
  });

  const typeOrder = VALID_TYPES.filter(t => groups[t] && groups[t].length > 0);

  typeOrder.forEach(t => {
    groups[t].sort((a, b) => (SEVERITY_ORDER[a.severity] || 3) - (SEVERITY_ORDER[b.severity] || 3));
  });

  container.innerHTML = typeOrder.map(type => {
    const typeLabel = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const items = groups[type];
    return `
      <div class="node-list-group" data-type="${type}">
        <div class="node-list-group-header">
          <span class="node-type-dot" style="background: ${TYPE_COLORS[type] || '#64748b'}"></span>
          <span class="node-list-group-title">${typeLabel}</span>
          <span class="node-list-group-count">${items.length}</span>
          <svg class="node-list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="node-list-group-items">
          ${items.map(n => `
            <div class="node-list-item" data-node-id="${n.id}">
              <span class="node-list-title">${escapeHtml(n.title)}</span>
              <span class="severity-badge ${n.severity}">${n.severity}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.node-list-group-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });

  container.querySelectorAll('.node-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const nodeId = item.dataset.nodeId;
      centerOnNode(nodeId);

      container.querySelectorAll('.node-list-item').forEach(i => i.classList.remove('highlighted'));
      item.classList.add('highlighted');
    });
  });
}

function renderStats(nodes) {
  const container = document.getElementById('stats-content');

  const typeCount = {};
  const sevCount = { critical: 0, high: 0, medium: 0, low: 0 };
  nodes.forEach(n => {
    typeCount[n.type] = (typeCount[n.type] || 0) + 1;
    sevCount[n.severity] = (sevCount[n.severity] || 0) + 1;
  });

  const total = nodes.length;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Issues</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color: var(--accent-red)">${sevCount.critical + sevCount.high}</div>
        <div class="stat-label">Critical/High</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color: var(--accent-amber)">${sevCount.medium}</div>
        <div class="stat-label">Medium</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" style="color: var(--accent-slate)">${sevCount.low}</div>
        <div class="stat-label">Low</div>
      </div>
    </div>
    <div class="mini-bar">
      ${sevCount.critical ? `<div class="mini-bar-segment" style="width: ${(sevCount.critical/total)*100}%; background: var(--accent-red)"></div>` : ''}
      ${sevCount.high ? `<div class="mini-bar-segment" style="width: ${(sevCount.high/total)*100}%; background: var(--accent-orange)"></div>` : ''}
      ${sevCount.medium ? `<div class="mini-bar-segment" style="width: ${(sevCount.medium/total)*100}%; background: var(--accent-amber)"></div>` : ''}
      ${sevCount.low ? `<div class="mini-bar-segment" style="width: ${(sevCount.low/total)*100}%; background: var(--accent-slate)"></div>` : ''}
    </div>
  `;
}

/* ===== CUSA Mode ===== */

function toggleCusaModal() {
  const modal = document.getElementById('cusa-modal');
  modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
  const key = localStorage.getItem('loopholemap_cusa_key');
  document.getElementById('cusa-deactivate-btn').style.display = key ? 'inline-block' : 'none';
  if (key) document.getElementById('cusa-key-input').value = key;
}

function activateCusa() {
  const key = document.getElementById('cusa-key-input').value.trim();
  if (!key) return;
  localStorage.setItem('loopholemap_cusa_key', key);
  document.getElementById('cusa-badge').style.display = 'inline';
  document.getElementById('cusa-lock-btn').classList.add('active');
  document.getElementById('cusa-modal').style.display = 'none';
  showToast('CUSA Reference Mode activated', 'success');
}

function deactivateCusa() {
  localStorage.removeItem('loopholemap_cusa_key');
  document.getElementById('cusa-badge').style.display = 'none';
  document.getElementById('cusa-lock-btn').classList.remove('active');
  document.getElementById('cusa-modal').style.display = 'none';
  showToast('CUSA Reference Mode deactivated', 'info');
}

/* ===== General Chat ===== */

function setupChatStarters() {
  const starterArea = document.getElementById('chat-panel-starters');
  if (!starterArea) return;
  const starters = [
    "What's the most dangerous loophole overall?",
    "If I could only fix 3 things, which should I prioritize?",
    "Who benefits most from these loopholes?",
    "How does this compare to similar regulations?"
  ];
  starterArea.innerHTML = starters.map(s =>
    `<span class="chat-suggestion-chip chat-starter-chip">${escapeHtml(s)}</span>`
  ).join('');
  starterArea.querySelectorAll('.chat-starter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('chat-panel-input');
      if (input) {
        input.value = chip.textContent;
        submitGeneralQuestion();
      }
    });
  });
}

function buildGeneralContext() {
  if (!analysisData) return '';
  const nodeSummary = analysisData.nodes.map(n =>
    `- [${n.type}] ${n.title} (${n.severity})`
  ).join('\n');
  return `Regulation: ${analysisData.title}\nOverall Assessment: ${analysisData.summary}\nNodes found:\n${nodeSummary}`;
}

async function submitGeneralQuestion() {
  const input = document.getElementById('chat-panel-input');
  const sendBtn = document.getElementById('chat-panel-send');
  const msgsEl = document.getElementById('chat-panel-messages');
  const starterArea = document.getElementById('chat-panel-starters');
  if (!input || !input.value.trim() || !msgsEl) return;

  const question = input.value.trim();
  input.value = '';
  sendBtn.disabled = true;
  if (starterArea) starterArea.style.display = 'none';

  generalChatMessages.push({ role: 'user', text: question });
  msgsEl.innerHTML = renderGeneralMessages();
  msgsEl.innerHTML += `<div class="chat-loading"><span class="chat-loading-dot"></span><span class="chat-loading-dot"></span><span class="chat-loading-dot"></span></div>`;
  msgsEl.scrollTop = msgsEl.scrollHeight;

  try {
    const raw = await askAI('general', buildGeneralContext(), question);
    const parsed = parseAskResponse(raw);
    generalChatMessages.push({ role: 'ai', text: parsed.answer, followUps: parsed.followUpSuggestions });
    msgsEl.innerHTML = renderGeneralMessages();

    // Add follow-up chips
    if (parsed.followUpSuggestions.length > 0) {
      const fuDiv = document.createElement('div');
      fuDiv.className = 'chat-panel-followups';
      parsed.followUpSuggestions.forEach(s => {
        const chip = document.createElement('span');
        chip.className = 'chat-suggestion-chip';
        chip.textContent = s;
        chip.addEventListener('click', () => {
          input.value = s;
          submitGeneralQuestion();
        });
        fuDiv.appendChild(chip);
      });
      msgsEl.appendChild(fuDiv);
    }
  } catch (err) {
    generalChatMessages.push({ role: 'ai', text: `Error: ${err.message}` });
    msgsEl.innerHTML = renderGeneralMessages();
  }

  msgsEl.scrollTop = msgsEl.scrollHeight;
  sendBtn.disabled = false;
  input.focus();
}

function renderGeneralMessages() {
  return generalChatMessages.map(m =>
    `<div class="chat-msg ${m.role}">${escapeHtml(m.text)}</div>`
  ).join('');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span>${escapeHtml(message)}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
