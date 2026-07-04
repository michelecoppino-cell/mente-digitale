// Convenzione PARA: in ogni taccuino (workbook) le sezioni il cui nome inizia
// con uno dei prefissi qui sotto vengono assegnate al ruolo corrispondente
// (es. "ARC-AUTO" e "ARC-LORENZO" → archive). OneNote non accetta "/" nei nomi
// sezione, quindi si usa un prefisso invece del nome letterale fisso. Tutte le
// altre sezioni sono considerate "progetti attivi" — nessuna configurazione
// aggiuntiva richiesta, basta rispettare i prefissi.
export const PARA_SECTION_PREFIXES = {
  area: ['AREA'],
  resources: ['RIS-', 'IDEE-'],
  archive: ['ARC-'],
};

function matchPrefix(displayName) {
  const name = (displayName || '').toUpperCase();
  for (const [role, prefixes] of Object.entries(PARA_SECTION_PREFIXES)) {
    const prefix = prefixes.find(p => name.startsWith(p));
    if (prefix) return { role, prefix };
  }
  return null;
}

// 'area' | 'resources' | 'archive' | null (progetto)
export function sectionRole(displayName) {
  return matchPrefix(displayName)?.role || null;
}

export function isParaSection(displayName) {
  return sectionRole(displayName) !== null;
}

// Nome sezione depurato dal prefisso PARA (es. "ARC-AUTO" → "AUTO"), usato
// come etichetta al posto del nome del taccuino nella vista PARA. Se la
// sezione non è PARA, o non resta nulla dopo il prefisso, ritorna il nome
// originale.
export function paraSectionLabel(displayName) {
  const name = displayName || '';
  const match = matchPrefix(name);
  if (!match) return name;
  const rest = name.slice(match.prefix.length).replace(/^[\s\-_]+/, '');
  return rest || name;
}
