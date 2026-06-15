#!/bin/bash
# Script de verificación automática de teléfonos en anuncios de particulares.
# Se ejecuta cada 2 días desde el cron del VPS para buscar teléfonos recién
# agregados por propietarios en listados que aún no tienen teléfono.
#
# Uso: ./scripts/verify-particulares-phones.sh [mode] [limit]
# Modos: all (verifica todos activos), missing (solo sin teléfono)
# Cron: 0 */48 * * * /path/a/smartbc/scripts/verify-particulares-phones.sh

set -e

# Configuración
API_URL="${APP_URL:-${API_URL:-http://localhost:3000}}"
CRON_SECRET="${CRON_SECRET:-}"
MODE="${1:-missing}"
LIMIT="${2:-100}"

if [ -z "$CRON_SECRET" ]; then
  echo "[ERROR] CRON_SECRET no definido. Exportarlo o agregarlo a .env."
  exit 1
fi

ENDPOINT="$API_URL/api/admin/particulares/verify-phones"
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

echo "[$TIMESTAMP] Verificando teléfonos de particulares (mode=$MODE, limit=$LIMIT)"

# Hacer el request con el secret en el header
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$ENDPOINT?mode=$MODE&limit=$LIMIT" 2>&1)

# Loguear resultado
if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "[$TIMESTAMP] ✓ Éxito - $(echo "$RESPONSE" | jq '.checked // 0' 2>/dev/null || echo "?") verificados"
  echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
else
  echo "[$TIMESTAMP] ✗ Error"
  echo "$RESPONSE"
  exit 1
fi
