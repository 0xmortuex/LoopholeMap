import { VALID_TYPES, POSSIBILITY_LABELS, DIFFICULTY_LABELS } from './parser.js';
import { prefersReducedMotion } from './motion.js';

/* ===== Shared visual vocabulary (also used by app.js / panel.js for
   legends, chips, and detail badges) ===== */

const TYPE_COLORS = {
  'loophole': '#ef4444',
  'exemption': '#f59e0b',
  'gray-area': '#8b5cf6',
  'contradiction': '#ec4899',
  'missing-definition': '#6366f1',
  'weak-enforcement': '#f97316',
  'scope-gap': '#14b8a6',
  'sunset-clause': '#64748b',
  'constitutional-conflict': '#dc2626',
  'coj-inconsistency': '#f97316',
  'requires-amendment': '#eab308'
};

const TYPE_GLYPHS = {
  'loophole': 'LH',
  'exemption': 'EX',
  'gray-area': 'GA',
  'contradiction': 'CX',
  'missing-definition': 'MD',
  'weak-enforcement': 'WE',
  'scope-gap': 'SG',
  'sunset-clause': 'SC',
  'constitutional-conflict': 'CC',
  'coj-inconsistency': 'CJ',
  'requires-amendment': 'RA'
};

const SEVERITY_COLORS = {
  'critical': '#ef4444',
  'high': '#f97316',
  'medium': '#f2b02b',
  'low': '#3b82f6'
};

const SEVERITY_ORDER_LIST = ['critical', 'high', 'medium', 'low'];

const POSSIBILITY_COLORS = {
  'very-low': '#3b82f6',
  'low': '#14b8a6',
  'medium': '#f2b02b',
  'high': '#f97316',
  'very-high': '#ef4444'
};

const DIFFICULTY_COLORS = {
  'easy': '#22c55e',
  'moderate': '#f2b02b',
  'hard': '#f97316',
  'very-hard': '#ef4444'
};

/* ===== Module state ===== */

let containerEl = null;
let boardEl = null;
let nodesData = [];
let nodeMap = {};
let onCardClick = null;
let currentFilters = { severities: new Set(), types: new Set() };
let groupBy = 'severity';
let selectedId = null;
let toolbarWired = false;

const FLIP_DURATION = 450;
const LEAVE_DURATION = 220;

/* ===== Init / destroy ===== */

function initBoard(container, data, callbacks = {}) {
  destroyBoard();

  containerEl = container;
  onCardClick = callbacks.onCardClick || null;
  nodesData = (data.nodes || []).map(n => ({ ...n }));
  nodeMap = {};
  nodesData.forEach(n => { nodeMap[n.id] = n; });
  currentFilters = { severities: new Set(), types: new Set() };
  selectedId = null;
  groupBy = 'severity';

  container.innerHTML = '';
  boardEl = document.createElement('div');
  boardEl.className = 'board';
  container.appendChild(boardEl);

  wireToolbar();
  syncToolbarActive();

  renderLanes({ animateEntrance: true });
}

function destroyBoard() {
  nodesData = [];
  nodeMap = {};
  selectedId = null;
  currentFilters = { severities: new Set(), types: new Set() };
  // DOM cleanup happens in initBoard (it always clears+rebuilds the
  // container), so there is nothing stateful here to tear down.
}

/* ===== Group-by toolbar (static markup in index.html) ===== */

function wireToolbar() {
  if (toolbarWired) return;
  const sevBtn = document.getElementById('group-by-severity');
  const typeBtn = document.getElementById('group-by-type');
  if (!sevBtn || !typeBtn) return;
  toolbarWired = true;
  sevBtn.addEventListener('click', () => setGroupBy('severity'));
  typeBtn.addEventListener('click', () => setGroupBy('type'));
}

function syncToolbarActive() {
  const sevBtn = document.getElementById('group-by-severity');
  const typeBtn = document.getElementById('group-by-type');
  if (sevBtn) {
    sevBtn.classList.toggle('active', groupBy === 'severity');
    sevBtn.setAttribute('aria-pressed', String(groupBy === 'severity'));
  }
  if (typeBtn) {
    typeBtn.classList.toggle('active', groupBy === 'type');
    typeBtn.setAttribute('aria-pressed', String(groupBy === 'type'));
  }
}

function setGroupBy(mode) {
  if (mode === groupBy || !boardEl) return;
  const reduced = prefersReducedMotion();
  const firstRects = reduced ? null : captureRects(getCardEls().filter(el => !el.classList.contains('is-hidden')));

  groupBy = mode;
  syncToolbarActive();
  renderLanes({ animateEntrance: false });

  if (!reduced && firstRects) {
    requestAnimationFrame(() => {
      flipCards(firstRects, getCardEls().filter(el => !el.classList.contains('is-hidden')));
    });
  }
}

/* ===== Rendering ===== */

