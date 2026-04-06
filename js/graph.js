import { VALID_TYPES, VALID_RELATIONSHIP_TYPES } from './parser.js';

const TYPE_COLORS = {
  'loophole': '#ef4444',
  'exemption': '#f59e0b',
  'gray-area': '#8b5cf6',
  'contradiction': '#ec4899',
  'missing-definition': '#6366f1',
  'weak-enforcement': '#f97316',
  'scope-gap': '#14b8a6',
  'sunset-clause': '#64748b'
};

const LINK_COLORS = {
  'enables': '#ef4444',
  'weakens': '#f59e0b',
  'contradicts': '#ec4899',
  'depends-on': '#6366f1',
  'amplifies': '#f97316'
};

const SEVERITY_COLORS = {
  'critical': '#ef4444',
  'high': '#f97316',
  'medium': '#f59e0b',
  'low': '#64748b'
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const COLUMN_ORDER = [
  'loophole', 'exemption', 'gray-area', 'contradiction',
  'missing-definition', 'weak-enforcement', 'scope-gap', 'sunset-clause'
];

const NODE_W = 170;
const NODE_H = 60;
const NODE_R = 10;
const COL_GAP = 80;
const ROW_GAP = 20;
const HEADER_H = 40;
const HEADER_GAP = 16;
const PADDING = 60;

let svg, g, nodesData, linksData, nodeElements, linkElements;
let zoom, labelsVisible = false, tooltip, onNodeClick = null;
let width, height, contentW, contentH, nodeMap;

/* ===== Layout Engine ===== */

function computeLayout(nodes) {
  const groups = {};
  nodes.forEach(n => {
    if (!groups[n.type]) groups[n.type] = [];
    groups[n.type].push(n);
  });

  const activeTypes = COLUMN_ORDER.filter(t => groups[t] && groups[t].length > 0);

  activeTypes.forEach(t => {
    groups[t].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  });

  const columns = [];
  const positions = {};
  let curX = PADDING;

  activeTypes.forEach(type => {
    const colNodes = groups[type];
    const col = { type, x: curX, nodeCount: colNodes.length, nodes: [] };

    let curY = PADDING + HEADER_H + HEADER_GAP;
    let lastSev = null;

    colNodes.forEach(n => {
      if (lastSev !== null && SEVERITY_ORDER[n.severity] !== SEVERITY_ORDER[lastSev]) {
        curY += 8;
      }
      lastSev = n.severity;

      positions[n.id] = {
        x: curX,
        y: curY,
        cx: curX + NODE_W / 2,
        cy: curY + NODE_H / 2,
        col: type
      };
      col.nodes.push(n.id);
      curY += NODE_H + ROW_GAP;
    });

    col.height = curY - ROW_GAP + PADDING;
    columns.push(col);
    curX += NODE_W + COL_GAP;
  });

  const totalW = curX - COL_GAP + PADDING;
  const totalH = Math.max(...columns.map(c => c.height), PADDING * 2 + HEADER_H);

  return { columns, positions, totalWidth: totalW, totalHeight: totalH };
}

/* ===== Connection Paths ===== */

function computeLinkPath(src, tgt) {
  const sp = src._pos;
  const tp = tgt._pos;

  if (sp.col !== tp.col) {
    const goingRight = sp.x < tp.x;
    const sx = goingRight ? sp.x + NODE_W : sp.x;
    const sy = sp.cy;
    const tx = goingRight ? tp.x : tp.x + NODE_W;
    const ty = tp.cy;
    const offset = Math.max(Math.abs(tx - sx) * 0.4, 50);
    const c1x = goingRight ? sx + offset : sx - offset;
    const c2x = goingRight ? tx - offset : tx + offset;
    return `M${sx},${sy} C${c1x},${sy} ${c2x},${ty} ${tx},${ty}`;
  }

  const sx = sp.x + NODE_W;
  const sy = sp.cy;
  const tx = tp.x + NODE_W;
  const ty = tp.cy;
  const bulge = NODE_W * 0.5;
  return `M${sx},${sy} C${sx + bulge},${sy} ${tx + bulge},${ty} ${tx},${ty}`;
}

/* ===== Init ===== */

function initGraph(container, data, callbacks) {
  onNodeClick = callbacks.onNodeClick || null;

  nodesData = data.nodes.map(n => ({ ...n }));
  linksData = data.connections.map(c => ({ ...c }));

  nodeMap = {};
  nodesData.forEach(n => { nodeMap[n.id] = n; });

  const layout = computeLayout(nodesData);
  contentW = layout.totalWidth;
  contentH = layout.totalHeight;

  nodesData.forEach(n => {
    const p = layout.positions[n.id];
    if (p) n._pos = p;
  });

  // Use container dimensions if available, otherwise fall back to content dimensions
  const rect = container.getBoundingClientRect();
  width = rect.width > 0 ? rect.width : contentW;
  height = rect.height > 0 ? rect.height : contentH;

  d3.select(container).selectAll('*').remove();

  svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`);

  const defs = svg.append('defs');

  VALID_TYPES.forEach(type => {
    const color = TYPE_COLORS[type];
    const filter = defs.append('filter')
      .attr('id', `shadow-${type}`)
      .attr('x', '-20%').attr('y', '-20%')
      .attr('width', '140%').attr('height', '140%');
    filter.append('feDropShadow')
      .attr('dx', 0).attr('dy', 2)
      .attr('stdDeviation', 4)
      .attr('flood-color', color)
      .attr('flood-opacity', 0.1);

    const filterHover = defs.append('filter')
      .attr('id', `shadow-hover-${type}`)
      .attr('x', '-20%').attr('y', '-20%')
      .attr('width', '140%').attr('height', '140%');
    filterHover.append('feDropShadow')
      .attr('dx', 0).attr('dy', 2)
      .attr('stdDeviation', 6)
      .attr('flood-color', color)
      .attr('flood-opacity', 0.25);
  });

  VALID_RELATIONSHIP_TYPES.forEach(type => {
    defs.append('marker')
      .attr('id', `arrow-${type}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', LINK_COLORS[type])
      .attr('opacity', 0.7);
  });

  g = svg.append('g');

  // Column stripes
  layout.columns.forEach(col => {
    g.append('rect')
      .attr('class', 'column-stripe')
      .attr('x', col.x - 15)
      .attr('y', PADDING)
      .attr('width', NODE_W + 30)
      .attr('height', contentH - PADDING)
      .attr('rx', 8)
      .attr('fill', TYPE_COLORS[col.type])
      .attr('opacity', 0.04);
  });

  // Column headers
  layout.columns.forEach(col => {
    const hg = g.append('g');
    const typeLabel = col.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    hg.append('circle')
      .attr('cx', col.x + 8)
      .attr('cy', PADDING + 14)
      .attr('r', 5)
      .attr('fill', TYPE_COLORS[col.type]);

    hg.append('text')
      .attr('class', 'column-header-label')
      .attr('x', col.x + 20)
      .attr('y', PADDING + 18)
      .text(typeLabel);

    hg.append('text')
      .attr('class', 'column-header-count')
      .attr('x', col.x + NODE_W - 5)
      .attr('y', PADDING + 18)
      .attr('text-anchor', 'end')
      .text(`(${col.nodeCount})`);
  });

  // Links
  const linksG = g.append('g').attr('class', 'links');

  linkElements = linksG.selectAll('g')
    .data(linksData.filter(l => nodeMap[l.source] && nodeMap[l.target]))
    .enter()
    .append('g')
    .attr('class', 'link-group');

  linkElements.append('path')
    .attr('class', d => `link-line link-animated link-${d.type}`)
    .attr('stroke', d => LINK_COLORS[d.type] || '#64748b')
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .attr('d', d => computeLinkPath(nodeMap[d.source], nodeMap[d.target]))
    .on('mouseenter', (event, d) => showLinkTooltip(event, d))
    .on('mouseleave', hideTooltip);

  // Nodes
  const nodesG = g.append('g').attr('class', 'nodes');

  nodeElements = nodesG.selectAll('g')
    .data(nodesData.filter(n => n._pos))
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .attr('transform', d => `translate(${d._pos.x},${d._pos.y})`)
    .on('click', (event, d) => {
      event.stopPropagation();
      if (onNodeClick) onNodeClick(d);
    })
    .on('mouseenter', function(event, d) {
      showNodeTooltip(event, d);
      d3.select(this).select('.node-card').attr('filter', `url(#shadow-hover-${d.type})`);
      const pos = d._pos;
      d3.select(this)
        .transition().duration(150)
        .attr('transform', `translate(${pos.x - NODE_W * 0.025},${pos.y - NODE_H * 0.025}) scale(1.05)`);
    })
    .on('mouseleave', function(event, d) {
      hideTooltip();
      d3.select(this).select('.node-card').attr('filter', `url(#shadow-${d.type})`);
      const pos = d._pos;
      d3.select(this)
        .transition().duration(150)
        .attr('transform', `translate(${pos.x},${pos.y}) scale(1)`);
    });

  // Card background
  nodeElements.append('rect')
    .attr('class', 'node-card')
    .attr('width', NODE_W)
    .attr('height', NODE_H)
    .attr('rx', NODE_R)
    .attr('fill', '#16161f')
    .attr('filter', d => `url(#shadow-${d.type})`);

  // Left accent border
  nodeElements.append('rect')
    .attr('class', 'node-accent')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', 4)
    .attr('height', NODE_H)
    .attr('rx', 2)
    .attr('fill', d => TYPE_COLORS[d.type]);

  // Clip to rounded left edge
  nodeElements.each(function(d, i) {
    const clipId = `clip-accent-${i}`;
    defs.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', 6).attr('height', NODE_H)
      .attr('rx', NODE_R);
    d3.select(this).select('.node-accent').attr('clip-path', `url(#${clipId})`);
  });

  // Title text
  nodeElements.append('text')
    .attr('class', 'node-title')
    .attr('x', 14)
    .attr('y', 28)
    .text(d => d.title)
    .each(function() {
      const el = this;
      const maxW = NODE_W - 40;
      let text = el.textContent;
      if (el.getComputedTextLength && el.getComputedTextLength() > maxW) {
        while (text.length > 0 && el.getComputedTextLength() > maxW) {
          text = text.slice(0, -1);
          el.textContent = text + '...';
        }
      }
    });

  // Severity label text
  nodeElements.append('text')
    .attr('class', 'node-title')
    .attr('x', 14)
    .attr('y', 45)
    .attr('fill', d => SEVERITY_COLORS[d.severity] || '#64748b')
    .attr('font-size', '10px')
    .attr('opacity', 0.7)
    .text(d => d.severity);

  // Severity dot
  nodeElements.append('circle')
    .attr('class', 'node-severity-dot')
    .attr('cx', NODE_W - 16)
    .attr('cy', NODE_H / 2)
    .attr('r', 4)
    .attr('fill', d => SEVERITY_COLORS[d.severity] || '#64748b');

  // Secondary labels (toggled)
  nodeElements.append('text')
    .attr('class', 'node-secondary-label')
    .attr('x', NODE_W / 2)
    .attr('y', NODE_H + 14)
    .text(d => d.section || '');

  // Zoom & pan
  zoom = d3.zoom()
    .scaleExtent([0.15, 3])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);
  svg.on('dblclick.zoom', null);
  svg.on('dblclick', () => resetView());

  tooltip = document.querySelector('.graph-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    document.body.appendChild(tooltip);
  }

  zoomToFit(0);
  animateIn();

  // Re-zoom after a short delay in case container dimensions weren't ready
  setTimeout(() => zoomToFit(300), 300);
}

