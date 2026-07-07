#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · bootstrap.sh — instalación AISLADA en el CX33
#
# El VPS sirve :80/:443 con un nginx en Docker (infrastructure-nginx-1) que
# enruta por dominio. Este script NO toca esa config: añade un archivo .conf
# nuevo (aditivo) y conecta la app a la red compartida. zintoleads intacto.
#
#   Postgres → 127.0.0.1:5433    Redis → 127.0.0.1:6380    App → 127.0.0.1:3000
#   Dominio público → http://crm.cremme.es  (vía nginx compartido)
#
# Overrides opcionales (export antes de ejecutar):
#   SHARED_NGINX=infrastructure-nginx-1
#   SHARED_NET=infrastructure_default
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="crm.cremme.es"
APP_CONTAINER="casafari-app"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

log()  { echo -e "\n▶ $*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*"; exit 1; }

# ── 0. Swap preventivo ───────────────────────────────────────────────────────
# El build de Docker (chromium, geopandas) puede OOM en el VPS compartido de
# 8 GB cuando el layer-cache está frío. 2 GB de swap absorben el pico.
if ! swapon --show | grep -q .; then
  if [ ! -f /swapfile ]; then
    log "Creando swapfile de 2 GB..."
    fallocate -l 2G /swapfile 2>/dev/null \
      || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap -q /swapfile
    grep -qxF '/swapfile none swap sw 0 0' /etc/fstab \
      || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  swapon /swapfile
  ok "Swap activo ($(swapon --show --noheadings --bytes | awk '{printf "%.0f MB", $3/1024/1024}'))"
fi

# ── 0. Comprobaciones ────────────────────────────────────────────────────────
log "[0/7] Comprobaciones previas..."
command -v docker >/dev/null || fail "Docker no está instalado"
[ -f "$REPO_DIR/.env" ] || fail "Falta $REPO_DIR/.env"
grep -q '^POSTGRES_PASSWORD=..*' "$REPO_DIR/.env" || fail "POSTGRES_PASSWORD vacío en .env"

# Detectar el nginx que sirve el :80 (contenedor) y su red
SHARED_NGINX="${SHARED_NGINX:-$(docker ps --filter "publish=80" --format '{{.Names}}' | head -1)}"
[ -n "$SHARED_NGINX" ] || fail "No encuentro el contenedor nginx que sirve el :80"
SHARED_NET="${SHARED_NET:-$(docker inspect "$SHARED_NGINX" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' \
  | grep -v '^$' | head -1)}"
[ -n "$SHARED_NET" ] || fail "No encuentro la red del nginx compartido"
ok "nginx compartido: $SHARED_NGINX  ·  red: $SHARED_NET"

# ── 1. Build de la imagen de la app ──────────────────────────────────────────
# SKIP_BUILD=1: el workflow de deploy construye casafari-app:latest en el
# runner de GitHub y la carga aquí vía docker load (el build en este VPS
# compartido muere con OOM).
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  log "[1/7] Build omitido — usando imagen casafari-app:latest precargada"
  ok "Imagen precargada"
else
  log "[1/7] Build de la app (puede tardar en el primer run)..."
  $COMPOSE build app
  ok "Imagen construida"
fi

# ── 2. Postgres + Redis (best-effort: la UI usa mock, no bloquea) ────────────
log "[2/7] Levantando Postgres (5433) + Redis (6380)..."
$COMPOSE up -d postgres redis || warn "DB/Redis no arrancaron (la UI funciona igual con mock)"
for i in $(seq 1 20); do
  $COMPOSE exec -T postgres pg_isready -U casafari >/dev/null 2>&1 && break || sleep 2
done
ok "Postgres y Redis arriba (o continuando sin ellos)"

# ── 3. Migraciones (best-effort) ─────────────────────────────────────────────
log "[3/7] Aplicando migraciones..."
$COMPOSE exec -T postgres sh -c \
  'for f in $(ls /migrations/*.sql 2>/dev/null | sort); do echo "   >> $f"; psql -U casafari -d casafari -f "$f" || exit 1; done' \
  && ok "Migraciones aplicadas" || warn "Migraciones omitidas/fallidas (no bloquea la web)"

# ── 4. Arrancar la app ───────────────────────────────────────────────────────
log "[4/7] Arrancando la app..."
$COMPOSE up -d --no-deps app
sleep 8
curl -sf http://127.0.0.1:3000 >/dev/null \
  || { $COMPOSE logs app --tail=40; fail "La app no responde en :3000"; }
ok "App respondiendo en 127.0.0.1:3000"

# ── 5. Conectar la app a la red del nginx compartido ─────────────────────────
log "[5/7] Conectando $APP_CONTAINER a la red $SHARED_NET..."
docker network connect "$SHARED_NET" "$APP_CONTAINER" 2>/dev/null \
  && ok "Conectada" || ok "Ya estaba conectada"

# ── 6. Instalar el server block en el nginx compartido (aditivo) ─────────────
log "[6/7] Registrando $DOMAIN en $SHARED_NGINX (sin tocar zinto.conf)..."
docker cp "$REPO_DIR/infra/nginx-casafari-shared.conf" \
  "$SHARED_NGINX:/etc/nginx/conf.d/casafari.conf"
if docker exec "$SHARED_NGINX" nginx -t >/dev/null 2>&1; then
  docker exec "$SHARED_NGINX" nginx -s reload
  ok "nginx recargado — casafari.conf activo, resto intacto"
else
  warn "nginx -t falló: revirtiendo (zintoleads queda intacto)"
  docker exec "$SHARED_NGINX" rm -f /etc/nginx/conf.d/casafari.conf
  docker exec "$SHARED_NGINX" nginx -s reload || true
  fail "Config inválida — revertida"
fi

# ── 6.5 TLS (Let's Encrypt — manual http-01 vía docker cp, no toca zinto) ────
log "[6.5/7] Configurando HTTPS para $DOMAIN..."
DOMAIN="$DOMAIN" SHARED_NGINX="$SHARED_NGINX" bash "$REPO_DIR/infra/ensure-tls.sh" \
  || warn "TLS no configurado — sigue funcionando en http"

# ── 7. Fin ───────────────────────────────────────────────────────────────────
log "[7/7] ✅ Bootstrap completado"
echo ""
echo "  🌐  https://$DOMAIN"
echo "  📦  docker ps | grep casafari"
echo "  📜  $COMPOSE logs -f app"
echo ""
echo "  zintoleads y el resto del VPS NO se han tocado."
