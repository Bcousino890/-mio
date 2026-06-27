#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · scraper/tgr/run-tgr.sh
#
# Corre en el VPS (lanzado por .github/workflows/scrape-tgr.yml). Exporta el
# CSV de roles a consultar desde la BD de producción (sii_roles_cl +
# chile_comunas, priorizando Las Condes → Lo Barnechea → Vitacura → resto de
# la Región Metropolitana) y lanza tgr_scraper.py contra ese CSV. El propio
# tgr_scraper.py escribe en su SQLite local Y (si DATABASE_URL está seteado)
# en las tablas tgr_certificados/tgr_certificado_detalle de producción.
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

LOCKFILE="/tmp/casafari-scrape-tgr.lock"
if [ -e "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE" 2>/dev/null)" 2>/dev/null; then
  echo "✗ Ya hay un scrape TGR en curso (PID $(cat "$LOCKFILE")). Abortando."
  exit 1
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

if [ -f .env ]; then
  set -a; source .env; set +a
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "✗ Falta POSTGRES_PASSWORD (revisa .env)"
  exit 1
fi
export DATABASE_URL="postgres://casafari:${POSTGRES_PASSWORD}@127.0.0.1:5433/casafari"

echo "▶ Verificando Chromium + ChromeDriver del sistema (Selenium los necesita para los certificados TGR)..."
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq chromium chromium-driver
fi
export CHROME_BINARY="$(command -v chromium || command -v chromium-browser)"
export CHROMEDRIVER_PATH="$(command -v chromedriver)"
echo "  CHROME_BINARY=$CHROME_BINARY"
echo "  CHROMEDRIVER_PATH=$CHROMEDRIVER_PATH"

cd scraper/tgr

if [ ! -d venv ]; then
  echo "▶ Creando virtualenv e instalando dependencias..."
  python3 -m venv venv
  ./venv/bin/pip install -q --upgrade pip
  ./venv/bin/pip install -q -r requirements.txt
fi

echo "▶ Exportando CSV de roles desde Postgres de producción (orden: Las Condes, Lo Barnechea, Vitacura, resto RM)..."
docker exec casafari-pg psql -U casafari -d casafari -At -F',' -c "
  SELECT r.sii_comuna_code || '-' || r.rol, c.name
  FROM sii_roles_cl r
  JOIN chile_comunas c ON c.id = r.comuna_id
  WHERE c.region = 'Región Metropolitana de Santiago'
  ORDER BY
    CASE c.name
      WHEN 'Las Condes' THEN 0
      WHEN 'Lo Barnechea' THEN 1
      WHEN 'Vitacura' THEN 2
      ELSE 3
    END, c.name, r.manzana, r.predio
" > roles_input_rm.csv

echo "rol,comuna" > roles_input_rm.csv.tmp
cat roles_input_rm.csv >> roles_input_rm.csv.tmp
mv roles_input_rm.csv.tmp roles_input_rm.csv

TOTAL=$(($(wc -l < roles_input_rm.csv) - 1))
echo "▶ ${TOTAL} roles a procesar. Lanzando tgr_scraper.py..."

./venv/bin/python tgr_scraper.py --input roles_input_rm.csv
