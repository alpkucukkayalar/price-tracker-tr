#!/usr/bin/env bash
# =============================================================================
# Fiyat Takip (price-tracker-tr) — macOS tek komut kurulum / güncelleme
#
# Kullanım (Terminal'de, sudo GEREKMEZ):
#   curl -fsSL https://raw.githubusercontent.com/alpkucukkayalar/price-tracker-tr/main/scripts/kur-mac.sh | bash
#
# Ne yapar:
#   1. Node.js 22'yi ~/fiyat-takip/node altına indirir (sisteme dokunmaz)
#   2. Uygulamayı ~/fiyat-takip/app altına indirir ve derler
#   3. Rastgele gizli anahtarlarla ~/fiyat-takip/.env oluşturur (varsa dokunmaz)
#   4. launchd ile oturum açılınca otomatik başlatır, çökerse yeniden başlatır
#   5. Uygulama çalışırken Mac'in uykuya geçmesini engeller (caffeinate)
#   6. Tarayıcıda http://localhost:3100 açar
#
# Tekrar çalıştırmak güvenlidir: kodu günceller; .env ve veriler korunur.
# =============================================================================
set -euo pipefail

BRANCH="${BRANCH:-main}"
REPO="alpkucukkayalar/price-tracker-tr"
ROOT="$HOME/fiyat-takip"
APP="$ROOT/app"
DATA="$ROOT/data"
ENV_FILE="$ROOT/.env"
NODE_DIR="$ROOT/node"
PORT=3100
LABEL="com.fiyattakip.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
mkdir -p "$ROOT" "$DATA"

# --- 1. Node 22 (yerel, sudo yok) ------------------------------------------------
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x64"
if [ ! -x "$NODE_DIR/bin/node" ] || [ "$("$NODE_DIR/bin/node" -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  step "Node.js 22 indiriliyor ($ARCH)"
  VER="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v22\.[0-9.]*"' | head -1 | cut -d'"' -f4)"
  rm -rf "${NODE_DIR:?}" && mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-darwin-$ARCH.tar.gz" | tar -xz -C "$NODE_DIR" --strip-components 1
fi
export PATH="$NODE_DIR/bin:$PATH"
echo "Node $(node --version)"

# --- 2. Kod -------------------------------------------------------------------------
step "Uygulama indiriliyor ($BRANCH)"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
TMP="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP" --strip-components 1
mkdir -p "$APP"
# node_modules'u koru (güncellemeler hızlı olsun), gerisini yenile
find "$APP" -mindepth 1 -maxdepth 1 ! -name server ! -name client -exec rm -rf {} +
for p in server client; do
  [ -d "$APP/$p" ] && find "$APP/$p" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
done
cp -R "$TMP"/. "$APP"/
rm -rf "$TMP"

# --- 3. Derleme -----------------------------------------------------------------------
step "Bağımlılıklar ve derleme (5-10 dakika sürebilir)"
( cd "$APP/server" && npm ci --no-audit --no-fund && npx --yes playwright install chromium && npm run build )
( cd "$APP/client" && npm ci --no-audit --no-fund && VITE_DISPLAY_CURRENCY=TRY npm run build )

# --- 4. .env ----------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  step ".env oluşturuluyor"
  rand() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
DATABASE_PATH=$DATA/price-tracker.db
NODE_ENV=production
COOKIE_SECURE=false
JWT_SECRET=$(rand)
SETTINGS_ENCRYPTION_KEY=$(rand)
PUBLIC_URL=http://localhost:$PORT
DISPLAY_CURRENCY=TRY
CAMPAIGN_NAME=Efsane Cuma / Black Friday 2026
CAMPAIGN_START=2026-11-27
CAMPAIGN_END=2026-11-30
CAMPAIGN_CHECK_INTERVAL_MINUTES=60
CAMPAIGN_BOOST_LEAD_DAYS=1
EOF
  chmod 600 "$ENV_FILE"
fi

# --- 5. launchd ---------------------------------------------------------------------------
step "Otomatik başlatma (launchd)"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$APP/server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-is</string>
    <string>$NODE_DIR/bin/node</string><string>--env-file=$ENV_FILE</string><string>dist/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DATA/log.txt</string>
  <key>StandardErrorPath</key><string>$DATA/log.txt</string>
</dict>
</plist>
EOF
: > "$DATA/log.txt"
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# --- 6. Aç ---------------------------------------------------------------------------------
step "Uygulama başlatılıyor"
URL="http://localhost:$PORT"
SETUP=""
for _ in $(seq 1 30); do
  sleep 2
  SETUP="$(grep -o 'setup?token=[a-f0-9]*' "$DATA/log.txt" | tail -1 || true)"
  [ -n "$SETUP" ] && break
  curl -fs -o /dev/null "$URL" && [ "$(grep -c . "$DATA/log.txt")" -gt 5 ] && break
done
printf '\n\033[1;32m Kurulum tamam!  Adres: %s\033[0m\n' "$URL"
if [ -n "$SETUP" ]; then
  echo " İlk hesabını oluşturmak için: $URL/$SETUP"
  open "$URL/$SETUP" || true
else
  open "$URL" || true
fi
echo " Loglar:   $DATA/log.txt"
echo " Güncelle: bu komutu tekrar çalıştır"
echo " Durdur:   launchctl bootout gui/\$(id -u)/$LABEL"
