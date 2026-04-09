import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const FONT = 'Outfit, sans-serif';
const APP_KEYS = ['OneNote', 'OneDrive', 'ToDo'];

export default function MindMap({
  notebooks, sectionsMap, todoListsMap,
  onSelectSection, onExpandNotebook,
  externalZoom, onZoomChange
}) {
  const svgRef = useRef();
  const zoomRef = useRef();
  const simRef = useRef();
  const gRef = useRef();
  const stateRef = useRef({ nodes: [], links: [], activeSection: null });
  const activeSectionRef = useRef(null);
  const savedTransformRef = useRef(null);

  // Carica sezioni all'avvio
  useEffect(() => {
    if (!notebooks.length) return;
    notebooks.forEach(nb => onExpandNotebook(nb));
  }, [notebooks]);

  // Costruisce il grafo la prima volta che tutte le sezioni sono caricate
  useEffect(() => {
    if (!notebooks.length) return;
    const allLoaded = notebooks.every(nb => sectionsMap[nb.id]);
    if (!allLoaded) return;
    buildGraph();
  }, [notebooks, sectionsMap]);

  // Zoom esterno
  useEffect(() => {
    if (!zoomRef.current || !svgRef.current) return;
    d3.select(svgRef.current).transition().duration(220)
      .call(zoomRef.current.scaleTo, externalZoom);
  }, [externalZoom]);

  useEffect(() => {
    const onResize = () => {
      const allLoaded = notebooks.length && notebooks.every(nb => sectionsMap[nb.id]);
      if (allLoaded) buildGraph();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [notebooks, sectionsMap]);

  function buildGraph() {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const W = container.offsetWidth;
    const H = container.offsetHeight;
    const cx = W / 2, cy = H / 2;

    if (simRef.current) simRef.current.stop();

    const svg = d3.select(svgRef.current).attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g;

    // Zoom & Pan
    const zoom = d3.zoom()
      .scaleExtent([0.1, 5])
      .wheelDelta(e => -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.004))
      .on('zoom', e => {
      g.attr('transform', e.transform);
      onZoomChange(Math.round(e.transform.k * 100) / 100);
    });
    zoomRef.current = zoom;
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', () => toggleAppNodes(null));

    // Layer ordinati
    g.append('g').attr('class', 'hulls');
    g.append('g').attr('class', 'links');
    g.append('g').attr('class', 'nodes');

    // Nodi base: taccuini + sezioni
    const nodes = [];
    const links = [];
    const nbSpread = Math.min(W, H) * 0.10;

    notebooks.forEach((nb, i) => {
      const angle = (i / notebooks.length) * 2 * Math.PI - Math.PI / 2;
      nodes.push({
        id: 'nb_' + nb.id,
        type: 'notebook',
        label: nb.displayName,
        color: nb._color,
        nb,
        r: 46,
        shape: 'circle',
        fx: cx + nbSpread * Math.cos(angle),
        fy: cy + nbSpread * Math.sin(angle),
      });

      (sectionsMap[nb.id] || []).forEach((s, si) => {
        const nbAngle = (i / notebooks.length) * 2 * Math.PI - Math.PI / 2;
        const secStartR = Math.min(W, H) * 0.30;
        const secTotal = (sectionsMap[nb.id] || []).length;
        const secAngle = nbAngle + (si - secTotal / 2) * 0.3;
        const secLbl = s.displayName;
        const secSpaceIdx = secLbl.lastIndexOf(' ', 8);
        const secHas2Lines = secLbl.length > 8;
        const secRh = secHas2Lines ? 30 : 20;
        nodes.push({
          id: 'sec_' + s.id,
          type: 'section',
          label: secLbl,
          color: nb._color,
          section: s,
          nb,
          shape: 'rect',
          rw: 52, rh: secRh,
          x: cx + secStartR * Math.cos(secAngle),
          y: cy + secStartR * Math.sin(secAngle),
        });
        links.push({ source: 'nb_' + nb.id, target: 'sec_' + s.id, type: 'nb-sec' });
      });
    });

    stateRef.current = { nodes, links, activeSection: null };

    // Simulazione
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(100).strength(0.6))
      .force('charge', d3.forceManyBody().strength(d => d.type === 'notebook' ? -900 : -220))
      .force('collision', d3.forceCollide(d => d.type === 'notebook' ? d.r + 30 : d.type === 'app' ? d.r + 1 : (d.shape === 'rect' ? Math.max(d.rw / 2, d.rh / 2) + 10 : d.r + 10)))
      .alphaDecay(0.022);
    simRef.current = sim;

    sim.on('tick', () => tick());
    renderAll();

    // Zoom iniziale 140% — applicato subito
    const initScale = 1.4;
    const initTx = (W - W * initScale) / 2;
    const initTy = (H - H * initScale) / 2;
    d3.select(svgRef.current)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(initTx, initTy).scale(initScale));
    onZoomChange(initScale);
  }

  // Aggiunge o rimuove nodi app senza ricostruire tutto
  function toggleAppNodes(sectionId) {
    const todoListsMapRef = todoListsMap;
    const st = stateRef.current;
    const prevActive = activeSectionRef.current;
    if (prevActive === sectionId) return;
    activeSectionRef.current = sectionId;

    // Ripristina vista e rimuovi riferimenti
    st.activeSecNode = null;
    st.activeSecId = null;
    st.needsFocus = false;
    savedTransformRef.current = null;
    // Marca sezioni come attive/non attive
    st.nodes.forEach(n => { if (n.type === 'section') n.active = false; });

    if (sectionId) {
      const secNode = st.nodes.find(n => n.id === 'sec_' + sectionId);
      if (secNode) {
        secNode.active = true;
        // Salva transform e segna per focus
        savedTransformRef.current = d3.zoomTransform(svgRef.current);
        st.activeSecNode = secNode;
        st.activeSecId = sectionId;
        st.todoListsMap = todoListsMapRef;
        st.needsFocus = true;
      }
    }

    // Aggiorna simulazione (solo nodi esistenti, no app nodes)
    const sim = simRef.current;
    sim.nodes(st.nodes);
    sim.force('link').links(st.links);
    sim.alpha(0.08).restart();
    renderAll();
  }



  function renderAll() {
    const st = stateRef.current;
    const g = gRef.current;
    if (!g) return;

    // ── Links ──
    const linkSel = g.select('.links').selectAll('line')
      .data(st.links, d => {
        const s = typeof d.source === 'object' ? d.source.id : d.source;
        const t = typeof d.target === 'object' ? d.target.id : d.target;
        return s + '-' + t;
      });

    linkSel.enter().append('line')
      .attr('stroke', d => {
        const tid = typeof d.target === 'object' ? d.target.id : d.target;
        const tn = st.nodes.find(n => n.id === tid);
        return tn?.color || '#888';
      })
      .attr('stroke-width', d => d.type === 'sec-app' ? 0.8 : 1.2)
      .attr('stroke-dasharray', d => d.type === 'sec-app' ? '3 4' : '4 6')
      .attr('stroke-opacity', d => d.type === 'sec-app' ? 0.45 : 0.3)
      .style('opacity', 0)
      .transition().duration(300).style('opacity', 1);

    linkSel.exit().transition().duration(200).style('opacity', 0).remove();

    // ── Nodes ──
    const nodeSel = g.select('.nodes').selectAll('g.node')
      .data(st.nodes, d => d.id);

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node')
      .style('cursor', d => {
        if (d.type === 'notebook') return 'default';
        if (d.type === 'app' && !d.enabled) return 'not-allowed';
        return 'pointer';
      })
      .style('opacity', 0);

    // Alone
    nodeEnter.append('circle').attr('class', 'halo')
      .attr('fill', d => d.color + '07')
      .attr('stroke', 'none');

    // Forma principale (cerchio o rettangolo)
    nodeEnter.each(function(d) {
      const el = d3.select(this);
      if (d.shape === 'rect') {
        el.append('rect').attr('class', 'main-shape')
          .attr('rx', 8).attr('ry', 8)
          .attr('fill', '#0c0e14');
      } else {
        el.append('circle').attr('class', 'main-shape')
          .attr('fill', d => (d.type === 'app' && !d.enabled) ? '#111418' : '#0c0e14');
      }
    });

    // Anello (notebook e sezioni attive)
    nodeEnter.filter(d => d.type === 'notebook')
      .append('circle').attr('class', 'ring')
      .attr('fill', 'none')
      .attr('stroke-width', 1);

    // Testo
    nodeEnter.each(function(d) {
      const el = d3.select(this);
      const opacity = (d.type === 'app' && !d.enabled) ? 0.4 : 1;
      const words = d.label.split(' ');

      if (d.shape === 'rect') {
        const MAX_CHARS = 8;
        const lbl = d.label;
        let line1 = '', line2 = '';
        if (lbl.length <= MAX_CHARS) {
          line1 = lbl;
        } else {
          // Prova a spezzare su spazio
          const spaceIdx = lbl.lastIndexOf(' ', MAX_CHARS);
          if (spaceIdx > 2) {
            line1 = lbl.slice(0, spaceIdx);
            line2 = lbl.slice(spaceIdx + 1, spaceIdx + 1 + MAX_CHARS);
            if (lbl.slice(spaceIdx + 1).length > MAX_CHARS) line2 = line2.slice(0, MAX_CHARS - 1) + '-';
          } else {
            line1 = lbl.slice(0, MAX_CHARS - 1) + '-';
            line2 = lbl.slice(MAX_CHARS - 1, MAX_CHARS * 2 - 2);
            if (lbl.length > MAX_CHARS * 2 - 2) line2 = line2.slice(0, MAX_CHARS - 1) + '-';
          }
        }
        if (line2) {
          el.append('text').attr('y', -6)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', 9).attr('font-weight', 400)
            .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
            .text(line1);
          el.append('text').attr('y', 6)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', 9).attr('font-weight', 400)
            .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
            .text(line2);
        } else {
          el.append('text')
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', 9).attr('font-weight', 400)
            .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
            .text(line1);
        }
      } else if (d.type === 'notebook') {
        if (words.length > 1 && d.label.length > 10) {
          const mid = Math.ceil(words.length / 2);
          [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].forEach((line, i) => {
            el.append('text')
              .attr('y', i === 0 ? -7 : 8)
              .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
              .attr('font-family', FONT).attr('font-size', 12).attr('font-weight', 500)
              .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
              .text(line);
          });
        } else {
          el.append('text')
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', 12).attr('font-weight', 500)
            .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
            .text(d.label);
        }
      } else {
        // App nodes — icona + testo piccolo sotto
        // Icone Microsoft-style con lettere stilizzate
        const iconDefs = {
          'OneNote': { letter: 'N', size: 13, weight: 700 },
          'OneDrive': { letter: '☁', size: 12, weight: 400 },
          'ToDo': { letter: '✓', size: 13, weight: 700 },
        };
        const iconDef = iconDefs[d.key] || { letter: '?', size: 12, weight: 400 };
        el.append('text')
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-family', FONT)
          .attr('font-size', iconDef.size - 1)
          .attr('font-weight', iconDef.weight)
          .attr('fill', d.color).attr('opacity', opacity)
          .attr('pointer-events', 'none')
          .text(iconDef.letter);

      }
    });

    // Drag (solo non-notebook)
    nodeEnter.filter(d => d.type !== 'notebook')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simRef.current.alphaTarget(0.15).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simRef.current.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Click
    nodeEnter.on('click', (e, d) => {
      e.stopPropagation();
      if (d.type === 'section') {
        const isActive = activeSectionRef.current === d.section.id;
        toggleAppNodes(isActive ? null : d.section.id);
        if (!isActive) onSelectSection(d.section, d.nb, 'onenote');
      }
      if (d.type === 'app' && d.enabled) {
        onSelectSection(d.section, d.nb, d.key);
      }
    });

    // Fade in nuovi nodi
    nodeEnter.transition().duration(300).style('opacity', 1);

    // Rimuovi nodi uscenti
    nodeSel.exit().transition().duration(200).style('opacity', 0).remove();

    // Merge per aggiornare dimensioni forme
    const merged = nodeEnter.merge(nodeSel);
    updateShapes(merged);
  }

  function updateShapes(sel) {
    sel.each(function(d) {
      const el = d3.select(this);

      // Halo
      const haloR = d.shape === 'rect'
        ? Math.max(d.rw / 2, d.rh / 2) + 6
        : d.r + (d.type === 'notebook' ? 18 : 10);
      el.select('.halo').attr('r', haloR);

      // Forma principale
      if (d.shape === 'rect') {
        const w = 52;
        const h = d.label.length > 8 ? 30 : 20;
        d.rw = w; d.rh = h;
        el.select('.main-shape')
          .attr('x', -w / 2).attr('y', -h / 2)
          .attr('width', w).attr('height', h)
          .attr('stroke', d.active ? d.color : d.color + '88')
          .attr('stroke-width', d.active ? 1.8 : 1);
      } else {
        el.select('.main-shape')
          .attr('r', d.r || 18)
          .attr('stroke', d.color + (d.type === 'app' && !d.enabled ? '33' : ''))
          .attr('stroke-width', d.type === 'notebook' ? 2 : 1.2);
      }

      // Anello notebook
      if (d.type === 'notebook') {
        el.select('.ring')
          .attr('r', d.r + 7)
          .attr('stroke', d.color + '25');
      }
    });
  }

  function tick() {
    const g = gRef.current;
    if (!g) return;
    const st = stateRef.current;

    // Aggiorna link
    g.select('.links').selectAll('line')
      .attr('x1', d => (typeof d.source === 'object' ? d.source : st.nodes.find(n => n.id === d.source))?.x || 0)
      .attr('y1', d => (typeof d.source === 'object' ? d.source : st.nodes.find(n => n.id === d.source))?.y || 0)
      .attr('x2', d => (typeof d.target === 'object' ? d.target : st.nodes.find(n => n.id === d.target))?.x || 0)
      .attr('y2', d => (typeof d.target === 'object' ? d.target : st.nodes.find(n => n.id === d.target))?.y || 0);

    // Aggiorna nodi
    g.select('.nodes').selectAll('g.node')
      .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

    // Hull
    drawHulls();
    // Nodi app geometrici
    drawAppNodes();
  }

  function drawAppNodes() {
    const g = gRef.current;
    if (!g) return;
    const st = stateRef.current;
    const sec = st.activeSecNode;

    // Rimuovi layer precedente
    g.select('.app-nodes').remove();

    if (!sec || !sec.x) return;

    const container = svgRef.current?.parentElement;
    const W = container?.offsetWidth || 800;
    const H = container?.offsetHeight || 600;
    const cxL = W/2, cyL = H/2;
    const baseAngle = Math.atan2(sec.y - cyL, sec.x - cxL);
    const appR = 60;
    const spread = 0.35;

    const appLayer = g.append('g').attr('class', 'app-nodes');

    APP_KEYS.forEach((key, i) => {
      const angle = baseAngle + (i - 1) * spread;
      const ax = sec.x + appR * Math.cos(angle);
      const ay = sec.y + appR * Math.sin(angle);
      const color = sec.color;
      const enabled = key === 'OneNote' || (key === 'ToDo' && !!(st.todoListsMap && st.todoListsMap[sec.section.displayName.toLowerCase()]));
      const opacity = enabled ? 1 : 0.35;

      // Linea
      appLayer.append('line')
        .attr('x1', sec.x).attr('y1', sec.y)
        .attr('x2', ax).attr('y2', ay)
        .attr('stroke', color).attr('stroke-width', 0.8)
        .attr('stroke-dasharray', '3 4').attr('stroke-opacity', 0.4);

      // Alone
      appLayer.append('circle')
        .attr('cx', ax).attr('cy', ay).attr('r', 16)
        .attr('fill', color + '07').attr('stroke', 'none');

      // Cerchio
      appLayer.append('circle')
        .attr('cx', ax).attr('cy', ay).attr('r', 10)
        .attr('fill', '#0c0e14')
        .attr('stroke', enabled ? color : color + '33')
        .attr('stroke-width', 1.2)
        .attr('opacity', opacity);

      // Icona
      const icons = { OneNote: {l:'N',s:13,w:700}, OneDrive: {l:'☁',s:11,w:400}, ToDo: {l:'✓',s:13,w:700} };
      const ic = icons[key];
      appLayer.append('text')
        .attr('x', ax).attr('y', ay)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-family', 'Outfit,sans-serif')
        .attr('font-size', ic.s - 1).attr('font-weight', ic.w)
        .attr('fill', color).attr('opacity', opacity)
        .attr('pointer-events', 'none')
        .text(ic.l);

      // Click area
      if (enabled) {
        appLayer.append('circle')
          .attr('cx', ax).attr('cy', ay).attr('r', 14)
          .attr('fill', 'transparent').attr('cursor', 'pointer')
          .on('click', (e) => {
            e.stopPropagation();
            onSelectSection(sec.section, sec.nb, key);
          });
      }
    });

    // Zoom-focus immediato (posizioni già stabili)
    if (st.needsFocus) {
      st.needsFocus = false;
      const xs = APP_KEYS.map((_, i) => sec.x + appR * Math.cos(baseAngle + (i-1)*spread));
      const ys = APP_KEYS.map((_, i) => sec.y + appR * Math.sin(baseAngle + (i-1)*spread));
      xs.push(sec.x); ys.push(sec.y);
      const pad = 70;
      const minX = Math.min(...xs)-pad, maxX = Math.max(...xs)+pad;
      const minY = Math.min(...ys)-pad, maxY = Math.max(...ys)+pad;
      const scale = Math.min(W/(maxX-minX), H/(maxY-minY), 3.5);
      const tx = (W-(maxX-minX)*scale)/2 - minX*scale;
      const ty = (H-(maxY-minY)*scale)/2 - minY*scale;
      // zoom-focus rimosso
    }
  }

  function drawHulls() {
    const g = gRef.current;
    if (!g) return;
    const st = stateRef.current;

    const hullData = notebooks.flatMap(nb => {
      const nbNode = st.nodes.find(n => n.id === 'nb_' + nb.id);
      const secNodes = st.nodes.filter(n => n.type === 'section' && n.nb.id === nb.id);
      if (!secNodes.length || !nbNode) return [];
      const pts = [];
      const addPts = (node, pad) => {
        const sz = node.shape === 'rect' ? Math.max(node.rw / 2, node.rh / 2) : (node.r || 18);
        for (let a = 0; a < 2 * Math.PI; a += Math.PI / 10)
          pts.push([(node.x || 0) + (sz + pad) * Math.cos(a), (node.y || 0) + (sz + pad) * Math.sin(a)]);
      };
      addPts(nbNode, 24);
      secNodes.forEach(n => addPts(n, 16));
      st.nodes.filter(n => n.type === 'app' && n.nb.id === nb.id)
        .forEach(n => addPts(n, 10));
      try {
        const hull = d3.polygonHull(pts);
        return hull ? [{ nb, hull }] : [];
      } catch { return []; }
    });

    const sel = g.select('.hulls').selectAll('.hull').data(hullData, d => d.nb.id);
    sel.enter().append('path').attr('class', 'hull')
      .merge(sel)
      .attr('fill', d => d.nb._color + '09')
      .attr('stroke', d => d.nb._color + '1a')
      .attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round')
      .attr('d', d => `M${d.hull.join('L')}Z`);
    sel.exit().remove();
  }

  return <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />;
}
