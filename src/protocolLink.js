// Apre un link ms-onenote:// / ms-to-do:// nell'app desktop collegata.
export function openProtocol(url) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.click();
}
