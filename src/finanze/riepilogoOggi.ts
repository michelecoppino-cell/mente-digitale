// Le quattro cifre di Finanze che compaiono nella vista Oggi.
//
// Prima Oggi mostrava solo un invito («i numeri restano nella sezione»): un
// riquadro che occupava spazio per non dire niente. Le cifre sono le stesse
// del «Riepilogo (oggi)» della scheda Saldo, calcolate dalla stessa catena —
// non una seconda formula che col tempo scivola via da quella vera.
//
// Tutto è caricato su richiesta, e solo a PIN inserito: il motore del saldo,
// il piano di ammortamento dei mutui e il modello dati non devono pesare
// sull'avvio di Oggi, che è la schermata che si apre per prima ogni mattina.

export interface RiepilogoOggi {
  /** Data dell'ultimo punto della serie (ISO). */
  ultimoDato: string;
  /** Importi già formattati come nella sezione Finanze ("12.345 €"). */
  grezzo: string;
  nettoTasse: string;
  /** Netto tasse + investito + equity immobiliare. */
  totaleConImmobili: string;
}

/** null quando non c'è ancora nessun movimento da cui calcolare qualcosa. */
export async function caricaRiepilogoOggi(): Promise<RiepilogoOggi | null> {
  const [db, saldoMod, fattureMod, mutuoMod, util] = await Promise.all([
    import("./store/db"),
    import("./engine/saldo"),
    import("./engine/fatture"),
    import("./engine/mutuo"),
    import("./util"),
  ]);

  const dati = await db.caricaDati();
  if (!dati || dati.transazioni.length === 0) return null;

  // Stessa fonte della scheda Saldo: dove ci sono fatture, le tasse dell'anno
  // si calcolano da quelle.
  const tasse = fattureMod.tasseConFatture(dati.tasse, dati.fatture);
  const ris = saldoMod.calcolaSaldo(dati.transazioni, tasse, dati.parametri);
  const u = ris.ultimo;
  if (!u) return null;

  const mutui = dati.mutui ?? [];
  const equity =
    mutui.length > 0 ? mutuoMod.equityImmobili(mutui, util.toIso(new Date())) : 0;

  // Formattati qui e non nel componente: `euro()` vive in questo chunk, e
  // farlo importare a Oggi solo per mettere il separatore alle migliaia
  // vanificherebbe il caricamento su richiesta.
  return {
    ultimoDato: u.data,
    grezzo: util.euro(u.grezzo),
    nettoTasse: util.euro(u.nettoTasse),
    totaleConImmobili: util.euro(u.nettoTasse + (u.investito ?? 0) + equity),
  };
}
