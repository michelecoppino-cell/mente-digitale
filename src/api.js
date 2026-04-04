import { getToken } from './auth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function call(path) {
  const token = await getToken();
  const r = await fetch(GRAPH + path, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`Graph error ${r.status}`);
  return r.json();
}

export async function getNotebooks() {
  // Un unico endpoint che restituisce sia personali che condivisi
  const d = await call('/me/onenote/notebooks?includePersonalNotebooks=true&$orderby=displayName');
  return d.value;
}

export async function getSections(notebookId) {
  const d = await call(`/me/onenote/notebooks/${notebookId}/sections?$orderby=displayName`);
  return d.value;
}

export async function getPages(sectionId) {
  const d = await call(`/me/onenote/sections/${sectionId}/pages?$orderby=lastModifiedDateTime desc&$top=8`);
  return d.value;
}
