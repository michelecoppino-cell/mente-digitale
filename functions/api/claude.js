// L'unica funzione server di questa app: /api/claude
//
// Per anni qui non c'era niente, e il README se ne vantava: «nessun dato transita
// da un backend proprio». Resta vero per tutto il resto — OneNote, To-Do,
// calendario, OneDrive, il diario, Finanze — e continua a esserlo per scelta.
// Questa funzione esiste perché una chiave API non può stare nel codice del
// browser: chiunque apra gli strumenti di sviluppo la vedrebbe e potrebbe
// spenderla. Quindi il modello si chiama da qui, e da nessun altro posto.
//
// Due compiti, entrambi avviati da un gesto esplicito (un pulsante), mai da soli:
//
//   chiarisci   un pensiero grezzo → una proposta di destinazione nel diagramma
//               GTD, con titolo e stima. Proposta: la premi tu.
//   diario      l'estratto che «Copia per l'AI» compone già → una risposta,
//               dentro l'app, invece di doverla andare a incollare altrove.
//
// ── Chi può chiamarla ───────────────────────────────────────────────────────
// Una funzione aperta che spende soldi è un rubinetto aperto. Qui serve il token
// Microsoft che l'app ha già in mano: la funzione lo verifica contro Graph e
// controlla che l'account sia quello dichiarato in UTENTE_AUTORIZZATO. Senza
// entrambe le variabili d'ambiente la funzione si dichiara spenta e l'app
// nasconde i due pulsanti — è il motivo per cui il GET esiste.
//
// Nota: nessun `// @ts-check`. `jsconfig.json` include solo `src`, quindi questo
// file non passa dal type-check; annotarlo darebbe una falsa sicurezza. Il
// contratto vero è in src/ai.js, che è controllato.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';

/** Quanto testo si accetta. Un limite qui è anche un limite di spesa. */
const MAX_PENSIERO = 4000;
const MAX_ESTRATTO = 60000;

/**
 * @param {any} dati
 * @param {number} [status]
 */
function json(dati, status = 200) {
  return new Response(JSON.stringify(dati), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Una risposta del modello non va in nessuna cache: né del browser, né di
      // Cloudflare. È il contenuto del diario di una persona.
      'cache-control': 'no-store',
    },
  });
}

/** @param {any} env */
function configurata(env) {
  return Boolean(env?.ANTHROPIC_API_KEY && env?.UTENTE_AUTORIZZATO);
}

/**
 * La sonda di capacità: l'app la chiama all'apertura dei pannelli interessati e
 * mostra i pulsanti solo se qui risponde `attivo`. Non tocca la chiave, non
 * costa niente, non richiede autenticazione — dice solo se la funzione è stata
 * configurata.
 */
export function onRequestGet({ env }) {
  return json({ attivo: configurata(env) });
}

/**
 * Verifica il token Microsoft e l'account. Restituisce `null` se va bene, il
 * motivo del rifiuto altrimenti.
 */
async function autorizza(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return 'Manca il token Microsoft.';

  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail', {
    headers: { authorization: auth },
  });
  if (!r.ok) return 'Il token Microsoft non è valido o è scaduto.';

  const me = await r.json();
  const consentiti = String(env.UTENTE_AUTORIZZATO).toLowerCase()
    .split(',').map(s => s.trim()).filter(Boolean);
  const miei = [me.id, me.userPrincipalName, me.mail]
    .filter(Boolean).map(v => String(v).toLowerCase());

  return miei.some(v => consentiti.includes(v))
    ? null
    : 'Questo account Microsoft non è fra quelli autorizzati a usare l\'AI.';
}

/** Il primo blocco di testo della risposta. */
function testoDi(risposta) {
  const blocco = (risposta?.content || []).find(b => b.type === 'text');
  return blocco?.text || '';
}

// ── chiarisci ───────────────────────────────────────────────────────────────
// Il diagramma di «Chiarire» è già nell'app e non cambia: Inbox → è un'azione? →
// meno di due minuti? → dove la metto. Quello che il modello fa è percorrerlo
// una volta e dire dove sarebbe andato lui, con un titolo che comincia per verbo
// e una stima. Il gesto finale — premere la foglia — resta della persona: è la
// differenza fra un suggerimento e un'automazione che sposta le cose da sola.