function typeLabel(t) {
  return t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildGroups() {
  if (groupBy === 'type') {
    const buckets = {};
    nodesData.forEach(n => { (buckets[n.type] = buckets[n.type] || []).push(n); });
    return VALID_TYPES.filter(t => buckets[t] && buckets[t].length).map(t => ({
      key: t,
      label: typeLabel(t),
      color: TYPE_COLORS[t] || '#64748b',
      items: buckets[t]
    }));
  }
  const buckets = {};
  nodesData.forEach(n => { (buckets[n.severity] = buckets[n.severity] || []).push(n); });
  return SEVERITY_ORDER_LIST.filter(s => buckets[s] && buckets[s].length).map(s => ({
    key: s,
    label: s.charAt(0).toUpperCase() + s.slice(1),
    color: SEVERITY_COLORS[s],
    items: buckets[s]
  }));
}

function isVisible(node) {
  const { severities, types } = currentFilters;
  return (!severities.size || severities.has(node.severity)) && (!types.size || types.has(node.type));
}

function getCardEls() {
  return boardEl ? Array.from(boardEl.querySelectorAll('.loophole-card')) : [];
}

function renderLanes({ animateEntrance = false } = {}) {
  if (!boardEl) return;
  const reduced = prefersReducedMotion();
  const groups = buildGroups();

  boardEl.innerHTML = '';

  groups.forEach((g, laneIdx) => {
    const lane = document.createElement('section');
    lane.className = 'board-lane';
    lane.dataset.laneKey = g.key;

    const header = document.createElement('header');
    header.className = 'lane-header';

    const accent = document.createElement('span');
    accent.className = 'lane-accent';
    accent.style.background = g.color;

    const title = document.createElement('span');
    title.className = 'lane-title';
    title.textContent = g.label;

    const pill = document.createElement('span');
    pill.className = 'lane-count-pill';
    pill.textContent = animateEntrance && !reduced ? '0' : String(g.items.length);

    header.append(accent, title, pill);
    lane.appendChild(header);

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'lane-cards';

    g.items.forEach((node, cardIdx) => {
      const card = buildCard(node);
      if (!isVisible(node)) card.classList.add('is-hidden');
      if (node.id === selectedId) card.classList.add('is-selected');
      if (animateEntrance && !reduced) {
        card.classList.add('entrance');
        card.style.animationDelay = `${cardIdx * 40}ms`;
      }
      cardsWrap.appendChild(card);
    });

    lane.appendChild(cardsWrap);

    if (g.items.every(n => !isVisible(n))) lane.classList.add('lane-empty');

    if (animateEntrance && !reduced) {
      lane.classList.add('entrance');
      lane.style.animationDelay = `${laneIdx * 70}ms`;
    }

    boardEl.appendChild(lane);

    if (animateEntrance && !reduced) animateCountPill(pill, g.items.length);
  });
}

function buildCard(node) {
  const card = document.createElement('article');
  card.className = 'loophole-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${node.title} — ${node.severity} severity`);
  card.dataset.nodeId = node.id;
  card.style.setProperty('--spine-color', SEVERITY_COLORS[node.severity] || '#64748b');

  const spine = document.createElement('div');
  spine.className = 'card-spine';
  card.appendChild(spine);

  const body = document.createElement('div');
  body.className = 'card-body';

  const badge = document.createElement('span');
  badge.className = 'card-type-badge';
  badge.style.setProperty('--type-color', TYPE_COLORS[node.type] || '#64748b');
  const glyph = document.createElement('span');
  glyph.className = 'card-type-glyph';
  glyph.textContent = TYPE_GLYPHS[node.type] || '?';
  const typeText = document.createElement('span');
  typeText.textContent = typeLabel(node.type);
  badge.append(glyph, typeText);
  body.appendChild(badge);

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = node.title;
  body.appendChild(title);

  if (node.section) {
    const section = document.createElement('div');
    section.className = 'card-section';
    section.textContent = node.section;
    body.appendChild(section);
  }

  const metrics = document.createElement('div');
  metrics.className = 'card-metrics';
  metrics.append(
    buildMetric('Possibility', POSSIBILITY_LABELS[node.possibility] || 'Medium', POSSIBILITY_COLORS[node.possibility] || POSSIBILITY_COLORS.medium),
    buildMetric('Difficulty', DIFFICULTY_LABELS[node.difficulty] || 'Moderate', DIFFICULTY_COLORS[node.difficulty] || DIFFICULTY_COLORS.moderate)
  );
  body.appendChild(metrics);

  if (node.description) {
    const desc = document.createElement('p');
    desc.className = 'card-desc';
    desc.textContent = node.description;
    body.appendChild(desc);
  }

  card.appendChild(body);

  card.addEventListener('click', () => selectCard(node));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectCard(node);
    }
  });

  return card;
}

