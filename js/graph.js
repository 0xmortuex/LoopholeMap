import { VALID_TYPES, VALID_RELATIONSHIP_TYPES } from './parser.js';
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

const SEVERITY_RADIUS = { critical: 23, high: 19, medium: 16, low: 13 };

// { color, dash, width } — dash is an SVG stroke-dasharray token or null for solid.
const LINK_STYLES = {
  'enables': { color: '#22c55e', dash: null, width: 1.6 },
  'weakens': { color: '#f2b02b', dash: null, width: 1.6 },
  'contradicts': { color: '#ef4444', dash: '2,4', width: 1.8 },
  'depends-on': { color: '#6366f1', dash: '1,3', width: 1.4 },
  'amplifies': { color: '#f97316', dash: null, width: 2.4 }
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

let svg, viewport, zoomBehavior, tooltip;
let simulation = null;
let nodeSel, linkSel;
let nodesData = [], linksData = [];
let nodeMap = {};
let labelsVisible = false;
let focusedId = null;
let onNodeClick = null, onBackgroundClick = null;
let containerEl = null;
let resizeObserver = null;
let width = 800, height = 600;
let currentFilters = { severities: new Set(), types: new Set() };
let linksDrawnIn = false;

function dur(ms) {
  return prefersReducedMotion() ? 0 : ms;
}

function radiusFor(d) {
  return SEVERITY_RADIUS[d.severity] || 14;
}

function initGraph(container, data, callbacks = {}) {
  destroyGraph();

  containerEl = container;
  onNodeClick = callbacks.onNodeClick || null;
  onBackgroundClick = callbacks.onBackgroundClick || null;
  focusedId = null;
  labelsVisible = false;
  linksDrawnIn = false;
  currentFilters = { severities: new Set(), types: new Set() };

  const rect = container.getBoundingClientRect();
  width = rect.width || 800;
  height = rect.height || 600;

  nodesData = data.nodes.map(n => ({ ...n }));
  nodeMap = {};
  nodesData.forEach(n => { nodeMap[n.id] = n; });

  linksData = (data.connections || [])
    .filter(c => nodeMap[c.source] && nodeMap[c.target] && c.source !== c.target)
    .map(c => ({ ...c }));

  // Seed every node near the canvas center with a little jitter — this is
  // where the "fly out and settle" motion originates from; the force
  // simulation itself pushes them out to their natural resting layout.
  const cx = width / 2, cy = height / 2;
  nodesData.forEach((d, i) => {
    d.x = cx + (Math.random() - 0.5) * 60;
    d.y = cy + (Math.random() - 0.5) * 60;
  });

  d3.select(container).selectAll('*').remove();

  svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%');

  const defs = svg.append('defs');
  VALID_RELATIONSHIP_TYPES.forEach(type => {
    const style = LINK_STYLES[type] || { color: '#64748b' };
    defs.append('marker')
      .attr('id', `arrow-${type}`)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4Z')
      .attr('fill', style.color)
      .attr('opacity', 0.8);
  });

  viewport = svg.append('g').attr('class', 'viewport');
  const linksG = viewport.append('g').attr('class', 'links-layer');
  const nodesG = viewport.append('g').attr('class', 'nodes-layer');

  zoomBehavior = d3.zoom()
    .scaleExtent([0.2, 4])
    .on('zoom', (event) => viewport.attr('transform', event.transform));
  svg.call(zoomBehavior);
  svg.on('dblclick.zoom', null);
  svg.on('dblclick', () => resetView());
  svg.on('click', (event) => {
    if (event.target === svg.node()) {
      clearFocus();
      if (onBackgroundClick) onBackgroundClick();
    }
  });

  linkSel = linksG.selectAll('line.link')
    .data(linksData)
    .enter()
    .append('line')
    .attr('class', d => `link link-${d.type}`)
    .attr('stroke', d => (LINK_STYLES[d.type] || {}).color || '#64748b')
    .attr('stroke-width', d => (LINK_STYLES[d.type] || {}).width || 1.5)
    .attr('stroke-dasharray', d => (LINK_STYLES[d.type] || {}).dash || null)
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .attr('opacity', 0.5)
    .on('mouseenter', (event, d) => showLinkTooltip(event, d))
    .on('mousemove', positionTooltip)
    .on('mouseleave', hideTooltip);

  const drag = d3.drag()
    .on('start', (event, d) => {
      if (!event.active && simulation) simulation.alphaTarget(0.2).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active && simulation) simulation.alphaTarget(0);
    });

  nodeSel = nodesG.selectAll('g.node-group')
    .data(nodesData, d => d.id)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .style('opacity', 0)
    .call(drag)
    .on('mouseenter', function(event, d) {
      d3.select(this).classed('hovered', true);
      showNodeTooltip(event, d);
      highlightNeighborhood(d.id);
    })
    .on('mousemove', positionTooltip)
    .on('mouseleave', function(event, d) {
      d3.select(this).classed('hovered', false);
      hideTooltip();
      if (!focusedId) clearHighlight();
      else highlightNeighborhood(focusedId);
    })
    .on('click', function(event, d) {
      event.stopPropagation();
      focusNode(d.id);
      if (onNodeClick) onNodeClick(d);
    });

  nodeSel.append('circle')
    .attr('class', 'node-halo')
    .attr('r', d => radiusFor(d) + 8)
    .attr('fill', d => TYPE_COLORS[d.type] || '#64748b');

  nodeSel.append('circle')
    .attr('class', 'node-core')
    .attr('r', d => radiusFor(d))
    .attr('fill', d => SEVERITY_COLORS[d.severity] || '#64748b')
    .attr('stroke', d => TYPE_COLORS[d.type] || '#64748b')
    .attr('stroke-width', 2.5);

  nodeSel.append('text')
    .attr('class', 'node-type-glyph')
    .attr('font-size', d => Math.max(8, radiusFor(d) * 0.42))
    .text(d => TYPE_GLYPHS[d.type] || '?');

  nodeSel.append('text')
    .attr('class', 'node-label')
    .attr('y', d => radiusFor(d) + 14)
    .attr('text-anchor', 'middle')
    .attr('font-size', 10.5)
    .attr('opacity', 0)
    .text(d => d.title.length > 24 ? d.title.slice(0, 22) + '…' : d.title);

  tooltip = document.querySelector('.graph-tooltip');

  buildSimulation();

  // Resize handling — keep the center force + zoom-to-fit anchored to the
  // real container size (important on mobile drawer open/close & window resize).
  if (resizeObserver) resizeObserver.disconnect();
  resizeObserver = new ResizeObserver(entries => {
    const r = entries[0].contentRect;
    if (!r.width || !r.height) return;
    width = r.width;
    height = r.height;
    if (simulation) {
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
      simulation.alpha(Math.max(simulation.alpha(), 0.1)).restart();
    }
  });
  resizeObserver.observe(container);

  animateIn();
}

