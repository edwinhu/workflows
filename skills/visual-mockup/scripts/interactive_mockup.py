#!/usr/bin/env python3
"""Generate an interactive drag-and-drop diagram mockup as a standalone HTML file.

Usage:
    python3 interactive_mockup.py layout.json [--output /tmp/mockup.html] [--open]
    echo '{"nodes":[...]}' | python3 interactive_mockup.py - [--open]

Input JSON format:
{
  "title": "Optional diagram title",
  "nodes": [
    {"id": "n1", "label": "Issuer", "x": 100, "y": 100, "color": "#4a90d9"}
  ],
  "edges": [
    {"from": "n1", "to": "n2", "label": "claim", "color": "#666", "dashed": false}
  ],
  "regions": [
    {"id": "r1", "label": "Primary Market", "x": 50, "y": 50, "w": 300, "h": 200, "color": "#4a90d9"}
  ]
}

All coordinates are in pixels. Nodes default to (0,0) if position omitted.
Colors default to sensible values if omitted.
"""

import json
import sys
import subprocess
import argparse
from pathlib import Path

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Interactive Diagram Mockup</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #1e1e2e; color: #cdd6f4;
    overflow: hidden; height: 100vh;
  }
  #toolbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: #181825; border-bottom: 1px solid #313244;
    padding: 8px 16px; display: flex; align-items: center; gap: 12px;
    height: 44px;
  }
  #toolbar .title { font-weight: 600; font-size: 14px; color: #cba6f7; }
  #toolbar button {
    background: #313244; color: #cdd6f4; border: 1px solid #45475a;
    border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 13px;
  }
  #toolbar button:hover { background: #45475a; }
  #toolbar button.primary { background: #89b4fa; color: #1e1e2e; border-color: #89b4fa; font-weight: 600; }
  #toolbar button.primary:hover { background: #74c7ec; }
  #toolbar .sep { width: 1px; height: 24px; background: #313244; }
  #toolbar select {
    background: #313244; color: #cdd6f4; border: 1px solid #45475a;
    border-radius: 6px; padding: 4px 8px; font-size: 13px; cursor: pointer;
  }
  #toolbar select:hover { background: #45475a; }
  #toolbar label { font-size: 12px; color: #a6adc8; }
  #toolbar .hint { font-size: 12px; color: #6c7086; margin-left: auto; }
  #toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #a6e3a1; color: #1e1e2e; padding: 8px 20px; border-radius: 8px;
    font-weight: 600; font-size: 14px; opacity: 0; transition: opacity 0.3s;
    z-index: 200; pointer-events: none;
  }
  #toast.show { opacity: 1; }
  #canvas {
    position: absolute; top: 44px; left: 0; right: 0; bottom: 0;
  }
  svg { width: 100%; height: 100%; }
  .region {
    cursor: move; stroke-dasharray: 6 4;
  }
  .region:hover { stroke-width: 2.5; }
  .region-label {
    font-size: 12px; font-weight: 600; fill: #a6adc8;
    pointer-events: none; user-select: none;
  }
  .node-group { cursor: move; }
  .node-rect {
    rx: 8; ry: 8; stroke-width: 1.5;
  }
  .node-group:hover .node-rect { stroke-width: 2.5; filter: brightness(1.1); }
  .node-label {
    font-size: 13px; font-weight: 500; fill: #1e1e2e;
    pointer-events: none; user-select: none; text-anchor: middle;
    dominant-baseline: central;
  }
  .edge-line { stroke-width: 2; fill: none; marker-end: url(#arrowhead); }
  .edge-label {
    font-size: 11px; fill: #a6adc8; text-anchor: middle;
    dominant-baseline: central; cursor: move; user-select: none;
  }
  .edge-label:hover { fill: #cdd6f4; }
  .edge-label.selected { fill: #f5c2e7; font-weight: 600; }
  .edge-hit {
    stroke: transparent; stroke-width: 12; fill: none; cursor: pointer;
  }
  .edge-rot-badge {
    font-size: 9px; fill: #585b70; pointer-events: none; user-select: none;
  }
  .resize-handle {
    fill: transparent; stroke: none; cursor: nwse-resize;
  }
  .resize-handle:hover { fill: rgba(137,180,250,0.3); }
  .coord-label {
    font-size: 10px; fill: #585b70; pointer-events: none; user-select: none;
  }
</style>
</head>
<body>
<div id="toolbar">
  <span class="title">TITLE_PLACEHOLDER</span>
  <div class="sep"></div>
  <button onclick="addNode()">+ Node</button>
  <button onclick="addEdgeMode()">+ Edge</button>
  <button onclick="addRegion()">+ Region</button>
  <div class="sep"></div>
  <button onclick="deleteSelected()">Delete</button>
  <button onclick="resetLayout()">Reset</button>
  <div class="sep"></div>
  <label>Export as:</label>
  <select id="coordSystem">
    <option value="fletcher">Fletcher (grid, y-down)</option>
    <option value="pixels">Raw pixels</option>
  </select>
  <button class="primary" onclick="copyLayout()">Copy Layout JSON</button>
  <span class="hint">Drag &middot; R rotate label &middot; Dbl-click rename &middot; Del delete</span>
</div>
<div id="toast">Copied to clipboard!</div>
<div id="canvas">
<svg id="svg">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#6c7086"/>
    </marker>
  </defs>
  <g id="regions-layer"></g>
  <g id="edges-layer"></g>
  <g id="nodes-layer"></g>
</svg>
</div>

<script>
const DATA = JSON_DATA_PLACEHOLDER;

// State
let nodes = [], edges = [], regions = [];
let selected = null;  // {type: 'node'|'region'|'edge', id: string|number}
let edgeMode = false;
let edgeFrom = null;
let nextNodeId = 1;
let nextRegionId = 1;

const NODE_W = 120, NODE_H = 40;
const svg = document.getElementById('svg');
const nodesLayer = document.getElementById('nodes-layer');
const edgesLayer = document.getElementById('edges-layer');
const regionsLayer = document.getElementById('regions-layer');

function init() {
  // Parse initial data
  (DATA.nodes || []).forEach(n => {
    nodes.push({
      id: n.id || `n${nextNodeId++}`,
      label: n.label || n.id,
      x: n.x || 0, y: n.y || 0,
      color: n.color || '#89b4fa',
      w: n.w || NODE_W, h: n.h || NODE_H
    });
  });
  (DATA.edges || []).forEach(e => {
    edges.push({
      from: e.from, to: e.to,
      label: e.label || '',
      color: e.color || '#6c7086',
      dashed: !!e.dashed,
      labelDx: e.labelDx || 0,
      labelDy: e.labelDy || -12,
      labelRot: e.labelRot || 0
    });
  });
  (DATA.regions || []).forEach(r => {
    regions.push({
      id: r.id || `r${nextRegionId++}`,
      label: r.label || '',
      x: r.x || 0, y: r.y || 0,
      w: r.w || 300, h: r.h || 200,
      color: r.color || '#45475a'
    });
  });
  // Set counters past existing IDs
  nodes.forEach(n => {
    const m = n.id.match(/^n(\d+)$/);
    if (m) nextNodeId = Math.max(nextNodeId, parseInt(m[1]) + 1);
  });
  regions.forEach(r => {
    const m = r.id.match(/^r(\d+)$/);
    if (m) nextRegionId = Math.max(nextRegionId, parseInt(m[1]) + 1);
  });
  render();
}

function render() {
  renderRegions();
  renderEdges();
  renderNodes();
}

function renderRegions() {
  regionsLayer.innerHTML = '';
  regions.forEach(r => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', r.x); rect.setAttribute('y', r.y);
    rect.setAttribute('width', r.w); rect.setAttribute('height', r.h);
    rect.setAttribute('fill', r.color + '15');
    rect.setAttribute('stroke', r.color);
    rect.setAttribute('stroke-width', selected?.type === 'region' && selected.id === r.id ? 2.5 : 1.5);
    rect.classList.add('region');
    g.appendChild(rect);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', r.x + 8); label.setAttribute('y', r.y + 16);
    label.classList.add('region-label');
    label.textContent = r.label;
    g.appendChild(label);

    // Resize handle (bottom-right corner)
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    handle.setAttribute('x', r.x + r.w - 14); handle.setAttribute('y', r.y + r.h - 14);
    handle.setAttribute('width', 14); handle.setAttribute('height', 14);
    handle.classList.add('resize-handle');
    g.appendChild(handle);

    // Drag region
    makeDraggable(rect, r, 'region');
    // Resize
    makeResizable(handle, r);

    rect.addEventListener('click', (e) => {
      e.stopPropagation();
      selected = { type: 'region', id: r.id };
      render();
    });

    regionsLayer.appendChild(g);
  });
}

function renderNodes() {
  nodesLayer.innerHTML = '';
  nodes.forEach(n => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('node-group');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', n.x); rect.setAttribute('y', n.y);
    rect.setAttribute('width', n.w); rect.setAttribute('height', n.h);
    rect.setAttribute('fill', n.color);
    rect.setAttribute('stroke', selected?.type === 'node' && selected.id === n.id ? '#f5c2e7' : n.color);
    rect.setAttribute('stroke-width', selected?.type === 'node' && selected.id === n.id ? 3 : 1.5);
    rect.classList.add('node-rect');
    g.appendChild(rect);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', n.x + n.w / 2); label.setAttribute('y', n.y + n.h / 2);
    label.classList.add('node-label');
    label.textContent = n.label;
    g.appendChild(label);

    // Coordinate display when selected (shows target coord system)
    if (selected?.type === 'node' && selected.id === n.id) {
      const coord = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      coord.setAttribute('x', n.x); coord.setAttribute('y', n.y - 6);
      coord.classList.add('coord-label');
      coord.textContent = displayCoord(n.x + n.w / 2, n.y + n.h / 2);
      g.appendChild(coord);
    }

    makeDraggable(g, n, 'node');

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (edgeMode) {
        if (!edgeFrom) {
          edgeFrom = n.id;
          selected = { type: 'node', id: n.id };
          render();
        } else if (edgeFrom !== n.id) {
          edges.push({ from: edgeFrom, to: n.id, label: '', color: '#6c7086', dashed: false, labelDx: 0, labelDy: -12, labelRot: 0 });
          edgeMode = false;
          edgeFrom = null;
          selected = null;
          render();
        }
      } else {
        selected = { type: 'node', id: n.id };
        render();
      }
    });

    nodesLayer.appendChild(g);
  });
}

