#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · scrape-salamanca-almagro.sh
#
# Scrapea, zona por zona, el distrito Salamanca (sus 6 barrios oficiales — NUNCA
# el distrito completo en una sola búsqueda, porque supera el tope de ~1800
# resultados/búsqueda de Idealista y se pierden anuncios) y el barrio de Almagro.
# A diferencia de scrape-goya.yml (que usa --emit-app y solo escribe JSON), este
# script NO pasa --emit-app: cada ficha se hace upsert directo en la tabla
# `listings` de la base de datos de producción.
#
# Pensado para ejecutarse en el VPS, donde .env (DATABASE_URL) y .env.scraper
# (credenciales del proxy) ya están disponibles tras el deploy.
#
# Uso: bash scraper/scrape-salamanca-almagro.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# Evita corridas solapadas (compiten por proxy, conexiones a BD y CPU del VPS).
LOCKFILE="/tmp/casafari-scrape-salamanca-almagro.lock"
if [ -e "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE" 2>/dev/null)" 2>/dev/null; then
  echo "✗ Ya hay un scrape en curso (PID $(cat "$LOCKFILE")). Abortando."
  exit 1
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# nvm-friendly: en sesiones SSH no interactivas el PATH puede no incluir node.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
command -v node >/dev/null 2>&1 || { echo "✗ node no está en el PATH"; exit 1; }

if [ -f .env ]; then
  set -a; source .env; set +a
fi
if [ -f .env.scraper ]; then
  set -a; source .env.scraper; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ Falta DATABASE_URL (revisa .env)"
  exit 1
fi

if [ ! -d scraper/node_modules ]; then
  echo "▶ Instalando dependencias del scraper..."
  (cd scraper && npm install)
fi

mkdir -p scraper/output

# 6 barrios oficiales del distrito Salamanca (ver db/migrations/0011) + Almagro.
ZONES=(
  "madrid/barrio-de-salamanca/goya:goya"
  "madrid/barrio-de-salamanca/recoletos:recoletos"
  "madrid/barrio-de-salamanca/lista:lista"
  "madrid/barrio-de-salamanca/castellana:castellana"
  "madrid/barrio-de-salamanca/guindalera:guindalera"
  "madrid/barrio-de-salamanca/fuente-del-berro:fuente-del-berro"
  "madrid/chamberi/almagro:almagro"
)
OPS=(rent sale)

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SUMMARY_LOG="scraper/output/salamanca-almagro-${TIMESTAMP}.summary.log"

{
  echo "╔════════════════════════════════════════════════════════════════════════════╗"
  echo "║ Scrape Salamanca (6 sub-barrios) + Almagro · Alquiler + Venta             ║"
  echo "╚════════════════════════════════════════════════════════════════════════════╝"
} | tee "$SUMMARY_LOG"

for entry in "${ZONES[@]}"; do
  SLUG="${entry%%:*}"
  LABEL="${entry##*:}"
  for OP in "${OPS[@]}"; do
    LOG="scraper/output/${LABEL}-${OP}-${TIMESTAMP}.log"
    FAIL_LOG="scraper/output/${LABEL}-${OP}-${TIMESTAMP}.failed.json"

    echo "" | tee -a "$SUMMARY_LOG"
    echo "▶ ${LABEL} · ${OP}" | tee -a "$SUMMARY_LOG"
    node scraper/scrape-zone.mjs \
      --zone "$SLUG" \
      --op "$OP" \
      --max-pages 60 \
      --fail-log "$FAIL_LOG" \
      > "$LOG" 2>&1 || echo "  ⚠ scrape-zone.mjs salió con error, revisa $LOG" | tee -a "$SUMMARY_LOG"
    tail -3 "$LOG" | tee -a "$SUMMARY_LOG"

    if [ -s "$FAIL_LOG" ] && [ "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$FAIL_LOG')).length)" 2>/dev/null || echo 0)" -gt 0 ]; then
      echo "  ⟳ Reintentando fichas fallidas de ${LABEL}/${OP}..." | tee -a "$SUMMARY_LOG"
      node scraper/scrape-zone.mjs \
        --zone "$SLUG" \
        --op "$OP" \
        --retry-failed "$FAIL_LOG" \
        --fail-log "$FAIL_LOG" \
        >> "$LOG" 2>&1 || echo "  ⚠ reintento salió con error, revisa $LOG" | tee -a "$SUMMARY_LOG"
      tail -3 "$LOG" | tee -a "$SUMMARY_LOG"
    fi
  done
done

echo "" | tee -a "$SUMMARY_LOG"
echo "✅ Scrape Salamanca + Almagro completado — log: $SUMMARY_LOG" | tee -a "$SUMMARY_LOG"
