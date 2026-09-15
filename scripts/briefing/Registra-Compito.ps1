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
  Registra il compito delle cinque nell'Utilità di pianificazione di Windows.

.DESCRIPTION
  Una volta sola, su questa macchina. Il compito deve girare **anche a sessione
  bloccata o utente scollegato**, che è il caso normale alle cinque del mattino:
  è tutta la differenza fra un briefing che c'è e uno che si scopre mancante
  mentre si fa colazione.

  Si prova in scala, perché su un PC aziendale il modo migliore può essere
  semplicemente vietato e lo si scopre solo provando:

  - **S4U** (il primo che si prova): Windows avvia il compito a nome tuo senza
    conservare la password. Funziona a schermo bloccato e a utente scollegato,
    e basta per un programma che parla solo via HTTPS. Vuole il diritto «Accedi
    come processo batch», che su un PC aziendale può non esserci.
  - **Password** (`-ConPassword`): la si digita una volta e Windows la
    custodisce. Si prova per primo solo se lo chiedi, perché conservare una
    password è una decisione, non un ripiego automatico.
  - **Interattivo**, e poi la stessa cosa via `schtasks.exe`: il compito parte
    mentre sei collegato, **anche a schermo bloccato** — che su una VDI è il
    caso normale, visto che disconnettersi non chiude la sessione. Non parte se
    ti scolleghi davvero, e lo script te lo dice a chiare lettere invece di
    lasciartelo scoprire una mattina senza briefing.

  Se la sessione è bloccata da criteri aziendali che uccidono i processi
  dell'utente allo screen lock, nessuno dei due modi basta: in quel caso il
  compito va messo su un'altra macchina sempre accesa. Il briefing non se ne
  accorge — legge e scrive su OneDrive, non su questo disco.

.PARAMETER Nome
  Il nome del compito nell'Utilità di pianificazione.

.PARAMETER Ora
  A che ora, ogni giorno. Il valore di default è le cinque: l'ora in cui nessuno
  sta usando il PC e il briefing è comunque fresco al risveglio.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Registra-Compito.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Registra-Compito.ps1 -ConPassword -Ora 04:30

.NOTES
  Per toglierlo:  Unregister-ScheduledTask -TaskName "Mente digitale - briefing del mattino"
  Per provarlo:   Start-ScheduledTask   -TaskName "Mente digitale - briefing del mattino"
#>

[CmdletBinding()]
param(
  [string]$Nome = 'Mente digitale - briefing del mattino',
  [string]$Ora = '05:00',
  [switch]$ConPassword,
  [int]$MinutiMassimi = 20
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'Briefing-Mattina.ps1'
if (-not (Test-Path $script)) { throw "Non trovo Briefing-Mattina.ps1 accanto a questo file." }

$azione = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $PSScriptRoot

$quando = New-ScheduledTaskTrigger -Daily -At $Ora

# `StartWhenAvailable`: se alle cinque la macchina era spenta o sospesa, il
# compito parte appena torna disponibile invece di saltare il giorno. Un
# briefing delle sette è ancora un briefing; nessun briefing è un buco.
# `ExecutionTimeLimit`: un modello che si impianta non deve restare acceso fino
# a sera — venti minuti sono molti più dei due che servono.
$impostazioni = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes $MinutiMassimi) `
  -MultipleInstances IgnoreNew

$utente = "$env:USERDOMAIN\$env:USERNAME"

# ── I modi di registrarlo, dal migliore al ripiego ───────────────────────────
# Su un PC aziendale il modo migliore può essere semplicemente vietato, e lo si
# scopre solo provando: registrare un compito S4U vuole il diritto «Accedi come
# processo batch», che l'amministratore di dominio può non aver dato. Il
# fallimento è un «Accesso negato» secco (0x80070005) che non spiega cosa
# manca, e la reazione sbagliata — l'unica possibile fino a ieri — era fermarsi
# lì e restare senza briefing.
#
# Quindi si prova in scala, e **si dice sempre quale livello si è ottenuto**,
# perché cambia quando il compito parte davvero:
#
#   password     gira anche a utente scollegato. La password la custodisce
#                Windows, e la si digita una volta sola.
#   S4U          uguale, senza che nessuna password venga conservata.
#   interattivo  gira mentre sei collegato, **anche a schermo bloccato** — che
#                su una VDI è il caso normale, perché disconnettersi non chiude
#                la sessione. Si perde solo se ti scolleghi davvero.
#   schtasks     lo stesso livello, per la strada vecchia: a volte l'unica che
#                i criteri lasciano aperta, perché non passa dalle stesse API.
#
# Un compito interattivo non è la stessa cosa di uno S4U, e spacciarlo per tale
# sarebbe il modo di scoprire a marzo che il briefing non arrivava da gennaio.

$modi = @()
if ($ConPassword) {
  $password = Read-Host "Password di $utente" -AsSecureString
  $chiaro = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
  $modi += @{
    nome  = 'password'
    dove  = 'anche a sessione bloccata o utente scollegato'
    prova = { Register-ScheduledTask -TaskName $Nome -Action $azione -Trigger $quando `
                -Settings $impostazioni -User $utente -Password $chiaro -RunLevel Limited -Force }
  }
}
$modi += @{
  nome  = 'S4U'
  dove  = 'anche a sessione bloccata o utente scollegato, senza password conservata'
  prova = {
    $p = New-ScheduledTaskPrincipal -UserId $utente -LogonType S4U -RunLevel Limited
    Register-ScheduledTask -TaskName $Nome -Action $azione -Trigger $quando `
      -Settings $impostazioni -Principal $p -Force
  }
}
$modi += @{
  nome  = 'interattivo'
  dove  = 'mentre sei collegato, anche a schermo bloccato — NON se ti scolleghi'
  prova = {
    $p = New-ScheduledTaskPrincipal -UserId $utente -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Nome -Action $azione -Trigger $quando `
      -Settings $impostazioni -Principal $p -Force
  }
}
$modi += @{
  nome  = 'schtasks'
  dove  = 'mentre sei collegato, anche a schermo bloccato — NON se ti scolleghi'
  prova = {
    $comando = 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"'
    $out = & schtasks.exe /Create /F /TN $Nome /SC DAILY /ST $Ora /TR $comando 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($out -join ' ') }
  }
}

