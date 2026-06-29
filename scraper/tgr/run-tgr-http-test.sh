#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · scraper/tgr/run-tgr-http-test.sh
#
# Prueba ACOTADA y controlada de --mode http en el VPS. NO toca el flujo
# Selenium de producción (run-tgr.sh) ni .launch-tgr. Pensada para validar
# estabilidad sostenida (WAF/F5) antes de cualquier corrida masiva:
#   - Filtra el CSV a UNA comuna (default: Las Condes).
#   - Corre tgr_scraper.py --mode http --no-save-raw-html durante un tiempo
#     máximo acotado (default: 3600s = 1h), no hasta agotar la cola.
#   - Mide reg/min, errores, WAF blocks, CPU/RAM y tamaño de la BD local
#     antes/después, y deja un resumen en texto al final.
#
# Variables de entorno (todas opcionales, con default seguro):
#   TGR_TEST_COMUNA      (default: "Las Condes")
#   TGR_TEST_WORKERS      (default: 5)
#   TGR_TEST_MAX_SECONDS  (default: 3600)
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

TGR_TEST_COMUNA="${TGR_TEST_COMUNA:-Las Condes}"
TGR_TEST_WORKERS="${TGR_TEST_WORKERS:-5}"
TGR_TEST_MAX_SECONDS="${TGR_TEST_MAX_SECONDS:-3600}"

LOCKFILE="/tmp/casafari-scrape-tgr.lock"
if [ -e "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if ! kill -0 "$OLD_PID" 2>/dev/null; then
    rm -f "$LOCKFILE"
  elif [ -n "$OLD_PID" ]; then
    echo "✗ Ya hay un scrape TGR en curso (PID $OLD_PID). Abortando prueba acotada." >&2
    exit 1
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

if [ -f .env ]; then
  set -a; source .env; set +a
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "✗ Falta POSTGRES_PASSWORD (revisa .env)" >&2
  exit 1
fi
export DATABASE_URL="postgres://casafari:${POSTGRES_PASSWORD}@127.0.0.1:5433/casafari"

cd scraper/tgr

if [ ! -d venv ]; then
  echo "▶ Creando virtualenv..."
  python3 -m venv venv
  ./venv/bin/pip install -q --upgrade pip
fi
echo "▶ Instalando/actualizando dependencias del venv (idempotente, por si requirements.txt cambió desde que se creó)..."
./venv/bin/pip install -q -r requirements.txt

echo "▶ Exportando CSV de roles para comuna='${TGR_TEST_COMUNA}'..."
docker exec casafari-pg psql -U casafari -d casafari -At -F',' -c "
  SELECT r.sii_comuna_code || '-' || r.rol, c.name
  FROM sii_roles_cl r
  JOIN chile_comunas c ON c.id = r.comuna_id
  WHERE c.name = '${TGR_TEST_COMUNA}'
  ORDER BY r.manzana, r.predio
" > roles_input_test.csv

echo "rol,comuna" > roles_input_test.csv.tmp
cat roles_input_test.csv >> roles_input_test.csv.tmp
mv roles_input_test.csv.tmp roles_input_test.csv

if [ ! -s "roles_input_test.csv" ]; then
  echo "✗ CRÍTICO: roles_input_test.csv vacío. ¿Nombre de comuna '${TGR_TEST_COMUNA}' correcto?" >&2
  exit 1
fi

TOTAL=$(($(wc -l < roles_input_test.csv) - 1))
if [ "$TOTAL" -lt 1 ]; then
  echo "✗ CRÍTICO: CSV tiene 0 roles para '${TGR_TEST_COMUNA}'." >&2
  exit 1
fi
echo "▶ ${TOTAL} roles de ${TGR_TEST_COMUNA} disponibles (la corrida se corta a los ${TGR_TEST_MAX_SECONDS}s, igual si no se agotan)."

mkdir -p "$REPO_DIR/scraper/output"
TS="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$REPO_DIR/scraper/output/tgr-http-test-${TS}.log"
METRICS_FILE="$REPO_DIR/scraper/output/tgr-http-test-${TS}-metrics.csv"
SUMMARY_FILE="$REPO_DIR/scraper/output/tgr-http-test-${TS}-resumen.txt"

DB_FILE="tgr_certificados.db"
SIZE_BEFORE=0
[ -f "$DB_FILE" ] && SIZE_BEFORE=$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)