function buildMetric(label, value, color) {
  const metric = document.createElement('div');
  metric.className = 'card-metric';
  metric.style.setProperty('--metric-color', color);

  const metricLabel = document.createElement('span');
  metricLabel.className = 'card-metric-label';
  metricLabel.textContent = label;

  const metricValue = document.createElement('span');
  metricValue.className = 'card-metric-value';
  metricValue.textContent = value;

  metric.append(metricLabel, metricValue);
  return metric;
}

function selectCard(node) {
  selectedId = node.id;
  getCardEls().forEach(el => el.classList.toggle('is-selected', el.dataset.nodeId === node.id));
  if (onCardClick) onCardClick(node);
}

/* ===== Count-up (rAF) ===== */

function animateCountPill(pillEl, target) {
  const duration = 600;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    pillEl.textContent = String(Math.round(eased * target));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ===== FLIP (First-Last-Invert-Play) regroup animation ===== */

function captureRects(els) {
  const map = new Map();
  els.forEach(el => map.set(el.dataset.nodeId, el.getBoundingClientRect()));
  return map;
}

function flipCards(firstRects, els) {
  els.forEach(el => {
    const first = firstRects.get(el.dataset.nodeId);
    if (!first) return;
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (!dx && !dy) return;

    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    // Force a reflow so the browser registers the starting transform
    // before we animate it back to zero on the next frame.
    void el.offsetWidth;

    requestAnimationFrame(() => {
      el.classList.add('is-flipping');
      el.style.transition = '';
      el.style.transform = '';
      const cleanup = () => {
        el.classList.remove('is-flipping');
        el.removeEventListener('transitionend', cleanup);
      };
      el.addEventListener('transitionend', cleanup);
      // Safety net in case transitionend never fires (e.g. element removed).
      setTimeout(cleanup, FLIP_DURATION + 80);
    });
  });
}

/* ===== Filters ===== */

function setFilters(filters) {
  currentFilters = {
    severities: filters.severities || new Set(),
    types: filters.types || new Set()
  };
  applyFilters();
}

function applyFilters() {
  if (!boardEl) return;
  const reduced = prefersReducedMotion();
  const allCards = getCardEls();

  if (reduced) {
    allCards.forEach(el => {
      const node = nodeMap[el.dataset.nodeId];
      el.classList.toggle('is-hidden', node ? !isVisible(node) : false);
    });
    updateLaneEmptiness();
    return;
  }

  const survivingBefore = allCards.filter(el => !el.classList.contains('is-hidden'));
  const firstRects = captureRects(survivingBefore);

  const toHide = [];
  const toShow = [];
  allCards.forEach(el => {
    const node = nodeMap[el.dataset.nodeId];
    if (!node) return;
    const shouldShow = isVisible(node);
    const isHidden = el.classList.contains('is-hidden');
    if (!shouldShow && !isHidden) toHide.push(el);
    if (shouldShow && isHidden) toShow.push(el);
  });

  toHide.forEach(el => el.classList.add('is-leaving'));

  const finish = () => {
    toHide.forEach(el => {
      el.classList.remove('is-leaving');
      el.classList.add('is-hidden');
    });
    toShow.forEach(el => el.classList.remove('is-hidden'));
    updateLaneEmptiness();

    requestAnimationFrame(() => {
      const survivorsNow = getCardEls().filter(el => !el.classList.contains('is-hidden') && !toShow.includes(el));
      flipCards(firstRects, survivorsNow);
      toShow.forEach(el => {
        el.classList.add('is-entering');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => el.classList.remove('is-entering'));
        });
      });
    });
  };

  if (toHide.length) {
    setTimeout(finish, LEAVE_DURATION + 20);
  } else {
    finish();
  }
}

function updateLaneEmptiness() {
  if (!boardEl) return;
  boardEl.querySelectorAll('.board-lane').forEach(lane => {
    const anyVisible = lane.querySelector('.loophole-card:not(.is-hidden)');
    lane.classList.toggle('lane-empty', !anyVisible);
  });
}

/* ===== Focus / jump-to-node (panel + node list integration) ===== */

function findCardEl(nodeId) {
  return getCardEls().find(el => el.dataset.nodeId === nodeId) || null;
}

function centerOnNode(nodeId, opts = {}) {
  const card = findCardEl(nodeId);
  if (!card) return;

  if (opts.pulse !== false) {
    selectedId = nodeId;
    getCardEls().forEach(el => el.classList.toggle('is-selected', el.dataset.nodeId === nodeId));
  }

  card.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'center',
    inline: 'center'
  });

  card.classList.remove('pulse');
  // Force reflow so re-adding the class restarts the pulse animation.
  void card.offsetWidth;
  card.classList.add('pulse');
  setTimeout(() => card.classList.remove('pulse'), 900);
}

function clearFocus() {
  selectedId = null;
  getCardEls().forEach(el => el.classList.remove('is-selected'));
}

export {
  initBoard, destroyBoard, centerOnNode, setFilters, clearFocus,
  TYPE_COLORS, TYPE_GLYPHS, SEVERITY_COLORS
};
