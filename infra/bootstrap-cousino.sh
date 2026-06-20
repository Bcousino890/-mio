#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · bootstrap-cousino.sh — instalación AISLADA del sitio público
# web-cousino en el CX33. Mismo patrón aditivo que bootstrap.sh: NO toca
# casafari.conf (crm.cremme.es) ni zinto.conf. Añade casafari-cousino.conf y
# conecta el contenedor a la red compartida.
#
#   App → 127.0.0.1:3001    Dominio público → http://cousino.204-168-174-0.nip.io
#
# Overrides opcionales (export antes de ejecutar):
#   SHARED_NGINX=infrastructure-nginx-1
#   SHARED_NET=infrastructure_default
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="cousino.204-168-174-0.nip.io"
APP_CONTAINER="casafari-cousino-app"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

log()  { echo -e "\n▶ $*"; }
ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*"; exit 1; }

log "[0/5] Comprobaciones previas..."
command -v docker >/dev/null || fail "Docker no está instalado"

SHARED_NGINX="${SHARED_NGINX:-$(docker ps --filter "publish=80" --format '{{.Names}}' | head -1)}"
[ -n "$SHARED_NGINX" ] || fail "No encuentro el contenedor nginx que sirve el :80"
SHARED_NET="${SHARED_NET:-$(docker inspect "$SHARED_NGINX" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' \
  | grep -v '^$' | head -1)}"
[ -n "$SHARED_NET" ] || fail "No encuentro la red del nginx compartido"
ok "nginx compartido: $SHARED_NGINX  ·  red: $SHARED_NET"

log "[1/5] Build de web-cousino (puede tardar en el primer run)..."
$COMPOSE build cousino-app
ok "Imagen construida"

log "[2/5] Arrancando el sitio..."
$COMPOSE up -d --no-deps cousino-app
sleep 8
curl -sf http://127.0.0.1:3001 >/dev/null \
  || { $COMPOSE logs cousino-app --tail=40; fail "El sitio no responde en :3001"; }
ok "Sitio respondiendo en 127.0.0.1:3001"

log "[3/5] Conectando $APP_CONTAINER a la red $SHARED_NET..."
docker network connect "$SHARED_NET" "$APP_CONTAINER" 2>/dev/null \
  && ok "Conectada" || ok "Ya estaba conectada"

log "[4/5] Registrando $DOMAIN en $SHARED_NGINX (sin tocar casafari.conf ni zinto.conf)..."
docker cp "$REPO_DIR/infra/nginx-cousino-shared.conf" \
  "$SHARED_NGINX:/etc/nginx/conf.d/casafari-cousino.conf"
if docker exec "$SHARED_NGINX" nginx -t >/dev/null 2>&1; then
  docker exec "$SHARED_NGINX" nginx -s reload
  ok "nginx recargado — casafari-cousino.conf activo, resto intacto"
else
  warn "nginx -t falló: revirtiendo (resto del VPS queda intacto)"
  docker exec "$SHARED_NGINX" rm -f /etc/nginx/conf.d/casafari-cousino.conf
  docker exec "$SHARED_NGINX" nginx -s reload || true
  fail "Config inválida — revertida"
fi

log "[4.5/5] Configurando HTTPS para $DOMAIN..."
DOMAIN="$DOMAIN" SHARED_NGINX="$SHARED_NGINX" bash "$REPO_DIR/infra/ensure-tls-cousino.sh" \
  || warn "TLS no configurado — sigue funcionando en http"

log "[5/5] ✅ Bootstrap completado"
echo ""
echo "  🌐  https://$DOMAIN"
echo "  📦  docker ps | grep cousino"
echo "  📜  $COMPOSE logs -f cousino-app"
echo ""
echo "  crm.cremme.es, zintoleads y el resto del VPS NO se han tocado."
