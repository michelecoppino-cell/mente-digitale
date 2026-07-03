// Convenzione PARA: in ogni taccuino (workbook) l'utente crea al più tre
// sezioni dal nome letterale fisso qui sotto. Tutte le altre sezioni sono
// considerate "progetti attivi" — nessuna configurazione aggiuntiva richiesta,
// basta rispettare i nomi.
export const PARA_SECTION_NAMES = {
  area: 'Area/Ricorrenti',
  resources: 'Risorse/Idee',
  archive: 'Archivio',
};

const ROLE_BY_LOWER_NAME = Object.fromEntries(
  Object.entries(PARA_SECTION_NAMES).map(([role, name]) => [name.toLowerCase(), role])
);

// 'area' | 'resources' | 'archive' | null (progetto)
export function sectionRole(displayName) {
  return ROLE_BY_LOWER_NAME[(displayName || '').toLowerCase()] || null;
}

export function isParaSection(displayName) {
  return sectionRole(displayName) !== null;
}
