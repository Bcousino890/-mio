#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · deploy.sh — deploy incremental (build + swap de la app)
# Reconecta la app a la red del nginx compartido y lo recarga (la IP del
# contenedor cambia al recrearlo). NO toca la config de zintoleads.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="crm.cremme.es"

# Garantizar swap SUFICIENTE para que `docker build` no muera con OOM (exit
# 137) al instalar paquetes pesados (chromium, geopandas) cuando el layer-cache
# se invalida y apt-get consume el pico de RAM en el VPS de 8GB compartido con
# Postgres. La versión anterior solo creaba swap si NO había NINGUNO: un swap
# chico preexistente (p.ej. 512MB) hacía saltar todo el bloque y el build
# seguía muriendo (justo el fallo del deploy de la migración 0052). Ahora se
# garantiza un swap TOTAL mínimo, recreando /swapfile al tamaño objetivo aunque
# ya exista uno más chico. Idempotente: en deploys posteriores no hace nada.
SWAP_MIN_MB=4096
SWAPFILE=/swapfile
swap_total_mb() { free -m | awk '/^Swap:/ {print $2}'; }
if [ "$(swap_total_mb)" -lt "$SWAP_MIN_MB" ]; then
  echo "▶ Swap actual $(swap_total_mb)MB < ${SWAP_MIN_MB}MB — asegurando ${SWAPFILE} de $((SWAP_MIN_MB/1024))GB..."
  # No se puede redimensionar un swapfile en caliente: si el nuestro ya está
  # activo (pero chico), lo desactivamos para recrearlo. Si swapoff falla
  # (swap en uso), conservamos lo que hay en vez de borrar un swapfile activo.
  if swapon --show=NAME --noheadings 2>/dev/null | grep -qxF "$SWAPFILE"; then
    swapoff "$SWAPFILE" 2>/dev/null || echo "  ⚠ ${SWAPFILE} en uso, no se pudo desactivar; se conserva"
  fi
  if ! swapon --show=NAME --noheadings 2>/dev/null | grep -qxF "$SWAPFILE"; then
    rm -f "$SWAPFILE"
    fallocate -l "${SWAP_MIN_MB}M" "$SWAPFILE" 2>/dev/null \
      || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SWAP_MIN_MB" status=none
    chmod 600 "$SWAPFILE"
    mkswap -q "$SWAPFILE"
    swapon "$SWAPFILE"
    grep -qxF "$SWAPFILE none swap sw 0 0" /etc/fstab \
      || echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  fi
  echo "  ✅ Swap total ahora: $(swap_total_mb)MB"
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
