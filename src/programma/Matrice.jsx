// @ts-check
// La matrice del carico: una colonna per settimana, una riga per **pacchetto**.
//
// È il pezzo difficile del Programma, e le decisioni prese qui dentro sono
// tutte sullo stesso problema: **queste celle si compilano cento volte**, quindi
// ogni gesto che costa un giro di mouse in più si paga cento volte.
//
// **Le righe sono il lavoro, non le persone.** È l'esatto contrario della
// scheda Persone, ed è voluto: là la domanda è «a questa persona quanto ho già
// dato», qui è «questo pacchetto quando si fa, e chi ci sta sopra». Prima
// erano tutt'e due per persona, e la domanda sul lavoro non aveva una vista
// sua: per sapere quante ore c'erano su un pacchetto in una settimana bisognava
// aprire tutte le righe e sommare a mente le sotto-righe con lo stesso nome.
//
// **La riga chiusa è il totale del pacchetto su tutte le persone**, aperta si
// spezza in una sotto-riga per persona — e solo le persone che su quel
// pacchetto hanno qualcosa (o che una voce ci propone). Con dodici pacchetti e
// sei persone le righe sarebbero settantadue: quello che si guarda a colpo
// d'occhio è quando cade il lavoro, il dettaglio si apre dove serve. Aprendola,
// i suoi numeri passano alle righe che ha sotto e la sua resta il nome: una
// somma che si vede già scomposta due righe più in basso è la stessa cosa
// scritta due volte.
//
// **Si scrive dove la destinazione esiste.** Su una riga di somma le ore
// andrebbero a quale persona? Quando la risposta è ovvia — una persona sola sul
// pacchetto o sulla voce, oppure il filtro acceso su una — la riga si compila.
// Negli altri casi la cella non dà errore, **scende di un livello**: l'apertura
// *è* la risposta.
//
// **La catena è pacchetto › voce › sotto-voce › persona**, e tre bottoni nella
// barra — «voci», «sottovoci», «persone» — dicono quali di quei livelli si
// vedono. Spenti tutti e tre resta la sola riga del pacchetto, che è la vista
// da cui si guarda l'andamento della commessa; accesi tutti e tre si scende
// fino alla persona, che è la vista in cui si compila.
// La cella porta la voce nella sua chiave, quindi si programma dove il lavoro è
// davvero descritto — «Calcolo plinti, Marco, W35: 34 ore» — invece che su un
// pacchetto da quattrocento ore in cui non si distingue più cosa è cosa.
//
// **I numeri stanno solo nell'ultimo livello mostrato.** Prima ogni riga
// portava la somma di quello che aveva sotto, e aprendo tutto la stessa ora
// compariva quattro volte incolonnata — pacchetto, voce, sotto-voce, persona —
// su venti colonne: una schermata di numeri in cui non si distingueva più il
// dato dalla sua eco. Adesso una riga che ha delle figlie a schermo è un
// intestazione e basta: le sue somme sono le righe qui sotto, già a schermo,
// e ripeterle non aggiungeva niente. Chi vuole i totali del pacchetto chiude
// il pacchetto, ed è lo stesso gesto con cui li aveva aperti.
//
// **Si scrive dove i numeri si vedono**, cioè nell'ultimo livello mostrato.
// Sulla riga di una persona sempre, e le ore vanno nella cella più profonda in
// cui stanno già — mentre quella che sostituiscono si azzera: sono le stesse
// ore, e tenerle in due posti raddoppierebbe la settimana. Su una riga di voce
// o di pacchetto solo quando la persona è ovvia: una sola, o il filtro acceso.
// Altrimenti la destinazione non esiste — a quale persona andrebbero quelle
// ore? — e scrivere scende di un livello invece di sceglierne una al posto di
// chi ce le aveva messe.
//
// **Le ore date al pacchetto e basta le adotta la voce che propone quella
// persona.** Sono le celle di prima che le voci esistessero, e quelle che ci
// arrivano dal consuntivo. Restavano in coda al pacchetto perché nessuno poteva
// dire a quale voce andassero — ma la voce lo dice: se in un pacchetto una sola
// voce propone Riccardo, quelle ore sono di quella voce, e vederle in fondo
// mentre la riga aperta resta a zero rende illeggibile la schermata che si è
// appena aperta. Chi nessuna voce reclama tiene la sua riga in coda, marcata
// «sul pacchetto»: sparire da una schermata e continuare a pesare sui totali è
// la cosa che quelle ore non devono fare.
//
// **La tinta della saturazione resta quella della persona, non della cella.**
// In una sotto-riga il numero sono le ore di quella persona *su questo
// pacchetto*, ma il rosso continua a voler dire una cosa sola — quella persona,
// quella settimana, è oltre la sua capacità contando tutto quello che ha
// addosso in questa commessa. Colorare sul numero della cella direbbe che chi
// ha dieci ore su un pacchetto sta bene, anche con altre trenta due righe più
// sotto: è esattamente l'allarme che serve, e si perderebbe girando la tabella.
//
// **La settimana corrente è una linea, non un riempimento.** Taglia la matrice
// in due — a sinistra lo speso, a destra la previsione — ed è la cosa che dà
// senso ai numeri della testata, quindi deve restare riconoscibile mentre si
// scorre senza coprire il numero che c'è nella cella.
//
// **L'annulla non è un lusso.** Un trascinamento sbagliato riscrive un mese in
// un secondo: senza ⌘Z la matrice diventa una cosa che si tocca con paura, e
// una matrice che si tocca con paura non la compila nessuno.
//
// **Dieci persone e un anno sono un'altra tabella.** Con tre risorse e sedici
// settimane tutto sta a schermo e non c'è niente da governare; con dieci righe
// e cinquanta colonne la stessa griglia diventa un tunnel — si scorre a destra
// per due schermate, si perde di vista la settimana di oggi, e la riga che si
// sta leggendo si confonde con le altre nove. Da lì la barra qui sopra, e sono
// tre gesti soli:
//
//   · **la densità** — la stessa griglia a tre larghezze di colonna. «Anno»
//     rimpicciolisce finché l'intera commessa ci sta in una schermata: non è
//     uno zoom estetico, è la differenza fra vedere l'andamento e ricostruirselo
//     scorrendo. «Comoda» fa l'opposto e si prende tutto lo spazio che c'è: con
//     dodici settimane su una finestra larga, le colonne fisse lasciavano metà
//     schermo vuoto a destra e i numeri stretti in un angolo.
//   · **una persona sola** — dieci pacchetti aperti sono sessanta sotto-righe.
//     Il più delle volte la domanda è su una persona, e allora le altre nove
//     sono rumore. Scegliendone una, anche i totali dei pacchetti diventano i
//     suoi: una riga chiusa che continuasse a sommare tutti non direbbe più
//     niente sul filtro acceso.
//
// E il filtro dei pacchetti della testata vale **dappertutto**: restano le sue
// righe, e i totali in fondo e in colonna sono i suoi. Un filtro che lascia in
// piedi somme di tutto il resto è peggio di nessun filtro, perché il numero
// sbagliato sembra giusto.
//
// E tre cose che si vedono e non si toccano: la riga e la colonna in cui si sta
// restano segnate mentre si scorre, le righe si alternano di fondo, e il primo
// lunedì di ogni mese porta una linea verticale. Sono i tre modi in cui si
// tiene il segno in una tabella grande, e nessuno costa un click.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lunediDellaSettimana } from '../tempo.js';
import {
  chiaveCarico, destinazioneOre, livelloSaturazione, oreCella, oreRisorsaSettimana, orePacchettoSettimana,
  oreSottoRiga, oreVoceSettimana, oreVoci, ramoVoce, risorseDiPacchetto, risorseDiVoce,
  risorseSenzaVoce, vociDiPacchetto, perMese, spalma,
} from '../programma.js';
import { readPref, writePref } from '../viewPrefs.js';
import { oreBrevi, leggiOre } from './formato.js';
import { DENSITA, useDensita } from './densita.js';

