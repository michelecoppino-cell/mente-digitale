import { useEffect, useRef } from 'react';
// Import mirati dei soli moduli D3 usati (invece dell'intero pacchetto):
// bundle più piccolo. 'd3-transition' è un side-effect import che aggiunge
// .transition() alle selezioni.
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { forceSimulation, forceLink, forceManyBody, forceCollide } from 'd3-force';
import { drag as d3drag } from 'd3-drag';
import { polygonHull } from 'd3-polygon';
import 'd3-transition';
import { sectionRole, paraSectionLabel } from './paraConfig';

const FONT = 'Inter, system-ui, sans-serif';
const OCRA = '#d4a44a';

// Le 4 aree PARA come "gruppi" fissi al posto dei taccuini, quando
// viewMode === 'para'. Colori distinti dal palette dell'app (config.js).
const PARA_GROUPS = [
  { id: 'para_projects', displayName: 'Progetti', color: '#7eb8c9', role: null },
  { id: 'para_area', displayName: 'Aree/Ricorrenti', color: '#86c07a', role: 'area' },
  { id: 'para_resources', displayName: 'Risorse/Idee', color: '#a084c8', role: 'resources' },
  { id: 'para_archive', displayName: 'Archivio', color: '#c8907a', role: 'archive' },
];

// Costruisce l'elenco di "gruppi" (nodi centrali di primo livello) e, per
// ciascuno, i suoi figli (sezioni) — in modalità 'workbook' i gruppi sono i
// taccuini reali, in modalità 'para' sono le 4 aree PARA fisse.
function buildGroups(viewMode, notebooks, sectionsMap) {
  if (viewMode !== 'para') {
    return notebooks.map(nb => ({
      id: 'nb_' + nb.id,
      displayName: nb.displayName,
      color: nb._color,
      children: (sectionsMap[nb.id] || []).map(s => ({ section: s, nb, label: s.displayName })),
    }));
  }

  const childrenByGroup = { para_projects: [], para_area: [], para_resources: [], para_archive: [] };
  notebooks.forEach(nb => {
    (sectionsMap[nb.id] || []).forEach(s => {
      const role = sectionRole(s.displayName);
      if (!role) {
        childrenByGroup.para_projects.push({ section: s, nb, label: s.displayName });
      } else {
        childrenByGroup['para_' + role].push({ section: s, nb, label: paraSectionLabel(s.displayName) });
      }
    });
  });

  return PARA_GROUPS.map(g => ({ id: g.id, displayName: g.displayName, color: g.color, children: childrenByGroup[g.id] }));
}

