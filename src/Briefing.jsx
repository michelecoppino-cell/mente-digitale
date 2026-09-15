// @ts-check
// La scheda «Briefing»: quello che il compito delle cinque ha scritto stanotte.
//
// Due metà, e sono diverse apposta. In alto le **proposte**, che sono l'unica
// cosa con cui si interagisce: ognuna col suo perché e due bottoni, Approva e
// Scarta. Sotto il **resto** — la giornata, gli ultimi giorni, le notizie, le
// curiosità — in sola lettura, che è tutto quello che deve fare.
//
// La regola che tiene in piedi la scheda: **niente finisce a piano da solo**.
// Il briefing propone, e finché nessuno tocca Approva il piano del giorno resta
// esattamente com'era. Un piano che si riempie da solo mentre dormi è un piano
// di cui non ci si fida più, e la prima volta che ci si trova dentro una cosa
// che non si è messa lo si smette di guardare.
//
// L'altra regola, che vale per ogni dato che arriva da fuori: **si guarda di
// che giorno è**. Il briefing lo scrive un PC che può essere spento, e uno di
// ieri messo a schermo senza dirlo si legge come se fosse di stamattina.

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadBriefing, saveBriefing } from './api';
import { qk, STALE } from './queryClient';
import { ymd } from './tempo';
import { genId } from './planner/griglia';
import {
  normalizzaBriefing, etaBriefing, eDelGiorno, contaProposte, conEsito,
  primaOraLibera, bloccoDaProposta, AREE_NOTIZIE, AREE_CURIOSITA,
} from './briefing';
import './Briefing.css';

const fmtGiorno = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * @param {object} props
 * @param {Record<string, any>} [props.plans]                 i piani del giorno, come li ha App
 * @param {(next: Record<string, any>) => void} [props.onPlansChanged]  la stessa scrittura del Piano
 * @param {any[]} [props.todoLists]                           per risalire dalla sezione al suo id
 */
