// Azure App Registration — stesso client ID di Mente Digitale
// Aggiungi il redirect URI di questa app nel portale Azure: https://portal.azure.com
export const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
export const REDIRECT_URI = window.location.origin + '/';
export const SCOPES = ['Tasks.ReadWrite', 'Files.ReadWrite'];

export const STATO_COLORS = {
  offerta:   '#a084c8',
  in_corso:  '#7eb8c9',
  sospesa:   '#c8a96e',
  chiusa:    '#86c07a',
  archiviata:'#888',
};

export const ELABORATO_COLORS = {
  in_corso:    '#7eb8c9',
  in_revisione:'#c8a96e',
  emesso:      '#86c07a',
  approvato:   '#c084a0',
  superato:    '#666',
};

export const PRIORITA_COLORS = {
  alta:   '#c07a7a',
  media:  '#c8a96e',
  bassa:  '#7eb8c9',
};
