// @ts-check
// Come si usa il Programma, scritto dentro il Programma.
//
// Non è documentazione messa lì per scrupolo: questo pannello ha quattro
// oggetti (commessa, pacchetto, voce, cella) che si somigliano abbastanza da
// confondersi, e due numeri — le ore delle voci e le ore delle celle — che
// **apposta** non coincidono. Chi ci entra la prima volta non ha modo di
// indovinare né l'ordine dei passaggi né perché quei due numeri sono diversi,
// e senza saperlo il pannello sembra rotto invece che utile.
//
// Sta in un modale e non in una pagina di aiuto altrove per la ragione di
// sempre: l'aiuto che non è dove serve non lo legge nessuno.

/**
 * @param {object} props
 * @param {() => void} props.onChiudi
 */
export default function Istruzioni({ onChiudi }) {
  return (
    <div className="pg-velo" onMouseDown={e => { if (e.target === e.currentTarget) onChiudi(); }}>
      <div className="pg-modale pg-modale-largo">
        <div className="pg-col-head">
          <span className="eyebrow eyebrow-accent">Come si usa</span>
          <button type="button" className="pg-chiudi" onClick={onChiudi} aria-label="Chiudi">✕</button>
        </div>

        <div className="pg-modale-corpo pg-istruzioni">
          <section>
            <h3>A cosa serve</h3>
            <p>
              Il Piano è la <b>giornata</b>: fasce da mezz&apos;ora, blocchi trascinati. Il Programma
              è i <b>mesi</b>: settimane, ore aggregate, persone. Risponde alla domanda che prima
              viveva negli Excel — quanto costa questa commessa, come si divide, chi la fa, quanto
              manca.
            </p>
            <p>
              Le voci che stanno qui <b>non sono attività</b>: non stanno nel pool, non scadono,
              non suonano. Una voce non diventa mai un&apos;attività, ne <b>genera</b> una il giorno
              in cui la assegni a qualcuno — ed è l&apos;unico momento in cui il Programma tocca il
              resto dell&apos;app.
            </p>
          </section>

          <section>
            <h3>I passaggi, in ordine</h3>
            <ol className="pg-passi">
              <li>
                <b>La commessa.</b> Nome, ore vendute, inizio e fine. Le ore vendute sono il metro
                di tutto il resto; le due date sono le colonne della matrice. Collegala alla sua
                <b> sezione</b>: da lì le liste che nasceranno prendono il nome giusto
                (<code>2573.A60-Fondazioni-270630</code>) e la sezione se le ritrova da sola.
              </li>
              <li>
                <b>Le persone.</b> In Impostazioni. Il nome è lo stesso che compare sulle attività
                delegate — scritto uguale, un task delegato e una riga della matrice parlano della
                stessa persona. La capacità (ore a settimana) serve a colorare le settimane troppo
                piene.
              </li>
              <li>
                <b>I pacchetti.</b> Sono i sotto-progetti: le righe della matrice, i filtri
                dell&apos;elenco, e il nome della lista che nascerà. Si creano in Impostazioni, o da
                soli incollando voci che li nominano.
              </li>
              <li>
                <b>Le voci.</b> In fondo all&apos;elenco: quattro campi separati per scriverne una,
                oppure la casella da incollare per scriverne duecento. Una voce troppo grossa non è
                un errore: si <b>scompone</b> dopo, dal dettaglio, e da quel momento le sue ore sono
                la somma delle figlie.
              </li>
              <li>
                <b>La matrice.</b> Quante ore di quella persona vanno in quella settimana su quel
                pacchetto. Il passato si compila in blocco dal Riepilogo («già spese»), il futuro
                cella per cella — perché lì ogni settimana è una decisione.
              </li>
              <li>
                <b>Attivare.</b> Quando una voce sta per cominciare, «Attiva…» crea l&apos;attività
                vera, con persona e scadenza. Nessuna conferma prima: c&apos;è l&apos;annulla dopo,
                per otto secondi.
              </li>
            </ol>
          </section>

          <section>
            <h3>I numeri, e perché due non coincidono</h3>
            <ul className="pg-elenco">
              <li><b>vendute</b> — il numero contrattuale. Non si tocca da solo.</li>
              <li><b>stimate</b> — la somma delle ore delle <i>voci</i>: cosa c&apos;è da fare.</li>
              <li><b>a piano</b> — la somma delle <i>celle</i> della matrice: chi lo fa, e quando.</li>
              <li>
                <b>da collocare</b> — stimate meno a piano. Positivo vuol dire lavoro che c&apos;è ma
                che nessuno sta facendo in nessuna settimana. È il numero per cui il pannello
                esiste: i due dati sono veri tutti e due e non si derivano l&apos;uno dall&apos;altro.
              </li>
              <li>
                <b>speso</b> e <b>a finire</b> — la matrice tagliata in due dalla colonna di questa
                settimana. Niente timesheet: le settimane passate si correggono con quanto è andato
                davvero.
              </li>
              <li><b>margine</b> — vendute meno a piano. Quando è rosso, sotto c&apos;è scritto da quali pacchetti viene.</li>
            </ul>
          </section>

          <section>
            <h3>La matrice, con la tastiera</h3>
            <ul className="pg-elenco">
              <li><b>frecce</b> per muoversi, <b>una cifra</b> per cominciare a scrivere, <b>Invio</b> o <b>Tab</b> per confermare.</li>
              <li><b>⇧+frecce</b> seleziona un intervallo. Battendo un numero su un intervallo chiede se va in ogni settimana o spalmato su tutte.</li>
              <li><b>barra spaziatrice</b> apre e chiude una persona. Si scrive nelle sotto-righe: la riga chiusa è il totale, e non ha un pacchetto in cui mettere le ore.</li>
              <li><b>⌘Z</b> annulla. Il quadratino in basso a destra della cella ripete il valore verso destra.</li>
              <li><b>Canc</b> svuota. Una cella vuota è vuota: non salva uno zero.</li>
            </ul>
          </section>

          <section>
            <h3>Quello che non fa, per scelta</h3>
            <p>
              Niente timesheet, niente dipendenze o percorso critico, niente costi in euro. La
              saturazione di una persona si legge sul solo programma aperto, non sommata su tutte
              le commesse accese: è l&apos;approssimazione dichiarata di questa versione.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