function renderEdges() {
  edgesLayer.innerHTML = '';
  edges.forEach((e, idx) => {
    const fromNode = nodes.find(n => n.id === e.from);
    const toNode = nodes.find(n => n.id === e.to);
    if (!fromNode || !toNode) return;

    const [x1, y1, x2, y2] = edgeEndpoints(fromNode, toNode);
    const isSelected = selected?.type === 'edge' && selected.id === idx;

    // Visible edge line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', isSelected ? '#f5c2e7' : e.color);
    if (e.dashed) line.setAttribute('stroke-dasharray', '6 3');
    line.classList.add('edge-line');
    edgesLayer.appendChild(line);

    // Invisible wide hit area for clicking
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
    hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
    hit.classList.add('edge-hit');
    hit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selected = { type: 'edge', id: idx };
      render();
    });
    edgesLayer.appendChild(hit);

    // Edge label (always rendered — even empty, so user can double-click to add)
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const lx = mx + e.labelDx, ly = my + e.labelDy;

    if (e.label) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${lx},${ly}) rotate(${e.labelRot})`);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', 0); label.setAttribute('y', 0);
      label.classList.add('edge-label');
      if (isSelected) label.classList.add('selected');
      label.textContent = e.label;
      g.appendChild(label);

      // Rotation badge when selected
      if (isSelected && e.labelRot !== 0) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', 0); badge.setAttribute('y', 14);
        badge.setAttribute('text-anchor', 'middle');
        badge.classList.add('edge-rot-badge');
        badge.textContent = `${e.labelRot}\u00b0`;
        g.appendChild(badge);
      }

      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selected = { type: 'edge', id: idx };
        render();
      });

      // Make label draggable (offsets from midpoint)
      makeEdgeLabelDraggable(g, e, mx, my);

      edgesLayer.appendChild(g);
    }
  });
}

function makeEdgeLabelDraggable(el, edge, midX, midY) {
  let dragging = false, startX, startY, origDx, origDy;

  el.addEventListener('mousedown', (ev) => {
    dragging = true;
    const pt = svgPoint(ev);
    startX = pt.x; startY = pt.y;
    origDx = edge.labelDx; origDy = edge.labelDy;
    ev.preventDefault();
    ev.stopPropagation();
  });

  window.addEventListener('mousemove', (ev) => {
    if (!dragging) return;
    const pt = svgPoint(ev);
    edge.labelDx = Math.round(origDx + pt.x - startX);
    edge.labelDy = Math.round(origDy + pt.y - startY);
    render();
  });

  window.addEventListener('mouseup', () => { dragging = false; });
}

function edgeEndpoints(from, to) {
  // Center-to-center, clipped to rect borders
  const cx1 = from.x + from.w / 2, cy1 = from.y + from.h / 2;
  const cx2 = to.x + to.w / 2, cy2 = to.y + to.h / 2;
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;

  // Clip from source border
  const t1x = from.w / 2 / Math.abs(ux || 0.001);
  const t1y = from.h / 2 / Math.abs(uy || 0.001);
  const t1 = Math.min(t1x, t1y);

  // Clip at target border (with arrowhead margin)
  const t2x = to.w / 2 / Math.abs(ux || 0.001);
  const t2y = to.h / 2 / Math.abs(uy || 0.001);
  const t2 = Math.min(t2x, t2y) + 2;

  return [cx1 + ux * t1, cy1 + uy * t1, cx2 - ux * t2, cy2 - uy * t2];
}

function makeDraggable(el, obj, type) {
  let dragging = false, startX, startY, origX, origY;

  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    dragging = true;
    const pt = svgPoint(e);
    startX = pt.x; startY = pt.y;
    origX = obj.x; origY = obj.y;
    selected = { type, id: obj.id };
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const pt = svgPoint(e);
    obj.x = Math.round(origX + pt.x - startX);
    obj.y = Math.round(origY + pt.y - startY);
    render();
  });

  window.addEventListener('mouseup', () => { dragging = false; });
}

function makeResizable(handle, region) {
  let resizing = false, startX, startY, origW, origH;

  handle.addEventListener('mousedown', (e) => {
    resizing = true;
    const pt = svgPoint(e);
    startX = pt.x; startY = pt.y;
    origW = region.w; origH = region.h;
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const pt = svgPoint(e);
    region.w = Math.max(60, Math.round(origW + pt.x - startX));
    region.h = Math.max(40, Math.round(origH + pt.y - startY));
    render();
  });

  window.addEventListener('mouseup', () => { resizing = false; });
}

function svgPoint(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// Toolbar actions
function addNode() {
  const id = `n${nextNodeId++}`;
  nodes.push({
    id, label: `Node ${nodes.length + 1}`,
    x: 100 + Math.random() * 200, y: 100 + Math.random() * 200,
    color: '#89b4fa', w: NODE_W, h: NODE_H
  });
  selected = { type: 'node', id };
  edgeMode = false;
  render();
}

function addEdgeMode() {
  edgeMode = true;
  edgeFrom = null;
  // If a node is already selected, use it as the source
  if (selected?.type === 'node') {
    edgeFrom = selected.id;
  }
}

function addRegion() {
  const id = `r${nextRegionId++}`;
  regions.push({
    id, label: `Region ${regions.length + 1}`,
    x: 50 + Math.random() * 100, y: 60 + Math.random() * 100,
    w: 300, h: 200, color: '#45475a'
  });
  selected = { type: 'region', id };
  render();
}

function deleteSelected() {
  if (!selected) return;
  if (selected.type === 'node') {
    nodes = nodes.filter(n => n.id !== selected.id);
    edges = edges.filter(e => e.from !== selected.id && e.to !== selected.id);
  } else if (selected.type === 'region') {
    regions = regions.filter(r => r.id !== selected.id);
  } else if (selected.type === 'edge') {
    edges.splice(selected.id, 1);
  }
  selected = null;
  render();
}

function resetLayout() {
  nodes = []; edges = []; regions = [];
  selected = null; edgeMode = false; edgeFrom = null;
  nextNodeId = 1; nextRegionId = 1;
  init();
}

// --- Coordinate transform ---

function getBBox() {
  // Bounding box of all elements (node centers + region corners)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  });
  regions.forEach(r => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  });
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 600; }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function r1(v) { return Math.round(v * 2) / 2; }  // round to 0.5

const FLETCHER_SCALE = 75; // px per grid unit — adjacent nodes ~2-3 units apart

function transformPoint(px, py, sys) {
  const bb = getBBox();
  if (sys === 'pixels') return { x: Math.round(px), y: Math.round(py) };
  // Fletcher: grid units, y-down, origin at top-left of bounding box
  return { x: r1((px - bb.minX) / FLETCHER_SCALE), y: r1((py - bb.minY) / FLETCHER_SCALE) };
}

function transformSize(pw, ph, sys) {
  if (sys === 'pixels') return { w: Math.round(pw), h: Math.round(ph) };
  return { w: r1(pw / FLETCHER_SCALE), h: r1(ph / FLETCHER_SCALE) };
}

function transformLabelOffset(dx, dy, sys) {
  if (sys === 'pixels') return { dx, dy };
  return { dx: r1(dx / FLETCHER_SCALE), dy: r1(dy / FLETCHER_SCALE) };
}

function getCoordSystem() {
  return document.getElementById('coordSystem').value;
}

// For showing coords on selected nodes
function displayCoord(px, py) {
  const sys = getCoordSystem();
  const p = transformPoint(px, py, sys);
  if (sys === 'pixels') return `(${p.x}, ${p.y})`;
  return `(${p.x}, ${p.y})`;
}

function copyLayout() {
  const sys = getCoordSystem();
  const layout = {
    coordinateSystem: sys,
  };

  if (sys === 'fletcher') {
    layout.note = 'y-down (screen convention). Use with spacing: (2.5em, 2em) or similar.';
  }

  layout.nodes = nodes.map(n => {
    const p = transformPoint(n.x + n.w / 2, n.y + n.h / 2, sys); // center point
    return { id: n.id, label: n.label, x: p.x, y: p.y, color: n.color };
  });

  layout.edges = edges.map(e => {
    const obj = { from: e.from, to: e.to };
    if (e.label) obj.label = e.label;
    if (e.dashed) obj.dashed = true;
    const ld = transformLabelOffset(e.labelDx, e.labelDy, sys);
    const defaultDy = sys === 'pixels' ? -12 : transformLabelOffset(0, -12, sys).dy;
    if (ld.dx !== 0) obj.labelDx = ld.dx;
    if (ld.dy !== defaultDy) obj.labelDy = ld.dy;
    if (e.labelRot !== 0) obj.labelRot = e.labelRot;
    return obj;
  });

  layout.regions = regions.map(r => {
    const p = transformPoint(r.x, r.y, sys);
    const sz = transformSize(r.w, r.h, sys);
    return { id: r.id, label: r.label, x: p.x, y: p.y, w: sz.w, h: sz.h };
  });

  const json = JSON.stringify(layout, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const toast = document.getElementById('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1500);
  });
}

// Re-render when coord system changes (to update coord labels)
document.getElementById('coordSystem').addEventListener('change', render);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement === document.body) deleteSelected();
  }
  if (e.key === 'Escape') {
    selected = null; edgeMode = false; edgeFrom = null;
    render();
  }
  // R to rotate selected edge label by 15 degrees (Shift+R for -15)
  if ((e.key === 'r' || e.key === 'R') && selected?.type === 'edge' && document.activeElement === document.body) {
    const edge = edges[selected.id];
    if (edge) {
      const step = e.shiftKey ? -15 : 15;
      edge.labelRot = ((edge.labelRot + step) % 360 + 360) % 360;
      // Snap to 0 when close
      if (edge.labelRot > 345) edge.labelRot = 0;
      render();
    }
  }
});

// Click on empty space deselects
svg.addEventListener('click', () => {
  if (!edgeMode) { selected = null; render(); }
});

// Double-click to rename
svg.addEventListener('dblclick', (e) => {
  if (selected?.type === 'node') {
    const node = nodes.find(n => n.id === selected.id);
    if (node) {
      const name = prompt('Node label:', node.label);
      if (name !== null) { node.label = name; render(); }
    }
  } else if (selected?.type === 'region') {
    const region = regions.find(r => r.id === selected.id);
    if (region) {
      const name = prompt('Region label:', region.label);
      if (name !== null) { region.label = name; render(); }
    }
  } else if (selected?.type === 'edge') {
    const edge = edges[selected.id];
    if (edge) {
      const name = prompt('Edge label:', edge.label);
      if (name !== null) { edge.label = name; render(); }
    }
  }
});

init();
</script>
</body>
</html>"""


def generate_html(data: dict) -> str:
    title = data.get("title", "Diagram Mockup")
    json_str = json.dumps(data)
    html = HTML_TEMPLATE.replace("JSON_DATA_PLACEHOLDER", json_str)
    html = html.replace("TITLE_PLACEHOLDER", title)
    return html


def main():
    parser = argparse.ArgumentParser(description="Generate interactive diagram mockup")
    parser.add_argument("input", help="JSON file path, or - for stdin")
    parser.add_argument("--output", "-o", default="/tmp/mockup.html", help="Output HTML path")
    parser.add_argument("--open", action="store_true", help="Open in browser after generating")
    args = parser.parse_args()

    if args.input == "-":
        data = json.load(sys.stdin)
    else:
        with open(args.input) as f:
            data = json.load(f)

    html = generate_html(data)
    Path(args.output).write_text(html)
    print(f"Wrote {args.output}")

    if args.open:
        subprocess.run(["open", args.output])


if __name__ == "__main__":
    main()
