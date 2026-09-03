<#
.SYNOPSIS
  Ricava il refresh token dell'account Microsoft **personale**, senza installare
  niente.

.DESCRIPTION
  Fa la stessa cosa di `node scripts/get-refresh-token.mjs`, ma in PowerShell:
  serve a chi non ha Node e non ha una copia del progetto sul computer, cioè al
  caso normale di chi deve solo mettere in piedi la Action del calendario di
  lavoro e non ha nessuna intenzione di scrivere codice.

  Si accede col telefono o col browser (login «device code»: compare un codice,
  lo si scrive su microsoft.com/devicelogin), e alla fine stampa il token da
  incollare nel segreto GitHub `MENTE_REFRESH_TOKEN`.

  **Va eseguito con l'account Microsoft personale**, non con quello di lavoro:
  è il OneDrive personale quello su cui l'app scrive.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Prendi-Token.ps1

.NOTES
  Il token è la chiave del OneDrive personale: vale quanto la password. Non
  finisce in nessun file — resta a schermo, si copia nel segreto GitHub e si
  chiude la finestra.

  Gli **scope sono scritti anche qui**, ed è l'unico posto in cui sono ripetuti:
  la loro casa è `MENTE_SCOPE` in scripts/mente-graph.mjs. Sono cuciti dentro al
  token, non chiesti a ogni chiamata, quindi chi allarga quell'elenco deve
  allargarlo anche qui — e rifare il token, o gli strumenti nuovi risponderanno
  403 senza che niente dica perché.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$CLIENT_ID = 'b639e8ea-2c30-4beb-8226-46e342721a50'
$SCOPE = 'offline_access Files.ReadWrite Notes.ReadWrite Notes.ReadWrite.All Calendars.ReadWrite Mail.Read'
$BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'

Write-Host ''
Write-Host 'Chiedo a Microsoft un codice di accesso...' -ForegroundColor Cyan

$dc = Invoke-RestMethod -Method Post -Uri "$BASE/devicecode" `
  -Body @{ client_id = $CLIENT_ID; scope = $SCOPE }

Write-Host ''
Write-Host $dc.message -ForegroundColor Yellow
Write-Host ''
Write-Host 'Accedi con il tuo account Microsoft PERSONALE (non quello di lavoro).'
Write-Host 'Aspetto qui: quando hai finito, il token compare da solo.'
Write-Host ''

$scadenza = (Get-Date).AddSeconds($dc.expires_in)
$attesa = [Math]::Max(5, $dc.interval)

while ((Get-Date) -lt $scadenza) {
  Start-Sleep -Seconds $attesa
  try {
    $tok = Invoke-RestMethod -Method Post -Uri "$BASE/token" -Body @{
      grant_type  = 'urn:ietf:params:oauth:grant-type:device_code'
      client_id   = $CLIENT_ID
      device_code = $dc.device_code
    }
  }
  catch {
    # «authorization_pending» è la risposta normale finché non si è finito di
    # accedere: arriva come errore HTTP 400, e non è un errore.
    $dettaglio = ''
    try { $dettaglio = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
    if ($dettaglio -eq 'authorization_pending') { continue }
    if ($dettaglio -eq 'authorization_declined') { throw 'Accesso rifiutato.' }
    if ($dettaglio -eq 'expired_token') { throw 'Il codice è scaduto: rilancia lo script.' }
    throw "Non è riuscito: $($_.Exception.Message)"
  }

  if ($tok.refresh_token) {
    Write-Host ''
    Write-Host ('-' * 64)
    Write-Host 'REFRESH TOKEN — copialo tutto, dalla prima all''ultima lettera,' -ForegroundColor Green
    Write-Host 'e incollalo nel segreto GitHub MENTE_REFRESH_TOKEN:' -ForegroundColor Green
    Write-Host ('-' * 64)
    Write-Host ''
    Write-Host $tok.refresh_token
    Write-Host ''
    Write-Host ('-' * 64)
    Write-Host 'Vale quanto la password del tuo OneDrive: non mandarlo a nessuno.'
    return
  }
}

throw 'Tempo scaduto senza accesso: rilancia lo script.'
