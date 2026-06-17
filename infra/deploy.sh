#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · deploy.sh — deploy incremental (build + swap de la app)
# Reconecta la app a la red del nginx compartido y lo recarga (la IP del
# contenedor cambia al recrearlo). NO toca la config de zintoleads.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="crm.cremme.es"
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

echo "▶ [4/4] Asegurando HTTPS y recargando nginx compartido ($SHARED_NGINX)..."
if [ -n "$SHARED_NGINX" ]; then
  DOMAIN="$DOMAIN" SHARED_NGINX="$SHARED_NGINX" bash "$REPO_DIR/infra/ensure-tls.sh" || true
fi

echo "▶ [5/5] Aplicando migraciones SQL..."
bash "$REPO_DIR/infra/post-deploy.sh" || true

echo ""
echo "✅ Deploy completado → https://$DOMAIN"
