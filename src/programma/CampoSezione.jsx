// @ts-check
// La tendina delle sezioni: il collegamento fra una commessa e il posto in cui
// quella commessa vive già.
//
// Non è un campo in più da compilare, è quello che decide **come si chiameranno
// le liste** che il Programma crea attivando. Una commessa collegata alla
// sezione `2573-ABS` genera consegne `2573.A60-Fondazioni-270630`, e da lì il
// pannello di quella sezione se le ritrova da solo (vedi `listsForSection` in
// `paraConfig.js`). Senza il collegamento il gruppo se lo inventa lo slug del
// nome, e la lista nasce orfana: nessuna vista la ricuce alla commessa.
//
// Le sezioni si caricano taccuino per taccuino e solo quando si aprono, quindi
// qui si chiedono tutte all'apertura del campo: una tendina vuota, in una
// schermata che chiede di collegare qualcosa, sarebbe un vicolo cieco.
import { useEffect } from 'react';
import { groupKeyForSection } from '../paraConfig.js';

/**
 * @param {object} props
 * @param {{ id: string, displayName: string }[]} props.sezioni
 * @param {string|null} props.sezione     il nome scelto
 * @param {(scelta: { sezione: string|null, sezioneId: string|null }) => void} props.onCambia
 * @param {() => void} [props.onCarica]   chiede all'app tutte le sezioni
 * @param {boolean} [props.inCorso]
 */
export default function CampoSezione({ sezioni, sezione, onCambia, onCarica, inCorso }) {
  useEffect(() => { onCarica?.(); }, [onCarica]);

  // Una sezione collegata prima e sparita dall'elenco (taccuino non ancora
  // caricato, sezione rinominata) resta scelta: il nome è il dato vero, la
  // tendina è solo il modo di sceglierlo.
  const orfana = sezione && !sezioni.some(s => s.displayName === sezione);

  return (
    <span className="pg-campo-sezione">
      <select
        className="pg-campo"
        value={sezione || ''}
        onChange={e => {
          const scelta = sezioni.find(s => s.displayName === e.target.value) || null;
          onCambia({ sezione: scelta?.displayName || null, sezioneId: scelta?.id || null });
        }}
      >
        <option value="">{inCorso ? 'cerco le sezioni…' : 'nessuna sezione collegata'}</option>
        {orfana && <option value={sezione}>{sezione} (non trovata adesso)</option>}
        {sezioni.map(s => <option key={s.id} value={s.displayName}>{s.displayName}</option>)}
      </select>
      <span className="pg-memo">
        {sezione
          ? `le liste si chiameranno ${groupKeyForSection(sezione)}.Pacchetto-AAMMGG, e la sezione se le ritrova da sola`
          : 'senza sezione le liste che nascono attivando restano scollegate dalla commessa'}
      </span>
    </span>
  );
}