function buildSimulation() {
  simulation = d3.forceSimulation(nodesData)
    .force('link', d3.forceLink(linksData).id(d => d.id).distance(110).strength(0.35))
    .force('charge', d3.forceManyBody().strength(-260).distanceMax(600))
    .force('collide', d3.forceCollide(d => radiusFor(d) + 14))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('x', d3.forceX(width / 2).strength(0.03))
    .force('y', d3.forceY(height / 2).strength(0.03))
    .on('tick', ticked)
    .on('end', onSimulationEnd);
}

function ticked() {
  nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  linkSel
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);
}

function onSimulationEnd() {
  if (!linksDrawnIn && !prefersReducedMotion()) {
    linksDrawnIn = true;
    drawLinksIn();
  }
}

function animateIn() {
  if (prefersReducedMotion()) {
    simulation.stop();
    for (let i = 0; i < 300; i++) simulation.tick();
    ticked();
    nodeSel.style('opacity', 1);
    linkSel.attr('opacity', 0.5);
    linksDrawnIn = true;
    zoomToFit(0);
    return;
  }

  nodeSel.transition()
    .delay((d, i) => i * 15)
    .duration(320)
    .ease(d3.easeCubicOut)
    .style('opacity', 1);

  linkSel.attr('opacity', 0.001);

  setTimeout(() => zoomToFit(500), 260);
}

function drawLinksIn() {
  linkSel.each(function(d) {
    const el = this;
    const length = Math.hypot(d.target.x - d.source.x, d.target.y - d.source.y) || 1;
    const style = LINK_STYLES[d.type] || {};
    d3.select(el)
      .attr('stroke-dasharray', `${length} ${length}`)
      .attr('stroke-dashoffset', length)
      .attr('opacity', 0.5)
      .transition()
      .duration(500)
      .ease(d3.easeCubicInOut)
      .attr('stroke-dashoffset', 0)
      .on('end', function() {
        d3.select(this).attr('stroke-dasharray', style.dash || null);
      });
  });
}

/* ===== Hover / focus highlighting ===== */

function neighborsOf(nodeId) {
  const ids = new Set([nodeId]);
  linksData.forEach(l => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (s === nodeId) ids.add(t);
    if (t === nodeId) ids.add(s);
  });
  return ids;
}

function highlightNeighborhood(nodeId) {
  const ids = neighborsOf(nodeId);
  nodeSel.classed('dimmed', d => !ids.has(d.id));
  linkSel.classed('dimmed', d => {
    const s = typeof d.source === 'object' ? d.source.id : d.source;
    const t = typeof d.target === 'object' ? d.target.id : d.target;
    return !(s === nodeId || t === nodeId);
  });
}

