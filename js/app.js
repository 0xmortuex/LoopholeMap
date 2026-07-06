import { analyzeRegulation, MAX_INPUT_CHARS, WARN_INPUT_CHARS } from './api.js';
import { parseAnalysisResponse, VALID_TYPES, VALID_RELATIONSHIP_TYPES } from './parser.js';
import {
  initGraph, destroyGraph, zoomIn, zoomOut, resetView, toggleLabels,
  centerOnNode, setFilters, clearFocus,
  TYPE_COLORS, TYPE_GLYPHS, LINK_STYLES, SEVERITY_COLORS
} from './graph.js';
import { initPanel, setOverallContext, openNodeDetail, openChatGeneral, closePanel } from './panel.js';
import { SAMPLE_REGULATION } from './samples.js';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const CUSA_TYPES = new Set(['constitutional-conflict', 'coj-inconsistency', 'requires-amendment']);

let analysisData = null;
let activeSeverityFilters = new Set();
let activeTypeFilters = new Set();
let gaugePathLength = null;

function $(id) { return document.getElementById(id); }

function isCusaActive() {
  return !!localStorage.getItem('loopholemap_cusa_key');
}

function init() {
  wireScanSection();
  wireRailToggle();
  wireCollapsibles();
  wireSettings();
  wireGraphControls();
  wireAskFab();

  initPanel([], [], { onJumpToNode: (id) => centerOnNode(id) });

  window._showToast = showToast;
}

/* ===== Scan / Input ===== */

function wireScanSection() {
  const textarea = $('regulation-input');
  const scanBtn = $('scan-btn');
  const sampleBtn = $('sample-btn');
  const charCount = $('char-count');

  const updateCharCount = () => {
    const len = textarea.value.length;
    if (len === 0) { charCount.textContent = ''; charCount.className = 'char-count'; return; }
    charCount.textContent = `${len.toLocaleString()} / ${MAX_INPUT_CHARS.toLocaleString()}`;
    charCount.className = 'char-count' + (len > MAX_INPUT_CHARS ? ' over' : len > WARN_INPUT_CHARS ? ' warn' : '');
  };
  textarea.addEventListener('input', updateCharCount);

  sampleBtn.addEventListener('click', () => {
    textarea.value = SAMPLE_REGULATION;
    textarea.focus();
    updateCharCount();
    showToast('Sample regulation loaded', 'info');
  });

  scanBtn.addEventListener('click', () => startScan(textarea.value));
  attachRipple(scanBtn);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      startScan(textarea.value);
    }
  });

  $('brand-home').addEventListener('click', () => {
    textarea.focus();
  });
}

function attachRipple(button) {
  button.addEventListener('click', (e) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.4;
    const ripple = document.createElement('span');
    ripple.style.position = 'absolute';
    ripple.style.borderRadius = '50%';
    ripple.style.background = 'rgba(255,255,255,0.35)';
    ripple.style.pointerEvents = 'none';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    ripple.style.transform = 'scale(0)';
    ripple.style.opacity = '1';
    ripple.style.transition = 'transform 500ms ease-out, opacity 500ms ease-out';
    button.appendChild(ripple);
    requestAnimationFrame(() => {
      ripple.style.transform = 'scale(1)';
      ripple.style.opacity = '0';
    });
    setTimeout(() => ripple.remove(), 520);
  });
}

const SCAN_PHASES = [
  'Mapping the loopholes',
  'Cross-referencing clauses',
  'Scoring severity',
  'Assembling the graph'
];

function scanBtnMarkup(label) {
  return `<span class="scan-spinner"></span><span class="scan-btn-label">${label}</span>`;
}

const SCAN_ICON_MARKUP = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
  </svg>
  <span class="scan-btn-label">Scan for Loopholes</span>
