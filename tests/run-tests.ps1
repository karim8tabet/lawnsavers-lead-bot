# Sends the demo payloads to the n8n webhook.
#
# Usage:
#   .\tests\run-tests.ps1 -Url https://YOUR.app.n8n.cloud/webhook/lawnsavers-lead -Email you@gmail.com
#   .\tests\run-tests.ps1 -Url ... -Email ... -Case complaint
#   .\tests\run-tests.ps1 -Url ... -Email ... -Secret mysecret   # if the webhook uses Header Auth
#
# -Email is your own inbox. Each case uses a +tag (you+normal@gmail.com, ...) so
# auto-replies come back to you and HubSpot sees a separate contact per case.
# The duplicate case is sent twice: HubSpot should end up with ONE contact and two notes.

param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Email,
  [ValidateSet('all', 'normal', 'complaint', 'injection', 'junk', 'duplicate')][string]$Case = 'all',
  [string]$Secret = ''
)

$ErrorActionPreference = 'Stop'
$parts = $Email.Split('@')
if ($parts.Length -ne 2) { throw "Email must look like you@gmail.com" }

$headers = @{}
if ($Secret) { $headers['X-Webhook-Secret'] = $Secret }

function Send-Case([string]$file) {
  $raw = Get-Content -Raw -Encoding UTF8 $file
  $body = $raw.Replace('EMAIL_USER', $parts[0]).Replace('EMAIL_DOMAIN', $parts[1])
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  Write-Host "-> $(Split-Path -Leaf $file)" -ForegroundColor Cyan
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $Url -ContentType 'application/json; charset=utf-8' -Headers $headers -Body $bytes
    Write-Host "   OK: $($resp | ConvertTo-Json -Compress)" -ForegroundColor Green
  } catch {
    Write-Host "   FAILED: $($_.Exception.Message)" -ForegroundColor Red
  }
}

$dir = Join-Path $PSScriptRoot 'payloads'
$files = Get-ChildItem $dir -Filter *.json | Sort-Object Name
if ($Case -ne 'all') { $files = $files | Where-Object { $_.Name -like "*-$Case.json" } }

foreach ($f in $files) {
  Send-Case $f.FullName
  if ($f.Name -like '*-duplicate.json') {
    Start-Sleep -Seconds 5
    Write-Host '   (sending the same email again)'
    Send-Case $f.FullName
  }
  Start-Sleep -Seconds 2
}

Write-Host "`nNow check: n8n Executions, your inbox, HubSpot contacts, and the Google Sheet."
