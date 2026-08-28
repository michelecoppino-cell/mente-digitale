// @ts-check
// I riquadri riservati di «Oggi» — Bussola, Finanze, Diario — partono visibili
// e si nascondono a mano.
//
// Prima partivano coperti e si aprivano col PIN. Era la scelta prudente, ma la
// prudenza la pagava la persona sbagliata: la scheda che sta aperta tutto il
// giorno sulla scrivania è quasi sempre guardata da chi quei dati li ha
// scritti, e chiedergli il PIN a ogni apertura per proteggerlo dalle due volte
// al mese in cui passa qualcuno vuol dire tre riquadri ciechi per tutto il
// resto del tempo.
//
// Il gesto è quindi rovesciato: si vede, e si nasconde quando serve — nel
// momento preciso in cui uno alza gli occhi e si accorge che sta arrivando
// qualcuno. Da lì in poi ci vuole il PIN, che è lo sblocco condiviso con la
// sezione Finanze (vedi finanze/sblocco.ts): quello non è cambiato, e la
// sezione coi conti resta protetta come prima.
//
// Il «nascosto» vale per la scheda del browser e non oltre: aprire una scheda
// nuova riparte da visibile, come riparte da bloccato lo sblocco del PIN.
import { useSyncExternalStore } from 'react';
import { blocca, useSbloccato } from './finanze/sblocco';

const SS_NASCOSTI = 'oggi.riquadriNascosti';

function leggi() {
  try { return sessionStorage.getItem(SS_NASCOSTI) === '1'; } catch { return false; }
}

let stato = leggi();
const ascoltatori = new Set();

function ricalcola() {
  const nuovo = leggi();
  if (nuovo === stato) return;
  stato = nuovo;
  for (const l of ascoltatori) l();
}

/** @param {() => void} l */
function iscrivi(l) {
  ascoltatori.add(l);
  return () => { ascoltatori.delete(l); };
}

function istantanea() { return stato; }

/**
 * Nasconde i riquadri e chiude lo sblocco: da qui in poi ci vuole il PIN.
 *
 * Le due cose insieme e non una sola: nascondere lasciando lo sblocco aperto
 * vorrebbe dire un velo che si alza premendo un bottone, cioè nessun velo.
 */
export function nascondi() {
  try { sessionStorage.setItem(SS_NASCOSTI, '1'); } catch { /* niente sessionStorage */ }
  ricalcola();
  blocca();
}

/**
 * React: `true` quando il contenuto riservato si può mostrare — perché non è
 * stato nascosto, oppure perché è stato riaperto col PIN.
 * @returns {boolean}
 */
export function useRiservatiVisibili() {
  const nascosti = useSyncExternalStore(iscrivi, istantanea, istantanea);
  const sbloccato = useSbloccato();
  return !nascosti || sbloccato;
}
