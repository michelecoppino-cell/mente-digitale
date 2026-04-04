import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const FONT = 'Outfit, sans-serif';

export default function MindMap({
  notebooks, sectionsMap,
  onSelectNotebook, onSelectSection, onExpandNotebook,
  externalZoom, onZoomChange
}) {
  const svgRef = useRef();
  const zoomRef = useRef();
  const posRef = useRef({});

  // Zoom esterno dai pulsanti header
  useEffect(() => {
    if (!zoomRef.current || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(220).call(zoomRef.current.scaleTo, externalZoom);
  }, [externalZoom]);

  // Ricostruisce il grafo quando cambiano notebooks o sezioni
  useEffect(() => {
    if (!notebooks.length) return;
    buildGraph();
  }, [notebooks, sectionsMap]);

  // Ridimensionamento finestra
  useEffect(() => {
    const onResize = () => { if (notebooks.length) buildGraph(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [notebooks, sectionsMap]);

  function buildGraph() {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const W = container.offsetWidth;
    const H = container.offsetHeight;

    const svg = d3.select(svgRef.current).attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    // ── Zoom & Pan ──
    const zoom = d3.zoom()
      .scaleExtent([0.1, 5])
      .on('zoom', e => {
        g.attr('transform', e.transform);
        onZoomChange(Math.round(e.transform.k * 100) / 100);
      });
    zoomRef.current = zoom;
    svg.call(zoom).on('dblclick.zoom', null);

    // ── Costruzione nodi e link ──
    const nodes = [];
    const links = [];

    notebooks.forEach((nb, i) => {
      const angle = (i / notebooks.length) * 2 * Math.PI - Math.PI / 2;
      const spread = Math.min(W, H) * 0.28;
      const saved = posRef.current['nb_' + nb.id];

      nodes.push({
        id: 'nb_' + nb.id,
        type: 'notebook',
        label: nb.displayName,
        color: nb._color,
        nb,
        r: 38,
        x: saved?.x ?? W / 2 + spread * Math.cos(angle),
        y: saved?.y ?? H / 2 + spread * Math.sin(angle),
      });

      (sectionsMap[nb.id] || []).forEach(s => {
        const savedS = posRef.current['sec_' + s.id];
        nodes.push({
          id: 'sec_' + s.id,
          type: 'section',
          label: s.displayName,
          color: nb._color,
          section: s,
          nb,
          r: 20,
          x: savedS?.x,
          y: savedS?.y,
        });
        links.push({ source: 'nb_' + nb.id, target: 'sec_' + s.id });
      });
    });

    // ── Simulazione forze ──
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(85).strength(0.7))
      .force('charge', d3.forceManyBody().strength(d => d.type === 'notebook' ? -600 : -180))
      .force('collision', d3.forceCollide(d => d.r + 16))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.04));

    // ── Hull (nuvola) ──
    const hullG = g.append('g');

    function drawHulls() {
      const hullData = notebooks.flatMap(nb => {
        const nbNode = nodes.find(n => n.id === 'nb_' + nb.id);
        const secNodes = nodes.filter(n => n.type === 'section' && n.nb.id === nb.id);
        if (!secNodes.length || !nbNode) return [];
        const pts = [];
        const pad = (node, r) => {
          for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8)
            pts.push([node.x + (r + 22) * Math.cos(a), node.y + (r + 22) * Math.sin(a)]);
        };
        pad(nbNode, nbNode.r);
        secNodes.forEach(n => pad(n, n.r));
        try {
          const hull = d3.polygonHull(pts);
          return hull ? [{ nb, hull }] : [];
        } catch { return []; }
      });

      const sel = hullG.selectAll('.hull').data(hullData, d => d.nb.id);
      sel.enter().append('path').attr('class', 'hull')
        .merge(sel)
        .attr('fill', d => d.nb._color + '09')
        .attr('stroke', d => d.nb._color + '22')
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('d', d => `M${d.hull.join('L')}Z`);
      sel.exit().remove();
    }

    // ── Link ──
    const linkSel = g.append('g').selectAll('line')
      .data(links).join('line')
      .attr('stroke', d => {
        const t = nodes.find(n => n.id === (typeof d.target === 'object' ? d.target.id : d.target));
        return t?.color || '#ffffff';
      })
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 5')
      .attr('stroke-opacity', 0.28);

    // ── Nodi ──
    const nodeSel = g.append('g').selectAll('g.node')
      .data(nodes).join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(
        d3.drag()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Alone esterno
    nodeSel.append('circle')
      .attr('r', d => d.r + 15)
      .attr('fill', d => d.color + '07')
      .attr('stroke', 'none');

    // Anello (solo notebook)
    nodeSel.filter(d => d.type === 'notebook')
      .append('circle')
      .attr('r', d => d.r + 6)
      .attr('fill', 'none')
      .attr('stroke', d => d.color + '28')
      .attr('stroke-width', 1);

    // Cerchio principale
    nodeSel.append('circle')
      .attr('r', d => d.r)
      .attr('fill', '#0c0e14')
      .attr('stroke', d => d.color)
      .attr('stroke-width', d => d.type === 'notebook' ? 1.8 : 1);

    // Testo
    nodeSel.each(function (d) {
      const el = d3.select(this);
      const words = d.label.split(' ');
      const maxLen = d.type === 'notebook' ? 13 : 11;
      if (d.type === 'notebook' && words.length > 1 && d.label.length > 10) {
        const mid = Math.ceil(words.length / 2);
        [words.slice(0, mid).join(' '), words.slice(mid).join(' ')].forEach((line, i) => {
          el.append('text')
            .attr('y', i === 0 ? -7 : 8)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', 11).attr('font-weight', 500)
            .attr('fill', d.color).attr('pointer-events', 'none')
            .text(line);
        });
      } else {
        const short = d.label.length > maxLen ? d.label.slice(0, maxLen - 1) + '…' : d.label;
        el.append('text')
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-family', FONT)
          .attr('font-size', d.type === 'notebook' ? 12 : 10)
          .attr('font-weight', d.type === 'notebook' ? 500 : 400)
          .attr('fill', d.color).attr('pointer-events', 'none')
          .text(short);
      }
    });

    // Click
    nodeSel.on('click', (e, d) => {
      e.stopPropagation();
      if (d.type === 'notebook') {
        onSelectNotebook(d.nb);
        onExpandNotebook(d.nb);
      } else {
        onSelectSection(d.section, d.nb);
      }
    });

    // Tick — aggiorna posizioni
    sim.on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
      drawHulls();
    });

    // Salva posizioni alla fine della simulazione
    sim.on('end', () => {
      nodes.forEach(n => { posRef.current[n.id] = { x: n.x, y: n.y }; });
    });
  }

  return <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />;
}