export default function MindMap({
  notebooks, sectionsMap, todoListsMap, todoCountMap,
  viewMode = 'workbook',
  onSelectSection, onExpandNotebook,
  externalZoom, onZoomChange,
  onIdentityOpen,
}) {
  const svgRef = useRef();
  const zoomRef = useRef();
  const simRef = useRef();
  const gRef = useRef();
  const stateRef = useRef({ nodes: [], links: [], activeSection: null });
  const activeSectionRef = useRef(null);
  const todoCountMapRef = useRef({});
  const internalZoomRef = useRef(false); // true durante zoom D3, evita feedback loop
  const tickCountRef = useRef(0);
  const openIdentityRef = useRef(null);
  openIdentityRef.current = onIdentityOpen;

  // Carica sezioni all'avvio
  useEffect(() => {
    if (!notebooks.length) return;
    notebooks.forEach(nb => onExpandNotebook(nb));
    // `onExpandNotebook` arriva da App.jsx e cambia identità a ogni render:
    // fra le dipendenze farebbe ripartire il caricamento all'infinito.
  }, [notebooks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Costruisce il grafo la prima volta che tutte le sezioni sono caricate
  useEffect(() => {
    if (!notebooks.length) return;
    const allLoaded = notebooks.every(nb => sectionsMap[nb.id]);
    if (!allLoaded) return;
    buildGraph();
    // buildGraph legge lo stato corrente quando viene chiamata: dipende da
    // tutto, e metterla qui vorrebbe dire ricostruire il grafo a ogni render.
  }, [notebooks, sectionsMap, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom esterno (solo da pulsanti, non da wheel D3)
  useEffect(() => {
    if (!zoomRef.current || !svgRef.current) return;
    if (internalZoomRef.current) { internalZoomRef.current = false; return; }
    select(svgRef.current).transition().duration(220)
      .call(zoomRef.current.scaleTo, externalZoom);
  }, [externalZoom]);

  // Sincronizza ref badge e ridisegna quando i conteggi arrivano (async)
  useEffect(() => {
    todoCountMapRef.current = todoCountMap || {};
    if (gRef.current) drawBadgesStatic();
  }, [todoCountMap]);

  // Debounce: ricostruire il grafo D3 è costoso, non va rifatto ad ogni
  // singolo evento resize durante il trascinamento della finestra.
  useEffect(() => {
    let timer;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const allLoaded = notebooks.length && notebooks.every(nb => sectionsMap[nb.id]);
        if (allLoaded) buildGraph();
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
    // Come sopra: buildGraph non va fra le dipendenze.
  }, [notebooks, sectionsMap, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildGraph() {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const W = container.offsetWidth;
    const H = container.offsetHeight;
    const cx = W / 2, cy = H / 2;

    if (simRef.current) simRef.current.stop();

    const svg = select(svgRef.current).attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g;

    // Zoom & Pan
    const zoom = d3zoom()
      .scaleExtent([0.1, 5])
      .wheelDelta(e => -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.005))
      .on('zoom', e => {
        g.attr('transform', e.transform);
        internalZoomRef.current = true; // segnala: questo cambio viene da D3, non da pulsanti
        onZoomChange(Math.round(e.transform.k * 100) / 100);
      });
    zoomRef.current = zoom;
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', () => toggleAppNodes(null));

    // Layer ordinati
    g.append('g').attr('class', 'hulls');
    g.append('g').attr('class', 'links');
    g.append('g').attr('class', 'nodes');
    g.append('g').attr('class', 'badges');

    // Nodi base: gruppi (taccuini reali o le 4 aree PARA) + sezioni
    const nodes = [];
    const links = [];
    const nbSpread = Math.min(W, H) * 0.10;
    const groups = buildGroups(viewMode, notebooks, sectionsMap);

    // Settori angolari pesati sul numero di sezioni: un gruppo affollato
    // (es. "Progetti" in vista PARA) occupa più arco di cerchio di uno quasi
    // vuoto (Aree/Risorse/Archivio), invece di spartirsi il piano in parti
    // uguali e accalcarsi.
    const weights = groups.map(g => Math.max(1, g.children.length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let angleAcc = -Math.PI / 2;

    groups.forEach((grp, i) => {
      const sector = (weights[i] / totalWeight) * 2 * Math.PI;
      const angle  = angleAcc + sector / 2;
      angleAcc += sector;

      nodes.push({
        id: grp.id,
        groupId: grp.id,
        type: 'notebook',
        label: grp.displayName,
        color: grp.color,
        r: 46,
        shape: 'circle',
        fx: cx + nbSpread * Math.cos(angle),
        fy: cy + nbSpread * Math.sin(angle),
      });

      const secTotal = grp.children.length;
      // Passo angolare: dentro il proprio settore, mai oltre 0.3 rad a figlio
      const step = secTotal > 1 ? Math.min(0.3, (sector * 0.85) / (secTotal - 1)) : 0;
      // Gruppi affollati: figli alternati su due anelli per non sovrapporsi
      const twoRings = secTotal > 8;

      grp.children.forEach(({ section: s, nb, label }, si) => {
        const baseR = Math.min(W, H) * 0.30;
        const secStartR = twoRings ? baseR * (si % 2 === 0 ? 1 : 1.45) : baseR;
        const secAngle = angle + (si - (secTotal - 1) / 2) * step;
        const secHas2Lines = label.length > 8;
        const secRh = secHas2Lines ? 30 : 20;
        nodes.push({
          id: 'sec_' + s.id,
          type: 'section',
          label,
          color: s._color || grp.color,
          section: s,
          nb,
          groupId: grp.id,
          shape: 'rect',
          rw: 52, rh: secRh,
          x: cx + secStartR * Math.cos(secAngle),
          y: cy + secStartR * Math.sin(secAngle),
        });
        links.push({ source: grp.id, target: 'sec_' + s.id, type: 'nb-sec' });
      });
    });

    stateRef.current = { nodes, links, activeSection: null };

    // Simulazione
    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).id(d => d.id).distance(100).strength(0.6))
      .force('charge', forceManyBody().strength(d => d.type === 'notebook' ? -900 : -220))
      .force('collision', forceCollide(d => d.type === 'notebook' ? d.r + 30 : d.type === 'app' ? d.r + 1 : (d.shape === 'rect' ? Math.max(d.rw / 2, d.rh / 2) + 10 : d.r + 10)))
      .alphaDecay(0.022);
    simRef.current = sim;

    sim.on('tick', () => tick());
    renderAll();

    // Zoom iniziale — 140% su desktop, ridotto sotto i 640px così la mappa
    // (il cui raggio scala comunque su Math.min(W,H)) resta interamente
    // visibile invece di richiedere subito un pinch-out per orientarsi.
    const initScale = W < 640 ? 1.0 : 1.4;
    const initTx = (W - W * initScale) / 2;
    const initTy = (H - H * initScale) / 2;
    select(svgRef.current)
      .call(zoomRef.current.transform, zoomIdentity.translate(initTx, initTy).scale(initScale));
    onZoomChange(initScale);

    // Ridisegna badge con i conteggi già presenti (es. dopo resize)
    drawBadgesStatic();

    // ── Orb identità — fisso al baricentro dei notebook ──────────────────────
    const orb = g.append('g')
      .attr('class', 'identity-orb')
      .attr('transform', `translate(${cx},${cy})`)
      .on('click', e => e.stopPropagation());

    // Anello pulsante dietro l'orb (animazione CSS .orb-pulse)
    orb.append('circle').attr('class', 'orb-pulse')
      .attr('r', 33).attr('fill', 'none')
      .attr('stroke', OCRA).attr('stroke-width', 1.2);
    orb.append('circle').attr('class', 'orb-pulse orb-pulse-2')
      .attr('r', 33).attr('fill', 'none')
      .attr('stroke', OCRA).attr('stroke-width', 1.2);

    // Cerchio ocra pieno
    orb.append('circle').attr('r', 28).attr('fill', OCRA);

    // Separatore orizzontale
    orb.append('line')
      .attr('x1', -14).attr('x2', 14).attr('y1', 1).attr('y2', 1)
      .attr('stroke', 'rgba(0,0,0,0.22)').attr('stroke-width', 0.8);

    // Icona bussola — metà superiore
    const compassG = orb.append('g').attr('transform', 'translate(0,-11)').style('cursor', 'pointer')
      .on('click', e => { e.stopPropagation(); openIdentityRef.current?.('bussola'); });
    compassG.append('circle').attr('r', 7).attr('fill', 'none').attr('stroke', 'rgba(0,0,0,0.55)').attr('stroke-width', 1.3);
    compassG.append('polygon')
      .attr('points', '2.97,-2.97 1.48,1.48 -2.97,2.97 -1.48,-1.48')
      .attr('fill', 'rgba(0,0,0,0.55)');
    // area click metà superiore
    orb.append('path')
      .attr('d', 'M-28,0 A28,28 0 0 1 28,0 Z')
      .attr('fill', 'transparent').style('cursor', 'pointer')
      .on('click', e => { e.stopPropagation(); openIdentityRef.current?.('bussola'); });

    // Icona occhio — metà inferiore
    const eyeG = orb.append('g').attr('transform', 'translate(0,11)').style('cursor', 'pointer')
      .on('click', e => { e.stopPropagation(); openIdentityRef.current?.('visione'); });
    eyeG.append('path')
      .attr('d', 'M-7,0 C-5,-3.5 5,-3.5 7,0 C5,3.5 -5,3.5 -7,0 Z')
      .attr('fill', 'none').attr('stroke', 'rgba(0,0,0,0.55)').attr('stroke-width', 1.3).attr('stroke-linejoin', 'round');
    eyeG.append('circle').attr('r', 2.2).attr('fill', 'rgba(0,0,0,0.55)');
    // area click metà inferiore
    orb.append('path')
      .attr('d', 'M-28,0 A28,28 0 0 0 28,0 Z')
      .attr('fill', 'transparent').style('cursor', 'pointer')
      .on('click', e => { e.stopPropagation(); openIdentityRef.current?.('visione'); });
  }

  // Zoom adattivo su un notebook e le sue sezioni
  function zoomToNotebook(nbNode) {
    const st = stateRef.current;
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const W = container.offsetWidth;
    const H = container.offsetHeight;

    const secNodes = st.nodes.filter(n => n.type === 'section' && n.groupId === nbNode.groupId);
    const allNodes = [nbNode, ...secNodes];

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    allNodes.forEach(n => {
      const hw = n.shape === 'rect' ? (n.rw || 52) / 2 : (n.r || 46);
      const hh = n.shape === 'rect' ? (n.rh || 20) / 2 : (n.r || 46);
      minX = Math.min(minX, (n.x || 0) - hw);
      maxX = Math.max(maxX, (n.x || 0) + hw);
      minY = Math.min(minY, (n.y || 0) - hh);
      maxY = Math.max(maxY, (n.y || 0) + hh);
    });

    const pad = 70;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const bw = maxX - minX;
    const bh = maxY - minY;
    const scale = Math.min(W / bw, H / bh, 4);
    const tx = W / 2 - scale * (minX + bw / 2);
    const ty = H / 2 - scale * (minY + bh / 2);

    select(svgRef.current)
      .transition().duration(420)
      .call(zoomRef.current.transform, zoomIdentity.translate(tx, ty).scale(scale));
    onZoomChange(Math.round(scale * 100) / 100);
  }

  // Aggiunge o rimuove nodi app senza ricostruire tutto
  function toggleAppNodes(sectionId) {
    const todoListsMapRef = todoListsMap;
    const st = stateRef.current;
    const prevActive = activeSectionRef.current;
    if (prevActive === sectionId) return;
    activeSectionRef.current = sectionId;

    st.activeSecNode = null;
    // Marca sezioni come attive/non attive
    st.nodes.forEach(n => { if (n.type === 'section') n.active = false; });

    if (sectionId) {
      const secNode = st.nodes.find(n => n.id === 'sec_' + sectionId);
      if (secNode) {
        secNode.active = true;
        st.activeSecNode = secNode;
        st.todoListsMap = todoListsMapRef;
      }
    }

    // Aggiorna simulazione (solo nodi esistenti, no app nodes)
    const sim = simRef.current;
    sim.nodes(st.nodes);
    sim.force('link').links(st.links);
    // Non riavviare la sim al click sezione — risparmia CPU su mobile
    // sim.alpha(0.08).restart();
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
      const el = select(this);
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
      const el = select(this);
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
            .attr('font-family', FONT).attr('font-size', d.active ? 11 : 9).attr('font-weight', d.active ? 600 : 400)
            .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
            .text(line1);
          el.append('text').attr('y', 6)
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', d.active ? 11 : 9).attr('font-weight', d.active ? 600 : 400)
            .attr('fill', d.color).attr('opacity', opacity).attr('pointer-events', 'none')
            .text(line2);
        } else {
          el.append('text')
            .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
            .attr('font-family', FONT).attr('font-size', d.active ? 11 : 9).attr('font-weight', d.active ? 600 : 400)
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

    // Glow al passaggio del mouse
    nodeEnter
      .on('mouseenter', function(e, d) {
        const el = select(this);
        el.select('.halo').transition().duration(160).attr('fill', d.color + '1e');
        el.select('.main-shape').transition().duration(160)
          .attr('stroke-width', d.type === 'notebook' ? 3 : d.active ? 2.5 : 2)
          .attr('stroke', d.color);
      })
      .on('mouseleave', function(e, d) {
        const el = select(this);
        el.select('.halo').transition().duration(300).attr('fill', d.color + '07');
        el.select('.main-shape').transition().duration(300)
          .attr('stroke-width', d.type === 'notebook' ? 2 : (d.shape === 'rect' && d.active) ? 2.5 : d.shape === 'rect' ? 1 : 1.2)
          .attr('stroke', d.shape === 'rect' && !d.active ? d.color + '88' : d.color);
      });

    // Drag (solo non-notebook)
    nodeEnter.filter(d => d.type !== 'notebook')
      .call(d3drag()
        .on('start', (e, d) => { if (!e.active) simRef.current.alphaTarget(0.15).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simRef.current.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Click
    nodeEnter.on('click', (e, d) => {
      e.stopPropagation();
      if (d.type === 'notebook') {
        zoomToNotebook(d);
      }
      if (d.type === 'section') {
        const isActive = activeSectionRef.current === d.section.id;
        toggleAppNodes(isActive ? null : d.section.id);
        if (isActive) {
          onSelectSection(null, null, null); // chiudi panel
        } else {
          onSelectSection(d.section, d.nb, 'onenote');
        }
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
      const el = select(this);

      // Halo
      const haloR = d.shape === 'rect'
        ? Math.max(d.rw / 2, d.rh / 2) + 6
        : d.r + (d.type === 'notebook' ? 18 : 10);
      el.select('.halo').attr('r', haloR);

      // Forma principale
      if (d.shape === 'rect') {
        const scale = d.active ? 1.2 : 1.0;
        const w = Math.round(52 * scale);
        const h = Math.round((d.label.length > 8 ? 30 : 20) * scale);
        d.rw = w; d.rh = h;
        el.select('.main-shape')
          .attr('x', -w / 2).attr('y', -h / 2)
          .attr('width', w).attr('height', h)
          .attr('stroke', d.active ? d.color : d.color + '88')
          .attr('stroke-width', d.active ? 2.5 : 1);
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
    tickCountRef.current++;

    // Aggiorna posizioni link
    g.select('.links').selectAll('line')
      .attr('x1', d => (typeof d.source === 'object' ? d.source : st.nodes.find(n => n.id === d.source))?.x || 0)
      .attr('y1', d => (typeof d.source === 'object' ? d.source : st.nodes.find(n => n.id === d.source))?.y || 0)
      .attr('x2', d => (typeof d.target === 'object' ? d.target : st.nodes.find(n => n.id === d.target))?.x || 0)
      .attr('y2', d => (typeof d.target === 'object' ? d.target : st.nodes.find(n => n.id === d.target))?.y || 0);

    // Aggiorna posizioni nodi
    g.select('.nodes').selectAll('g.node')
      .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

    // Hull: solo ogni 3 tick (costoso)
    if (tickCountRef.current % 3 === 0) drawHulls();

    // App nodes disabilitati - apertura dashboard gestita dal click

    // Badge: aggiorna posizioni ogni tick
    updateBadgePositions();
  }

  function drawBadgesStatic() {
    // Ricrea tutti i badge con i dati aggiornati
    const g = gRef.current;
    if (!g) return;
    const st = stateRef.current;
    const counts = todoCountMapRef.current;
    const badgeLayer = g.select('.badges');
    badgeLayer.selectAll('*').remove();
    if (!Object.keys(counts).length) return;

    st.nodes.filter(n => n.type === 'section').forEach(n => {
      const sectionName = (n.section?.displayName || n.label).toLowerCase();
      const count = counts[sectionName];
      if (!count) return;
      const bx = (n.x || 0) + (n.rw || 52) / 2 - 4;
      const by = (n.y || 0) - (n.rh || 20) / 2 + 4;
      badgeLayer.append('circle')
        .attr('class', 'badge-circle')
        .attr('data-secid', n.id)
        .attr('cx', bx).attr('cy', by).attr('r', 7)
        .attr('fill', n.color).attr('stroke', '#0e1013').attr('stroke-width', 1.5);
      badgeLayer.append('text')
        .attr('class', 'badge-text')
        .attr('data-secid', n.id)
        .attr('x', bx).attr('y', by)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', 7).attr('font-weight', 700)
        .attr('fill', '#0e1013').attr('pointer-events', 'none')
        .text(count > 9 ? '9+' : count);
    });
  }

  function updateBadgePositions() {
    const g = gRef.current;
    if (!g) return;
    const st = stateRef.current;
    st.nodes.filter(n => n.type === 'section' && n.x && n.y).forEach(n => {
      const bx = n.x + (n.rw || 52) / 2 - 4;
      const by = n.y - (n.rh || 20) / 2 + 4;
      g.select('.badges').selectAll(`[data-secid="${n.id}"]`)
        .attr('cx', bx).attr('cy', by)
        .attr('x', bx).attr('y', by);
    });
  }

  function drawHulls() {
    const g = gRef.current;
    if (!g) return;
    const st = stateRef.current;

    const groupNodes = st.nodes.filter(n => n.type === 'notebook');
    const hullData = groupNodes.flatMap(grpNode => {
      const secNodes = st.nodes.filter(n => n.type === 'section' && n.groupId === grpNode.groupId);
      if (!secNodes.length) return [];
      const pts = [];
      const addPts = (node, pad) => {
        const sz = node.shape === 'rect' ? Math.max(node.rw / 2, node.rh / 2) : (node.r || 18);
        for (let a = 0; a < 2 * Math.PI; a += Math.PI / 10)
          pts.push([(node.x || 0) + (sz + pad) * Math.cos(a), (node.y || 0) + (sz + pad) * Math.sin(a)]);
      };
      addPts(grpNode, 24);
      secNodes.forEach(n => addPts(n, 16));
      st.nodes.filter(n => n.type === 'app' && n.groupId === grpNode.groupId)
        .forEach(n => addPts(n, 10));
      try {
        const hull = polygonHull(pts);
        return hull ? [{ groupId: grpNode.groupId, color: grpNode.color, hull }] : [];
      } catch { return []; }
    });

    const sel = g.select('.hulls').selectAll('.hull').data(hullData, d => d.groupId);
    sel.enter().append('path').attr('class', 'hull')
      .merge(sel)
      .attr('fill', d => d.color + '09')
      .attr('stroke', d => d.color + '1a')
      .attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round')
      .attr('d', d => `M${d.hull.join('L')}Z`);
    sel.exit().remove();
  }

  return <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />;
}
