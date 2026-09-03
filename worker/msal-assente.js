/**
 * worker/msal-assente.js
 * MSAL, che nel connettore remoto non esiste.
 *
 * `src/taskStore.js` sa procurarsi da sé il suo trasporto (`import('./api.js')`)
 * per quando lo usa l'app nel browser: di lì si arriva a `auth.js`, e da lì a
 * MSAL. Chi gira fuori dal browser quel ramo non lo esegue mai — `mente-graph.mjs`
 * inietta il trasporto con `usaDrive()` appena viene importato — ma chi
 * costruisce il pacchetto non lo sa, e si porterebbe dietro duecentosessanta
 * chilobyte di libreria per un browser che qui non c'è.
 *
 * Il `[alias]` in wrangler.toml manda quel ramo qui. Se un giorno qualcosa
 * dovesse davvero eseguirlo, meglio un errore che lo dice di un
 * comportamento inspiegabile: nel Worker l'accesso è un refresh token, e sta
 * in `worker/archivio.js`.
 */

const spiega = () => {
  throw new Error(
    'MSAL non esiste nel connettore remoto: qui non c\'è un browser e non c\'è un utente ' +
    'che accede. Il token è un refresh token custodito in KV (worker/archivio.js), e il ' +
    'trasporto lo inietta mente-graph.mjs con usaDrive().'
  );
};

export class PublicClientApplication {
  constructor() { spiega(); }
}

export class InteractionRequiredAuthError extends Error {}
