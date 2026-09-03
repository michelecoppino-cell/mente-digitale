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
                pacchetto. Una riga per <b>pacchetto</b>, e aprendola le persone che ci stanno
                sopra: la domanda qui è sul lavoro — quando si fa, e chi lo fa. Il passato si
                compila in blocco dal Riepilogo («già spese»), il futuro cella per cella — perché
                lì ogni settimana è una decisione. La tinta rossa di una cella è la persona, non la
                cella: dice che quella settimana è oltre la sua capacità contando tutto.
              </li>
              <li>
                <b>Persone.</b> La matrice al contrario: una riga per persona, e le ore sommate su
                <b> tutte le commesse accese</b>. Serve a una domanda che dentro una commessa sola
                non ha risposta — «a questa persona ho già dato quella settimana?» —, perché dieci
                ore qui e trenta là stanno sotto la capacità in tutte e due le matrici e sopra nella
                realtà. Si legge e basta: le ore si cambiano nella matrice della commessa, e un clic
                sul suo nome ci porta. Il filtro dei pacchetti in testata vale in tutt&apos;e due:
                acceso, si vedono solo le ore di quel pacchetto — righe, totali e piede compresi.
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
              <li><b>programmate</b> — le sole celle da questa settimana in avanti.</li>
              <li>
                <b>da collocare</b> — stimate meno a piano. Positivo vuol dire lavoro che c&apos;è ma
                che nessuno sta facendo in nessuna settimana. È il numero per cui il pannello
                esiste: i due dati sono veri tutti e due e non si derivano l&apos;uno dall&apos;altro.
              </li>
              <li>
                <b>speso</b> e <b>programmate</b> — la matrice tagliata in due dalla colonna di
                questa settimana: a sinistra quello che è andato, a destra quello che è già in
                calendario. Niente timesheet: le settimane passate si correggono con quanto è
                andato davvero, una per una o in blocco dal Riepilogo.
              </li>
              <li>
                <b>a finire</b> — stimate meno speso. <i>Non</i> le celle a destra: la
                programmazione non si fa mai fino in fondo, e contare quella direbbe sempre meno
                lavoro di quanto ne resta. Non va sotto zero — chi ha già speso più di quanto
                stimava non ha ore di credito, ha un margine rosso.
              </li>
              <li>
                <b>margine</b> — vendute meno <i>speso più a finire</i>, cioè meno quello che la
                commessa costerà in tutto. Quando è rosso, sotto c&apos;è scritto da quali pacchetti
                viene.
              </li>
            </ul>
          </section>

          <section>
            <h3>La matrice, con la tastiera</h3>
            <ul className="pg-elenco">
              <li><b>frecce</b> per muoversi, <b>una cifra</b> per cominciare a scrivere, <b>Invio</b> o <b>Tab</b> per confermare.</li>
              <li><b>⇧+frecce</b> seleziona un intervallo. Battendo un numero su un intervallo chiede se va in ogni settimana o spalmato su tutte.</li>
              <li><b>barra spaziatrice</b> apre e chiude un pacchetto. Si scrive nelle sotto-righe: la riga chiusa è il totale del pacchetto, e non ha una persona a cui dare le ore.</li>
              <li><b>⌘Z</b> annulla. Il quadratino in basso a destra della cella ripete il valore verso destra.</li>
              <li><b>Canc</b> svuota. Una cella vuota è vuota: non salva uno zero.</li>
              <li>
                <b>voci</b> e <b>sottovoci</b>, nella barra, aggiungono sotto ogni pacchetto aperto
                il lavoro che ci sta dentro: una riga per lavorazione, e a un altro clic le sue
                figlie. Sono righe che si <b>leggono</b> — le ore vivono nella cella persona ×
                pacchetto × settimana, una voce non ne ha di sue. Quello che dicono è la
                <b> finestra</b> della voce disegnata sulle settimane, e le ore stimate nel totale:
                serve a vedere se le celle che si stanno riempiendo cadono dove il lavoro era
                previsto. Una voce senza finestra lo dice («quando?»).
              </li>
            </ul>
          </section>

          <section>
            <h3>Quando diventa grande</h3>
            <p>
              Dieci persone e un anno sono cinquanta colonne: la griglia si legge solo se si
              governa, e i gesti per governarla stanno nella barra sopra la matrice.
            </p>
            <ul className="pg-elenco">
              <li>
                <b>densità</b> — la stessa griglia a tre larghezze. «anno» rimpicciolisce finché
                la commessa intera sta in una schermata; lì le ore si scrivono all&apos;ora intera,
                e le mezze ore si rivedono tornando a «stretta».
              </li>
              <li><b>oggi</b> — riporta a schermo la colonna di adesso, che è la linea fra lo speso e la previsione.</li>
              <li><b>apri / chiudi tutte</b> e <b>una persona sola</b> — dieci righe aperte sono sessanta sotto-righe, e quasi sempre la domanda è su una persona.</li>
              <li>
                La riga e la colonna in cui si sta restano segnate, le righe si alternano di fondo,
                e il primo lunedì di ogni mese porta una linea: sono i modi di tenere il segno
                scorrendo, e non costano un click.
              </li>
              <li>
                In <b>Elenco voci</b> le lavorazioni si chiudono: chiuse tutte, quaranta righe
                tornano a essere le dieci lavorazioni che sono la commessa.
              </li>
            </ul>
          </section>

          <section>
            <h3>Excel: come esce e come rientra</h3>
            <p>
              <b>↓ Excel</b>, in cima, scarica un file con tre fogli — Riepilogo, Matrice, Voci —
              da mandare ai colleghi. È una fotografia col giorno nel nome: due esportazioni non si
              coprono a vicenda.
            </p>
            <p>
              <b>↑ Ore registrate</b> è il giro all&apos;indietro. Nel foglio Matrice si corregge la
              colonna della settimana appena chiusa con le ore davvero fatte, si seleziona il
              rettangolo — <i>intestazione compresa</i> — e si incolla lì. Prima di applicare, il
              riquadro dice quante celle cambiano, di chi, quante ore c&apos;erano e quante ce ne
              saranno, ed elenca le righe che non ha capito. Vanno bene anche righe sciolte
              <code> persona | pacchetto | settimana | ore</code>.
            </p>
            <p>
              Le ore incollate <b>sostituiscono</b> quelle previste: sono un consuntivo, quindi
              reincollare lo stesso foglio non raddoppia niente. Una cella lasciata vuota non si
              tocca — così si corregge una settimana sola senza azzerare le altre — e <b>⌘Z</b>
              annulla tutto l&apos;incollato in un colpo.
            </p>
          </section>

          <section>
            <h3>Quello che non fa, per scelta</h3>
            <p>
              Niente timesheet automatico, niente dipendenze o percorso critico, niente costi in
              euro. Le ore vere entrano incollate e non lette da un file: leggere un <code>.xlsx</code>
              vorrebbe dire scrivere un decompressore per far arrivare qui gli stessi numeri che
              gli appunti hanno già.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
