#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · deploy.sh
# Ejecutar en el VPS: cd /opt/casafari && bash infra/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

echo "▶ [1/5] Pull latest code..."
git -C "$REPO_DIR" pull --ff-only

echo "▶ [2/5] Build app image..."
$COMPOSE build app

echo "▶ [3/5] Restart app (zero-downtime rotate)..."
$COMPOSE up -d --no-deps app

echo "▶ [4/5] Ensure DB + Redis are up..."
$COMPOSE up -d postgres redis

echo "▶ [5/5] Health check..."
sleep 5
if curl -sf http://127.0.0.1:3000 > /dev/null; then
  echo "✅ App responde en http://127.0.0.1:3000"
else
  echo "⚠️  App no responde aún — revisar logs:"
  $COMPOSE logs app --tail=40
  exit 1
fi

echo ""
echo "✅ Deploy completado. Accede en: http://204.168.174.0"
