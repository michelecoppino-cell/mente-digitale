// Hash della password del gate. Nota: su un sito statico questa e' solo una
// barriera per l'interfaccia — i dati veri restano comunque solo nel tuo
// browser. La protezione seria arrivera' con il login Microsoft/OneDrive.

export async function sha256(testo: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(testo),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
