<#
.SYNOPSIS
  Manda alla casella personale l'agenda di lavoro intera, come allegato .ics.

.DESCRIPTION
  Gira sul PC di lavoro, dentro Outlook, con l'utente di sempre: nessun
  permesso da chiedere all'amministratore, nessun programma da installare,
  niente che esca dal PC se non una mail — cioè l'unica cosa che l'azienda
  già consente.

  È il tasto «Invia calendario tramite e-mail» che Outlook ha già, premuto da
  solo ogni due ore. Sotto c'è la stessa API (CalendarSharing), quindi il file
  che esce è lo stesso: se un giorno questo script non partisse, la stessa cosa
  si fa a mano dal menù di Outlook e l'app se ne accorge lo stesso.

  **Manda tutta la finestra ogni volta, non le differenze.** È quello che rende
  il meccanismo a prova di mail persa: conta solo l'ultima mail arrivata, le
  altre non servono. Una mail che non parte non lascia un buco — quella dopo
  rimette tutto in pari.

.PARAMETER A
  L'indirizzo personale a cui mandarla.

.PARAMETER Oggetto
  Il marcatore con cui comincia l'oggetto. Deve combaciare col segreto
  CALENDARIO_LAVORO_MAIL su GitHub. In coda lo script scrive data e ora
  dell'esportazione, così nella casella si vede a colpo d'occhio l'ultima.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Invia-Calendario.ps1 -A me@esempio.it

.NOTES
  Registrarlo come compito pianificato, ogni due ore nei giorni feriali:

    schtasks /Create /TN "Calendario lavoro" /SC HOURLY /MO 2 /ST 07:00 ^
      /TR "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\percorso\Invia-Calendario.ps1 -A me@esempio.it"

  Il resto — i due segreti su GitHub, cosa controllare — sta in
  docs/calendario-lavoro.md.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$A,
  [string]$Oggetto = 'CALENDARIO-LAVORO',
  [int]$MesiIndietro = 1,
  [int]$MesiAvanti = 12
)

$ErrorActionPreference = 'Stop'

# olFolderCalendar = 9, olFullDetails = 2, olMailItem = 0. Sono le costanti
# dell'oggetto Outlook: scritte per numero perché la libreria di tipi non è
# caricata quando si arriva qui da COM.
$OL_CALENDARIO = 9
$OL_DETTAGLI_COMPLETI = 2
$OL_MAIL = 0

$file = Join-Path $env:TEMP 'calendario-lavoro.ics'

try {
  $outlook = New-Object -ComObject Outlook.Application
  $calendario = $outlook.GetNamespace('MAPI').GetDefaultFolder($OL_CALENDARIO)

  $esportatore = $calendario.GetCalendarExporter()
  $esportatore.CalendarDetail = $OL_DETTAGLI_COMPLETI
  $esportatore.StartDate = (Get-Date).AddMonths(-$MesiIndietro)
  $esportatore.EndDate = (Get-Date).AddMonths($MesiAvanti)
  # Senza questo esporterebbe solo le ore lavorative dei giorni feriali, e una
  # trasferta del sabato o una riunione alle 19 sparirebbero senza dirlo.
  $esportatore.RestrictToWorkingHours = $false
  # Gli allegati degli appuntamenti no: il file diventerebbe di decine di MB e
  # all'app servono solo titolo, giorno e ora.
  $esportatore.IncludeAttachments = $false
  try { $esportatore.IncludePrivateDetails = $true } catch { }

  $esportatore.SaveAsICal($file)
  $peso = [math]::Round((Get-Item $file).Length / 1KB)
  Write-Host "Esportato: $file ($peso KB)"

  $mail = $outlook.CreateItem($OL_MAIL)
  $mail.To = $A
  $mail.Subject = "$Oggetto $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  $mail.Body = @"
Esportazione automatica del calendario di lavoro.

Finestra: $($esportatore.StartDate.ToString('dd/MM/yyyy')) - $($esportatore.EndDate.ToString('dd/MM/yyyy'))
Generata da Invia-Calendario.ps1 sul PC di lavoro.

Il corpo di questa mail non viene letto da nessuno: conta solo l'allegato,
e conta solo l'ultima mail arrivata.
"@
  $mail.Attachments.Add($file) | Out-Null
  $mail.Send()
  Write-Host "Inviata a $A."
}
catch {
  # Il codice di uscita serve al compito pianificato: nella sua colonna
  # «Risultato ultima esecuzione» uno zero vuol dire andata, e un numero
  # diverso è la sola traccia che resta di un giro fallito.
  Write-Error "Non è riuscito: $($_.Exception.Message)"
  exit 1
}
finally {
  if (Test-Path $file) { Remove-Item $file -Force -ErrorAction SilentlyContinue }
}
