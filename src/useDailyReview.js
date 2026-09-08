// @ts-check
// La campanella: le proposte di attività ricavate dalle email recenti e dalle
// righe «Da fare» (Ctrl+1) delle pagine OneNote toccate di recente.
//
// Tutto locale ed euristico — nessuna chiamata AI, nessun costo. Ogni proposta
// si mostra una volta sola: accettata o scartata, la sua «firma» resta scritta
// nei marker per una settimana, e non ricompare più. Un lavoro fatto a mano non
// si deve rifare.
//
// Stava dentro `App.jsx` insieme a tutto il resto — il caricamento, i colori,
// le scadenze, sei rotte e nove modali — e non aveva niente a che vedere con
// nessuna di quelle cose. Qui è un pezzo che si legge da solo.

import { useCallback, useState } from 'react';
import { getRecentEmails, getPageContentHtml, markOneNoteTagDone } from './api';
import { getMarker, setMarker } from './markers';
import { extractEmailCandidates, extractOneNoteCandidates } from './dailyReview';

/** Per quanto si ricorda di aver già visto una proposta. */
const VISTE_TTL = 7 * 24 * 60 * 60 * 1000;

/** Alla prima scansione, o dopo una pausa lunga: quanto indietro si guarda. */
const FINESTRA_INIZIALE = 2 * 24 * 60 * 60 * 1000;

const ULTIMO_CONTROLLO = 'review_last_check';
const ULTIMO_CONTROLLO_TTL = 30 * 24 * 60 * 60 * 1000;

/** Tetto di sicurezza sulle pagine di cui si scarica il contenuto per intero. */
const TETTO_PAGINE = 40;

/** @param {any} a @returns {string} */
function firmaProposta(a) {
  return `${a.source || 'email'}::${a.title || ''}::${a.extractedAction || ''}`;
}

/** @param {string} firma */
function segnaVista(firma) {
  const viste = getMarker('review_seen') || [];
  if (!viste.includes(firma)) {
    setMarker('review_seen', [...viste, firma].slice(-300), VISTE_TTL);
  }
}

// `taglioMs` è un istante assoluto, non una durata: così si scansionano solo le
// pagine toccate dall'ultimo controllo riuscito in poi, invece di rifare ogni
// volta la stessa finestra di due giorni. Copertura più larga nel tempo, e
// niente da riscaricare di quello che si è già visto.
/**
 * @param {any[]} pagine
 * @param {number} taglioMs
 * @returns {any[]}
 */
export function pagineRecenti(pagine, taglioMs) {
  return pagine
    .filter(p => p.lastModifiedDateTime && new Date(p.lastModifiedDateTime).getTime() >= taglioMs)
    .sort((a, b) => new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime());
}

/**
 * @typedef {object} DailyReview
 * @property {any[]} proposte
 * @property {boolean} inCorso
 * @property {boolean} aperta
 * @property {(v: boolean | ((prec: boolean) => boolean)) => void} apri
 * @property {(raccogliPagine: () => Promise<any[]>) => Promise<void>} aggiorna
 * @property {(proposta: any, testoCorretto?: string) => string} accetta
 * @property {(proposta: any) => void} scarta
 */

/**
 * @returns {DailyReview}
 */
export function useDailyReview() {
  const [proposte, setProposte] = useState(/** @type {any[]} */ ([]));
  const [aperta, setAperta] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  /**
   * Rifà la scansione. Le pagine gliele passa chi chiama, perché aggregarle
   * vuol dire girare taccuini e sezioni riusando le cache già in piedi, e quelle
   * le tiene «Oggi» — non questa campanella.
   * @param {() => Promise<any[]>} raccogliPagine
   */
  const aggiorna = useCallback(async (/** @type {() => Promise<any[]>} */ raccogliPagine) => {
    setInCorso(true);
    try {
      const [email, pagine] = await Promise.all([
        getRecentEmails().catch(e => { console.error('recent emails', e); return []; }),
        raccogliPagine().catch((/** @type {unknown} */ e) => { console.error('recent pages', e); return []; }),
      ]);

      const ultimo = getMarker(ULTIMO_CONTROLLO);
      const taglio = ultimo || (Date.now() - FINESTRA_INIZIALE);
      const daLeggere = pagineRecenti(pagine, taglio).slice(0, TETTO_PAGINE);

      const conHtml = [];
      for (const p of daLeggere) {
        try {
          const html = await getPageContentHtml(p.id);
          conHtml.push({ ...p, html });
          await new Promise(r => setTimeout(r, 120));
        } catch (e) { console.error('page content', p.title, e); }
      }

      const viste = getMarker('review_seen') || [];
      // Le due fonti si mescolano e si riordinano per punteggio invece di
      // restare in due blocchi: una riga segnata a mano con Ctrl+1 è un
      // segnale vero, e in coda a sei email indovinate finiva sotto la piega
      // del pannello proprio la sola proposta di cui si è già certi.
      const candidate = [
        ...extractEmailCandidates(email, 6),
        ...extractOneNoteCandidates(conHtml, 8),
      ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      setProposte(candidate
        .map(a => ({
          ...a,
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          _sig: firmaProposta(a),
        }))
        .filter(a => !viste.includes(a._sig)));
      setMarker(ULTIMO_CONTROLLO, Date.now(), ULTIMO_CONTROLLO_TTL);
    } catch (e) {
      console.error('daily review', e);
    }
    setInCorso(false);
  }, []);

  // Una proposta che viene da OneNote si spunta nella pagina d'origine, sia che
  // la si accetti sia che la si scarti: in tutti e due i casi la riga «Da fare»
  // è stata guardata, e non deve ripresentarsi.
  /** @param {any} proposta */
  const chiudiInOrigine = useCallback((/** @type {any} */ proposta) => {
    if (proposta.source !== 'onenote') return;
    markOneNoteTagDone(proposta.pageId, proposta.elementId, proposta.originalTagHtml)
      .catch(e => console.error('mark onenote tag done', e));
  }, []);

  /** @param {any} proposta */
  const togli = useCallback((/** @type {any} */ proposta) => {
    segnaVista(proposta._sig);
    chiudiInOrigine(proposta);
    setProposte(prec => prec.filter(p => p.id !== proposta.id));
  }, [chiudiInOrigine]);

  /**
   * Accettare non crea un'attività al volo nella prima lista che capita: apre
   * il chiarimento col testo già dentro, così a decidere dove va è chi guarda.
   * @param {any} proposta
   * @param {string} [testoCorretto]
   * @returns {string} il testo da portare nel chiarimento
   */
  const accetta = useCallback((/** @type {any} */ proposta, /** @type {string|undefined} */ testoCorretto) => {
    togli(proposta);
    setAperta(false);
    return (testoCorretto || proposta.extractedAction || '').trim();
  }, [togli]);

  return { proposte, inCorso, aperta, apri: setAperta, aggiorna, accetta, scarta: togli };
}