export default function Briefing({ plans, onPlansChanged, todoLists }) {
  const queryClient = useQueryClient();
  const oggi = ymd();

  const { data: grezzo, isLoading, error, refetch } = useQuery({
    queryKey: qk.briefing(),
    queryFn: loadBriefing,
    staleTime: STALE.briefing,
  });

  const doc = useMemo(() => normalizzaBriefing(grezzo), [grezzo]);
  const eta = useMemo(() => etaBriefing(doc), [doc]);
  const diOggi = eDelGiorno(doc, oggi);
  const conti = contaProposte(doc);

  /** L'ultimo esito scritto, per poterlo raccontare senza rileggere il file. */
  const [inVolo, setInVolo] = useState(/** @type {string|null} */ (null));
  const [avviso, setAvviso] = useState('');

  /**
   * Scrive l'esito nel documento: prima a schermo, poi su OneDrive.
   * @param {any} docNuovo
   */
  async function salva(docNuovo) {
    queryClient.setQueryData(qk.briefing(), docNuovo);
    try {
      await saveBriefing(docNuovo);
    } catch (e) {
      console.error('salvataggio briefing', e);
      setAvviso('Non sono riuscito a salvare la scelta: riprova fra un momento.');
      refetch();
    }
  }

  /**
   * Approva una proposta: mette il blocco nel piano di oggi e segna la scelta.
   *
   * L'ora è quella proposta stanotte, ma solo se è ancora libera: fra le cinque
   * e adesso possono essere comparse una riunione o un blocco messo a mano, e
   * due blocchi accavallati sono un errore, non una sovrapposizione da
   * disegnare. Se è occupata si scende al primo buco — chi approva vuole quella
   * cosa nella giornata, non a quell'ora esatta — e glielo si dice.
   *
   * @param {any} proposta
   */
  async function approva(proposta) {
    if (!doc || inVolo) return;
    setAvviso('');
    setInVolo(proposta.id);
    try {
      const piano = plans?.[oggi] || { date: oggi, blocks: [] };
      const blocchi = piano.blocks || [];
      const ora = primaOraLibera(blocchi, proposta.ora || '09:00', proposta.durataMin);
      if (!ora) {
        setAvviso(`«${proposta.titolo}» non ci sta più: la giornata è piena. Spostala dal Piano.`);
        return;
      }
      const blocco = bloccoDaProposta(proposta, ora, genId());
      // La lista il briefing la nomina; l'id ce l'ha solo l'app. Serve al blocco
      // per poter poi spuntare il task vero da «Oggi».
      const lista = (todoLists || []).find(l => l.displayName === proposta.lista);
      if (lista) blocco.listId = lista.id;

      onPlansChanged?.({
        ...plans,
        [oggi]: {
          ...piano,
          blocks: [...blocchi, blocco].sort((a, b) => a.startTime.localeCompare(b.startTime)),
        },
      });
      if (ora !== proposta.ora && proposta.ora) {
        setAvviso(`Alle ${proposta.ora} c'era già qualcosa: «${proposta.titolo}» è andata alle ${ora}.`);
      }
      await salva(conEsito(doc, proposta.id, 'approvata'));
    } finally {
      setInVolo(null);
    }
  }

  /** @param {any} proposta */
  async function scarta(proposta) {
    if (!doc || inVolo) return;
    setAvviso('');
    setInVolo(proposta.id);
    try {
      await salva(conEsito(doc, proposta.id, 'scartata'));
    } finally {
      setInVolo(null);
    }
  }

  /**
   * Rimette in gioco una proposta già decisa. Se era stata approvata, toglie
   * anche il blocco che aveva messo: lasciarlo lì vorrebbe dire una scelta
   * annullata a metà, che è peggio di non poterla annullare.
   * @param {any} proposta
   */
  async function annulla(proposta) {
    if (!doc || inVolo) return;
    setAvviso('');
    setInVolo(proposta.id);
    try {
      if (proposta.esito === 'approvata') {
        const piano = plans?.[oggi];
        const blocchi = piano?.blocks || [];
        // Si toglie il blocco di quel titolo non ancora spuntato: se nel
        // frattempo è stato completato resta dov'è, perché è lavoro fatto.
        const via = [...blocchi].reverse()
          .find((/** @type {any} */ b) => b.taskTitle === proposta.titolo && !b.completed);
        if (via) {
          onPlansChanged?.({
            ...plans,
            [oggi]: { ...piano, blocks: blocchi.filter((/** @type {any} */ b) => b.id !== via.id) },
          });
        }
      }
      await salva(conEsito(doc, proposta.id, null));
    } finally {
      setInVolo(null);
    }
  }

  // ── Gli stati in cui non c'è niente da mostrare ───────────────────────────

  if (isLoading) return <div className="brief-attesa muted">Carico il briefing…</div>;

  if (error) {
    return (
      <Vuoto
        titolo="Il briefing non si è aperto"
        righe={['OneDrive non ha risposto. Il documento è suo, non di questa schermata: riprovare di solito basta.']}
        azione={<button className="brief-btn" onClick={() => refetch()}>Riprova</button>}
      />
    );
  }

  if (!doc) {
    return (
      <Vuoto
        titolo="Stanotte non è arrivato niente"
        righe={[
          'Il briefing lo scrive alle cinque il compito sul PC di lavoro. Se quella macchina era spenta, o la sessione scollegata, il compito non è partito.',
          'Non c\'è niente da aggiustare qui: si rifà a mano in un minuto, da quel PC.',
        ]}
      />
    );
  }

  return (
    <div className="brief">
      <header className="brief-testa">
        <div>
          <div className="eyebrow">Briefing</div>
          <h1 className="brief-titolo">
            {doc.data ? fmtGiorno.format(new Date(`${doc.data}T12:00:00`)) : 'Briefing del mattino'}
          </h1>
        </div>
        {!diOggi && (
          <p className="brief-vecchio">
            È il briefing di {doc.data ? fmtGiorno.format(new Date(`${doc.data}T12:00:00`)) : 'un altro giorno'},
            non di oggi{eta ? ` — scritto ${eta.ore} ore fa` : ''}. Stanotte non ne è stato scritto uno:
            le proposte qui sotto parlano di una giornata passata.
          </p>
        )}
      </header>

      {avviso && <p className="brief-avviso" role="status">{avviso}</p>}

      {/* Tre gruppi, e l'ordine in cui sono scritti è quello in cui si leggono
          da telefono, dove la griglia diventa una colonna sola: prima quello
          che chiede una decisione, poi il contesto, in fondo la lettura. */}
      <div className="brief-colonne">
      <div className="brief-col c-lavoro">
      {doc.giornata && (
        <section className="brief-sez">
          <p className="brief-prosa">{doc.giornata}</p>
        </section>
      )}

      {!!conti.totale && (
        <section className="brief-sez">
          <h2 className="eyebrow brief-eyebrow">
            Proposte
            <span className="brief-conto">
              {conti.aperte.length
                ? `${conti.aperte.length} da decidere`
                : 'tutte decise'}
            </span>
          </h2>
          <p className="brief-nota">
            Niente va a piano finché non lo approvi tu.
          </p>
          <ul className="brief-proposte">
            {doc.proposte.map(p => (
              <li key={p.id} className={`brief-prop${p.esito ? ' e-decisa' : ''}`}>
                <div className="brief-prop-capo">
                  <span className="brief-prop-titolo">{p.titolo}</span>
                  <span className="brief-prop-quando">
                    {p.ora ? `${p.ora} · ` : ''}{durataDetta(p.durataMin)}
                  </span>
                </div>
                {p.perche && <p className="brief-prop-perche">{p.perche}</p>}
                {p.lista && <span className="brief-prop-lista">{p.lista}</span>}

                {p.esito ? (
                  <div className="brief-prop-esito">
                    <span className={p.esito === 'approvata' ? 'e-ok' : 'e-no'}>
                      {p.esito === 'approvata' ? 'Messa a piano' : 'Scartata'}
                    </span>
                    <button className="brief-btn brief-btn-piano" onClick={() => annulla(p)} disabled={!!inVolo}>
                      Annulla
                    </button>
                  </div>
                ) : (
                  <div className="brief-prop-azioni">
                    <button
                      className="brief-btn brief-btn-si"
                      onClick={() => approva(p)}
                      disabled={!!inVolo}
                    >
                      Approva
                    </button>
                    <button
                      className="brief-btn"
                      onClick={() => scarta(p)}
                      disabled={!!inVolo}
                    >
                      Scarta
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      </div>

      {/* Le curiosità stanno col contesto e non con le notizie: sono le cose
          che uno si segna, non la cronaca, e tenerle qui lascia alle notizie
          una colonna sola invece di due sbilanciate. */}
      <div className="brief-col c-giorni">
      {!!doc.recap.length && <Elenco titolo="Gli ultimi giorni" righe={doc.recap} />}

      {AREE_CURIOSITA.map(a => (
        doc.curiosita[a.chiave].length
          ? <Elenco key={a.chiave} titolo={a.label} righe={doc.curiosita[a.chiave]} />
          : null
      ))}


      {doc.domanda && (
        <section className="brief-sez">
          <p className="brief-domanda">{doc.domanda}</p>
        </section>
      )}
      </div>

      <div className="brief-col c-letture">
      {AREE_NOTIZIE.map(a => (
        doc.notizie[a.chiave].length
          ? <Elenco key={a.chiave} titolo={a.label} righe={doc.notizie[a.chiave]} />
          : null
      ))}

      </div>
      </div>

      <footer className="brief-piede muted">
        {doc.fonti.length
          ? `Scritto guardando: ${doc.fonti.join(', ')}.`
          : 'Scritto senza dichiarare le fonti.'}
        {eta ? ` ${eta.ore === 0 ? 'Meno di un\'ora fa' : `${eta.ore} ore fa`}.` : ''}
      </footer>
    </div>
  );
}

/** @param {{ titolo: string, righe: string[] }} props */
function Elenco({ titolo, righe }) {
  return (
    <section className="brief-sez">
      <h2 className="eyebrow brief-eyebrow">{titolo}</h2>
      <ul className="brief-righe">
        {righe.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </section>
  );
}

/**
 * Lo stato vuoto. È una schermata a sé e non una riga in grigio perché è
 * quella che si vede nei giorni storti, ed è lì che serve sapere *perché* non
 * c'è niente invece di dubitare dell'app.
 * @param {{ titolo: string, righe: string[], azione?: import('react').ReactNode }} props
 */
function Vuoto({ titolo, righe, azione }) {
  return (
    <div className="brief brief-vuoto">
      <div className="eyebrow">Briefing</div>
      <h1 className="brief-titolo">{titolo}</h1>
      {righe.map((r, i) => <p key={i} className="brief-prosa">{r}</p>)}
      {azione}
    </div>
  );
}

/** @param {number} min @returns {string} «45 minuti», «1h30» */
function durataDetta(min) {
  if (min < 60) return `${min} minuti`;
  const ore = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${ore}h${String(resto).padStart(2, '0')}` : `${ore}h`;
}