/* ===== Animation ===== */

function animateIn() {
  nodeElements.each(function(d, i) {
    d3.select(this)
      .transition()
      .delay(i * 30)
      .duration(0)
      .on('end', function() { d3.select(this).classed('visible', true); });
  });

  const totalDelay = nodesData.length * 30 + 400;

  linkElements.each(function(d, i) {
    d3.select(this)
      .transition()
      .delay(totalDelay + i * 20)
      .duration(0)
      .on('end', function() { d3.select(this).classed('visible', true); });
  });
}

/* ===== Tooltips ===== */

function showNodeTooltip(event, d) {
  const typeLabel = d.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  tooltip.innerHTML = `
    <div class="tt-title">${escapeHtml(d.title)}</div>
    <div class="tt-meta">${typeLabel} &middot; ${d.section || ''} &middot; ${d.severity}</div>
  `;
  positionTooltip(event);
  tooltip.classList.add('visible');
}

function showLinkTooltip(event, d) {
  const typeLabel = d.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  tooltip.innerHTML = `
    <div class="tt-title">${typeLabel}</div>
    <div class="tt-meta">${escapeHtml(d.description || '')}</div>
  `;
  positionTooltip(event);
  tooltip.classList.add('visible');
}

function positionTooltip(event) {
  const pad = 12;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + 280 > window.innerWidth) x = event.clientX - 280 - pad;
  if (y + 80 > window.innerHeight) y = event.clientY - 80 - pad;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