`;

async function startScan(text) {
  if (!text.trim()) {
    showToast('Please paste a regulation first', 'error');
    return;
  }
  if (text.trim().length < 50) {
    showToast('Text seems too short — paste a full regulation', 'error');
    return;
  }
  if (text.trim().length > WARN_INPUT_CHARS && text.trim().length <= MAX_INPUT_CHARS) {
    showToast(`Large input (${text.trim().length.toLocaleString()} chars) — analysis may take longer`, 'info');
  }

  const scanBtn = $('scan-btn');
  const textarea = $('regulation-input');

  scanBtn.disabled = true;
  textarea.classList.add('scanning');

  let phaseIndex = 0;
  scanBtn.innerHTML = scanBtnMarkup(`${SCAN_PHASES[0]}...`);
  const phaseTimer = setInterval(() => {
    phaseIndex = (phaseIndex + 1) % SCAN_PHASES.length;
    scanBtn.innerHTML = scanBtnMarkup(`${SCAN_PHASES[phaseIndex]}...`);
  }, 2400);

  try {
    const raw = await analyzeRegulation(text);
    analysisData = parseAnalysisResponse(raw);
    showGraphView(analysisData);
    showToast(`Found ${analysisData.nodes.length} vulnerabilities`, 'success');
  } catch (err) {
    showToast(err.message || 'Analysis failed', 'error');
  } finally {
    clearInterval(phaseTimer);
    scanBtn.disabled = false;
    scanBtn.innerHTML = SCAN_ICON_MARKUP;
    textarea.classList.remove('scanning');
  }
}

/* ===== Graph view population ===== */

function showGraphView(data) {
  closePanel();
  clearFocus();
  destroyGraph();

  $('reg-title').textContent = data.title;

  const riskBadge = $('risk-badge');
  riskBadge.textContent = data.overallRisk;
  riskBadge.className = `risk-badge ${data.overallRisk}`;
  riskBadge.hidden = false;

  const nodeCount = $('node-count');
  nodeCount.textContent = `${data.nodes.length} nodes`;
  nodeCount.hidden = false;

  $('empty-state').style.display = 'none';

  activeSeverityFilters = new Set();
  activeTypeFilters = new Set();

  renderGauge(data.overallRisk);
  $('assessment-text').textContent = data.summary;
  renderFilters(data.nodes);
  renderLegend();
  renderNodeList(data.nodes);

  ['risk-section', 'filter-section', 'legend-section', 'issues-section'].forEach(id => {
    $(id).hidden = false;
  });

  initPanel(data.nodes, data.connections, { onJumpToNode: (id) => centerOnNode(id) });
  setOverallContext(buildOverallContextText(data));

  $('ask-fab').hidden = false;

  requestAnimationFrame(() => {
    const container = $('graph-canvas');
    initGraph(container, data, {
      onNodeClick: (node) => openNodeDetail(node),
      onBackgroundClick: () => {}
    });
  });
}

function buildOverallContextText(data) {
  const nodeSummary = data.nodes.map(n => `- [${n.type}] ${n.title} (${n.severity})`).join('\n');
  return `Regulation: ${data.title}\nOverall Assessment: ${data.summary}\nNodes found:\n${nodeSummary}`;
}

/* ===== Risk gauge ===== */

function renderGauge(riskLevel) {
  const fillPath = $('gauge-fill');
  const needle = $('gauge-needle');
  const label = $('gauge-label');

  if (gaugePathLength === null) {
    gaugePathLength = fillPath.getTotalLength();
    fillPath.style.strokeDasharray = `${gaugePathLength}`;
  }

  const order = ['low', 'medium', 'high', 'critical'];
  const idx = order.indexOf(riskLevel);
  const fraction = idx === -1 ? 0.5 : (idx + 1) / order.length;
  const color = SEVERITY_COLORS[riskLevel] || SEVERITY_COLORS.medium;

  fillPath.style.stroke = color;
  fillPath.style.strokeDashoffset = `${gaugePathLength * (1 - fraction)}`;

  const angle = -90 + fraction * 180;
  needle.style.transform = `rotate(${angle}deg)`;

  label.textContent = riskLevel;
  label.style.color = color;
}

/* ===== Filters ===== */

function renderFilters(nodes) {
  const cusa = isCusaActive();
  const severityWrap = $('severity-filters');
  const typeWrap = $('type-filters');

  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const typeCounts = {};
  nodes.forEach(n => {
    sevCounts[n.severity] = (sevCounts[n.severity] || 0) + 1;
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  });

  severityWrap.innerHTML = '';
  ['critical', 'high', 'medium', 'low'].forEach(sev => {
    if (!sevCounts[sev]) return;
    const chip = makeChip(sev.charAt(0).toUpperCase() + sev.slice(1), sevCounts[sev], SEVERITY_COLORS[sev]);
    chip.addEventListener('click', () => toggleFilter(activeSeverityFilters, sev, chip));
    severityWrap.appendChild(chip);
  });

  typeWrap.innerHTML = '';
  VALID_TYPES.forEach(type => {
    if (!typeCounts[type]) return;
    if (CUSA_TYPES.has(type) && !cusa) return;
    const label = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const chip = makeChip(label, typeCounts[type], TYPE_COLORS[type]);
    chip.addEventListener('click', () => toggleFilter(activeTypeFilters, type, chip));
    typeWrap.appendChild(chip);
  });

  updateClearFiltersVisibility();
}

function makeChip(label, count, color) {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.style.setProperty('--chip-color', color);
  const dot = document.createElement('span');
  dot.className = 'chip-dot';
  dot.style.background = color;
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(`${label} (${count})`));
  return chip;
}

function toggleFilter(set, value, chipEl) {
  if (set.has(value)) { set.delete(value); chipEl.classList.remove('active'); }
  else { set.add(value); chipEl.classList.add('active'); }
  setFilters({ severities: activeSeverityFilters, types: activeTypeFilters });
  updateClearFiltersVisibility();
}

function updateClearFiltersVisibility() {
  const btn = $('clear-filters-btn');
  const any = activeSeverityFilters.size > 0 || activeTypeFilters.size > 0;
  btn.hidden = !any;
  btn.onclick = () => {
    activeSeverityFilters.clear();
    activeTypeFilters.clear();
    document.querySelectorAll('#filter-body .chip.active').forEach(c => c.classList.remove('active'));
    setFilters({ severities: activeSeverityFilters, types: activeTypeFilters });
    updateClearFiltersVisibility();
  };
}

/* ===== Legend ===== */

function renderLegend() {
  const container = $('legend-content');
  const cusa = isCusaActive();
  const shownTypes = cusa ? VALID_TYPES : VALID_TYPES.filter(t => !CUSA_TYPES.has(t));

  const typeItems = shownTypes.map(t => {
    const label = t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="legend-item"><span class="legend-dot" style="background: ${TYPE_COLORS[t]}"></span>${escapeHtml(label)}</div>`;
  }).join('');

  const linkItems = VALID_RELATIONSHIP_TYPES.map(t => {
    const label = t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const style = LINK_STYLES[t] || {};
    const dashClass = style.dash === '2,4' ? 'dashed' : style.dash === '1,3' ? 'dotted' : '';
    return `<div class="legend-item"><span class="legend-line ${dashClass}" style="border-color: ${style.color}"></span>${escapeHtml(label)}</div>`;
  }).join('');

  container.innerHTML = `
    <div class="legend-section-title">Severity &amp; Type</div>
    <div class="legend-items">${typeItems}</div>
    <div class="legend-section-title">Connections</div>
    <div class="legend-items">${linkItems}</div>
  `;
}

