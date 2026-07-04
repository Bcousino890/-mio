#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · scraper/sii-scraper/run-sii-mapasui.sh
#
# Corre en el VPS (lanzado por .github/workflows/scrape-sii-mapasui.yml, mismo
# patrón que run-tgr.sh). Ejecuta el scraper de predios del SII
# (mapasFacadeService) para las comunas configuradas y luego ingesta la salida
# JSONL en la tabla `sii_mapasui_predios_cl` de producción.
#
# ⚠ PROCEDENCIA / ToS: este scraper hace requests HTTP AUTOMATIZADAS contra
# sii.cl, lo que los términos de uso del SII prohíben (uso "personal y no
# comercial"). Se ejecuta bajo autorización explícita del responsable del
# proyecto (ver cabecera de db/migrations/0052_sii_mapasui_predios_cl.sql y
# scraper/sii-scraper/README.md). Sus datos viven en una tabla propia, nunca
# mezclada con la señal oficial `sii_roles_cl`.
#
# Config por variables de entorno (todas opcionales, con defaults sensatos):
#   SII_COMUNA_CODE    código SII de la comuna (default 15108 = Las Condes)
#   SII_COMUNA_NOMBRE  nombre para el slug de salida (default "Las Condes")
#   SII_MANZANAS_STAGE etapa de descubrimiento: "manzanas-geo" (robusto, por
#                      coordenada — default) o "manzanas" (enumeración de IDs)
#   SII_RPS            requests/segundo (default 2 — ritmo anti-429 recomendado)
#   SII_CONCURRENCY    peticiones simultáneas (default 2)
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

LOCKFILE="/tmp/casafari-scrape-sii-mapasui.lock"
# Limpiar locks viejos de procesos muertos (mismo patrón que run-tgr.sh).
if [ -e "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if ! kill -0 "$OLD_PID" 2>/dev/null; then
    rm -f "$LOCKFILE"
  elif [ -n "$OLD_PID" ]; then
    echo "✗ Ya hay un scrape SII en curso (PID $OLD_PID). Abortando."
    exit 1
  fi
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

# SMARTPROXY_CL_* ya vienen del .env (los sincroniza deploy.yml desde los
# secrets del repo). Si están, el scraper usa proxy sticky-por-sesión; si no,
# conexión directa (ver scraper/sii-scraper/README.md y sii_scraper/client/session.py).
if [ -n "${SMARTPROXY_CL_HOST:-}" ]; then
  echo "▶ Proxy SmartProxy CL detectado en .env — el scraper rotará IPs por sesión."
else
  echo "▶ Sin SMARTPROXY_CL_* en .env — el scraper irá por conexión directa (ritmo bajo)."
fi

# ── Parámetros de la corrida ────────────────────────────────────────────────
SII_COMUNA_CODE="${SII_COMUNA_CODE:-15108}"
SII_COMUNA_NOMBRE="${SII_COMUNA_NOMBRE:-Las Condes}"
SII_MANZANAS_STAGE="${SII_MANZANAS_STAGE:-manzanas-geo}"
SII_RPS="${SII_RPS:-2}"
SII_CONCURRENCY="${SII_CONCURRENCY:-2}"

if [ "$SII_MANZANAS_STAGE" != "manzanas" ] && [ "$SII_MANZANAS_STAGE" != "manzanas-geo" ]; then
  echo "✗ SII_MANZANAS_STAGE debe ser 'manzanas' o 'manzanas-geo' (recibido: $SII_MANZANAS_STAGE)"
  exit 1
fi

cd scraper/sii-scraper

if [ ! -d venv ]; then
  echo "▶ Creando virtualenv e instalando dependencias del scraper SII..."
  python3 -m venv venv
  ./venv/bin/pip install -q --upgrade pip
  ./venv/bin/pip install -q -r requirements.txt
fi

# config.json está en .gitignore (se genera acá, no se commitea). Se arma con
# la comuna objetivo y los límites anti-429. `geo` cubre el caso manzanas-geo.
echo "▶ Generando config.json para comuna ${SII_COMUNA_NOMBRE} (${SII_COMUNA_CODE})..."
cat > config.json <<JSON
{
  "comunas": [
    { "comuna_id": ${SII_COMUNA_CODE}, "nombre_comuna": "${SII_COMUNA_NOMBRE}" }
  ],
  "regiones": [],
  "ranges": { "manzana_max": 1500, "manzana_probe_depth": 30, "predio_max": 150 },
  "limits": { "max_concurrency": ${SII_CONCURRENCY}, "requests_per_second": ${SII_RPS}, "max_retries": 5, "backoff_base": 2 },
  "geo": { "grid_step_m": 100 },
  "output_dir": "output"
}
JSON

echo "▶ [1/3] Descubriendo manzanas (${SII_MANZANAS_STAGE})..."
./venv/bin/python run.py "$SII_MANZANAS_STAGE" --config config.json

echo "▶ [2/3] Extrayendo predios..."
./venv/bin/python run.py predios --config config.json

# ── Ingesta a Postgres de producción ────────────────────────────────────────
# El ingest (Node) importa `pg` desde scraper/package.json. El deploy excluye
# node_modules del rsync, así que si no están, se instalan una vez.
cd "$REPO_DIR/scraper"
if [ ! -d node_modules/pg ]; then
  echo "▶ Instalando dependencias Node del scraper (pg) para el ingest..."
  npm install --omit=dev --no-audit --no-fund
fi

echo "▶ [3/3] Ingestando predios en sii_mapasui_predios_cl..."
DATABASE_URL="$DATABASE_URL" node ingest-sii-mapasui.mjs --dir sii-scraper/output/predios

echo "✅ Scrape + ingesta SII completados para ${SII_COMUNA_NOMBRE} (${SII_COMUNA_CODE})."
