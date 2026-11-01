# =============================================================================
# Fiyat Takip (price-tracker-tr) — Windows tek komut kurulum / güncelleme
#
# Kullanım: PowerShell'i aç ve şunu yapıştır:
#   irm https://raw.githubusercontent.com/alpkucukkayalar/price-tracker-tr/main/scripts/kur-windows.ps1 | iex
#
# Ne yapar:
#   1. Node.js 22 yoksa kurar (Windows bir kez "izin ver" sorabilir)
#   2. Uygulamayı %USERPROFILE%\fiyat-takip\app altına indirir ve derler
#   3. Rastgele gizli anahtarlarla .env oluşturur (varsa dokunmaz)
#   4. Bilgisayar açılıp oturum açınca arka planda otomatik başlatır
#   5. Prize takılıyken bilgisayarın uykuya geçmesini kapatır
#   6. Tarayıcıda http://localhost:3100 açar
#
# Tekrar çalıştırmak güvenlidir: kodu günceller; .env ve veriler korunur.
# =============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Branch  = if ($env:BRANCH) { $env:BRANCH } else { 'main' }
$Repo    = 'alpkucukkayalar/price-tracker-tr'
$Root    = Join-Path $env:USERPROFILE 'fiyat-takip'
$AppDir  = Join-Path $Root 'app'
$DataDir = Join-Path $Root 'data'
$EnvFile = Join-Path $Root '.env'
$Port    = 3100
$TaskName = 'FiyatTakip'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Green }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

New-Item -ItemType Directory -Force -Path $Root, $DataDir | Out-Null

# --- 1. Node.js 22 -----------------------------------------------------------
Refresh-Path
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
  $major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
  $nodeOk = ($major -eq 22)
}
if (-not $nodeOk) {
  Step 'Node.js 22 kuruluyor (Windows izin sorarsa "Evet" de)'
  $rel = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
  $msi = Join-Path $env:TEMP "node-$($rel.version)-x64.msi"
  Invoke-WebRequest "https://nodejs.org/dist/$($rel.version)/node-$($rel.version)-x64.msi" -OutFile $msi
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /passive /norestart" -Verb RunAs -Wait
  Refresh-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js kurulamadı. PowerShell''i kapatıp açıp komutu tekrar çalıştır.' }
}
Write-Host "Node $(node --version)"

# --- 2. Kodu indir -------------------------------------------------------------
Step "Uygulama indiriliyor ($Branch)"
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*fiyat-takip*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$zip = Join-Path $env:TEMP 'fiyat-takip.zip'
$ref = $Branch -replace '/', '%2F'
Invoke-WebRequest "https://codeload.github.com/$Repo/zip/refs/heads/$ref" -OutFile $zip
$tmp = Join-Path $env:TEMP 'fiyat-takip-src'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip -DestinationPath $tmp
$src = Get-ChildItem $tmp | Select-Object -First 1
# Keep installed node_modules between updates (faster), replace everything else.
if (Test-Path $AppDir) {
  Get-ChildItem $AppDir -Exclude 'server', 'client' | Remove-Item -Recurse -Force
  foreach ($p in 'server', 'client') {
    if (Test-Path (Join-Path $AppDir $p)) { Get-ChildItem (Join-Path $AppDir $p) -Exclude 'node_modules' | Remove-Item -Recurse -Force }
  }
}
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Copy-Item (Join-Path $src.FullName '*') $AppDir -Recurse -Force

# --- 3. Bağımlılıklar ve derleme -------------------------------------------------
Step 'Bağımlılıklar ve derleme (5-10 dakika sürebilir)'
Push-Location (Join-Path $AppDir 'server')
npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm ci (server) başarısız' }
npx playwright install chromium chromium-headless-shell; if ($LASTEXITCODE) { throw 'Chromium indirilemedi' }
npm run build; if ($LASTEXITCODE) { throw 'Server derlenemedi' }
Pop-Location
Push-Location (Join-Path $AppDir 'client')
npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm ci (client) başarısız' }
$env:VITE_DISPLAY_CURRENCY = 'TRY'
npm run build; if ($LASTEXITCODE) { throw 'Arayüz derlenemedi' }
Pop-Location

# --- 4. .env (bir kez) ---------------------------------------------------------------
if (-not (Test-Path $EnvFile)) {
  Step '.env oluşturuluyor'
  function Rand { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" }
  $db = ((Join-Path $DataDir 'price-tracker.db') -replace '\\', '/')
  @"
PORT=$Port
DATABASE_PATH=$db
NODE_ENV=production
COOKIE_SECURE=false
JWT_SECRET=$(Rand)
SETTINGS_ENCRYPTION_KEY=$(Rand)
PUBLIC_URL=http://localhost:$Port
DISPLAY_CURRENCY=TRY
CAMPAIGN_NAME=Efsane Cuma / Black Friday 2026
CAMPAIGN_START=2026-11-27
CAMPAIGN_END=2026-11-30
CAMPAIGN_CHECK_INTERVAL_MINUTES=60
CAMPAIGN_BOOST_LEAD_DAYS=1
"@ | Set-Content -Path $EnvFile -Encoding ascii
}

# --- 5. Otomatik başlatma -------------------------------------------------------------
Step 'Otomatik başlatma ayarlanıyor'
$serverDir = Join-Path $AppDir 'server'
$logFile = Join-Path $DataDir 'log.txt'
$nodeExe = (Get-Command node).Source
# The server writes its own log file (LOG_FILE) instead of piping through
# PowerShell, and the loop restarts it within 10 s if it ever exits.
$cmd = "Set-Location '$serverDir'; `$env:LOG_FILE='$logFile'; while (`$true) { & '$nodeExe' --env-file='$EnvFile' dist/index.js; Start-Sleep -Seconds 10 }"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
if (Test-Path $logFile) { Clear-Content $logFile }
Start-ScheduledTask -TaskName $TaskName

# --- 6. Uyku modu (prizdeyken) -----------------------------------------------------------
Step 'Prize takılıyken uyku kapatılıyor'
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null

# --- 7. Aç -----------------------------------------------------------------------------
Step 'Uygulama başlatılıyor'
$url = "http://localhost:$Port"
$setup = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $logFile) {
    $m = Select-String -Path $logFile -Pattern 'setup\?token=[a-f0-9]+' -AllMatches | Select-Object -Last 1
    if ($m) { $setup = "$url/" + $m.Matches[-1].Value; break }
  }
  try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; if ($i -gt 4) { break } } catch {}
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " Kurulum tamam!  Adres: $url" -ForegroundColor Green
if ($setup) {
  Write-Host " İlk hesabını oluşturmak için tarayıcı açılıyor:"
  Write-Host "   $setup"
  Start-Process $setup
} else {
  Start-Process $url
}
Write-Host " Loglar:   $logFile"
Write-Host " Güncelle: bu komutu tekrar çalıştır"
Write-Host " Yedek:    $DataDir klasörünü kopyala"
Write-Host "========================================================" -ForegroundColor Green
