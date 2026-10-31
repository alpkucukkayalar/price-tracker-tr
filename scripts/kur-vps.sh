#!/usr/bin/env bash
# =============================================================================
# Fiyat Takip (price-tracker-tr) — Ubuntu VPS tek komut kurulum / güncelleme
#
# Kullanım (sunucuda root olarak):
#   curl -fsSL https://raw.githubusercontent.com/alpkucukkayalar/price-tracker-tr/main/scripts/kur-vps.sh | bash
#
# Ne yapar:
#   1. Node.js 22, git, Caddy (otomatik HTTPS) kurar
#   2. Uygulamayı /opt/fiyat-takip altına indirir, derler
#   3. Rastgele gizli anahtarlarla .env oluşturur (varsa dokunmaz)
#   4. systemd servisi kurar → sunucu açılınca otomatik başlar, çökerse yeniden başlar
#   5. https://<IP>.sslip.io adresinde ücretsiz Let's Encrypt sertifikasıyla yayınlar
#   6. Güvenlik duvarında sadece 22 (SSH), 80, 443 portlarını açar
#
# Tekrar çalıştırmak güvenlidir: kodu günceller, yeniden derler, servisi yeniden
# başlatır; .env ve veritabanı korunur.
#
# Ayarlanabilir: BRANCH (varsayılan main), DOMAIN (kendi alan adın varsa).
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/alpkucukkayalar/price-tracker-tr.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/fiyat-takip
APP_USER=fiyat
PORT=3100

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mHATA: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Bu script root olarak çalışmalı (önce: sudo -i)"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || [ "${ID:-}" = "debian" ] || die "Sadece Ubuntu/Debian destekleniyor (bulunan: ${ID:-?})"

# --- Sunucu adresi -----------------------------------------------------------
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me || true)"
  [ -n "$IP" ] || die "Sunucunun genel IP adresi bulunamadı; DOMAIN=... ile belirt"
  DOMAIN="${IP//./-}.sslip.io"
fi
PUBLIC_URL="https://${DOMAIN}"

export DEBIAN_FRONTEND=noninteractive

log "Sistem paketleri"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https

# --- Swap (2 GB RAM'de Chromium + derleme için rahatlık) ----------------------
if ! swapon --show | grep -q .; then
  log "2 GB swap alanı"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Node.js 22 ----------------------------------------------------------------
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  log "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# --- Caddy ---------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  log "Caddy (HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

# --- Uygulama kullanıcısı ve kod ---------------------------------------------------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$APP_USER --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  log "Kod güncelleniyor ($BRANCH)"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  log "Kod indiriliyor ($BRANCH)"
  mkdir -p "$APP_DIR" && chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

log "Bağımlılıklar ve derleme (birkaç dakika sürebilir)"
cd "$APP_DIR/server"
sudo -u "$APP_USER" -H npm ci --no-audit --no-fund
npx --yes playwright install-deps chromium
sudo -u "$APP_USER" -H npx playwright install chromium
sudo -u "$APP_USER" -H npm run build
cd "$APP_DIR/client"
sudo -u "$APP_USER" -H npm ci --no-audit --no-fund
sudo -u "$APP_USER" -H env VITE_DISPLAY_CURRENCY=TRY npm run build

# --- .env (bir kez) ----------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log ".env oluşturuluyor"
  rand() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
DATABASE_PATH=$APP_DIR/data/price-tracker.db
NODE_ENV=production
JWT_SECRET=$(rand)
SETTINGS_ENCRYPTION_KEY=$(rand)
PUBLIC_URL=$PUBLIC_URL
DISPLAY_CURRENCY=TRY
CAMPAIGN_NAME=Efsane Cuma / Black Friday 2026
CAMPAIGN_START=2026-11-27
CAMPAIGN_END=2026-11-30
CAMPAIGN_CHECK_INTERVAL_MINUTES=60
CAMPAIGN_BOOST_LEAD_DAYS=1
TZ=Europe/Istanbul
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE" && chmod 600 "$ENV_FILE"
fi
mkdir -p "$APP_DIR/data" && chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"

# --- systemd -------------------------------------------------------------------------
log "Servis (systemd)"
cat > /etc/systemd/system/fiyat-takip.service <<EOF
[Unit]
Description=Fiyat Takip (price-tracker-tr)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable fiyat-takip >/dev/null
systemctl restart fiyat-takip

# --- Caddy reverse proxy ---------------------------------------------------------------
log "HTTPS: $PUBLIC_URL"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl reload caddy || systemctl restart caddy

# --- Güvenlik duvarı ----------------------------------------------------------------------
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# --- Sonuç -----------------------------------------------------------------------------
sleep 6
SETUP_LINE="$(journalctl -u fiyat-takip --no-pager -n 200 | grep -o "${PUBLIC_URL}/setup?token=[a-f0-9]*" | tail -1 || true)"
log "Kurulum tamam!"
echo "  Adres:  $PUBLIC_URL"
if [ -n "$SETUP_LINE" ]; then
  echo "  İlk yönetici hesabını oluşturmak için bu linki aç:"
  echo "    $SETUP_LINE"
else
  echo "  (Yönetici hesabı zaten var ya da servis hâlâ açılıyor: journalctl -u fiyat-takip -n 50)"
fi
echo
echo "  Durum:    systemctl status fiyat-takip"
echo "  Loglar:   journalctl -u fiyat-takip -f"
echo "  Güncelle: bu komutu tekrar çalıştır"
echo "  Yedek:    $APP_DIR/data/price-tracker.db dosyasını kopyala"
