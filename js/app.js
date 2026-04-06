import { analyzeRegulation } from './api.js';
import { parseAnalysisResponse, VALID_TYPES, VALID_RELATIONSHIP_TYPES } from './parser.js';
import { initGraph, destroyGraph, zoomIn, zoomOut, resetView, toggleLabels, centerOnNode, highlightNode, TYPE_COLORS, LINK_COLORS } from './graph.js';
import { initModal, openModal } from './modal.js';
import { SAMPLE_REGULATION } from './samples.js';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

let analysisData = null;
let panelCollapsed = false;

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
    destroyGraph();
    analysisData = null;
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

function renderLegend() {
  const container = document.getElementById('legend-content');
  const typeItems = VALID_TYPES.map(t => {
    const label = t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