function hideTooltip() {
  if (tooltip) tooltip.classList.remove('visible');
}

/* ===== Controls ===== */

function zoomIn() {
  svg.transition().duration(300).call(zoom.scaleBy, 1.3);
}

function zoomOut() {
  svg.transition().duration(300).call(zoom.scaleBy, 0.7);
}

function resetView() {
  zoomToFit(500);
}

function zoomToFit(duration = 600) {
  if (!nodesData || nodesData.length === 0) return;

  // Compute actual bounds from node positions with 50px padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodesData.forEach(n => {
    if (!n._pos) return;
    minX = Math.min(minX, n._pos.x - 50);
    minY = Math.min(minY, n._pos.y - 70); // extra for column headers
    maxX = Math.max(maxX, n._pos.x + NODE_W + 50);
    maxY = Math.max(maxY, n._pos.y + NODE_H + 50);
  });

  if (!isFinite(minX)) return;

  const bw = maxX - minX;
  const bh = maxY - minY;

  // Re-read container dimensions in case it became visible
  const container = svg.node()?.parentElement;
  if (container) {
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      width = r.width;
      height = r.height;
      svg.attr('viewBox', `0 0 ${width} ${height}`);
    }
  }

  const scale = Math.min(width / bw, height / bh, 1.5);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-cx, -cy);

  if (duration > 0) {
    svg.transition().duration(duration).call(zoom.transform, transform);
  } else {
    svg.call(zoom.transform, transform);
  }
}

function toggleLabels() {
  labelsVisible = !labelsVisible;
  g.selectAll('.node-secondary-label').classed('visible', labelsVisible);
  return labelsVisible;
}

function centerOnNode(nodeId) {
  const node = nodesData.find(n => n.id === nodeId);
  if (!node || !node._pos) return;

  nodeElements.classed('highlighted', false);
  nodeElements.filter(d => d.id === nodeId).classed('highlighted', true);

  const scale = 1.8;
  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-node._pos.cx, -node._pos.cy);

  svg.transition().duration(600).call(zoom.transform, transform);

  setTimeout(() => {
    nodeElements.classed('highlighted', false);
  }, 3000);
}

function highlightNode(nodeId) {
  nodeElements.classed('highlighted', false);
  nodeElements.filter(d => d.id === nodeId).classed('highlighted', true);
}

function destroyGraph() {
  hideTooltip();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export {
  initGraph, destroyGraph, zoomIn, zoomOut, resetView,
  toggleLabels, centerOnNode, highlightNode,
  TYPE_COLORS, LINK_COLORS
};
