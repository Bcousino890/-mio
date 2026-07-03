#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · deploy.sh — deploy incremental (build + swap de la app)
# Reconecta la app a la red del nginx compartido y lo recarga (la IP del
# contenedor cambia al recrearlo). NO toca la config de zintoleads.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="crm.cremme.es"

# Garantizar swap para que `docker build` no muera con OOM (exit 137) al
# instalar paquetes pesados (chromium, geopandas) cuando el layer-cache se
# invalida y apt-get update consume >600MB en el VPS compartido.
if ! swapon --show | grep -q .; then
  if [ ! -f /swapfile ]; then
    echo "▶ Creando swapfile de 2 GB (solo en primer uso)..."
    fallocate -l 2G /swapfile 2>/dev/null \
      || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap -q /swapfile
    grep -qxF '/swapfile none swap sw 0 0' /etc/fstab \
      || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  swapon /swapfile
  echo "  ✅ Swap activo ($(swapon --show --noheadings --bytes | awk '{printf "%.0f MB", $3/1024/1024}'))"
fi
APP_CONTAINER="casafari-app"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

SHARED_NGINX="${SHARED_NGINX:-$(docker ps --filter "publish=80" --format '{{.Names}}' | head -1)}"
SHARED_NET="${SHARED_NET:-$(docker inspect "$SHARED_NGINX" \
  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null \
  | grep -v '^$' | head -1)}"

echo "▶ [0/4] Asegurando Nominatim propio (CL) arriba — no bloquea el deploy..."
$COMPOSE up -d nominatim || true

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
