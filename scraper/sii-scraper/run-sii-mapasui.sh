#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · scraper/sii-scraper/run-sii-mapasui.sh
#
# Corre en el VPS (lanzado por .github/workflows/scrape-sii-mapasui.yml, mismo
# patrón que run-tgr.sh). Ejecuta el scraper de predios del SII
# (mapasFacadeService) para las comunas de la COLA (comunas-queue.json) una
# tras otra, SIN pausas, e ingesta la salida JSONL en la tabla
# `sii_mapasui_predios_cl` de producción.
#
# ⚠ PROCEDENCIA / ToS: este scraper hace requests HTTP AUTOMATIZADAS contra
# sii.cl, lo que los términos de uso del SII prohíben (uso "personal y no
# comercial"). Se ejecuta bajo autorización explícita del responsable del
# proyecto (ver cabecera de db/migrations/0052_sii_mapasui_predios_cl.sql y
# scraper/sii-scraper/README.md). Sus datos viven en una tabla propia, nunca
# mezclada con la señal oficial `sii_roles_cl`.
#
# ── Cola de comunas (24/7, sin pausas) ──────────────────────────────────────
# Por defecto (SII_COMUNA_CODE vacío) recorre `comunas-queue.json` en orden:
# scrapea Las Condes, y al TERMINARLA arranca sola con Vitacura, etc. Cada
# comuna terminada deja un marcador output/.complete-<code>; una corrida
# relanzada (watchdog o botón .launch-sii-mapasui) salta las completas y retoma
# la primera pendiente desde sus checkpoints. Al completar TODA la cola escribe
# output/.sii-mapasui-complete (el watchdog deja de relanzar).
#
# ── Override de una sola comuna (uso manual) ────────────────────────────────
# Si se exporta SII_COMUNA_CODE (p.ej. desde el workflow_dispatch manual), se
# ignora la cola y se scrapea solo esa comuna.
#
# Config por variables de entorno (todas opcionales, con defaults sensatos):
#   SII_COMUNA_CODE    fuerza UNA sola comuna (vacío = usar la cola)
#   SII_COMUNA_NOMBRE  nombre para el slug de salida (solo en modo una-comuna)
#   SII_MANZANAS_STAGE etapa en modo una-comuna: "manzanas-geo" (default) o
#                      "manzanas" (en modo cola, la etapa la define cada
#                      entrada de comunas-queue.json)
#   SII_RPS            requests/segundo (default 8 — proxies a full)
#   SII_CONCURRENCY    peticiones simultáneas (default 8 — proxies a full)
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
INGEST_LOOP_PID=""
cleanup() {
  [ -n "$INGEST_LOOP_PID" ] && kill "$INGEST_LOOP_PID" 2>/dev/null || true
  rm -f "$LOCKFILE"
}
trap cleanup EXIT

if [ -f .env ]; then
  set -a; source .env; set +a
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "✗ Falta POSTGRES_PASSWORD (revisa .env)"
  exit 1
fi
export DATABASE_URL="postgres://casafari:${POSTGRES_PASSWORD}@127.0.0.1:5433/casafari"

# SMARTPROXY_CL_* ya vienen del .env (los sincroniza deploy.yml desde los
# secrets del repo). Si están, el scraper usa proxy sticky-por-sesión (rota IP
# por sesión); si no, conexión directa (ver README.md y sii_scraper/client/session.py).
if [ -n "${SMARTPROXY_CL_HOST:-}" ]; then
  echo "▶ Proxy SmartProxy CL detectado en .env — el scraper rotará IPs por sesión (proxies a full)."
else
  echo "▶ Sin SMARTPROXY_CL_* en .env — el scraper irá por conexión directa (ritmo bajo)."
fi

# ── Parámetros de velocidad (proxies a full) ────────────────────────────────
# Con proxy residencial rotable y ancho de banda de sobra, se sube el ritmo por
# defecto (antes 2/2). Sigue siendo configurable: si el WAF empieza a devolver
# 403/429 sostenidos conviene BAJARLO — ir demasiado rápido provoca bloqueos
# largos que estancan el 24/7 en vez de acelerarlo.
SII_RPS="${SII_RPS:-8}"
SII_CONCURRENCY="${SII_CONCURRENCY:-8}"

cd scraper/sii-scraper
mkdir -p output

QUEUE_FILE="comunas-queue.json"
PARAMS_FILE="output/.sii-mapasui-params"
ALL_COMPLETE_MARKER="output/.sii-mapasui-complete"