$riuscito = $null
$errori = @()
foreach ($m in $modi) {
  try {
    & $m.prova | Out-Null
    $riuscito = $m
    break
  }
  catch {
    # Si prende nota e si scende di un gradino. L'errore serve dopo: se non
    # riesce nemmeno l'ultimo, va mostrato quello di ciascuno — «non ha
    # funzionato» senza dire cosa ha risposto Windows non si può diagnosticare.
    $errori += "$($m.nome): $($_.Exception.Message.Trim())"
  }
}

if ($chiaro) { Remove-Variable chiaro }

if (-not $riuscito) {
  Write-Host "✗ Non sono riuscito a registrare il compito in nessun modo:" -ForegroundColor Red
  $errori | ForEach-Object { Write-Host "   - $_" }
  Write-Host ""
  Write-Host "  Le tre cose da provare, in quest'ordine:"
  Write-Host "   1. riapri PowerShell come amministratore, se su questa macchina puoi;"
  Write-Host "   2. chiedi all'IT il diritto «Accedi come processo batch» per il tuo utente"
  Write-Host "      (secpol.msc → Assegnazione diritti utente), che è quello che serve a S4U;"
  Write-Host "   3. se i criteri non lo consentono, il compito va su un'altra macchina sempre"
  Write-Host "      accesa: il briefing legge e scrive su OneDrive, quindi non cambia niente."
  Write-Host ""
  Write-Host "  Intanto il briefing lo puoi scrivere a mano quando vuoi:"
  Write-Host "   powershell -ExecutionPolicy Bypass -File .\Briefing-Mattina.ps1"
  exit 1
}

Write-Host "✓ registrato: «$Nome», ogni giorno alle $Ora ($($riuscito.nome))."
Write-Host "  Quando parte:    $($riuscito.dove)"
if ($riuscito.nome -in @('interattivo', 'schtasks')) {
  Write-Host "  ⚠ Questo livello non basta a utente scollegato. Su una VDI di solito va bene" -ForegroundColor Yellow
  Write-Host "    lo stesso — disconnettersi non è scollegarsi — ma se una mattina il briefing" -ForegroundColor Yellow
  Write-Host "    non c'è, è il primo sospetto. Per quello pieno serve S4U: vedi docs/briefing-mattina.md." -ForegroundColor Yellow
}
Write-Host "  Provalo adesso:  Start-ScheduledTask -TaskName '$Nome'"
Write-Host "  Il log sta in:   $env:LOCALAPPDATA\mente-digitale\briefing"
