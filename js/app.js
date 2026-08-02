import { analyzeRegulation, setReferenceMode, MAX_INPUT_CHARS, WARN_INPUT_CHARS } from './api.js';
import { parseAnalysisResponse, VALID_TYPES, VALID_RELATIONSHIP_TYPES, POSSIBILITY_LABELS, DIFFICULTY_LABELS } from './parser.js';
import {
  initBoard, destroyBoard, centerOnNode, setFilters, clearFocus,
  TYPE_COLORS, TYPE_GLYPHS, SEVERITY_COLORS
} from './board.js';
import { initPanel, setOverallContext, openNodeDetail, openChatGeneral, closePanel } from './panel.js';
import { SAMPLE_REGULATION } from './samples.js';
import {
  buildIssuesReport, copyText, buildShareUrl, decodeSharePayload,
  readShareToken, clearShareToken, MAX_SHARE_URL_CHARS
} from './share.js';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
// Issue types that only make sense against the RP legal corpus.
// constitutional-conflict and requires-amendment stay available in real-world
// mode (real constitutions exist); the Code of Justice is RP-only.
const RP_ONLY_TYPES = new Set(['coj-inconsistency']);
const MODE_KEY = 'loopholemap_analysis_mode';

let analysisData = null;
let activeSeverityFilters = new Set();
let activeTypeFilters = new Set();
let gaugePathLength = null;
// Mode selected in the toggle (applies to the NEXT scan)…
let analysisMode = localStorage.getItem(MODE_KEY) === 'real' ? 'real' : 'rp';
// …vs. the mode of the scan currently shown on the board, which drives the
// legend and filters so flipping the toggle doesn't relabel existing results.
let boardRpMode = analysisMode === 'rp';

function $(id) { return document.getElementById(id); }

function isRpLegalMode() {
  return boardRpMode;
}

function init() {
  wireScanSection();
  wireModeToggle();
  wireRailToggle();
  wireCollapsibles();
  wireAskFab();
  wireResultActions();

  initPanel([], [], { onJumpToNode: (id) => centerOnNode(id) });

  window._showToast = showToast;

  restoreSharedAnalysis();
  // Pasting a share link into the address bar while already on the site only
  // changes the fragment — no reload, so DOMContentLoaded never fires again.
  window.addEventListener('hashchange', () => restoreSharedAnalysis());
}

/* ===== Shared links ===== */

async function restoreSharedAnalysis() {
  const token = readShareToken();
  if (!token) return;

  try {
    const { data, rpMode } = await decodeSharePayload(token);
    analysisData = data;
    boardRpMode = rpMode;
    setReferenceMode(rpMode);
    showGraphView(data);
    $('shared-banner').hidden = false;
    showToast('Opened a shared analysis', 'info');
  } catch (err) {
    // A truncated or hand-edited link shouldn't leave a dead fragment behind.
    clearShareToken();
    showToast(err.message || 'That share link could not be opened', 'error');
  }
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

function wireModeToggle() {
  const buttons = document.querySelectorAll('.mode-toggle-btn');

  const applyActiveState = () => {
    buttons.forEach(b => {
      const active = b.dataset.mode === analysisMode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === analysisMode) return;
      analysisMode = mode;
      localStorage.setItem(MODE_KEY, mode);
      applyActiveState();
      showToast(
        mode === 'rp'
          ? 'CUSA / RP mode — next scan checks against the RP Constitution & Code of Justice'
          : 'Real-world mode — next scan analyzes the text as real-life law',
        'info'
      );
    });
  });

  applyActiveState();
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

/*
 * Scan progress bar. The scan is a single non-streaming request, so exact
 * byte progress isn't available; instead we advance a determinate bar along a
 * real elapsed-time curve calibrated to an adaptive per-user estimate (learned
 * from previous scans), never exceeding ~97% until the response lands, then
 * snapping to 100%. Shows elapsed time, an estimated time-left, and the phase.
 */
