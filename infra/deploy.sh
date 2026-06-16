#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · deploy.sh — deploy incremental (build + swap de la app)
# Reconecta la app a la red del nginx compartido y lo recarga (la IP del
# contenedor cambia al recrearlo). NO toca la config de zintoleads.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_CONTAINER="casafari-app"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

SHARED_NGINX="${SHARED_NGINX:-$(docker ps --filter "publish=80" --format '{{.Names}}' | head -1)}"
SHARED_NET="${SHARED_NET:-$(docker inspect "$SHARED_NGINX" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null \
  | grep -v '^$' | head -1)}"

echo "▶ [1/4] Build de la app..."
$COMPOSE build app

echo "▶ [2/4] Swap del contenedor..."
$COMPOSE up -d --no-deps app
sleep 8
curl -sf http://127.0.0.1:3000 >/dev/null || { $COMPOSE logs app --tail=40; echo "❌ App no responde"; exit 1; }

echo "▶ [3/4] Reconectando a la red compartida ($SHARED_NET)..."
if [ -n "$SHARED_NET" ]; then
  docker network connect "$SHARED_NET" "$APP_CONTAINER" 2>/dev/null || true
fi

echo "▶ [4/4] Recargando nginx compartido ($SHARED_NGINX)..."
if [ -n "$SHARED_NGINX" ]; then
  # Reasegura el conf (por si el contenedor nginx se recreó) y recarga
  docker cp "$REPO_DIR/infra/nginx-casafari-shared.conf" \
    "$SHARED_NGINX:/etc/nginx/conf.d/casafari.conf" 2>/dev/null || true
  docker exec "$SHARED_NGINX" nginx -t >/dev/null 2>&1 && docker exec "$SHARED_NGINX" nginx -s reload || true
fi

echo ""
echo "✅ Deploy completado → http://204-168-174-0.nip.io"
