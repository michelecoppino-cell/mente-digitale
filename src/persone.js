// @ts-check
// Le persone a cui si chiede qualcosa o si delega qualcosa.
//
// Sono sempre le stesse — Sara, ADC, Riccardo, ALIGS — e un nome scritto a
// mano ogni volta è un nome scritto ogni volta in modo diverso: «ADC» e «adc»
// diventerebbero due gruppi nella colonna Attività, che è esattamente la cosa
// che il raggruppamento per persona serve a evitare. Quindi l'elenco vive in
// `persone.json`, versionato col resto: è lì che si aggiunge chi manca.
//
// Un nome scritto al volo nel pannello di dettaglio, però, non deve richiedere
// un commit per essere riproposto domani: viene ricordato in locale e finisce
// in fondo all'elenco, marcato come aggiunto qui. Il posto stabile resta il
// JSON — il locale è memoria di comodo, non un secondo registro.
import registro from './persone.json';
import { readPref, writePref } from './viewPrefs';

const CHIAVE_AGGIUNTE = 'mente:persone-aggiunte:v1';

/** I nomi del registro versionato, nell'ordine in cui ci stanno scritti. */
export const PERSONE_REGISTRO = /** @type {string[]} */ (
  Array.isArray(registro?.persone) ? registro.persone.filter(n => typeof n === 'string' && n.trim()) : []
);

/** Due nomi sono la stessa persona se differiscono solo per spazi o maiuscole. */
function chiave(/** @type {string} */ nome) {
  return nome.trim().toLowerCase();
}

/** I nomi aggiunti a mano da questo dispositivo. */
function aggiunte() {
  const saved = readPref(CHIAVE_AGGIUNTE, []);
  return /** @type {string[]} */ (Array.isArray(saved) ? saved.filter(n => typeof n === 'string' && n.trim()) : []);
}

/**
 * L'elenco completo: prima il registro, poi i nomi aggiunti al volo.
 * @returns {string[]}
 */
export function elencoPersone() {
  const viste = new Set(PERSONE_REGISTRO.map(chiave));
  const extra = aggiunte().filter(n => {
    const k = chiave(n);
    if (viste.has(k)) return false;
    viste.add(k);
    return true;
  });
  return [...PERSONE_REGISTRO, ...extra.sort((a, b) => a.localeCompare(b, 'it'))];
}

/**
 * Il nome come sta nell'elenco, se c'è: così «adc» scritto di fretta diventa
 * «ADC» e non apre un gruppo tutto suo.
 * @param {string|null|undefined} nome
 * @returns {string}
 */
export function normalizzaPersona(nome) {
  const grezzo = (nome || '').trim();
  if (!grezzo) return '';
  return elencoPersone().find(p => chiave(p) === chiave(grezzo)) || grezzo;
}

/**
 * Ricorda un nome scritto a mano, se è nuovo. Restituisce il nome
 * normalizzato, che è quello da salvare sul task.
 * @param {string|null|undefined} nome
 * @returns {string}
 */
export function ricordaPersona(nome) {
  const grezzo = (nome || '').trim();
  if (!grezzo) return '';
  const noto = normalizzaPersona(grezzo);
  if (noto !== grezzo) return noto;
  if (PERSONE_REGISTRO.some(p => chiave(p) === chiave(grezzo))) return noto;
  const attuali = aggiunte();
  if (!attuali.some(p => chiave(p) === chiave(grezzo))) writePref(CHIAVE_AGGIUNTE, [...attuali, grezzo]);
  return grezzo;
}
