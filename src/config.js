// Data della build (iniettata da Vite): la schermata di login la mostra, così
// da iPhone si vede subito se il telefono sta girando l'ultimo deploy.
export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME || null;
export const CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50';
export const REDIRECT_URI = window.location.origin + '/';
// Account Microsoft personale usato di default: evita lo chooser dei 3 account
// anche al primo accesso su un dispositivo nuovo (nessuna cache locale ancora).
export const PREFERRED_LOGIN_HINT = 'michelecoppino@gmail.com';
// `offline_access` è scritto qui invece di lasciarlo ai default impliciti di
// MSAL: è lo scope che fa rilasciare il refresh token, cioè la differenza fra
// «l'accesso dura un'ora» e «l'accesso dura finché Microsoft lo rinnova».
// `Calendars.ReadWrite` copre solo i calendari di cui l'utente è proprietario:
// un calendario condiviso da un'altra persona compare lo stesso in
// /me/calendars (quindi nel filtro "Calendari" del Piano), ma la lettura dei
// suoi eventi viene rifiutata — il calendario c'è, gli eventi no. Serve
// `Calendars.Read.Shared`, che è l'unico dei due permessi ".Shared"
// consentibile anche dagli account Microsoft personali
// (`Calendars.ReadWrite.Shared` è solo work/school). In sola lettura: gli
// eventi dei calendari altrui si vedono, non si modificano.
// Aggiungere uno scope significa un nuovo consenso: al primo avvio dopo
// l'aggiornamento l'app chiede di riconnettersi una volta.
export const SCOPES = ['offline_access', 'Notes.Read', 'Notes.Read.All', 'Notes.ReadWrite', 'Tasks.Read', 'Tasks.ReadWrite', 'Calendars.ReadWrite', 'Calendars.Read.Shared', 'Files.ReadWrite', 'Mail.Read'];
export const COLORS = [
  '#7eb8c9','#c084a0','#86c07a',
  '#c8a96e','#a084c8','#c8907a','#7ab8a0'
];
