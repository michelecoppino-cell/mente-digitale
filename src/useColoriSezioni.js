// @ts-check
// Il colore di ogni taccuino, di ogni sezione e di ogni calendario.
//
// Di partenza il colore viene dalla posizione: il primo taccuino prende il
// primo della tavolozza, le sue sezioni una sfumatura di quel colore. Chi non
// vuole quello lo cambia dall'ingranaggio, e la scelta finisce su OneDrive —
// perché un colore scelto sul portatile deve valere anche sul telefono.
//
// I colori si scrivono **addosso agli oggetti** (`nb._color`, `sec._color`) e
// non in una mappa a parte: è la convenzione che c'era già prima che i colori
// si potessero scegliere, ed è quello che permette a ogni vista — la Mappa, il
// Piano, le Sezioni — di leggere `_color` senza sapere niente di come è stato
// deciso. Per questo il hook tiene il *documento* delle scelte e chi lo usa
// tiene i taccuini: la ridipintura è un aggancio solo, `onCambio`.
//
// I calendari fanno eccezione, e per forza: gli eventi non sono oggetti
// nostri — arrivano da Graph a ogni lettura e si ridecorano da capo, quindi
// non c'è niente su cui scrivere un `_color` che sopravviva. Lì la mappa
// `calendars` (id del calendario -> hex) resta una mappa, e la legge chi
// disegna l'evento (`coloreEvento` in planner/griglia.js).

import { useCallback, useRef, useState } from 'react';
import { saveColorSettings } from './api';
import { queryClient, qk } from './queryClient';
import { shadeColor } from './plannerShared';
import { COLORS } from './config';

/** @typedef {{ notebooks: Record<string, string>, sections: Record<string, string>, calendars: Record<string, string> }} Colori */

/** @type {Colori} */
export const COLORI_VUOTI = { notebooks: {}, sections: {}, calendars: {} };

/**
 * Le scelte come arrivano da OneDrive: i file scritti prima che i calendari si
 * potessero colorare non hanno quel campo, e senza questo ogni lettura di
 * `scelti.calendars` sarebbe una lettura di `undefined`.
 * @param {any} letti @returns {Colori}
 */
export function normalizzaColori(letti) {
  return {
    notebooks: letti?.notebooks || {},
    sections:  letti?.sections  || {},
    calendars: letti?.calendars || {},
  };
}

/**
 * @param {any} nb
 * @param {number} indice
 * @param {Colori} scelti
 */
export function coloraTaccuino(nb, indice, scelti) {
  nb._color = scelti.notebooks[nb.id] || COLORS[indice % COLORS.length];
}

/**
 * @param {any} nb
 * @param {any[]} sezioni
 * @param {Colori} scelti
 */
export function coloraSezioni(nb, sezioni, scelti) {
  (sezioni || []).forEach((s, i) => {
    s._color = scelti.sections[s.id] || shadeColor(nb._color || '#888', i);
  });
}

/**
 * @param {(scelti: Colori) => void} onCambio  ridipingi quello che hai in memoria
 */
export function useColoriSezioni(onCambio) {
  const [scelti, setScelti] = useState(COLORI_VUOTI);
  const sceltiRef = useRef(COLORI_VUOTI);
  // Finché il file non è stato letto non si scrive: al primo avvio salverebbe
  // la tavolozza vuota sopra le scelte che stanno su OneDrive.
  const lettoRef = useRef(false);

  // Le scelte come sono adesso, senza aspettare un render: durante il
  // caricamento i colori servono nell'istante in cui i taccuini arrivano.
  const adesso = useCallback(() => sceltiRef.current, []);

  /**
   * Le scelte appena lette da OneDrive. Non si salva niente: è quello che c'è
   * già scritto lì.
   * @param {Colori|null} letti
   */
  const ricevi = useCallback((/** @type {Colori|null} */ letti) => {
    const nuovi = normalizzaColori(letti);
    sceltiRef.current = nuovi;
    lettoRef.current = true;
    setScelti(nuovi);
    return nuovi;
  }, []);

  /**
   * Una scelta nuova: si ridipinge e si salva.
   * @param {Colori} nuovi
   */
  const applica = useCallback((/** @type {Colori} */ nuovi) => {
    sceltiRef.current = nuovi;
    setScelti(nuovi);
    // Anche in cache, non solo su OneDrive: è la copia che si ritrova
    // riaprendo l'app, e lasciarla indietro voleva dire vedere per un istante
    // i colori di prima a ogni avvio.
    queryClient.setQueryData(qk.colorSettings(), nuovi);
    if (lettoRef.current) {
      saveColorSettings(nuovi).catch(e => console.error('save color settings', e));
    }
    onCambio(nuovi);
  }, [onCambio]);

  /** @param {string} nbId @param {string} colore */
  const coloraUnTaccuino = useCallback((/** @type {string} */ nbId, /** @type {string} */ colore) => {
    const c = sceltiRef.current;
    applica({ ...c, notebooks: { ...c.notebooks, [nbId]: colore } });
  }, [applica]);

  /** @param {string} sectionId @param {string} colore */
  const coloraUnaSezione = useCallback((/** @type {string} */ sectionId, /** @type {string} */ colore) => {
    const c = sceltiRef.current;
    applica({ ...c, sections: { ...c.sections, [sectionId]: colore } });
  }, [applica]);

  /** @param {string} nbId */
  const riportaTaccuino = useCallback((/** @type {string} */ nbId) => {
    const c = sceltiRef.current;
    const notebooks = { ...c.notebooks };
    delete notebooks[nbId];
    applica({ ...c, notebooks });
  }, [applica]);

  /** @param {string} calId @param {string} colore */
  const coloraUnCalendario = useCallback((/** @type {string} */ calId, /** @type {string} */ colore) => {
    const c = sceltiRef.current;
    applica({ ...c, calendars: { ...c.calendars, [calId]: colore } });
  }, [applica]);

  /** @param {string} calId */
  const riportaCalendario = useCallback((/** @type {string} */ calId) => {
    const c = sceltiRef.current;
    const calendars = { ...c.calendars };
    delete calendars[calId];
    applica({ ...c, calendars });
  }, [applica]);

  /** @param {string} sectionId */
  const riportaSezione = useCallback((/** @type {string} */ sectionId) => {
    const c = sceltiRef.current;
    const sections = { ...c.sections };
    delete sections[sectionId];
    applica({ ...c, sections });
  }, [applica]);

  return {
    scelti,
    adesso,
    ricevi,
    coloraUnTaccuino,
    coloraUnaSezione,
    coloraUnCalendario,
    riportaTaccuino,
    riportaSezione,
    riportaCalendario,
  };
}