function clearHighlight() {
  nodeSel.classed('dimmed', false);
  linkSel.classed('dimmed', false);
}

function focusNode(nodeId) {
  focusedId = nodeId;
  nodeSel.classed('focused', d => d.id === nodeId);
  highlightNeighborhood(nodeId);
  centerOnNode(nodeId, { pulse: false });
}

function clearFocus() {
  focusedId = null;
  if (nodeSel) nodeSel.classed('focused', false);
  clearHighlight();
}

/* ===== Filters ===== */

function setFilters(filters) {
  currentFilters = {
    severities: filters.severities || new Set(),
    types: filters.types || new Set()
  };
  const { severities, types } = currentFilters;

  const visible = d => (!severities.size || severities.has(d.severity)) && (!types.size || types.has(d.type));

  nodeSel.classed('filtered-out', d => !visible(d));
  linkSel.classed('filtered-out', d => {
    const s = typeof d.source === 'object' ? d.source : nodeMap[d.source];
    const t = typeof d.target === 'object' ? d.target : nodeMap[d.target];
    return !(s && t && visible(s) && visible(t));
  });
}

/* ===== Tooltip ===== */

function showNodeTooltip(event, d) {
  if (!tooltip) return;
  const typeLabel = d.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  tooltip.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = d.title;
  const meta = document.createElement('div');
  meta.className = 'tt-meta';
  meta.textContent = `${typeLabel} · ${d.section || ''} · ${d.severity}`;
  tooltip.appendChild(title);
  tooltip.appendChild(meta);
  positionTooltip(event);
  tooltip.classList.add('visible');
}

function showLinkTooltip(event, d) {
  if (!tooltip) return;
  const typeLabel = d.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  tooltip.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = typeLabel;
  tooltip.appendChild(title);
  if (d.description) {
    const meta = document.createElement('div');
    meta.className = 'tt-meta';
    meta.textContent = d.description;
    tooltip.appendChild(meta);
  }
  positionTooltip(event);
  tooltip.classList.add('visible');
}

function positionTooltip(event) {
  if (!tooltip) return;
  const pad = 14;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + 280 > window.innerWidth) x = event.clientX - 280 - pad;
  if (y + 90 > window.innerHeight) y = event.clientY - 90 - pad;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

function hideTooltip() {
  if (tooltip) tooltip.classList.remove('visible');
}

/* ===== Zoom / pan controls ===== */

function zoomIn() {
  svg.transition().duration(dur(250)).call(zoomBehavior.scaleBy, 1.35);
}

function zoomOut() {
  svg.transition().duration(dur(250)).call(zoomBehavior.scaleBy, 0.7);
}

function resetView() {
  zoomToFit(dur(450));
}

function zoomToFit(duration) {
  if (!svg || !nodesData.length) return;
  const pad = 60;
  const xs = nodesData.map(d => d.x);
  const ys = nodesData.map(d => d.y);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);

  const rect = containerEl.getBoundingClientRect();
  const vw = rect.width || width;
  const vh = rect.height || height;

  const scale = Math.min(vw / bw, vh / bh, 1.6);
  const tx = vw / 2 - ((minX + maxX) / 2) * scale;
  const ty = vh / 2 - ((minY + maxY) / 2) * scale;

  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
  if (duration > 0) {
    svg.transition().duration(duration).call(zoomBehavior.transform, transform);
  } else {
    svg.call(zoomBehavior.transform, transform);
  }
}

function toggleLabels() {
  labelsVisible = !labelsVisible;
  nodeSel.selectAll('.node-label')
    .transition().duration(dur(200))
    .attr('opacity', labelsVisible ? 1 : 0);
  return labelsVisible;
}

function centerOnNode(nodeId, opts = {}) {
  const node = nodeMap[nodeId];
  if (!node || !svg) return;

  if (opts.pulse !== false) {
    focusedId = nodeId;
    nodeSel.classed('focused', d => d.id === nodeId);
    highlightNeighborhood(nodeId);
  }

  const rect = containerEl.getBoundingClientRect();
  const vw = rect.width || width;
  const vh = rect.height || height;
  const scale = 1.5;
  const tx = vw / 2 - node.x * scale;
  const ty = vh / 2 - node.y * scale;
  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
  svg.transition().duration(dur(500)).ease(d3.easeCubicOut).call(zoomBehavior.transform, transform);
}

function destroyGraph() {
  hideTooltip();
  if (simulation) {
    simulation.stop();
    simulation = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  nodesData = [];
  linksData = [];
  nodeMap = {};
  focusedId = null;
}

export {
  initGraph, destroyGraph, zoomIn, zoomOut, resetView,
  toggleLabels, centerOnNode, setFilters, clearFocus,
  TYPE_COLORS, TYPE_GLYPHS, LINK_STYLES, SEVERITY_COLORS
};