# ── Construir la lista de comunas a procesar ────────────────────────────────
# Modo una-comuna (override) si SII_COMUNA_CODE viene seteado; si no, la cola.
declare -a COMUNA_CODES COMUNA_NOMBRES COMUNA_STAGES
if [ -n "${SII_COMUNA_CODE:-}" ]; then
  SII_COMUNA_NOMBRE="${SII_COMUNA_NOMBRE:-Las Condes}"
  SII_MANZANAS_STAGE="${SII_MANZANAS_STAGE:-manzanas-geo}"
  COMUNA_CODES=("$SII_COMUNA_CODE")
  COMUNA_NOMBRES=("$SII_COMUNA_NOMBRE")
  COMUNA_STAGES=("$SII_MANZANAS_STAGE")
  echo "▶ Modo UNA comuna (override): ${SII_COMUNA_NOMBRE} (${SII_COMUNA_CODE}) · ${SII_MANZANAS_STAGE}"
else
  if [ ! -f "$QUEUE_FILE" ]; then
    echo "✗ No existe $QUEUE_FILE y no se dio SII_COMUNA_CODE — nada que scrapear."
    exit 1
  fi
  # Parsear la cola con python3 del sistema (el venv aún no existe). Cada línea:
  # code<TAB>nombre<TAB>stage.
  QUEUE_TSV="$(python3 - "$QUEUE_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
for c in data.get("comunas", []):
    code = str(c["code"]).strip()
    nombre = str(c["nombre"]).strip()
    stage = str(c.get("stage", "manzanas-geo")).strip()
    if stage not in ("manzanas", "manzanas-geo"):
        stage = "manzanas-geo"
    print(f"{code}\t{nombre}\t{stage}")
PY
)"
  if [ -z "$QUEUE_TSV" ]; then
    echo "✗ La cola $QUEUE_FILE no tiene comunas."
    exit 1
  fi
  while IFS=$'\t' read -r code nombre stage; do
    [ -z "$code" ] && continue
    COMUNA_CODES+=("$code")
    COMUNA_NOMBRES+=("$nombre")
    COMUNA_STAGES+=("$stage")
  done <<< "$QUEUE_TSV"
  echo "▶ Modo COLA — ${#COMUNA_CODES[@]} comuna(s): ${COMUNA_NOMBRES[*]}"
fi

# Estado en disco para el watchdog (ingest-sii-mapasui-now.yml).
cat > "$PARAMS_FILE" <<PARAMS
SII_RPS=${SII_RPS}
SII_CONCURRENCY=${SII_CONCURRENCY}
PARAMS
rm -f "$ALL_COMPLETE_MARKER"

# Reintentos con backoff para las etapas Python: un crash transitorio (racha
# de 429, red, OOM puntual) se cura solo sin esperar al watchdog. Los
# checkpoints hacen que cada reintento retome donde quedó, no desde cero.
run_stage() {
  local nombre="$1"; shift
  local intento
  for intento in 1 2 3; do
    if "$@"; then return 0; fi
    echo "⚠ Etapa ${nombre} falló (intento ${intento}/3)"
    if [ "$intento" -lt 3 ]; then
      local espera=$((intento * 120))
      echo "  … reintentando en ${espera}s"
      sleep "$espera"
    fi
  done
  echo "✗ Etapa ${nombre} falló 3 veces — abortando (el watchdog relanzará)."
  return 1
}

if [ ! -d venv ]; then
  echo "▶ Creando virtualenv e instalando dependencias del scraper SII..."
  python3 -m venv venv
  ./venv/bin/pip install -q --upgrade pip
  ./venv/bin/pip install -q -r requirements.txt
fi

# El ingest (Node) importa `pg` desde scraper/package.json. El deploy excluye
# node_modules del rsync, así que si no están, se instalan una vez — ANTES de
# la etapa de predios, porque la ingesta incremental de abajo lo necesita
# mientras esa etapa corre, no solo al final.
if [ ! -d "$REPO_DIR/scraper/node_modules/pg" ]; then
  echo "▶ Instalando dependencias Node del scraper (pg) para el ingest..."
  (cd "$REPO_DIR/scraper" && npm install --omit=dev --no-audit --no-fund)
fi

