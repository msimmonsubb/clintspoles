# Starts the pole site server and a free Cloudflare quick tunnel (Windows).
# Run from this folder:   powershell -ExecutionPolicy Bypass -File .\start-tunnel.ps1
#
# Needs: node (https://nodejs.org) and cloudflared (winget install Cloudflare.cloudflared)
# The https://....trycloudflare.com address changes every time this script starts.
# It is printed here and written to tunnel-url.txt so you can copy it.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$port = if ($env:PORT) { $env:PORT } else { '8080' }

foreach ($tool in 'node', 'cloudflared') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Host "Missing '$tool'. Install it first (node: https://nodejs.org, cloudflared: winget install Cloudflare.cloudflared)" -ForegroundColor Red
    exit 1
  }
}

$env:PORT = $port
$server = Start-Process node -ArgumentList 'server.js' -NoNewWindow -PassThru
Start-Sleep -Seconds 1
if ($server.HasExited) { Write-Host "server.js failed to start" -ForegroundColor Red; exit 1 }

$log = Join-Path $here 'tunnel.log'
if (Test-Path $log) { Remove-Item $log }
$tunnel = Start-Process cloudflared -ArgumentList "tunnel --url http://localhost:$port --no-autoupdate" -NoNewWindow -PassThru -RedirectStandardError $log

Write-Host "Waiting for Cloudflare to hand out a URL..."
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if ($url) {
  Set-Content -Path (Join-Path $here 'tunnel-url.txt') -Value $url
  Write-Host ""
  Write-Host "  Pole site is live at:  $url" -ForegroundColor Green
  Write-Host "  (also saved to tunnel-url.txt)"
  Write-Host ""
  Write-Host "  Leave this window open. Ctrl+C stops the server and the tunnel."
} else {
  Write-Host "cloudflared did not report a URL in 60 s. See tunnel.log" -ForegroundColor Yellow
}

try { Wait-Process -Id $tunnel.Id } finally {
  foreach ($p in $server, $tunnel) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