const ScanProgress = (() => {
  const DEFAULT_ESTIMATE_MS = 55000;
  const EST_KEY = 'loopholemap_scan_estimate_ms';
  const RP_PHASES = [
    { at: 0.00, label: 'Reading the bill…' },
    { at: 0.22, label: 'Cross-referencing the Constitution & Code of Justice…' },
    { at: 0.55, label: 'Scoring severity, possibility & difficulty…' },
    { at: 0.82, label: 'Assembling the board…' }
  ];
  const REAL_PHASES = [
    { at: 0.00, label: 'Reading the text…' },
    { at: 0.22, label: 'Probing definitions, scope & enforcement…' },
    { at: 0.55, label: 'Scoring severity, possibility & difficulty…' },
    { at: 0.82, label: 'Assembling the board…' }
  ];
  let PHASES = RP_PHASES;

  let rafId = null;
  let startTs = 0;
  let estimate = DEFAULT_ESTIMATE_MS;
  let running = false;

  const el = (id) => document.getElementById(id);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function loadEstimate() {
    const v = parseInt(localStorage.getItem(EST_KEY), 10);
    return (Number.isFinite(v) && v >= 12000 && v <= 110000) ? v : DEFAULT_ESTIMATE_MS;
  }
  function saveEstimate(actualMs) {
    const blended = Math.round(loadEstimate() * 0.5 + actualMs * 0.5);
    localStorage.setItem(EST_KEY, String(Math.min(110000, Math.max(12000, blended))));
  }
  function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function setFraction(frac) {
    frac = Math.max(0, Math.min(1, frac));
    const fill = el('scan-progress-fill');
    if (fill) fill.style.transform = `scaleX(${frac})`;
    const pct = el('scan-progress-pct');
    if (pct) pct.textContent = `${Math.round(frac * 100)}%`;
    const phase = el('scan-progress-phase');
    if (phase) {
      let label = PHASES[0].label;
      for (const p of PHASES) if (frac >= p.at) label = p.label;
      phase.textContent = label;
    }
  }

  function tick() {
    if (!running) return;
    const elapsed = Date.now() - startTs;
    // Asymptotic: ~90% at the estimate, crawling toward 0.97 after.
    const k = 2.3 / estimate;
    const frac = Math.min(0.97, 1 - Math.exp(-k * elapsed));
    setFraction(frac);
    const timeEl = el('scan-progress-time');
    if (timeEl) {
      const remain = estimate - elapsed;
      const left = remain > 3000 ? `~${Math.round(remain / 1000)}s left` : 'almost done…';
      timeEl.textContent = `${fmtClock(elapsed)} elapsed · ${left}`;
    }
    rafId = requestAnimationFrame(tick);
  }

  function start(rpMode = true) {
    PHASES = rpMode ? RP_PHASES : REAL_PHASES;
    running = true;
    startTs = Date.now();
    estimate = loadEstimate();
    const empty = el('empty-state');
    if (empty) empty.style.display = 'none';
    const panel = el('scan-progress');
    if (panel) panel.hidden = false;
    setFraction(0.02);
    const timeEl = el('scan-progress-time');
    if (timeEl) timeEl.textContent = `0:00 elapsed · ~${Math.round(estimate / 1000)}s left`;
    cancelAnimationFrame(rafId);
    // The bar itself is information, not decoration, so it runs even under
    // reduced motion — just without any extra flourish.
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  function succeed() {
    if (startTs) saveEstimate(Date.now() - startTs);
    const actual = Date.now() - startTs;
    stop();
    setFraction(1);
    const phase = el('scan-progress-phase');
    if (phase) phase.textContent = 'Complete';
    const timeEl = el('scan-progress-time');
    if (timeEl) timeEl.textContent = `Done in ${fmtClock(actual)}`;
    setTimeout(() => { const panel = el('scan-progress'); if (panel) panel.hidden = true; }, 320);
  }

  function fail() {
    stop();
    const panel = el('scan-progress');
    if (panel) panel.hidden = true;
    const gc = el('graph-canvas');
    const hasBoard = gc && Array.from(gc.children).some(ch => ch.id !== 'empty-state');
    const empty = el('empty-state');
    if (empty && !hasBoard) empty.style.display = '';
  }

  return { start, succeed, fail };
})();

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

  const rpMode = analysisMode === 'rp';

  scanBtn.disabled = true;
  textarea.classList.add('scanning');
  scanBtn.innerHTML = scanBtnMarkup('Scanning…');
  ScanProgress.start(rpMode);

  try {
    const raw = await analyzeRegulation(text, rpMode);
    analysisData = parseAnalysisResponse(raw);
    if (!rpMode) remapRpOnlyTypes(analysisData);
    boardRpMode = rpMode;
    // A fresh scan replaces any shared analysis that was on screen.
    $('shared-banner').hidden = true;
    clearShareToken();
    ScanProgress.succeed();
    showGraphView(analysisData);
    showScanResultToast(analysisData);
  } catch (err) {
    ScanProgress.fail();
    showToast(err.message || 'Analysis failed', 'error');
  } finally {
    scanBtn.disabled = false;
    scanBtn.innerHTML = SCAN_ICON_MARKUP;
    textarea.classList.remove('scanning');
  }
}

// In real-world mode the prompt forbids coj-inconsistency, but if the model
// emits it anyway, fold it into the closest generic type so the board,
// filters, and legend stay consistent.
function remapRpOnlyTypes(data) {
  data.nodes.forEach(n => {
    if (RP_ONLY_TYPES.has(n.type)) n.type = 'contradiction';
  });
}

