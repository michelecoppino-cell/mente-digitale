// Le parti di Microsoft Graph che non sono file su OneDrive: OneNote, il
// calendario, la posta, i promemoria.
//
// Il finto drive (`drive.js`) sa fare i file, che è quello che serve alle
// prove. Per aprire l'app in locale serve anche il resto, perché «Oggi» si
// riempie di appuntamenti, la Mappa di taccuini e Sezioni di pagine — e una
// schermata vuota non dice se il disegno regge.
//
// Sono risposte finte ma nella forma vera, quella che `api.js` si aspetta: se
// una risposta qui è sbagliata, l'app si rompe come si romperebbe con Graph.

import {
  TACCUINI, SEZIONI, PAGINE, CALENDARI, EVENTI,
  LISTE, TASK, PIANI, OBIETTIVI, CODA, DIARIO_MESE, MOVIMENTO_MESE, MOVIMENTO_INDICE, BUSSOLA,
  PROGRAMMI, PROGRAMMA, CALENDARIO_LAVORO, POSTA,
} from './semi.js';
import { ymd } from '../tempo.js';

/**
 * Aggiunge al finto drive le rotte di OneNote, calendario e posta, e ci scrive
 * dentro i file dell'app come se ci fossero già.
 * @param {ReturnType<import('./drive.js').montaFintoOnedrive>} finto
 */
export function montaFintoGraph(finto) {
  finto.pulisci();

  // ── I file dell'app, già scritti ──────────────────────────────────────────
  const scrivi = (/** @type {string} */ rel, /** @type {any} */ dati) =>
    finto.scriviFile(`mente-digitale/${rel}`, JSON.stringify(dati, null, 2));

  scrivi('task/_liste.json', { version: 1, migrazioneTodo: new Date().toISOString(), liste: LISTE });
  for (const l of LISTE) {
    scrivi(l.file, { version: 1, listId: l.id, listName: l.nome, tasks: TASK[l.id] || [] });
  }

  scrivi('programmi/_registro.json', { version: 1, programmi: PROGRAMMI });
  for (const p of PROGRAMMI) scrivi(p.file, PROGRAMMA[p.id]);

  scrivi('calendario-lavoro.json', CALENDARIO_LAVORO);

  scrivi('mente-digitale-daily-plans.json', PIANI);
  scrivi('mente-digitale-obiettivi.json', OBIETTIVI);
  scrivi('mente-digitale-coda.json', CODA);
  scrivi('mente-digitale-bussola.json', BUSSOLA);
  scrivi('mente-digitale-rituale.json', {});
  scrivi('mente-digitale-color-settings.json', { notebooks: {}, sections: {} });

  const mese = ymd().slice(0, 7);
  scrivi('diario/diario-index.json', { months: [mese] });
  scrivi(`diario/diario-${mese}.json`, DIARIO_MESE);
  scrivi('movimento/movimento-index.json', MOVIMENTO_INDICE);
  scrivi(`movimento/movimento-${mese}.json`, MOVIMENTO_MESE);

  // ── OneNote, calendario, posta ────────────────────────────────────────────
  finto.aggiungiRotta((
    /** @type {string} */ percorso,
    /** @type {any} */ opzioni,
    /** @type {(status: number, corpo: any) => any} */ risposta,
  ) => {
    const metodo = opzioni.method || 'GET';
    const nudo = percorso.split('?')[0];

    if (nudo === '/me' || nudo.startsWith('/me?')) {
      return risposta(200, { userPrincipalName: 'finto@esempio.it', displayName: 'Finto' });
    }

    // ── OneNote ───────────────────────────────────────────────────────────
    if (nudo === '/me/onenote/notebooks') return risposta(200, { value: TACCUINI });
    const sez = nudo.match(/^\/me\/onenote\/notebooks\/([^/]+)\/sections$/);
    if (sez) return risposta(200, { value: SEZIONI[sez[1]] || [] });
    const pag = nudo.match(/^\/me\/onenote\/sections\/([^/]+)\/pages$/);
    if (pag && metodo === 'GET') return risposta(200, { value: PAGINE[pag[1]] || [] });
    if (pag && metodo === 'POST') return risposta(201, { id: 'p-nuova', title: 'Pagina nuova' });
    if (/^\/me\/onenote\/pages\/[^/]+\/content$/.test(nudo)) {
      // Il contenuto è HTML, non JSON: `getPageContentHtml` fa `r.text()`.
      return {
        ok: true, status: 200, headers: { get: () => null },
        text: async () => '<html><body><p>Contenuto finto della pagina.</p></body></html>',
        json: async () => { throw new Error('è HTML'); },
      };
    }

    // ── Calendario ────────────────────────────────────────────────────────
    if (nudo === '/me/calendars') {
      if (metodo === 'POST') return risposta(201, { id: 'cal-nuovo', name: JSON.parse(opzioni.body).name });
      return risposta(200, { value: CALENDARI });
    }
    if (/^\/me\/calendars\/[^/]+$/.test(nudo) && metodo === 'PATCH') return risposta(200, {});
    const vista = nudo.match(/^\/me\/calendars\/([^/]+)\/(calendarView|events)$/);
    if (vista && metodo === 'GET') {
      return risposta(200, { value: EVENTI.filter(e => e._calId === vista[1]) });
    }
    if (nudo === '/me/calendarView') return risposta(200, { value: EVENTI });
    if (/^\/me\/(calendars\/[^/]+\/)?events$/.test(nudo) && metodo === 'POST') {
      const corpo = JSON.parse(opzioni.body);
      return risposta(201, { id: `e-${Date.now()}`, ...corpo, _calId: 'cal-1', _calName: 'Calendario' });
    }
    if (/^\/me\/(calendars\/[^/]+\/)?events\/[^/]+/.test(nudo)) {
      // PATCH, DELETE, move: il finto calendario dice sempre di sì.
      return metodo === 'DELETE' ? risposta(204, null) : risposta(200, { id: 'e-modificato' });
    }

    // ── Promemoria e posta ────────────────────────────────────────────────
    if (nudo.startsWith('/me/messages')) return risposta(200, { value: POSTA });

    return null;   // non è roba nostra: se ne occupa il drive
  });
}
