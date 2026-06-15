#!/bin/bash
# Script para ejecutar el scraper de particulares cada hora desde el VPS.
# Uso: agregar a crontab del servidor
# 0 * * * * /path/a/este/script.sh

set -e

# Variables de config
API_URL="${API_URL:-http://localhost:3000}"  # URL del app en el VPS (pm2 arranca next start --port 3000)
CRON_SECRET="${CRON_SECRET:-}"  # Debe estar en .env o exportado

if [ -z "$CRON_SECRET" ]; then
  echo "[ERROR] CRON_SECRET no definido. Exportarlo o agregarlo al script."
  exit 1
fi

ENDPOINT="$API_URL/api/cron/particulares/scrape"
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

echo "[$TIMESTAMP] Ejecutando: particulares/scrape"

# Hacer el request con el secret en el header
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$ENDPOINT" 2>&1)

# Loguear resultado
if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "[$TIMESTAMP] ✓ Éxito"
  echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
else
  echo "[$TIMESTAMP] ✗ Error"
  echo "$RESPONSE"
  exit 1
fi