/* ===== Node list ===== */

function renderNodeList(nodes) {
  const container = $('node-list');
  const groups = {};
  nodes.forEach(n => {
    if (!groups[n.type]) groups[n.type] = [];
    groups[n.type].push(n);
  });

  const typeOrder = VALID_TYPES.filter(t => groups[t] && groups[t].length > 0);
  typeOrder.forEach(t => {
    groups[t].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  });

  container.innerHTML = typeOrder.map(type => {
    const typeLabel = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const items = groups[type];
    return `
      <div class="node-list-group" data-type="${type}">
        <div class="node-list-group-header">
          <span class="node-type-dot" style="background: ${TYPE_COLORS[type] || '#64748b'}"></span>
          <span class="node-list-group-title">${escapeHtml(typeLabel)}</span>
          <span class="node-list-group-count">${items.length}</span>
          <svg class="node-list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="node-list-group-items"><div>
          ${items.map(n => `
            <div class="node-list-item" data-node-id="${n.id}">
              <span class="node-list-title">${escapeHtml(n.title)}</span>
              <span class="severity-badge ${n.severity}">${n.severity}</span>
            </div>
          `).join('')}
        </div></div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.node-list-group-header').forEach(header => {
    header.addEventListener('click', () => header.parentElement.classList.toggle('collapsed'));
  });

  container.querySelectorAll('.node-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const node = analysisData.nodes.find(n => n.id === item.dataset.nodeId);
      if (!node) return;
      centerOnNode(node.id);
      openNodeDetail(node);
      container.querySelectorAll('.node-list-item').forEach(i => i.classList.remove('highlighted'));
      item.classList.add('highlighted');
    });
  });
}

/* ===== Rail toggle (mobile) & collapsible sections ===== */

function wireRailToggle() {
  $('rail-toggle-btn').addEventListener('click', () => {
    $('left-rail').classList.toggle('open');
  });
}

function wireCollapsibles() {
  document.querySelectorAll('.rail-section-header[data-collapse-target]').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.rail-collapsible').classList.toggle('collapsed');
    });
  });
}

/* ===== Settings / CUSA ===== */

function wireSettings() {
  const btn = $('settings-btn');
  const popover = $('settings-popover');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.hidden = !popover.hidden;
    if (!popover.hidden) syncCusaInputs();
  });

  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && e.target !== btn) {
      popover.hidden = true;
    }
  });

  $('cusa-activate-btn').addEventListener('click', () => {
    const key = $('cusa-key-input').value.trim();
    if (!key) return;
    localStorage.setItem('loopholemap_cusa_key', key);
    syncCusaDot();
    syncCusaInputs();
    $('cusa-status').textContent = 'Private mode activated';
    if (analysisData) { renderLegend(); renderFilters(analysisData.nodes); }
    showToast('Private reference mode activated', 'success');
  });

  $('cusa-deactivate-btn').addEventListener('click', () => {
    localStorage.removeItem('loopholemap_cusa_key');
    syncCusaDot();
    syncCusaInputs();
    $('cusa-status').textContent = 'Private mode deactivated';
    if (analysisData) { renderLegend(); renderFilters(analysisData.nodes); }
    showToast('Private reference mode deactivated', 'info');
  });

  syncCusaDot();
}

function syncCusaDot() {
  $('cusa-dot').hidden = !isCusaActive();
}

function syncCusaInputs() {
  const active = isCusaActive();
  $('cusa-deactivate-btn').hidden = !active;
  $('cusa-key-input').value = active ? localStorage.getItem('loopholemap_cusa_key') : '';
}

/* ===== Graph controls ===== */

function wireGraphControls() {
  $('zoom-in').addEventListener('click', zoomIn);
  $('zoom-out').addEventListener('click', zoomOut);
  $('reset-view').addEventListener('click', resetView);
  $('toggle-labels').addEventListener('click', () => {
    const visible = toggleLabels();
    $('toggle-labels').title = visible ? 'Hide Labels' : 'Show Labels';
    $('toggle-labels').classList.toggle('active', visible);
  });
}

function wireAskFab() {
  $('ask-fab').addEventListener('click', () => openChatGeneral());
}

/* ===== Toasts ===== */

function showToast(message, type = 'info') {
  const container = $('toast-container');
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.innerHTML = icons[type] || icons.info;
  toast.appendChild(iconSpan);
  toast.appendChild(document.createTextNode(message));
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
