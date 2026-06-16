#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Actualiza la IP del subdominio DuckDNS de casafari-mio.
# Lee DUCKDNS_DOMAIN y DUCKDNS_TOKEN de /opt/casafari/.env
# Pensado para cron: */5 * * * * bash /opt/casafari/infra/duckdns-update.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a

if [ -z "${DUCKDNS_DOMAIN:-}" ] || [ -z "${DUCKDNS_TOKEN:-}" ]; then
  echo "❌ Falta DUCKDNS_DOMAIN o DUCKDNS_TOKEN en $ENV_FILE"
  exit 1
fi

# ip vacío = DuckDNS detecta la IP pública del que llama
RESPONSE=$(curl -sf "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=")

if [ "$RESPONSE" = "OK" ]; then
  echo "✅ DuckDNS actualizado: ${DUCKDNS_DOMAIN}.duckdns.org"
else
  echo "❌ DuckDNS respondió: $RESPONSE"
  exit 1
fi
