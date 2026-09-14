# encoding: UTF-8 **con BOM**, ed è obbligatorio.
#
# Windows PowerShell 5.1 — quello di serie su Windows, quello che l'Utilità di
# pianificazione avvia — legge un .ps1 senza BOM come ANSI (CP1252). Un trattino
# lungo diventa allora tre caratteri, e l'ultimo dei tre è una virgoletta
# «intelligente» che PowerShell prende per l'inizio di una stringa: da lì in poi
# il file non si chiude più, e l'errore compare sull'ultima riga del file, cioè
# lontanissimo dalla riga che l'ha causato. Il file si è rifiutato di partire
# così, una volta. Chi lo modifica lo risalvi con il BOM.

<#
.SYNOPSIS
  Fa scrivere a Claude Code il recap del mattino, senza che nessuno sia davanti
  allo schermo.

.DESCRIPTION
  Gira alle cinque sul PC che resta acceso — la VDI di lavoro — dove il server
  MCP `mente` è già registrato e Claude Code gira sull'abbonamento: nessuna
  chiamata a consumo, nessuna chiave API da custodire.

  Fa una cosa sola: legge `prompt-recap.md` e lo passa a `claude -p`, cioè alla
  modalità non interattiva. Il modello guarda calendario, posta e attività con
  gli strumenti del server MCP, cerca sul web i titoli del giorno, e scrive il
  risultato con lo strumento `recap`, che sostituisce quello di ieri su
  OneDrive. Al risveglio la domanda è una sola — «leggimi il recap» — e la
  risposta è già pronta.

  **Gli strumenti si dichiarano uno per uno** (`-AllowedTools`): in modalità non
  interattiva nessuno può rispondere a una richiesta di consenso, e l'alternativa
  — spegnere i permessi in blocco — vorrebbe dire un processo che di notte, da
  solo, può fare qualunque cosa. Questo elenco è anche la risposta alla domanda
  «cosa può fare il compito delle cinque?».

  **Se non parte, non si rompe niente.** Il recap di ieri resta dov'è, e chi lo
  rilegge se ne accorge da solo: `oggi` mostra il recap solo se è di stamattina,
  e altrimenti dice di che giorno è. È la stessa regola dello specchio del
  calendario di lavoro — un dato che arriva da un PC che può essere spento
  dichiara quanti anni ha.

.PARAMETER Progetto
  La cartella del progetto mente-digitale su questa macchina. Claude Code viene
  avviato lì dentro: è da lì che legge `.claude/` e trova il server MCP.

.PARAMETER Claude
  Il comando di Claude Code. Di solito basta `claude`; su Windows può servire il
  percorso completo, perché il compito pianificato non ha lo stesso PATH della
  tua sessione.

.PARAMETER Server
  Il nome con cui il server MCP è registrato (`claude mcp list`). Entra nei nomi
  degli strumenti: `mcp__mente__oggi`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Recap-Mattina.ps1

.NOTES
  Per registrarlo alle cinque: `.\Registra-Compito.ps1`.
  Il resto — cosa contiene il recap, come si prova, cosa guardare quando non
  arriva — sta in docs/recap-mattina.md.
#>

[CmdletBinding()]
param(
  [string]$Progetto,
  [string]$Claude = 'claude',
  [string]$Server = 'mente',
  [string]$Prompt,
  [string]$CartellaLog = (Join-Path $env:LOCALAPPDATA 'mente-digitale\recap'),
  [int]$LogDaTenere = 14
)

$ErrorActionPreference = 'Stop'

# I percorsi che dipendono da dove sta questo file si calcolano **qui**, non
# come valore di default dentro `param()`: in Windows PowerShell 5.1
# `$PSScriptRoot` lì dentro è ancora vuoto, e `Join-Path` si ferma con «stringa
# vuota» prima che lo script esista davvero. Nel corpo è valorizzato — è la
# stessa riga che in Registra-Compito.ps1 funziona da sempre.
$radice = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
if (-not $Prompt)   { $Prompt   = Join-Path $radice 'prompt-recap.md' }
if (-not $Progetto) { $Progetto = (Resolve-Path (Join-Path $radice '..\..')).Path }

if (-not (Test-Path $Prompt)) { throw "Prompt non trovato: $Prompt" }
if (-not (Test-Path $Progetto)) { throw "Cartella del progetto non trovata: $Progetto" }

# Gli strumenti che il compito può usare. In lettura tutto quello che serve a
# capire com'è messa la giornata; in scrittura `recap` e basta — è l'unica cosa
# che questo compito ha il diritto di cambiare.
$strumenti = @(
  'oggi', 'agenda', 'piano', 'piano_auto', 'posta',
  'attivita_lista', 'sezioni', 'obiettivi_leggi', 'programma',
  'recap'
) | ForEach-Object { "mcp__${Server}__$_" }

# E il web, per i titoli del giorno in coda al recap. Sono di Claude Code, non
# del server MCP, e vanno nominati anche loro: in modalità non interattiva
# quello che non è dichiarato non si può usare, e il recap uscirebbe senza
# notizie senza che nessuno dica perché.
$strumenti += @('WebSearch', 'WebFetch')

New-Item -ItemType Directory -Force -Path $CartellaLog | Out-Null
$log = Join-Path $CartellaLog ("recap-{0:yyyy-MM-dd}.log" -f (Get-Date))

"=== {0:yyyy-MM-dd HH:mm:ss} — recap del mattino ===" -f (Get-Date) | Out-File $log -Append -Encoding utf8
"progetto: $Progetto" | Out-File $log -Append -Encoding utf8

try {
  # Il prompt arriva da stdin invece che come argomento: un testo di duemila
  # caratteri su una riga di comando di Windows è il modo di scoprire il limite
  # degli 8191 caratteri in una notte qualunque, e senza un errore leggibile.
  $testo = Get-Content -Path $Prompt -Raw -Encoding utf8

  Push-Location $Progetto
  $risposta = $testo | & $Claude -p `
    --allowedTools ($strumenti -join ',') `
    --output-format text 2>&1
  $codice = $LASTEXITCODE
  Pop-Location

  $risposta | Out-File $log -Append -Encoding utf8

  if ($codice -ne 0) { throw "claude è uscito con codice $codice" }
  "--- fatto {0:HH:mm:ss} ---" -f (Get-Date) | Out-File $log -Append -Encoding utf8
}
catch {
  # L'errore finisce nel log e nel codice di uscita, così la colonna «Risultato
  # ultima esecuzione» dell'Utilità di pianificazione dice la verità. Il recap
  # di ieri resta dov'è: è quello che rende questo fallimento innocuo.
  "ERRORE: $($_.Exception.Message)" | Out-File $log -Append -Encoding utf8
  exit 1
}
finally {
  # I log vecchi si buttano: sono righe di servizio, non un archivio.
  Get-ChildItem $CartellaLog -Filter 'recap-*.log' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $LogDaTenere |
    Remove-Item -Force -ErrorAction SilentlyContinue
}