# Ingesta incremental (global, cubre TODAS las comunas de la corrida): la etapa
# de predios de una comuna grande puede tardar horas a ritmo anti-429, y sin
# esto sii_mapasui_predios_cl (y /chile/sii-mapasui) se quedaría sin datos
# nuevos hasta terminar la comuna. Se ingesta output/predios/*.jsonl (de todas
# las comunas) cada SII_INGEST_INTERVAL_SEC mientras el scrape corre;
# ingest-sii-mapasui.mjs solo LEE el .jsonl (no lo bloquea) y su INSERT ON
# CONFLICT DO UPDATE es idempotente, así que re-ingestar archivos en
# crecimiento es seguro.
SII_INGEST_INTERVAL_SEC="${SII_INGEST_INTERVAL_SEC:-600}"
(
  while sleep "$SII_INGEST_INTERVAL_SEC"; do
    if [ -d output/predios ]; then
      echo "▶ [ingesta incremental $(date -Iseconds)]"
      DATABASE_URL="$DATABASE_URL" node "$REPO_DIR/scraper/ingest-sii-mapasui.mjs" --dir output/predios 2>&1 \
        | sed 's/^/  [ingest] /'
    fi
  done
) &
INGEST_LOOP_PID=$!

# ── Procesa una comuna: manzanas → predios → ingesta → marcador ─────────────
procesar_comuna() {
  local code="$1" nombre="$2" stage="$3"
  local marker="output/.complete-${code}"

  if [ -f "$marker" ]; then
    echo "✓ ${nombre} (${code}) ya completa (marcador presente) — saltando."
    return 0
  fi

  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  echo "▶ Comuna ${nombre} (${code}) · etapa ${stage} · ${SII_RPS} rps × ${SII_CONCURRENCY}"
  echo "════════════════════════════════════════════════════════════════════"

  # config.json por comuna (está en .gitignore; se genera acá). `geo` cubre el
  # caso manzanas-geo. manzana_max alto para comunas con manzanas en IDs altos
  # (p.ej. Vitacura, 103–3625) cuando se usa la etapa de enumeración.
  cat > config.json <<JSON
{
  "comunas": [
    { "comuna_id": ${code}, "nombre_comuna": "${nombre}" }
  ],
  "regiones": [],
  "ranges": { "manzana_max": 4000, "manzana_probe_depth": 30, "predio_max": 150 },
  "limits": { "max_concurrency": ${SII_CONCURRENCY}, "requests_per_second": ${SII_RPS}, "max_retries": 5, "backoff_base": 2 },
  "geo": { "grid_step_m": 100 },
  "output_dir": "output"
}
JSON

  echo "▶ [1/3] Descubriendo manzanas (${stage})..."
  run_stage "manzanas ${code}" ./venv/bin/python run.py "$stage" --config config.json

  echo "▶ [2/3] Extrayendo predios..."
  run_stage "predios ${code}" ./venv/bin/python run.py predios --config config.json

  echo "▶ [3/3] Ingestando predios en sii_mapasui_predios_cl..."
  if [ -d output/predios ]; then
    DATABASE_URL="$DATABASE_URL" node "$REPO_DIR/scraper/ingest-sii-mapasui.mjs" --dir output/predios
  else
    echo "⚠ No se generó output/predios para ${nombre} — nada que ingestar."
  fi

  date -Iseconds > "$marker"
  echo "✅ Comuna ${nombre} (${code}) completa."
}

# ── Recorrer la cola sin pausas ─────────────────────────────────────────────
for i in "${!COMUNA_CODES[@]}"; do
  procesar_comuna "${COMUNA_CODES[$i]}" "${COMUNA_NOMBRES[$i]}" "${COMUNA_STAGES[$i]}"
done

# Parar el loop de ingesta incremental y hacer una ingesta final de cierre.
kill "$INGEST_LOOP_PID" 2>/dev/null || true
wait "$INGEST_LOOP_PID" 2>/dev/null || true
INGEST_LOOP_PID=""
if [ -d output/predios ]; then
  echo "▶ Ingesta final de cierre (todas las comunas)..."
  DATABASE_URL="$DATABASE_URL" node "$REPO_DIR/scraper/ingest-sii-mapasui.mjs" --dir output/predios || true
fi

# Marcador de cola completa: el watchdog deja de relanzar cuando existe. Solo
# se escribe en modo cola (en modo una-comuna override, el marcador por comuna
# ya alcanza y no queremos declarar "toda la cola lista").
if [ -z "${SII_COMUNA_CODE:-}" ]; then
  date -Iseconds > "$ALL_COMPLETE_MARKER"
fi

echo ""
echo "✅ Scrape + ingesta SII completados para: ${COMUNA_NOMBRES[*]}"
