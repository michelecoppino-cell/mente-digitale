<#
.SYNOPSIS
  Registra il compito delle cinque nell'Utilità di pianificazione di Windows.

.DESCRIPTION
  Una volta sola, su questa macchina. Il compito deve girare **anche a sessione
  bloccata o utente scollegato**, che è il caso normale alle cinque del mattino:
  è tutta la differenza fra un recap che c'è e uno che si scopre mancante
  mentre si fa colazione.

  Due modi di ottenerlo, e sono l'uno l'alternativa dell'altro:

  - **S4U** (quello di default): Windows avvia il compito a nome tuo senza
    conservare la password. Funziona a schermo bloccato e a utente scollegato,
    e basta per un programma che parla solo via HTTPS. Vuole il diritto «Accedi
    come processo batch», che di solito l'utente di un PC aziendale ha già.
  - **Password** (`-ConPassword`): la si digita una volta e Windows la
    custodisce. Serve dove S4U è negato dai criteri di dominio — succede — o
    dove il compito dovesse leggere una cartella di rete.

  Se la sessione è bloccata da criteri aziendali che uccidono i processi
  dell'utente allo screen lock, nessuno dei due modi basta: in quel caso il
  compito va messo su un'altra macchina sempre accesa. Il recap non se ne
  accorge — legge e scrive su OneDrive, non su questo disco.

.PARAMETER Nome
  Il nome del compito nell'Utilità di pianificazione.

.PARAMETER Ora
  A che ora, ogni giorno. Il valore di default è le cinque: l'ora in cui nessuno
  sta usando il PC e il recap è comunque fresco al risveglio.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Registra-Compito.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Registra-Compito.ps1 -ConPassword -Ora 04:30

.NOTES
  Per toglierlo:  Unregister-ScheduledTask -TaskName "Mente digitale — recap del mattino"
  Per provarlo:   Start-ScheduledTask   -TaskName "Mente digitale — recap del mattino"
#>

[CmdletBinding()]
param(
  [string]$Nome = 'Mente digitale — recap del mattino',
  [string]$Ora = '05:00',
  [switch]$ConPassword,
  [int]$MinutiMassimi = 20
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'Recap-Mattina.ps1'
if (-not (Test-Path $script)) { throw "Non trovo Recap-Mattina.ps1 accanto a questo file." }

$azione = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $PSScriptRoot

$quando = New-ScheduledTaskTrigger -Daily -At $Ora

# `StartWhenAvailable`: se alle cinque la macchina era spenta o sospesa, il
# compito parte appena torna disponibile invece di saltare il giorno. Un recap
# delle sette è ancora un recap; nessun recap è un buco.
# `ExecutionTimeLimit`: un modello che si impianta non deve restare acceso fino
# a sera — venti minuti sono molti più dei due che servono.
$impostazioni = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes $MinutiMassimi) `
  -MultipleInstances IgnoreNew

$utente = "$env:USERDOMAIN\$env:USERNAME"

if ($ConPassword) {
  $password = Read-Host "Password di $utente" -AsSecureString
  $chiaro = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
  Register-ScheduledTask -TaskName $Nome -Action $azione -Trigger $quando `
    -Settings $impostazioni -User $utente -Password $chiaro -RunLevel Limited -Force | Out-Null
  Remove-Variable chiaro
}
else {
  # S4U: gira a utente scollegato senza che la password venga conservata da
  # nessuna parte.
  $principale = New-ScheduledTaskPrincipal -UserId $utente -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName $Nome -Action $azione -Trigger $quando `
    -Settings $impostazioni -Principal $principale -Force | Out-Null
}

Write-Host "✓ registrato: «$Nome», ogni giorno alle $Ora, anche a sessione bloccata."
Write-Host "  Provalo adesso:  Start-ScheduledTask -TaskName `"$Nome`""
Write-Host "  Il log sta in:   $env:LOCALAPPDATA\mente-digitale\recap"