const SCHEMA_PROPOSTA = {
  type: 'object',
  properties: {
    azionabile: { type: 'boolean' },
    dueMinuti: { type: 'boolean' },
    ramo: { type: 'string', enum: ['cestino', 'falla', 'progetti', 'risorse', 'aree'] },
    destinazione: { type: 'string' },
    titolo: { type: 'string' },
    stimaMinuti: { type: 'integer', enum: [5, 15, 30, 45, 60, 120, 240] },
    perche: { type: 'string' },
  },
  required: ['azionabile', 'dueMinuti', 'ramo', 'destinazione', 'titolo', 'stimaMinuti', 'perche'],
  additionalProperties: false,
};

const ISTRUZIONI_CHIARISCI = `Aiuti una persona a chiarire un pensiero appena catturato, seguendo il diagramma "Chiarire" di Getting Things Done adattato al metodo PARA.

Percorri il diagramma nell'ordine:
1. È un'azione? Se no, è materiale di riferimento: va salvato come pagina di appunti (ramo progetti/risorse/aree, azionabile = false).
2. Se è un'azione, richiede meno di due minuti? Se sì, ramo "falla".
3. Altrimenti è un'attività da mettere in una lista: ramo progetti, risorse o aree.
4. Se non è né un'azione né qualcosa da conservare, ramo "cestino".

Come scegliere il ramo PARA:
- progetti: ha un esito definito e una fine (una tesi, un trasloco, un acquisto).
- aree: una responsabilità che non finisce e ritorna (casa, salute, famiglia, un abbonamento da rinnovare).
- risorse: un'idea, un interesse, qualcosa da approfondire senza scadenza.

Regole sul contenuto:
- "destinazione" deve essere ESATTAMENTE uno dei nomi elencati per il ramo scelto, copiato lettera per lettera. Se nessuno è adatto, o se il ramo è "cestino" o "falla", usa la stringa vuota.
- "titolo" è la prossima azione fisica concreta, che comincia con un verbo all'infinito, al massimo 60 caratteri, senza punto finale. Per il materiale di riferimento è invece il titolo della pagina.
- "stimaMinuti" è quanto tempo ci vuole davvero, non quanto sarebbe comodo.
- "perche" è una sola frase, breve, in italiano, che spiega la scelta a chi ha scritto il pensiero. Niente elenchi, niente preamboli.

Rispondi in italiano.`;

async function chiarisci(client, corpo) {
  const testo = String(corpo?.testo || '').trim().slice(0, MAX_PENSIERO);
  if (!testo) return json({ errore: 'Non c\'è niente da chiarire.' }, 400);

  const dest = corpo?.destinazioni || {};
  const elenco = ['progetti', 'risorse', 'aree'].map(ramo => {
    const nomi = Array.isArray(dest[ramo]) ? dest[ramo].filter(Boolean).slice(0, 60) : [];
    return `${ramo}: ${nomi.length ? nomi.join(' · ') : '(nessuna destinazione disponibile)'}`;
  }).join('\n');

  const risposta = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: ISTRUZIONI_CHIARISCI,
    thinking: { type: 'adaptive' },
    output_config: {
      // Una classificazione breve: la profondità di ragionamento serve poca, e
      // qui la latenza si vede — la finestra è aperta e la persona aspetta.
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA_PROPOSTA },
    },
    messages: [{
      role: 'user',
      content: `Destinazioni disponibili, per ramo:\n${elenco}\n\nIl pensiero da chiarire:\n"""\n${testo}\n"""`,
    }],
  });

  if (risposta.stop_reason === 'refusal') {
    return json({ errore: 'Il modello ha preferito non rispondere su questo testo.' }, 422);
  }

  try {
    return json({ proposta: JSON.parse(testoDi(risposta)) });
  } catch {
    // Con output_config.format non dovrebbe succedere: se succede è meglio dirlo
    // che mostrare una proposta a metà.
    return json({ errore: 'La proposta è arrivata in un formato che non so leggere.' }, 502);
  }
}

// ── diario ──────────────────────────────────────────────────────────────────
// «Copia per l'AI» compone già tutto: il contesto, la richiesta scelta col
// preset, le voci del periodo, e la Bussola se la si include. Quel markdown era
// fatto per essere incollato in un'altra chat; qui viene mandato così com'è e la
// risposta torna dentro l'app. Il prompt di sistema aggiunge solo le due cose
// che il markdown non può dire da sé: come stare in questa conversazione, e
// dove smettere.