/** @typedef {import('../programma.js').DocProgramma} DocProgramma */
/** @typedef {{ tipo: 'pacchetto'|'voce'|'risorsa', nome: string, risorsa: string|null, capacita: number, colore: string|null, pacchettoId: string, voceId: string|null, aperta: boolean, rientro: number, foglia: boolean, stimate: number, orfana?: boolean, estranea?: boolean }} Riga */

const CHIAVE_DETTAGLIO = 'md_pg_matrice_dettaglio_v1';
const CHIAVE_PERSONE = 'md_pg_matrice_persone_v1';

/** Quanto misurano, alla densità comoda, le due colonne che non sono settimane. */
const L_NOME = 220;
const L_TOT = 88;

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];


/** «mag» dal mese 'YYYY-MM'. @param {string} mese */
const nomeMese = mese => MESI[Number(mese.slice(5, 7)) - 1] || mese;

/**
 * @param {object} props
 * @param {DocProgramma} props.doc
 * @param {string[]} props.settimane
 * @param {string} props.settimanaOra
 * @param {string|null} props.pacchettoScelto  quando c'è, resta solo la sua riga — totali compresi
 * @param {(celle: Record<string, number>) => void} props.onCelle  le ore cambiate, tutte insieme
 * @param {() => void} props.onAnnulla
 * @param {(risorsa: string, pacchettoId: string) => void} [props.onSceltaRiga]
 * @param {(voceId: string) => void} [props.onSceltaVoce]  il clic su una riga di voce apre il suo dettaglio
 */
