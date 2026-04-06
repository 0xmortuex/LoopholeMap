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

const SEVERITY_RADIUS = {
  'critical': 25,
  'high': 20,
  'medium': 16,
  'low': 12
};

let svg, g, simulation, nodesData, linksData, nodeElements, linkElements, labelElements;
let zoom;
let labelsVisible = false;
let tooltip;
let onNodeClick = null;
let width, height;

function initGraph(container, data, callbacks) {
  onNodeClick = callbacks.onNodeClick || null;

  const rect = container.getBoundingClientRect();
  width = rect.width;
  height = rect.height;

  const cx = width / 2;
  const cy = height / 2;
  const spreadRadius = Math.min(width, height) * 0.35;
  nodesData = data.nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / data.nodes.length;
    return { ...n, x: cx + spreadRadius * Math.cos(angle), y: cy + spreadRadius * Math.sin(angle) };
  });
  linksData = data.connections.map(c => ({
    ...c,
    source: c.source,
    target: c.target
  }));

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
      .attr('id', `glow-${type}`)
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'coloredBlur');
    filter.append('feFlood')
      .attr('flood-color', color)
      .attr('flood-opacity', '0.35')
      .attr('result', 'glowColor');
    filter.append('feComposite')
      .attr('in', 'glowColor')
      .attr('in2', 'coloredBlur')
      .attr('operator', 'in')
      .attr('result', 'softGlow');
    const merge = filter.append('feMerge');
    merge.append('feMergeNode').attr('in', 'softGlow');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');
  });

  VALID_RELATIONSHIP_TYPES.forEach(type => {
    defs.append('marker')
      .attr('id', `arrow-${type}`)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 8)
      .attr('markerHeight', 8)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', LINK_COLORS[type])
      .attr('opacity', 0.6);
  });

  g = svg.append('g');

  const bgPattern = g.append('g').attr('class', 'graph-bg-pattern');
  const gridSize = 40;
  for (let x = 0; x < width * 3; x += gridSize) {
    bgPattern.append('line')
      .attr('x1', x - width).attr('y1', -height)
      .attr('x2', x - width).attr('y2', height * 2);
  }
  for (let y = 0; y < height * 3; y += gridSize) {
    bgPattern.append('line')
      .attr('x1', -width).attr('y1', y - height)
      .attr('x2', width * 2).attr('y2', y - height);
  }

  linkElements = g.append('g').attr('class', 'links')
    .selectAll('g')
    .data(linksData)
    .enter()
    .append('g')
    .attr('class', 'link-group');

  linkElements.append('path')
    .attr('class', d => `link-line link-animated link-${d.type}`)
    .attr('stroke', d => LINK_COLORS[d.type] || '#64748b')
    .attr('marker-end', d => `url(#arrow-${d.type})`)
    .on('mouseenter', (event, d) => showLinkTooltip(event, d))
    .on('mouseleave', hideTooltip);

  nodeElements = g.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodesData)
    .enter()
    .append('g')
    .attr('class', 'node-group')
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded))
    .on('click', (event, d) => {
      event.stopPropagation();
      if (onNodeClick) onNodeClick(d);
    })
    .on('mouseenter', (event, d) => {
      showNodeTooltip(event, d);
      if (!labelsVisible) {
        d3.select(event.currentTarget).select('.node-label').attr('opacity', 1);
      }
    })
    .on('mouseleave', (event) => {
      hideTooltip();
      if (!labelsVisible) {
        d3.select(event.currentTarget).select('.node-label').attr('opacity', 0);
      }
    });

  nodeElements.append('circle')
    .attr('class', d => `node-circle node-${d.type}`)
    .attr('r', d => SEVERITY_RADIUS[d.severity] || 16)
    .attr('fill', d => TYPE_COLORS[d.type] || '#64748b')
    .attr('filter', d => `url(#glow-${d.type})`);

  labelElements = nodeElements.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => (SEVERITY_RADIUS[d.severity] || 16) + 14)
    .attr('opacity', 0)
    .text(d => d.title.length > 20 ? d.title.slice(0, 18) + '...' : d.title);

  simulation = d3.forceSimulation(nodesData)
    .force('link', d3.forceLink(linksData).id(d => d.id).distance(180).strength(0.3))
    .force('charge', d3.forceManyBody().strength(-550).distanceMax(600))
    .force('collision', d3.forceCollide().radius(d => (SEVERITY_RADIUS[d.severity] || 16) + 28).strength(1))
    .force('x', d3.forceX(width / 2).strength(0.04))
    .force('y', d3.forceY(height / 2).strength(0.04))
    .alphaDecay(0.02)
    .on('tick', ticked);

  // Auto zoom-to-fit after simulation stabilizes
  let tickCount = 0;
  simulation.on('tick.zoomfit', () => {
    tickCount++;
    if (tickCount === 200) {
      zoomToFit();
      simulation.on('tick.zoomfit', null);
    }
  });

  zoom = d3.zoom()
    .scaleExtent([0.2, 4])
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

  animateIn();
}

function ticked() {
  linkElements.select('path')
    .attr('d', d => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
      return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
    });

  nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);
}

function animateIn() {
  nodeElements.each(function(d, i) {
    d3.select(this)
      .transition()
      .delay(i * 30)
      .duration(0)
      .on('end', function() {
        d3.select(this).classed('visible', true);
      });
  });

  const totalNodeDelay = nodesData.length * 30 + 400;

  linkElements.each(function(d, i) {
    d3.select(this)
      .transition()
      .delay(totalNodeDelay + i * 20)
      .duration(0)
      .on('end', function() {
        d3.select(this).classed('visible', true);
      });
  });
}

function dragStarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragEnded(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

function showNodeTooltip(event, d) {
  const typeLabel = d.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  tooltip.innerHTML = `
    <div class="tt-title">${escapeHtml(d.title)}</div>
    <div class="tt-meta">${typeLabel} &middot; ${d.section} &middot; ${d.severity}</div>
  `;
  positionTooltip(event);
  tooltip.classList.add('visible');
}

function showLinkTooltip(event, d) {
  const typeLabel = d.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  tooltip.innerHTML = `
    <div class="tt-title">${typeLabel}</div>
    <div class="tt-meta">${escapeHtml(d.description)}</div>
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

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodesData.forEach(d => {
    const r = (SEVERITY_RADIUS[d.severity] || 16) + 30;
    if (d.x - r < minX) minX = d.x - r;
    if (d.y - r < minY) minY = d.y - r;
    if (d.x + r > maxX) maxX = d.x + r;
    if (d.y + r > maxY) maxY = d.y + r;
  });

  const padding = 60;
  minX -= padding; minY -= padding; maxX += padding; maxY += padding;

  const bw = maxX - minX;
  const bh = maxY - minY;
  const scale = Math.min(width / bw, height / bh, 1.8);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-cx, -cy);

  svg.transition().duration(duration).call(zoom.transform, transform);
}

function toggleLabels() {
  labelsVisible = !labelsVisible;
  if (labelElements) {
    labelElements.attr('opacity', labelsVisible ? 1 : 0);
  }
  return labelsVisible;
}

function centerOnNode(nodeId) {
  const node = nodesData.find(n => n.id === nodeId);
  if (!node) return;

  nodeElements.classed('highlighted', false);
  nodeElements.filter(d => d.id === nodeId).classed('highlighted', true);

  const scale = 1.5;
  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-node.x, -node.y);

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
  if (simulation) simulation.stop();
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
