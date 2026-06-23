#!/bin/bash
# spike-with-smartproxy.sh
#
# Script de una línea para ejecutar spike CON Smartproxy
# Usa la URL de API de Smartproxy provided.
#
# Uso:
#   bash spike-with-smartproxy.sh
#
# NO guarda credenciales en git. La URL es temporal, solo en esta sesión.

set -e

SMARTPROXY_URL="https://www.smartproxy.org/web_v1/ip/get-ip-v3?app_key=9cf8f476185ea51d90a811dfedf19974&pt=9&num=100&ep=&cc=CL&state=&city=&life=30&lb=%5Cn&format=json&protocol=1"

echo "
╔════════════════════════════════════════════════════════════════════════════╗
║                  Spike Fase 0.5 CON SMARTPROXY                             ║
╚════════════════════════════════════════════════════════════════════════════╝

✓ Smartproxy URL cargada
✓ Modo: CON rotación de IP residencial
✓ Concurrencia: escalada 1 → 2 → 3 → 5

Iniciando spikes en 3... 2... 1...
"

export SMARTPROXY_URL
node scraper/spike-rate-limit-vps.mjs

echo "
✓ Spikes completados con Smartproxy.

Próximo: analiza los JSONs y compara con resultados sin proxy.
"