export default function Matrice({
  doc, settimane, settimanaOra, pacchettoScelto, onCelle, onAnnulla, onSceltaRiga, onSceltaVoce,
}) {
  const [aperte, setAperte] = useState(/** @type {string[]} */ ([]));
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [ancora, setAncora] = useState(/** @type {{r:number,c:number}|null} */ (null));
  const [bozza, setBozza] = useState(/** @type {string|null} */ (null));
  const [spalmatura, setSpalmatura] = useState(/** @type {string|null} */ (null));
  // La stessa densità della matrice per persona: sono le stesse colonne, e una
  // stretta e l'altra no sarebbero due tabelle diverse a guardarsi.
  const [densita, cambiaDensita] = useDensita();
  const [personaSola, setPersonaSola] = useState('');
  // I pacchetti che vanno in coda perché quella persona non ci ha ancora
  // niente. Si decidono **quando si sceglie la persona**, e da lì non si
  // muovono più: ricalcolarli a ogni modifica farebbe saltare in cima il
  // pacchetto in cui si è appena scritta la prima ora — proprio mentre ci si
  // sta scrivendo dentro — e la cella dopo sarebbe di un'altra riga.
  const [inCoda, setInCoda] = useState(/** @type {string[]} */ ([]));

  /** @param {string} nome */
  const scegliPersona = nome => {
    setPersonaSola(nome);
    setInCoda(nome
      ? doc.pacchetti.filter(p => !risorseDiPacchetto(doc, p.id).some(r => r.nome === nome))
        .map(p => p.id)
      : []);
  };
  // Quanti livelli di lavoro si vedono sotto un pacchetto: 0 nessuno, 1 le
  // lavorazioni, 2 anche le loro figlie. Si ricorda, perché è un modo di
  // guardare e non un gesto: chi programma leggendo le voci le vuole sempre.
  const [dettaglio, setDettaglio] = useState(() => {
    const salvato = readPref(CHIAVE_DETTAGLIO, 0);
    return typeof salvato === 'number' && salvato >= 0 && salvato <= 2 ? salvato : 0;
  });
  // E se sotto si scende fino alla persona. È il terzo gradino della stessa
  // scala, e si spegne: chi guarda l'andamento della commessa vuole i pacchetti
  // e le loro voci, non sei righe di nomi sotto ognuna. Spento insieme a
  // «voci», il pacchetto non ha più niente sotto e la matrice torna a essere
  // una riga per pacchetto — che è la vista da cui si guarda, e in cui si
  // compila la riga del pacchetto.
  const [mostraPersone, setMostraPersone] = useState(() => readPref(CHIAVE_PERSONE, true) !== false);
  const scorrevole = useRef(/** @type {HTMLDivElement|null} */ (null));
  const trascina = useRef(/** @type {'selezione'|'riempi'|null} */ (null));

  // Un pacchetto si apre solo se qualcosa dei tre bottoni gli mette qualcosa
  // sotto: spenti tutti e tre, il triangolino aprirebbe il nulla.
  const apribile = dettaglio > 0 || mostraPersone;

  // Le righe visibili: pacchetto › voce › sotto-voce › persona, potato dai
  // tre bottoni «voci», «sottovoci» e «persone». Le celle stanno in fondo
  // alla catena, cioè nell'ultimo livello che i bottoni lasciano vedere.
  const righe = useMemo(() => {
    /** @type {Riga[]} */
    const fila = [];
    const pacchetti = pacchettoScelto
      ? doc.pacchetti.filter(p => p.id === pacchettoScelto)
      : doc.pacchetti;

    /** Le righe di persona sotto una voce (o sotto il pacchetto, senza voce). */
    const persone = (/** @type {import('../programma.js').Risorsa[]} */ sue,
      /** @type {string} */ pacchettoId, /** @type {string|null} */ voceId,
      /** @type {number} */ rientro, /** @type {boolean} */ orfana = false) => {
      // Le ore rimaste sul pacchetto restano visibili anche col bottone
      // «persone» spento: nessuna voce le reclama, quindi spegnendo le persone
      // sparirebbero da ogni riga della tabella e continuerebbero a pesare sui
      // totali in fondo — che è la cosa che quelle ore non devono fare.
      if (!mostraPersone && !orfana) return;
      for (const r of sue) {
        if (personaSola && r.nome !== personaSola) continue;
        fila.push({
          tipo: 'risorsa', nome: r.nome, risorsa: r.nome, capacita: r.oreSettimana,
          colore: null, pacchettoId, voceId, aperta: false, rientro, orfana, foglia: true,
          // Una persona non ha una stima: le ore stimate stanno sulla voce,
          // che dice quanto pesa il lavoro e non chi lo fa.
          stimate: 0,
        });
      }
    };

    // Col filtro su una persona, i pacchetti in cui non ha ancora niente
    // **restano**, in coda e tenui. Prima sparivano, ed era il filtro a
    // togliere di mezzo l'unico posto in cui dargliene: scegliere una persona è
    // il modo di far comparire la sua riga sotto una voce, e su un pacchetto
    // nuovo quella riga non c'era da nessuna parte. In cima resta comunque
    // quello che fa davvero, che è la domanda per cui si accende il filtro.
    const estranea = (/** @type {import('../programma.js').Pacchetto} */ p) => (
      !!personaSola && inCoda.includes(p.id));
    const inFila = personaSola
      ? [...pacchetti].sort((a, b) => Number(estranea(a)) - Number(estranea(b)))
      : pacchetti;

    for (const p of inFila) {
      // Con «voci» e «persone» spenti sotto il pacchetto non c'è niente da
      // mostrare: la riga non si apre, e resta la matrice per pacchetti.
      const aperto = apribile && aperte.includes(p.id);
      const sue = personaSola
        ? doc.risorse.filter(r => r.nome === personaSola)
        : risorseDiPacchetto(doc, p.id);
      fila.push({
        tipo: 'pacchetto', nome: p.nome, estranea: estranea(p),
        // Chi scrive in questa riga lo decide la passata qui sotto, che sa
        // quali righe hanno davvero delle figlie a schermo.
        risorsa: null,
        capacita: 0, colore: p.colore, pacchettoId: p.id, voceId: null,
        aperta: aperto, rientro: 0, foglia: true,
        stimate: oreVoci(doc, v => v.pacchettoId === p.id),
      });
      if (!aperto) continue;

      if (!dettaglio) {
        persone(sue.length ? sue : doc.risorse.slice(0, 1), p.id, null, 1);
        continue;
      }

      // Guardando per voci, la catena è pacchetto › voce › sotto-voce ›
      // persona: le ore stanno in fondo, dove il lavoro è davvero descritto.
      const voci = vociDiPacchetto(doc, p.id, dettaglio);
      voci.forEach(({ voce, livello }, i) => {
        // Una voce è l'ultimo livello **delle voci** se la riga dopo non è una
        // sua figlia: solo lì la proposta di una persona vale una riga.
        const ultima = !(voci[i + 1] && voci[i + 1].livello > livello);
        const ramo = ramoVoce(doc, voce.id);
        fila.push({
          tipo: 'voce', nome: voce.titolo, risorsa: null, capacita: 0,
          colore: p.colore, pacchettoId: p.id, voceId: voce.id,
          aperta: false, rientro: livello + 1, foglia: true,
          // La stima di una voce è quella del suo ramo: le sotto-voci sono il
          // dettaglio della stessa stima, non un lavoro in più.
          stimate: oreVoci(doc, v => ramo.has(v.id)),
        });
        // Su una voce con figlie mostrate compaiono solo le persone che ci
        // hanno già delle ore: la proposta lì sarebbe una riga vuota in mezzo,
        // cioè un invito a scrivere le stesse ore due volte.
        //
        // Col filtro acceso la riga di quella persona compare dove la voce la
        // propone o dove ha delle ore, e **non** sotto ogni voce del
        // pacchetto: prima si forzava, e filtrando su Erika si vedeva la sua
        // riga vuota sotto «Calcolo» — una voce che non la riguarda — accanto
        // a quella vera sotto «Casseri». Un filtro che inventa righe è un
        // filtro che non risponde alla domanda per cui lo si accende; la riga
        // dove ancora non c'è niente la fa comparire l'attivazione della voce,
        // che è il gesto con cui una persona entra in una lavorazione.
        persone(risorseDiVoce(doc, voce.id, ultima), p.id, voce.id, livello + 2);
      });

      // Le ore date al pacchetto e basta: le celle di prima che ci fossero le
      // voci, e quelle che ci arrivano ancora oggi dal consuntivo — del
      // passato si sa il totale, non su quale voce sia caduto. Nessuno può
      // dire al posto di chi le ha scritte a quale voce andassero: restano
      // dove sono, visibili, invece di sparire da una schermata e continuare
      // a pesare sui totali.
      persone(risorseSenzaVoce(doc, p.id), p.id, null, 1, true);
    }

    // L'ultimo livello mostrato, riga per riga: la riga dopo, se è più
    // rientrata, è una sua figlia. È da qui che dipendono le due cose che
    // questa tabella fa diversamente da prima — i numeri stanno solo nelle
    // foglie, e nelle foglie si scrive — e si decide qui, guardando la fila
    // già montata, perché una riga non sa da sola se qualcosa la seguirà: un
    // pacchetto aperto su cui il filtro non lascia nessuna riga è una foglia
    // quanto un pacchetto chiuso, ed è giusto che lo sia — è il solo posto in
    // cui dare a quella persona la sua prima ora su quel pacchetto.
    for (let i = 0; i < fila.length; i++) {
      const riga = fila[i];
      const dopo = fila[i + 1];
      riga.foglia = !(dopo && dopo.rientro > riga.rientro);
      // Col filtro su una persona la stima sparisce: è la stima del lavoro, di
      // tutti, e affiancarla alle sole ore di Erika sarebbe un confronto fra
      // due numeri che non parlano della stessa cosa — «12 su 886» detto di
      // una persona è una frase falsa.
      if (personaSola) riga.stimate = 0;
      if (!riga.foglia || riga.tipo === 'risorsa') continue;
      // Una foglia di somma si compila solo se la persona è ovvia: una sola su
      // quel ramo, o quella del filtro. Altrimenti resta senza destinazione, e
      // scrivere scende di un livello.
      const chi = riga.voceId
        ? risorseDiVoce(doc, riga.voceId, true)
        : risorseDiPacchetto(doc, riga.pacchettoId);
      riga.risorsa = unicaRisorsa(chi, personaSola);
      riga.capacita = doc.risorse.find(r => r.nome === riga.risorsa)?.oreSettimana || 0;
    }
    return fila;
  }, [doc, aperte, pacchettoScelto, personaSola, inCoda, dettaglio, mostraPersone, apribile]);

  // La matrice si mette con la settimana corrente a un terzo da sinistra: si
  // vuole vedere un po' di passato e molto futuro, e su cinquanta colonne
  // partire dall'inizio della commessa vuol dire scorrere ogni volta prima di
  // vedere qualcosa.
  //
  // Era anche un bottone «oggi» nella barra. Se n'è andato: la colonna di
  // adesso è già segnata da una linea che si vede anche scorrendo, e un
  // bottone in più nella barra costava più di quel che rimetteva a posto.
  const vaiAOggi = useCallback(() => {
    const box = scorrevole.current;
    const colonna = box?.querySelector('.pg-w-ora');
    if (box && colonna instanceof HTMLElement) {
      box.scrollLeft = Math.max(0, colonna.offsetLeft - box.clientWidth / 3);
    }
  }, []);

  useEffect(() => { vaiAOggi(); }, [doc.id, vaiAOggi]);
  // Cambiando densità cambiano tutte le distanze: senza rimetterla a posto, la
  // colonna di oggi finisce fuori schermo proprio mentre si stringe per vedere
  // di più.
  useEffect(() => { vaiAOggi(); }, [densita, vaiAOggi]);

  /** @param {number} livelli */
  const cambiaDettaglio = livelli => { setDettaglio(livelli); writePref(CHIAVE_DETTAGLIO, livelli); };
  /** @param {boolean} acceso */
  const cambiaPersone = acceso => { setMostraPersone(acceso); writePref(CHIAVE_PERSONE, acceso); };

  // Quanto è larga la finestra, per la densità comoda. È l'unico posto in cui
  // questa tabella misura sé stessa, e serve perché la larghezza giusta di una
  // colonna dipende da quante ce ne sono: dodici settimane su un portatile
  // stavano in metà schermo, e l'altra metà restava bianca.
  const [larghezza, setLarghezza] = useState(0);
  useEffect(() => {
    const box = scorrevole.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    setLarghezza(box.clientWidth);
    const osserva = new ResizeObserver(righe => setLarghezza(righe[0].contentRect.width));
    osserva.observe(box);
    return () => osserva.disconnect();
  }, []);

  // «Comoda» si prende tutto lo spazio che c'è; «stretta» e «anno» no, perché
  // sono le due densità che si scelgono *per* rimpicciolire — allargarle
  // sarebbe disfare il gesto appena fatto. E si allarga soltanto: sotto la sua
  // misura non scende mai, altrimenti stringendo la finestra le colonne
  // diventerebbero illeggibili invece di far comparire la barra di scorrimento.
  const larghezzaColonna = (() => {
    const base = DENSITA[densita].w;
    if (densita !== 'comoda' || !larghezza || !settimane.length) return base;
    const disponibile = larghezza - L_NOME - L_TOT - 2;
    return Math.max(base, Math.floor(disponibile / settimane.length));
  })();

  const rettangolo = () => {
    const a = ancora || sel;
    return {
      r1: Math.min(a.r, sel.r), r2: Math.max(a.r, sel.r),
      c1: Math.min(a.c, sel.c), c2: Math.max(a.c, sel.c),
    };
  };
  const nelRettangolo = (/** @type {number} */ r, /** @type {number} */ c) => {
    const q = rettangolo();
    return r >= q.r1 && r <= q.r2 && c >= q.c1 && c <= q.c2;
  };
  /** Le celle scrivibili dentro la selezione. @returns {{ riga: Riga, colonna: number }[]} */
  const celleScrivibili = () => {
    const q = rettangolo();
    /** @type {{ riga: Riga, colonna: number }[]} */
    const elenco = [];
    for (let r = q.r1; r <= q.r2; r++) {
      const riga = righe[r];
      if (!riga?.risorsa || !riga.foglia) continue;
      for (let c = q.c1; c <= q.c2; c++) elenco.push({ riga, colonna: c });
    }
    return elenco;
  };

  /** Le ore come si scrivono a questa densità. @param {number} ore */
  const scritte = ore => (
    DENSITA[densita].intere ? oreBrevi(Math.round(ore)) : oreBrevi(ore));

  /** @param {Riga} riga @param {number} colonna */
  const valore = (riga, colonna) => {
    const w = settimane[colonna];
    if (riga.tipo === 'risorsa') {
      // La riga in coda al pacchetto dice **solo** le ore senza voce: è la sua
      // ragione di esistere, e sommarci quelle di una voce le mostrerebbe due
      // volte, qui e nella riga della voce qui sopra.
      if (riga.orfana) {
        return oreCella(doc, /** @type {string} */ (riga.risorsa), riga.pacchettoId, w);
      }
      // Altrimenti il totale di quello che la riga ha sotto: le sotto-voci che
      // non si stanno mostrando, e le ore lasciate sul pacchetto che questa
      // voce adotta. Leggere la sola chiave della riga lasciava la persona a
      // zero sotto un pacchetto che diceva quaranta.
      return oreSottoRiga(
        doc, /** @type {string} */ (riga.risorsa), riga.pacchettoId, riga.voceId, w);
    }
    // Le righe chiuse sommano quello che hanno sotto — la voce prende tutto il
    // suo ramo, come le ore stimate — e rispettano il filtro sulla persona.
    if (riga.tipo === 'voce') {
      return oreVoceSettimana(doc, /** @type {string} */ (riga.voceId), w, personaSola || null);
    }
    return orePacchettoSettimana(doc, riga.pacchettoId, w, personaSola || null);
  };

  /**
   * Scrive un valore nelle celle indicate.
   *
   * La cella non è più la chiave della riga: è la sua **destinazione** — la
   * cella più profonda in cui quelle ore stanno già — e quello che sostituisce
   * si azzera nello stesso colpo, perché sono le stesse ore. Una riga che è la
   * somma di due voci diverse non ha una destinazione: come per le righe di
   * totale, la risposta è scendere di un livello.
   * @param {{ riga: Riga, colonna: number }[]} celle @param {number[]} valori
   */
  function scrivi(celle, valori) {
    /** @type {Map<string, number>} */
    const scritte = new Map();
    /** @type {Set<string>} */
    const azzerate = new Set();
    let somme = false;
    celle.forEach((cella, i) => {
      // La riga in coda al pacchetto scrive nella sua cella e basta: mostra le
      // sole ore senza voce, e mandarle su una voce vorrebbe dire spostare
      // quello che si sta guardando.
      const dove = cella.riga.orfana
        ? { chiave: chiaveCarico(/** @type {string} */ (cella.riga.risorsa),
          cella.riga.pacchettoId, settimane[cella.colonna]), assorbe: [] }
        : destinazioneOre(
          doc, /** @type {string} */ (cella.riga.risorsa), cella.riga.pacchettoId,
          cella.riga.voceId, settimane[cella.colonna]);
      if (!dove) { somme = true; return; }
      scritte.set(dove.chiave, valori[Math.min(i, valori.length - 1)]);
      for (const chiave of dove.assorbe) azzerate.add(chiave);
    });
    /** @type {Record<string, number>} */
    const mappa = {};
    // Prima gli zeri, poi i valori: in una selezione larga la stessa cella può
    // essere la destinazione di una riga e l'assorbita di un'altra, e vince
    // quello che si è scritto.
    for (const chiave of azzerate) mappa[chiave] = 0;
    for (const [chiave, ore] of scritte) mappa[chiave] = ore;
    if (Object.keys(mappa).length) onCelle(mappa);
    else if (somme && dettaglio < 2) cambiaDettaglio(dettaglio + 1);
  }

  /** La riga su cui si sta scrivendo, o il livello da scendere per arrivarci. @param {number} r */
  function apriSeServe(r) {
    const riga = righe[r];
    if (!riga || riga.risorsa) return true;
    // Non un errore: scrivere in una riga di somma non ha una destinazione — a
    // quale persona andrebbero quelle ore? — e scendere di un livello è la
    // risposta. Prima si poteva solo aprire il pacchetto; adesso che anche le
    // persone si spengono, la risposta può essere riaccenderle: senza, la
    // cella non avrebbe fatto niente e la matrice sembrerebbe rotta.
    if (!aperte.includes(riga.pacchettoId) && apribile) {
      setAperte(p => [...p, riga.pacchettoId]);
    } else if (!mostraPersone) {
      cambiaPersone(true);
      setAperte(p => (p.includes(riga.pacchettoId) ? p : [...p, riga.pacchettoId]));
    }
    return false;
  }

  /** @param {number} dr @param {number} dc @param {boolean} estendi */
  function muovi(dr, dc, estendi) {
    setSel(s => {
      const r = Math.max(0, Math.min(righe.length - 1, s.r + dr));
      const c = Math.max(0, Math.min(settimane.length - 1, s.c + dc));
      return { r, c };
    });
    setAncora(precedente => (estendi ? (precedente || sel) : null));
  }

  /** @param {import('react').KeyboardEvent} e */
  function tasti(e) {
    if (bozza !== null) return;   // ci pensa l'input della cella
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); onAnnulla(); return; }

    const frecce = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const passo = frecce[/** @type {keyof typeof frecce} */ (e.key)];
    if (passo) {
      e.preventDefault();
      muovi(passo[0], passo[1], e.shiftKey);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      const riga = righe[sel.r];
      if (riga && apribile) setAperte(p => (p.includes(riga.pacchettoId) ? p.filter(n => n !== riga.pacchettoId) : [...p, riga.pacchettoId]));
      return;
    }
    if (e.key === 'Escape') { setAncora(null); setSpalmatura(null); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const celle = celleScrivibili();
      if (celle.length) scrivi(celle, [0]);
      return;
    }
    if (/^[\d.,]$/.test(e.key)) {
      e.preventDefault();
      if (!apriSeServe(sel.r)) return;
      // Con un intervallo selezionato non si indovina se quel numero vada in
      // ogni settimana o distribuito in tutte: si chiede, mostrando i due
      // risultati già calcolati.
      if (celleScrivibili().length > 1) setSpalmatura(e.key);
      else setBozza(e.key);
    }
  }

  /** Conferma della barretta: lo stesso numero in ogni cella, o spalmato. @param {boolean} inTutto */
  function confermaSpalmatura(inTutto) {
    const ore = leggiOre(spalmatura || '');
    const celle = celleScrivibili();
    setSpalmatura(null);
    if (ore === null || !celle.length) return;
    scrivi(celle, inTutto ? spalma(ore, celle.length) : [ore]);
  }

  const gruppiMese = perMese(settimane);
  // I pacchetti che la tabella sta mostrando: è da qui che i totali del piede
  // sanno del filtro.
  const pacchettiVisti = righe.filter(r => r.tipo === 'pacchetto')
    .map(r => ({ id: r.pacchettoId }));
  // Il numero d'ordine di ogni pacchetto: serve alla zebra, che alterna per
  // pacchetto e non per riga.
  const indiciPacchetto = new Map(doc.pacchetti.map((p, i) => [p.id, i]));
  // Le settimane che aprono un mese: con cinquanta colonne la fascia in cima
  // non basta a tenere il segno, e una linea verticale sì.
  const inizioMese = new Set(gruppiMese.map(g => g.settimane[0]));

  if (!doc.pacchetti.length) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">
          La matrice ha una riga per pacchetto, e non ce n&apos;è ancora nessuno. I pacchetti si
          creano in Impostazioni, o nascono da soli incollando delle voci che li nominano.
        </p>
      </div>
    );
  }
  if (!doc.risorse.length) {
    return (
      <div className="pg-matrice-vuota">
        <p className="pg-empty">
          Le ore si danno a qualcuno, e non c&apos;è ancora nessuno: le persone si aggiungono
          nelle Impostazioni della commessa.
        </p>
      </div>
    );
  }

  const tutteAperte = doc.pacchetti.length > 0 && doc.pacchetti.every(p => aperte.includes(p.id));

  return (
    <div className="pg-matrice-guscio">
      <div className="pg-barra">
        {/* Senza niente sotto il pacchetto non c'è niente da aprire, e un
            bottone che non fa niente è peggio di un bottone che non c'è. */}
        {apribile && (
          <button
            type="button"
            className="pg-barra-btn"
            onClick={() => setAperte(tutteAperte ? [] : doc.pacchetti.map(p => p.id))}
          >
            {tutteAperte ? 'chiudi tutte' : 'apri tutte'}
          </button>
        )}

        {/* Una persona sola. Con dieci pacchetti aperti le sotto-righe sono
            sessanta, e la domanda quasi sempre è su una persona: le altre nove
            in quel momento sono rumore. Scelta una, tutti i totali di questa
            tabella — righe chiuse, colonna «tot», piede — diventano i suoi. */}
        <select
          className="pg-filtro"
          value={personaSola}
          onChange={e => scegliPersona(e.target.value)}
          title="Restringi la matrice a una persona sola"
        >
          <option value="">tutte le persone</option>
          {doc.risorse.map(r => <option key={r.nome} value={r.nome}>solo {r.nome}</option>)}
        </select>

        {/* Il lavoro che c'è dentro il pacchetto, un livello per bottone.
            «sottovoci» accende anche «voci»: sono due gradini della stessa
            scala, non due interruttori indipendenti. */}
        <button
          type="button"
          className={`pg-barra-btn${dettaglio >= 1 ? ' scelto' : ''}`}
          onClick={() => cambiaDettaglio(dettaglio >= 1 ? 0 : 1)}
          title="Sotto ogni pacchetto aperto, le sue lavorazioni: finestra e ore stimate, in sola lettura"
        >
          voci
        </button>
        <button
          type="button"
          className={`pg-barra-btn${dettaglio >= 2 ? ' scelto' : ''}`}
          onClick={() => cambiaDettaglio(dettaglio >= 2 ? 1 : 2)}
          title="Anche le figlie delle lavorazioni scomposte"
        >
          sottovoci
        </button>
        {/* Il terzo gradino. Spento, la matrice si ferma al lavoro e non
            arriva alle persone: è la vista in cui si guarda come cade la
            commessa, e i nomi sotto ogni voce sarebbero il triplo delle
            righe per una domanda che in quel momento non si sta facendo. */}
        <button
          type="button"
          className={`pg-barra-btn${mostraPersone ? ' scelto' : ''}`}
          onClick={() => cambiaPersone(!mostraPersone)}
          title="Sotto l'ultimo livello del lavoro, chi lo fa: è la riga in cui si scrivono le ore"
        >
          persone
        </button>

        <span className="pg-barra-sp" />

        <span className="eyebrow">densità</span>
        {Object.entries(DENSITA).map(([chiave, { etichetta }]) => (
          <button
            type="button"
            key={chiave}
            className={`pg-barra-btn${densita === chiave ? ' scelto' : ''}`}
            onClick={() => cambiaDensita(/** @type {import('./densita.js').Densita} */ (chiave))}
          >
            {etichetta}
          </button>
        ))}
        <span className="pg-barra-conto">
          {settimane.length} settimane · {pacchettoScelto ? '1' : doc.pacchetti.length} pacchetti
        </span>
      </div>

      <div
        className={`pg-matrice pg-densita-${densita}`}
        ref={scorrevole}
        tabIndex={0}
        onKeyDown={tasti}
        onMouseUp={() => { trascina.current = null; }}
        onMouseLeave={() => { trascina.current = null; }}
      >
        <div
          className="pg-griglia"
          style={/** @type {import('react').CSSProperties} */ ({ '--pg-w': `${larghezzaColonna}px` })}
        >
          {/* La fascia dei mesi: con venticinque colonne è l'unico modo di
              sapere dove si è senza contare le settimane. */}
          <div className="pg-riga pg-riga-mesi">
            <div className="pg-nome pg-nome-angolo" />
            {gruppiMese.map(g => (
              <div key={g.mese} className="pg-mese" style={{ width: `calc(var(--pg-w) * ${g.settimane.length})` }}>
                {nomeMese(g.mese)}
              </div>
            ))}
            <div className="pg-tot pg-tot-angolo" />
          </div>

          <div className="pg-riga pg-riga-testa">
            <div className="pg-nome pg-nome-angolo eyebrow">pacchetto</div>
            {settimane.map(w => (
              <div key={w} className={`pg-w${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}${sel.c === settimane.indexOf(w) ? ' pg-colonna-scelta' : ''}`}>
                {/* La «W» sparisce alla densità più stretta: a ventotto pixel
                    è la lettera che manda fuori il numero, ed è anche la meno
                    utile — la colonna delle settimane si sa che è. */}
                <span className="pg-w-iso"><span className="pg-w-w">W</span>{w.slice(6)}</span>
                <span className="pg-w-giorno">{lunediDellaSettimana(w).slice(8)}/{lunediDellaSettimana(w).slice(5, 7)}</span>
              </div>
            ))}
            <div className="pg-tot pg-tot-testa" title="A piano, e dopo la barra le ore stimate della riga">
              tot<span className="pg-tot-stima">/stim</span>
            </div>
          </div>

          {righe.map((riga, r) => {
            let totale = 0;
            // Una riga che ha delle figlie a schermo non porta numeri: le sue
            // somme sono le righe qui sotto, e ripeterle in cima riempiva la
            // schermata della stessa ora scritta a quattro altezze diverse.
            const celle = settimane.map((w, c) => {
              const v = valore(riga, c);
              totale += v;
              return { w, c, v };
            });
            return (
              <div
                key={`${riga.pacchettoId}|${riga.voceId || '-'}|${riga.risorsa || 'tot'}|${riga.tipo}`}
                className={[
                  'pg-riga',
                  riga.tipo === 'pacchetto' ? 'pg-riga-risorsa' : (riga.tipo === 'voce' ? 'pg-riga-voce' : 'pg-riga-pacchetto'),
                  riga.orfana ? 'pg-riga-orfana' : '',
                  riga.estranea ? 'pg-riga-estranea' : '',
                  riga.aperta ? 'pg-aperta' : '',
                  // A righe alterne, contando i **pacchetti** e non le righe:
                  // un pacchetto aperto resta un blocco solo con le sue
                  // sotto-righe, che è quello che si segue con l'occhio.
                  (indiciPacchetto.get(riga.pacchettoId) || 0) % 2 ? 'pg-dispari' : '',
                  r === sel.r ? 'pg-riga-scelta' : '',
                ].filter(Boolean).join(' ')}
              >
                <div
                  className="pg-nome"
                  style={riga.rientro ? { paddingLeft: `calc(var(--sp-3) + ${riga.rientro * 16}px)` } : undefined}
                  onClick={() => {
                    if (riga.tipo === 'pacchetto') {
                      if (!apribile) return;
                      setAperte(p => (p.includes(riga.pacchettoId)
                        ? p.filter(id => id !== riga.pacchettoId)
                        : [...p, riga.pacchettoId]));
                    } else if (riga.tipo === 'voce' && riga.voceId) {
                      onSceltaVoce?.(riga.voceId);
                    } else if (riga.risorsa) {
                      onSceltaRiga?.(riga.risorsa, riga.pacchettoId);
                    }
                  }}
                  title={riga.orfana
                    ? `${riga.nome}: ore date al pacchetto e non a una voce — un consuntivo, o le celle di prima che ci fossero le voci. Restano qui finché non le si riscrive su una voce.`
                    : undefined}
                >
                  {riga.tipo === 'pacchetto' && (
                    <>
                      <span className="pg-caret">{apribile ? (riga.aperta ? '▾' : '▸') : ''}</span>
                      <span className="pg-punto" style={riga.colore ? { background: riga.colore } : undefined} />
                      <span className="pg-nome-testo">{riga.nome}</span>
                    </>
                  )}
                  {riga.tipo === 'voce' && (
                    <>
                      <span className="pg-voce-segno">·</span>
                      <span className="pg-nome-testo">{riga.nome}</span>
                    </>
                  )}
                  {riga.tipo === 'risorsa' && (
                    <>
                      <span className="pg-nome-testo">{riga.nome}</span>
                      {/* Le ore rimaste sul pacchetto si riconoscono a vista,
                          altrimenti sembrano una persona in più che compare da
                          sola in fondo. */}
                      <span className="pg-cap">{riga.orfana ? 'sul pacchetto' : `${riga.capacita}h/s`}</span>
                    </>
                  )}
                </div>

                {celle.map(({ w, c, v }) => {
                  const scelta = sel.r === r && sel.c === c;
                  const dentro = nelRettangolo(r, c);
                  // La tinta è la persona, non la cella: dice «questa persona,
                  // questa settimana, è oltre la sua capacità in questa
                  // commessa», e conta tutto quello che ha addosso — non le
                  // sole ore di questo pacchetto, che direbbero sempre di sì.
                  //
                  // E il passato non si colora: una settimana già andata è un
                  // fatto, non un allarme. Quelle ore nessuno le può più
                  // spostare, e il rosso su una colonna che non si può
                  // cambiare toglie forza ai rossi che invece si possono
                  // ancora risolvere — che sono l'unica ragione per cui la
                  // tinta esiste.
                  const sat = riga.risorsa && riga.foglia && w >= settimanaOra
                    ? livelloSaturazione(oreRisorsaSettimana(doc, riga.risorsa, w), riga.capacita)
                    : 'vuota';
                  return (
                    <div
                      key={w}
                      className={[
                        'pg-cella',
                        `pg-sat-${sat}`,
                        w === settimanaOra ? 'pg-w-ora' : '',
                        w < settimanaOra ? 'pg-passato' : '',
                        inizioMese.has(w) ? 'pg-mese-inizio' : '',
                        dentro ? 'pg-dentro' : '',
                        // La colonna in cui si sta, segnata per tutta l'altezza:
                        // su cinquanta colonne, guardando la riga in fondo non
                        // si sa più in che settimana si è.
                        sel.c === c ? 'pg-colonna-scelta' : '',
                        scelta ? 'pg-scelta' : '',
                      ].filter(Boolean).join(' ')}
                      onMouseDown={e => {
                        if (e.button !== 0) return;
                        trascina.current = 'selezione';
                        setSel({ r, c });
                        setAncora(e.shiftKey ? (ancora || sel) : null);
                        setBozza(null);
                        setSpalmatura(null);
                        scorrevole.current?.focus();
                      }}
                      onMouseEnter={() => {
                        if (trascina.current !== 'selezione') return;
                        setAncora(a => a || sel);
                        setSel({ r, c });
                      }}
                      onDoubleClick={() => { if (apriSeServe(r)) { setSel({ r, c }); setBozza(oreBrevi(v)); } }}
                    >
                      {scelta && bozza !== null ? (
                        <input
                          className="pg-input"
                          autoFocus
                          value={bozza}
                          onChange={ev => setBozza(ev.target.value)}
                          onBlur={() => setBozza(null)}
                          onKeyDown={ev => {
                            const avanti = { Enter: [1, 0], Tab: [0, 1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
                            const passo = avanti[/** @type {keyof typeof avanti} */ (ev.key)];
                            if (ev.key === 'Escape') { ev.preventDefault(); setBozza(null); scorrevole.current?.focus(); return; }
                            if (!passo) return;
                            ev.preventDefault();
                            const ore = leggiOre(bozza);
                            // Un valore che non si legge non svuota la cella:
                            // si resta dov'è, e chi ha sbagliato lo vede.
                            if (ore !== null && riga.risorsa && riga.foglia) scrivi([{ riga, colonna: c }], [ore]);
                            setBozza(null);
                            scorrevole.current?.focus();
                            if (ore !== null) muovi(passo[0], ev.shiftKey ? -passo[1] : passo[1], false);
                          }}
                        />
                      ) : (riga.foglia ? scritte(v) : '')}

                      {/* Il quadratino che ripete il valore. Solo in
                          orizzontale: verso il basso vorrebbe dire copiare le
                          ore di una persona su un'altra — o peggio, su un altro
                          pacchetto — che non è mai quello che si intende. */}
                      {scelta && riga.risorsa && riga.foglia && bozza === null && (
                        <span
                          className="pg-maniglia"
                          onMouseDown={e => {
                            e.stopPropagation();
                            trascina.current = 'riempi';
                            const partenza = { r, c, v };
                            const suCella = (/** @type {MouseEvent} */ ev) => {
                              const sotto = document.elementFromPoint(ev.clientX, ev.clientY);
                              const box = sotto?.closest('.pg-cella');
                              const riquadro = box?.parentElement;
                              if (!box || !riquadro) return;
                              const colonna = [...riquadro.querySelectorAll('.pg-cella')].indexOf(box);
                              if (colonna < 0) return;
                              setAncora({ r: partenza.r, c: partenza.c });
                              setSel({ r: partenza.r, c: colonna });
                            };
                            const fine = () => {
                              document.removeEventListener('mousemove', suCella);
                              document.removeEventListener('mouseup', fine);
                              trascina.current = null;
                              setSel(s => {
                                const da = Math.min(partenza.c, s.c), a = Math.max(partenza.c, s.c);
                                /** @type {{ riga: Riga, colonna: number }[]} */
                                const celleDaRiempire = [];
                                for (let x = da; x <= a; x++) celleDaRiempire.push({ riga, colonna: x });
                                scrivi(celleDaRiempire, [partenza.v]);
                                return s;
                              });
                            };
                            document.addEventListener('mousemove', suCella);
                            document.addEventListener('mouseup', fine);
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Le ore a piano e quelle stimate, una accanto all'altra. Sono
                    i due numeri che questa tabella tiene insieme — «quanto
                    pesa questo lavoro» e «quanto ne ho messo in calendario» —
                    e il loro scarto è la domanda per cui si apre la matrice.
                    Finora stava solo nella testata, per tutta la commessa: un
                    solo numero per dodici pacchetti, cioè la media di dodici
                    situazioni diverse. Qui sta su ogni riga che una stima ce
                    l'ha, e le righe di somma la portano anche a schermo muto —
                    è l'unica cosa che un'intestazione può dire senza ripetere
                    quello che ha sotto, perché la stima non è una somma delle
                    celle. */}
                <div
                  className="pg-tot"
                  title={riga.stimate
                    ? `${oreBrevi(totale)} h a piano su ${oreBrevi(riga.stimate)} h stimate — ne restano ${oreBrevi(Math.max(0, riga.stimate - totale))} da collocare`
                    : undefined}
                >
                  {scritte(totale)}
                  {riga.stimate > 0 && (
                    <span className="pg-tot-stima">/{scritte(riga.stimate)}</span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="pg-riga pg-riga-piede">
            <div className="pg-nome">totale settimana</div>
            {/* Il piede rispetta i filtri accesi: sommare tutta la commessa
                sotto una tabella che ne mostra un pezzo darebbe un numero
                giusto alla domanda sbagliata, e nessuno se ne accorgerebbe. */}
            {settimane.map(w => (
              <div key={w} className={`pg-cella pg-cella-piede${w === settimanaOra ? ' pg-w-ora' : ''}${inizioMese.has(w) ? ' pg-mese-inizio' : ''}`}>
                {scritte(pacchettiVisti.reduce(
                  (s, p) => s + orePacchettoSettimana(doc, p.id, w, personaSola || null), 0))}
              </div>
            ))}
            <div className="pg-tot">
              {scritte(settimane.reduce((s, w) => s + pacchettiVisti.reduce(
                (q, p) => q + orePacchettoSettimana(doc, p.id, w, personaSola || null), 0), 0))}
              {/* La stima è del lavoro, non di chi lo fa: col filtro su una
                  persona il confronto non avrebbe senso — le sue ore contro la
                  stima di tutti — e un numero che non risponde alla domanda è
                  peggio di nessun numero. */}
              {!personaSola && (
                <span className="pg-tot-stima">
                  /{scritte(pacchettiVisti.reduce(
                    (s, p) => s + oreVoci(doc, v => v.pacchettoId === p.id), 0))}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {spalmatura !== null && (
        <div className="pg-spalma">
          <span className="pg-spalma-num">{spalmatura}</span>
          <button type="button" className="pg-spalma-scelta" onClick={() => confermaSpalmatura(false)}>
            {leggiOre(spalmatura) ?? '—'} h in ogni settimana <span className="pg-scorciatoia">Invio</span>
          </button>
          <button type="button" className="pg-spalma-scelta" onClick={() => confermaSpalmatura(true)}>
            {leggiOre(spalmatura) ?? '—'} h in tutto = {oreBrevi(spalma(leggiOre(spalmatura) || 0, celleScrivibili().length)[0] || 0)} h × {celleScrivibili().length}
            <span className="pg-scorciatoia">⌥Invio</span>
          </button>
          <input
            className="pg-spalma-campo"
            autoFocus
            value={spalmatura}
            onChange={e => setSpalmatura(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); confermaSpalmatura(e.altKey); scorrevole.current?.focus(); }
              if (e.key === 'Escape') { setSpalmatura(null); scorrevole.current?.focus(); }
            }}
          />
        </div>
      )}

      <div className="pg-legenda">
        <span>frecce per muoversi · una cifra per scrivere · ⇧+frecce per un intervallo · ⌘Z annulla</span>
        <span className="pg-legenda-nota">
          la tinta è la persona nella settimana, su tutta la commessa — non le ore della cella
        </span>
        <span className="pg-legenda-nota">
          {mostraPersone
            ? 'le ore si scrivono nella riga della persona, l\u2019ultima della catena'
            : 'i numeri stanno nell\u2019ultimo livello aperto, ed \u00e8 l\u00ec che si scrivono'}
        </span>
        {DENSITA[densita].intere && (
          <span className="pg-legenda-nota">ore arrotondate all&apos;intero: le mezze ore ci sono, si rivedono a densità «stretta»</span>
        )}
        <span className="pg-legenda-sp" />
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-soglia" /> in soglia</span>
        <span className="pg-legenda-voce"><span className="pg-campione pg-sat-sopra" /> oltre la capacità</span>
      </div>
    </div>
  );
}

/**
 * La persona di un pacchetto quando ce n'è una sola — o quella scelta nel
 * filtro: lì scrivere in una riga chiusa ha una destinazione ovvia, e chiedere
 * di aprirla sarebbe un passaggio per niente.
 * @param {import('../programma.js').Risorsa[]} sue  le persone del pacchetto
 * @param {string} personaSola
 * @returns {string|null}
 */
function unicaRisorsa(sue, personaSola) {
  if (personaSola) return personaSola;
  return sue.length === 1 ? sue[0].nome : null;
}