const ISTRUZIONI_DIARIO = `Stai leggendo l'estratto del diario personale di chi ti scrive. Lo condivide lui, di sua volontà, e ti dice nel testo stesso che tipo di risposta gli serve: seguila.

Come rispondere:
- In italiano, dandogli del tu, in prosa. Markdown solo se serve davvero (qualche grassetto, un elenco corto); niente titoli, niente riassunti dell'incarico, niente "certo, ecco".
- Parti da quello che c'è scritto, citandolo quando aiuta. Non inventare fatti che non ci sono e non addolcire quelli che ci sono.
- Non fingerti terapeuta e non usare il tono del manuale di crescita personale. Un diario incollato a un modello non è una terapia, e va detto se serve dirlo.
- Se leggi segnali seri — pensieri di farsi male, disperazione che dura, abuso di sostanze, violenza subita — dillo con franchezza e senza allarmismo, e suggerisci di parlarne con una persona reale: qualcuno di cui si fida, il medico di base, o il Telefono Amico Italia al 02 2327 2327.
- Sta' sotto le 400 parole, a meno che la richiesta nel testo ne chieda esplicitamente di più.`;

async function diario(client, corpo) {
  const markdown = String(corpo?.markdown || '').trim();
  if (!markdown) return json({ errore: 'Non c\'è nessuna voce da leggere.' }, 400);
  if (markdown.length > MAX_ESTRATTO) {
    return json({ errore: `L'estratto è troppo lungo (${markdown.length} caratteri, il massimo è ${MAX_ESTRATTO}). Scegli un periodo più corto.` }, 413);
  }

  const domanda = String(corpo?.domanda || '').trim().slice(0, 1000);
  const contenuto = domanda ? `${markdown}\n\n---\n\nE in più, questo: ${domanda}` : markdown;

  const richiesta = {
    model: MODEL,
    max_tokens: 4000,
    system: ISTRUZIONI_DIARIO,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: contenuto }],
  };

  let risposta;
  try {
    // Un diario può contenere pagine molto brutte, ed è esattamente quando serve
    // una risposta che il rifiuto fa più male. Con i fallback lato server, se il
    // modello declina la richiesta viene rigiocata su un altro dentro la stessa
    // chiamata.
    risposta = await client.beta.messages.create({
      ...richiesta,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (e) {
    // Se il parametro non è disponibile su questo account, la richiesta normale
    // funziona comunque: meglio una risposta senza rete di sicurezza che nessuna.
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    risposta = await client.messages.create(richiesta);
  }

  if (risposta.stop_reason === 'refusal') {
    return json({
      errore: 'Il modello ha preferito non rispondere a questo estratto. Se c\'è qualcosa di pesante fra queste righe, vale la pena dirlo a una persona: qualcuno di cui ti fidi, il tuo medico, o il Telefono Amico Italia (02 2327 2327).',
    }, 422);
  }

  return json({ risposta: testoDi(risposta), troncata: risposta.stop_reason === 'max_tokens' });
}

// ── L'ingresso ──────────────────────────────────────────────────────────────

const COMPITI = { chiarisci, diario };

export async function onRequestPost({ request, env }) {
  if (!configurata(env)) {
    return json({ errore: 'L\'AI non è configurata su questo deploy.' }, 503);
  }

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ errore: 'Corpo della richiesta illeggibile.' }, 400);
  }

  const compito = COMPITI[corpo?.compito];
  if (!compito) return json({ errore: 'Compito sconosciuto.' }, 400);

  const negato = await autorizza(request, env);
  if (negato) return json({ errore: negato }, 401);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    return await compito(client, corpo);
  } catch (e) {
    // I messaggi sono per una persona sola, che è anche l'unica a poter
    // rimediare: dire quale delle tre cose è andata storta le fa risparmiare
    // mezz'ora.
    if (e instanceof Anthropic.AuthenticationError) {
      return json({ errore: 'La chiave API di Anthropic non è valida. Controllala fra le variabili di Cloudflare Pages.' }, 502);
    }
    if (e instanceof Anthropic.RateLimitError) {
      return json({ errore: 'Troppe richieste al modello in poco tempo. Riprova fra un minuto.' }, 429);
    }
    if (e instanceof Anthropic.APIError) {
      return json({ errore: `Il modello ha risposto con un errore (${e.status}).` }, 502);
    }
    return json({ errore: 'Non sono riuscito a raggiungere il modello.' }, 502);
  }
}

// Nessun `onRequest` generico di proposito: esportarlo insieme ai due handler
// per metodo è ambiguo, e a Pages basta non trovare il metodo per rispondere 405
// da sé.
