#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · deploy-cousino.sh — deploy incremental del sitio web-cousino
# (build + swap de la app). Reconecta a la red del nginx compartido y lo
# recarga. NO toca casafari.conf (crm.cremme.es) ni zinto.conf.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="cousino.204-168-174-0.nip.io"
APP_CONTAINER="casafari-cousino-app"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

SHARED_NGINX="${SHARED_NGINX:-$(docker ps --filter "publish=80" --format '{{.Names}}' | head -1)}"
SHARED_NET="${SHARED_NET:-$(docker inspect "$SHARED_NGINX" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null \
  | grep -v '^$' | head -1)}"

echo "▶ [1/4] Build del sitio..."
$COMPOSE build cousino-app

echo "▶ [2/4] Swap del contenedor..."
$COMPOSE up -d --no-deps cousino-app
sleep 8
curl -sf http://127.0.0.1:3001 >/dev/null || { $COMPOSE logs cousino-app --tail=40; echo "❌ El sitio no responde"; exit 1; }

echo "▶ [3/4] Reconectando a la red compartida ($SHARED_NET)..."
if [ -n "$SHARED_NET" ]; then
  docker network connect "$SHARED_NET" "$APP_CONTAINER" 2>/dev/null || true
fi

echo "▶ [4/4] Asegurando HTTPS y recargando nginx compartido ($SHARED_NGINX)..."
if [ -n "$SHARED_NGINX" ]; then
  DOMAIN="$DOMAIN" SHARED_NGINX="$SHARED_NGINX" bash "$REPO_DIR/infra/ensure-tls-cousino.sh" || true
fi

echo ""
echo "✅ Deploy completado → https://$DOMAIN"