echo "=== Prueba acotada HTTP mode ===" > "$SUMMARY_FILE"
echo "Inicio: $(date -u)" >> "$SUMMARY_FILE"
echo "Comuna: ${TGR_TEST_COMUNA} | Workers: ${TGR_TEST_WORKERS} | Max segundos: ${TGR_TEST_MAX_SECONDS}" >> "$SUMMARY_FILE"
echo "Roles disponibles: ${TOTAL}" >> "$SUMMARY_FILE"
echo "Tamaño BD local antes: ${SIZE_BEFORE} bytes" >> "$SUMMARY_FILE"

echo "timestamp,cpu_pct,mem_pct" > "$METRICS_FILE"
(
  while true; do
    read -r CPU MEM < <(ps -eo pcpu,pmem --no-headers | awk '{c+=$1; m+=$2} END {print c, m}')
    echo "$(date -u +%Y-%m-%dT%H:%M:%S),${CPU:-0},${MEM:-0}" >> "$METRICS_FILE"
    sleep 30
  done
) &
METRICS_PID=$!
trap 'kill "$METRICS_PID" 2>/dev/null; rm -f "$LOCKFILE"' EXIT

echo "▶ Lanzando tgr_scraper.py --mode http --workers ${TGR_TEST_WORKERS} (corte a los ${TGR_TEST_MAX_SECONDS}s)..."
set +e
timeout --signal=TERM "${TGR_TEST_MAX_SECONDS}s" \
  ./venv/bin/python tgr_scraper.py \
    --input roles_input_test.csv \
    --mode http \
    --workers "${TGR_TEST_WORKERS}" \
    --no-save-raw-html \
    2>&1 | tee -a "$LOG_FILE"
SCRAPER_EXIT=${PIPESTATUS[0]}
set -e

kill "$METRICS_PID" 2>/dev/null || true

SIZE_AFTER=0
[ -f "$DB_FILE" ] && SIZE_AFTER=$(stat -c%s "$DB_FILE" 2>/dev/null || echo 0)

PROCESADOS=$(grep -oP '⚡ Progreso: \K\d+' "$LOG_FILE" | tail -1)
VELOCIDAD=$(grep -oP '\K[\d.]+(?= props/min)' "$LOG_FILE" | tail -1)
ERRORES=$(grep -oP 'Errores: \K\d+' "$LOG_FILE" | tail -1)
WAF_BLOCKS=$(grep -c "bloqueado por WAF" "$LOG_FILE" || true)
EXITOSOS=$(grep -c '✅ \[' "$LOG_FILE" || true)
SIN_DEUDA=$(grep -c '⚪ \[' "$LOG_FILE" || true)
ERRORES_LINEA=$(grep -c '❌ \[' "$LOG_FILE" || true)

{
  echo "Fin: $(date -u)"
  echo "Código de salida (124 = cortado por timeout, esperado): ${SCRAPER_EXIT}"
  echo "--- Métricas extraídas del log ---"
  echo "Procesados (último reporte interno): ${PROCESADOS:-N/A}"
  echo "Velocidad (último reporte interno, props/min): ${VELOCIDAD:-N/A}"
  echo "Errores acumulados en BD (último reporte interno): ${ERRORES:-N/A}"
  echo "Líneas ✅ (exitosas con deuda): ${EXITOSOS}"
  echo "Líneas ⚪ (sin deuda): ${SIN_DEUDA}"
  echo "Líneas ❌ (error): ${ERRORES_LINEA}"
  echo "Bloqueos WAF detectados ('bloqueado por WAF'): ${WAF_BLOCKS}"
  echo "Tamaño BD local antes: ${SIZE_BEFORE} bytes"
  echo "Tamaño BD local después: ${SIZE_AFTER} bytes (delta: $((SIZE_AFTER - SIZE_BEFORE)) bytes)"
  echo "Log completo: ${LOG_FILE}"
  echo "Métricas CPU/RAM (muestreo cada 30s): ${METRICS_FILE}"
} >> "$SUMMARY_FILE"

cat "$SUMMARY_FILE"

if [ "$WAF_BLOCKS" -gt 0 ]; then
  echo "⚠ ATENCIÓN: se detectaron ${WAF_BLOCKS} bloqueos WAF. Bajar concurrencia antes de re-intentar." >&2
fi

exit 0