function showScanResultToast(data) {
  const filteredCount = data.filteredOwnershipTeamNodes || 0;

  if (data.nodes.length === 0 && filteredCount > 0) {
    showToast(`No reportable non-OT vulnerabilities found (${filteredCount} OT-only excluded)`, 'info');
    return;
  }

  const noun = data.nodes.length === 1 ? 'vulnerability' : 'vulnerabilities';
  const suffix = filteredCount > 0 ? ` (${filteredCount} OT-only excluded)` : '';
  showToast(`Found ${data.nodes.length} ${noun}${suffix}`, 'success');
}

/* ===== Graph view population ===== */

function showGraphView(data) {
  closePanel();
  clearFocus();
  destroyBoard();

  $('reg-title').textContent = data.title;

  const riskBadge = $('risk-badge');
  riskBadge.textContent = data.overallRisk;
  riskBadge.className = `risk-badge ${data.overallRisk}`;
  riskBadge.hidden = false;

  const nodeCount = $('node-count');
  nodeCount.textContent = `${data.nodes.length} nodes`;
  nodeCount.hidden = false;

  const emptyState = $('empty-state');
  if (emptyState) emptyState.style.display = 'none';

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
  $('board-toolbar').hidden = false;

  requestAnimationFrame(() => {
    const container = $('graph-canvas');
    initBoard(container, data, {
      onCardClick: (node) => openNodeDetail(node)
    });
  });
}

function buildOverallContextText(data) {
  const nodeSummary = data.nodes.map(n => {
    const possibility = POSSIBILITY_LABELS[n.possibility] || 'Medium';
    const difficulty = DIFFICULTY_LABELS[n.difficulty] || 'Moderate';
    return `- [${n.type}] ${n.title} (${n.severity}; possibility: ${possibility}; difficulty: ${difficulty})`;
  }).join('\n');
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
  fillPath.style.filter = `drop-shadow(0 0 6px ${color})`;
  fillPath.style.strokeDashoffset = `${gaugePathLength * (1 - fraction)}`;

  const angle = -90 + fraction * 180;
  needle.style.transform = `rotate(${angle}deg)`;

  label.textContent = riskLevel;
  label.style.color = color;
}

/* ===== Filters ===== */

function renderFilters(nodes) {
  const cusa = isRpLegalMode();
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
    if (RP_ONLY_TYPES.has(type) && !cusa) return;
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
  const cusa = isRpLegalMode();
  const shownTypes = cusa ? VALID_TYPES : VALID_TYPES.filter(t => !RP_ONLY_TYPES.has(t));

  const typeItems = shownTypes.map(t => {
    const label = t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="legend-item"><span class="legend-dot" style="background: ${TYPE_COLORS[t]}"></span>${escapeHtml(label)}</div>`;
  }).join('');

  container.innerHTML = `
    <div class="legend-section-title">Severity &amp; Type</div>
    <div class="legend-items">${typeItems}</div>
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

function wireAskFab() {
  $('ask-fab').addEventListener('click', () => openChatGeneral());
}

/* ===== Copy / Share ===== */

function flashCopied(btn) {
  btn.classList.add('copied');
  setTimeout(() => btn.classList.remove('copied'), 1400);
}

function wireResultActions() {
  const copyBtn = $('copy-issues-btn');
  const shareBtn = $('share-btn');

  copyBtn.addEventListener('click', async () => {
    if (!analysisData) return;
    const report = buildIssuesReport(analysisData, isRpLegalMode());
    if (await copyText(report)) {
      flashCopied(copyBtn);
      const n = analysisData.nodes.length;
      showToast(`Copied ${n} issue${n === 1 ? '' : 's'} to the clipboard`, 'success');
    } else {
      showToast('Could not access the clipboard — copy blocked by the browser', 'error');
    }
  });

  shareBtn.addEventListener('click', async () => {
    if (!analysisData) return;
    shareBtn.disabled = true;
    try {
      const url = await buildShareUrl(analysisData, isRpLegalMode());

      // Very large analyses make links that chat apps and mail clients
      // truncate, so fall back to the plain-text report instead of handing
      // out a link that will arrive broken.
      if (url.length > MAX_SHARE_URL_CHARS) {
        const report = buildIssuesReport(analysisData, isRpLegalMode());
        if (await copyText(report)) {
          showToast('Analysis too large for a link — copied the full report instead', 'info');
        } else {
          showToast('Analysis too large to share as a link', 'error');
        }
        return;
      }

      // Mobile: hand off to the OS share sheet when available.
      if (navigator.share) {
        try {
          await navigator.share({ title: `LoopholeMap — ${analysisData.title}`, url });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return; // user dismissed the sheet
          /* otherwise fall through to clipboard */
        }
      }

      if (await copyText(url)) {
        flashCopied(shareBtn);
        showToast('Share link copied — anyone with it sees these results', 'success');
      } else {
        showToast('Could not access the clipboard — copy blocked by the browser', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Could not build a share link', 'error');
    } finally {
      shareBtn.disabled = false;
    }
  });
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
