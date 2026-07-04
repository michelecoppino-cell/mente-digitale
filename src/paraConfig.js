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

// 'area' | 'resources' | 'archive' | null (progetto)
export function sectionRole(displayName) {
  const name = (displayName || '').toUpperCase();
  for (const [role, prefixes] of Object.entries(PARA_SECTION_PREFIXES)) {
    if (prefixes.some(prefix => name.startsWith(prefix))) return role;
  }
  return null;
}

export function isParaSection(displayName) {
  return sectionRole(displayName) !== null;
}
