import { VALID_TYPES, VALID_RELATIONSHIP_TYPES } from './parser.js';

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

const COLUMN_WIDTH = 200;
const COLUMN_GAP = 60;
const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const NODE_GAP_Y = 20;
const HEADER_HEIGHT = 50;
const START_Y = 80;
const START_X = 40;

let svg, mainGroup, nodesData, linksData, nodeElements, linkElements;
let zoomBehavior, labelsVisible = false, tooltip, onNodeClick = null;
let totalWidth, totalHeight, nodeMap, typeKeys;

function initGraph(container, data, callbacks) {
  onNodeClick = callbacks.onNodeClick || null;

  // Step 1: Group nodes by type, sort by severity
  const groups = {};
  data.nodes.forEach(node => {
    if (!groups[node.type]) groups[node.type] = [];
    groups[node.type].push({ ...node });
  });
  Object.values(groups).forEach(arr =>
    arr.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
  );

  // Step 2: Calculate positions — set x,y on every node BEFORE rendering
  typeKeys = Object.keys(groups);
  typeKeys.forEach((type, colIndex) => {
    const colX = START_X + colIndex * (COLUMN_WIDTH + COLUMN_GAP);
    groups[type].forEach((node, rowIndex) => {
      node.x = colX;
      node.y = START_Y + HEADER_HEIGHT + rowIndex * (NODE_HEIGHT + NODE_GAP_Y);
    });
  });

  // Flatten into arrays
  nodesData = [];
  typeKeys.forEach(type => { nodesData.push(...groups[type]); });
  linksData = data.connections.map(c => ({ ...c }));

  nodeMap = {};
  nodesData.forEach(n => { nodeMap[n.id] = n; });

  // Step 3: Calculate viewBox to fit all content
  totalWidth = START_X * 2 + typeKeys.length * (COLUMN_WIDTH + COLUMN_GAP);
  const maxNodesInCol = Math.max(...Object.values(groups).map(g => g.length));
  totalHeight = START_Y + HEADER_HEIGHT + maxNodesInCol * (NODE_HEIGHT + NODE_GAP_Y) + 80;

  // Clear and create SVG
  d3.select(container).selectAll('*').remove();

  svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${totalWidth} ${totalHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const defs = svg.append('defs');

  // Arrow markers for each relationship type
  VALID_RELATIONSHIP_TYPES.forEach(type => {
    defs.append('marker')
      .attr('id', `arrow-${type}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4Z')
      .attr('fill', LINK_COLORS[type])
      .attr('opacity', 0.7);
  });

  // Drop shadow filter
  const shadow = defs.append('filter').attr('id', 'card-shadow')
    .attr('x', '-10%').attr('y', '-10%').attr('width', '120%').attr('height', '130%');
  shadow.append('feDropShadow')
    .attr('dx', 0).attr('dy', 2).attr('stdDeviation', 4)
    .attr('flood-color', '#000').attr('flood-opacity', 0.3);

  // Step 8: Pan & zoom
  mainGroup = svg.append('g');

  zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 2])
    .on('zoom', (event) => {
      mainGroup.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);
  svg.on('dblclick.zoom', null);
  svg.on('dblclick', () => resetView());

  // Step 4: Column backgrounds
  typeKeys.forEach((type, colIndex) => {
    const colX = START_X + colIndex * (COLUMN_WIDTH + COLUMN_GAP);
    mainGroup.append('rect')
      .attr('x', colX - 10)
      .attr('y', START_Y - 10)
      .attr('width', COLUMN_WIDTH + 20)
      .attr('height', totalHeight - START_Y)
      .attr('rx', 8)
      .attr('fill', TYPE_COLORS[type] || '#64748b')
      .attr('opacity', 0.05)
      .style('pointer-events', 'none');
  });

  // Step 5: Column headers
  typeKeys.forEach((type, colIndex) => {
    const colX = START_X + colIndex * (COLUMN_WIDTH + COLUMN_GAP);
    const label = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const count = groups[type].length;

    const hg = mainGroup.append('g');
    hg.append('circle')
      .attr('cx', colX + 8)
      .attr('cy', START_Y + 12)
      .attr('r', 5)
      .attr('fill', TYPE_COLORS[type] || '#64748b');

    hg.append('text')
      .attr('x', colX + 20)
      .attr('y', START_Y + 16)
      .attr('font-family', 'Outfit, sans-serif')
      .attr('font-size', '13px')
      .attr('font-weight', '600')
      .attr('fill', '#94a3b8')
      .text(label);

    hg.append('text')
      .attr('x', colX + COLUMN_WIDTH - 10)
      .attr('y', START_Y + 16)
      .attr('text-anchor', 'end')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '11px')
      .attr('fill', '#64748b')
      .text(`(${count})`);
  });

  // Step 7: Connections (render before nodes so nodes appear on top)
  const linksG = mainGroup.append('g');

  const validLinks = linksData.filter(l => nodeMap[l.source] && nodeMap[l.target]);

  linkElements = linksG.selectAll('g')
    .data(validLinks)
    .enter()
    .append('g')
    .attr('class', 'link-group');

  linkElements.append('path')
    .attr('class', d => `link-line link-animated link-${d.type}`)
    .attr('fill', 'none')
    .attr('stroke', d => LINK_COLORS[d.type] || '#64748b')
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.45)
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .attr('d', d => {
      const src = nodeMap[d.source];
      const tgt = nodeMap[d.target];
      return computeLinkPath(src, tgt);
    })
    .on('mouseenter', (event, d) => showLinkTooltip(event, d))
    .on('mouseleave', hideTooltip);

  // Step 6: Render nodes
  const nodesG = mainGroup.append('g');

  nodeElements = nodesG.selectAll('g')
    .data(nodesData)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation();
      if (onNodeClick) onNodeClick(d);
    })
    .on('mouseenter', function(event, d) {
      showNodeTooltip(event, d);
      d3.select(this).select('.node-card')
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 1);
      d3.select(this)
        .transition().duration(120)
        .attr('transform', `translate(${d.x - NODE_WIDTH * 0.02},${d.y - NODE_HEIGHT * 0.02}) scale(1.04)`);
    })
    .on('mouseleave', function(event, d) {
      hideTooltip();
      d3.select(this).select('.node-card')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.3);
      d3.select(this)
        .transition().duration(120)
        .attr('transform', `translate(${d.x},${d.y}) scale(1)`);
    });

  // Card background
  nodeElements.append('rect')
    .attr('class', 'node-card')
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 8)
    .attr('fill', '#16161f')
    .attr('stroke', d => TYPE_COLORS[d.type] || '#64748b')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.3)
    .attr('filter', 'url(#card-shadow)');

  // Left accent border
  nodeElements.append('rect')
    .attr('x', 0)
    .attr('y', 4)
    .attr('width', 4)
    .attr('height', NODE_HEIGHT - 8)
    .attr('rx', 2)
    .attr('fill', d => TYPE_COLORS[d.type] || '#64748b')
    .style('pointer-events', 'none');

  // Title text (truncated to 20 chars)
  nodeElements.append('text')
    .attr('x', 14)
    .attr('y', 24)
    .attr('font-family', 'Outfit, sans-serif')
    .attr('font-size', '12px')
    .attr('font-weight', '500')
    .attr('fill', '#e2e8f0')
    .style('pointer-events', 'none')
    .text(d => d.title.length > 20 ? d.title.slice(0, 18) + '...' : d.title);

  // Severity label
  nodeElements.append('text')
    .attr('x', 14)
    .attr('y', 42)
    .attr('font-family', 'Outfit, sans-serif')
    .attr('font-size', '10px')
    .attr('fill', d => SEVERITY_COLORS[d.severity] || '#64748b')
    .attr('opacity', 0.8)
    .style('pointer-events', 'none')
    .text(d => d.severity);

  // Severity dot
  nodeElements.append('circle')
    .attr('cx', NODE_WIDTH - 14)
    .attr('cy', NODE_HEIGHT / 2)
    .attr('r', 4)
    .attr('fill', d => SEVERITY_COLORS[d.severity] || '#64748b')
    .style('pointer-events', 'none');

  // Section label (toggled with toggleLabels)
  nodeElements.append('text')
    .attr('class', 'node-section-label')
    .attr('x', NODE_WIDTH / 2)
    .attr('y', NODE_HEIGHT + 14)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'Outfit, sans-serif')
    .attr('font-size', '9px')
    .attr('fill', '#64748b')
    .attr('opacity', 0)
    .style('pointer-events', 'none')
    .text(d => d.section || '');

  // Tooltip
  tooltip = document.querySelector('.graph-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    document.body.appendChild(tooltip);
  }

  // Initial zoom to fit
  zoomToFit(0);

  // Animate in
  animateIn();
}

// Step 7 helper: Bezier curve paths
function computeLinkPath(src, tgt) {
  if (!src || !tgt) return '';

  const sameColumn = (src.x === tgt.x);

  if (sameColumn) {
    // U-shape curving to the right
    const sx = src.x + NODE_WIDTH;
    const sy = src.y + NODE_HEIGHT / 2;
    const tx = tgt.x + NODE_WIDTH;
    const ty = tgt.y + NODE_HEIGHT / 2;
    const bulge = 150;
    return `M${sx},${sy} C${sx + bulge},${sy} ${tx + bulge},${ty} ${tx},${ty}`;
  }

  // Source right edge → target left edge
  const goingRight = src.x < tgt.x;
  const sx = goingRight ? src.x + NODE_WIDTH : src.x;
  const sy = src.y + NODE_HEIGHT / 2;
  const tx = goingRight ? tgt.x : tgt.x + NODE_WIDTH;
  const ty = tgt.y + NODE_HEIGHT / 2;

  const dx = Math.abs(tx - sx);
  const offset = Math.max(dx * 0.4, 40);

  const c1x = goingRight ? sx + offset : sx - offset;
  const c2x = goingRight ? tx - offset : tx + offset;

  return `M${sx},${sy} C${c1x},${sy} ${c2x},${ty} ${tx},${ty}`;
}

function animateIn() {
  if (nodeElements) {
    nodeElements.each(function(d, i) {
      d3.select(this)
        .style('opacity', 0)
        .transition()
        .delay(i * 25)
        .duration(300)
        .style('opacity', 1);
    });
  }
  if (linkElements) {
    const delay = nodesData.length * 25 + 200;
    linkElements.each(function(d, i) {
      d3.select(this)
        .style('opacity', 0)
        .transition()
        .delay(delay + i * 15)
        .duration(300)
        .style('opacity', 1);
    });
  }
}

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

function zoomIn() {
  svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3);
}

function zoomOut() {
  svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7);
}

function resetView() {
  zoomToFit(400);
}

function zoomToFit(duration) {
  if (!svg || !totalWidth || !totalHeight) return;

  // Read actual container size
  const container = svg.node()?.parentElement;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const vw = rect.width || totalWidth;
  const vh = rect.height || totalHeight;

  const scale = Math.min(vw / totalWidth, vh / totalHeight) * 0.95;
  const tx = (vw - totalWidth * scale) / 2;
  const ty = (vh - totalHeight * scale) / 2;

  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);

  if (duration > 0) {
    svg.transition().duration(duration).call(zoomBehavior.transform, transform);
  } else {
    svg.call(zoomBehavior.transform, transform);
  }
}

function toggleLabels() {
  labelsVisible = !labelsVisible;
  mainGroup.selectAll('.node-section-label')
    .transition().duration(200)
    .attr('opacity', labelsVisible ? 1 : 0);
  return labelsVisible;
}

// Step 9: Center on node from sidebar
function centerOnNode(nodeId) {
  const node = nodeMap?.[nodeId];
  if (!node || !svg) return;

  // Remove old highlights
  mainGroup.selectAll('.node-group').classed('highlighted', false);
  mainGroup.selectAll('.node-group')
    .filter(d => d.id === nodeId)
    .classed('highlighted', true);

  // Read container size
  const container = svg.node()?.parentElement;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const vw = rect.width || totalWidth;
  const vh = rect.height || totalHeight;

  // Center the node
  const scale = 1.4;
  const nodeCX = node.x + NODE_WIDTH / 2;
  const nodeCY = node.y + NODE_HEIGHT / 2;
  const tx = vw / 2 - nodeCX * scale;
  const ty = vh / 2 - nodeCY * scale;

  const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
  svg.transition().duration(500).call(zoomBehavior.transform, transform);

  setTimeout(() => {
    mainGroup.selectAll('.node-group').classed('highlighted', false);
  }, 3000);
}

function highlightNode(nodeId) {
  if (!mainGroup) return;
  mainGroup.selectAll('.node-group').classed('highlighted', false);
  mainGroup.selectAll('.node-group')
    .filter(d => d.id === nodeId)
    .classed('highlighted', true);
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
