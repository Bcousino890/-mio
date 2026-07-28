#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · scraper/sii-scraper/watchdog-ingest-sii-mapasui.sh
#
# Watchdog del scrape SII + ingesta del output ya existente. Corre EN EL VPS,
# desde el cron local (lo instala infra/install-crons.sh en cada deploy).
#
# ── Por qué acá y no en GitHub Actions ──────────────────────────────────────
# Esto vivía en el cron de ingest-sii-mapasui-now.yml (cada 30 min). Ese
# workflow no hacía otra cosa que levantar un runner Ubuntu completo — facturado
# por minuto empezado en repos privados — para abrir una sesión SSH al VPS y
# lanzar exactamente estos comandos. 48 corridas al día de un runner que solo
# sirve de mando a distancia es plata tirada, teniendo el VPS ya pagado y siendo
# él quien hace el trabajo de verdad.
#
# De regalo, el cron local arregla un problema que el propio workflow
# documentaba: GitHub descarta y retrasa mucho los scheduled runs (se veían
# huecos reales de 2-3 h pidiendo cada 30 min). El cron del VPS no deriva, así
# que se puede correr cada 10 min y /chile/sii-mapasui va más al día que antes
# costando cero.
#
# El workflow sigue existiendo para dispararlo A MANO (botón / push al
# centinela), y llama a este mismo script: una sola copia de la lógica.
#
# Qué hace, en dos partes:
#   1. Watchdog del scrape (nohup suelto, sin supervisor):
#        - proceso vivo y con progreso           → no tocar
#        - proceso vivo pero SIN progreso en 6 h → colgado: matar y relanzar
#        - muerto y .sii-mapasui-complete existe → cola completa, todo bien
#        - muerto sin marcador                   → murió a medias: relanzar
#      El relanzamiento reutiliza los parámetros de la corrida original
#      (.sii-mapasui-params) y retoma desde los checkpoints, sin perder nada.
#   2. Ingesta de output/predios/*.jsonl en sii_mapasui_predios_cl. Es
#      incremental (checkpoint por archivo, migración 0082): solo lee las
#      líneas nuevas, así que una corrida normal tarda segundos.
#
# Uso:  bash /opt/casafari/scraper/sii-scraper/watchdog-ingest-sii-mapasui.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

LOCK=/tmp/casafari-scrape-sii-mapasui.lock
INGEST_LOCK=/tmp/casafari-ingest-sii-mapasui.lock
OUT=scraper/sii-scraper/output

echo "── $(date -Iseconds) · watchdog + ingesta SII mapasui ──"

# ── 1. Watchdog ─────────────────────────────────────────────────────────────
watchdog() {
  # Pausa manual (stop-sii-mapasui.yml): mientras exista el flag, el watchdog
  # NO relanza. Se limpia al apretar el botón de launch.
  if [ -f "$OUT/.sii-mapasui-paused" ]; then
    echo "⏸ Scrape SII PAUSADO ($(cat "$OUT/.sii-mapasui-paused")) — el watchdog no relanza."
    return 0
  fi

  local necesita_relanzar=""
  local PID
  PID=$(cat "$LOCK" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    # Vivo. ¿Progresa? Checkpoints o JSONL tocados en las últimas 6 h.
    # (Los backoffs anti-429 duran minutos; 6 h sin escribir = colgado.)
    if [ -d "$OUT" ] && [ -n "$(find "$OUT/checkpoints" "$OUT/predios" -newermt '-6 hours' -print -quit 2>/dev/null)" ]; then
      echo "✓ Scrape vivo y con progreso (PID $PID) — nada que hacer."
    elif [ -n "$(find "$LOCK" -newermt '-6 hours' -print -quit 2>/dev/null)" ]; then
      # Corrida joven (<6 h): aún puede estar en venv/descubrimiento sin haber
      # escrito nada — no juzgarla todavía.
      echo "✓ Scrape vivo, corrida reciente (PID $PID) — esperando progreso."
    elif [ -f "$OUT/.sii-mapasui-complete" ]; then
      # Vivo sin escribir pero ya completó antes (p. ej. corrida de
      # verificación); no es un cuelgue.
      echo "✓ Scrape vivo, comuna ya completa — nada que hacer."
    else
      echo "⚠ Scrape vivo pero sin progreso en 6 h (PID $PID) — colgado. Matando..."
      pkill -9 -f "run-sii-mapasui.sh" || true
      # Los workers corren como "./venv/bin/python run.py <etapa> ..." (ruta
      # relativa): "sii-scraper/run.py" no matchea su cmdline.
      pkill -9 -f "run\.py (regiones|manzanas|predios)" || true
      pkill -9 -f "sii-scraper/run.py" || true
      rm -f "$LOCK"
      necesita_relanzar=1
    fi
  elif [ -f "$OUT/.sii-mapasui-complete" ]; then
    echo "✓ Scrape terminado ($(cat "$OUT/.sii-mapasui-complete")) — cola completa, nada que relanzar."
    rm -f "$LOCK"
  else
    echo "⚠ Scrape muerto sin completar — relanzando..."
    rm -f "$LOCK"
    necesita_relanzar=1
  fi

  [ -n "$necesita_relanzar" ] || return 0

  # Velocidad de la corrida original si quedó en disco (RPS/concurrencia).
  # NO se fija SII_COMUNA_CODE: run-sii-mapasui.sh cae en modo COLA y retoma la
  # primera comuna pendiente de comunas-queue.json desde sus checkpoints (salta
  # las ya marcadas .complete-<code>), de modo que el relanzamiento continúa
  # hacia Vitacura sin intervención humana.
  if [ -f "$OUT/.sii-mapasui-params" ]; then
    set -a; source "$OUT/.sii-mapasui-params"; set +a
    echo "  (params: ${SII_RPS:-?} rps × ${SII_CONCURRENCY:-?} · modo cola)"
  fi
  mkdir -p scraper/output
  chmod +x scraper/sii-scraper/run-sii-mapasui.sh
  nohup bash scraper/sii-scraper/run-sii-mapasui.sh \
    > "scraper/output/watchdog-relaunch-$(date +%Y%m%d_%H%M%S).log" 2>&1 < /dev/null &
  local NEWPID=$!
  disown
  sleep 3
  if kill -0 "$NEWPID" 2>/dev/null; then
    echo "▶ Scrape relanzado por el watchdog (PID $NEWPID)."
  else
    echo "✗ El relanzamiento no arrancó — revisar scraper/output/."
    return 1
  fi
}

# ── 2. Ingesta del output existente ─────────────────────────────────────────
ingesta() {
  if [ ! -d "$OUT/predios" ]; then
    echo "○ No existe $OUT/predios — nada que ingestar."
    return 0
  fi
  if [ -f .env ]; then set -a; source .env; set +a; fi
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    echo "✗ Falta POSTGRES_PASSWORD (revisa .env)"
    return 1
  fi
  export DATABASE_URL="postgres://casafari:${POSTGRES_PASSWORD}@127.0.0.1:5433/casafari"

  if [ ! -d scraper/node_modules/pg ]; then
    echo "▶ Instalando dependencias Node del scraper (pg)..."
    (cd scraper && npm install --omit=dev --no-audit --no-fund)
  fi

  echo "▶ Ingestando $OUT/predios/ en sii_mapasui_predios_cl..."
  # Por defecto -n (no bloqueante): si run-sii-mapasui.sh está en su ingesta
  # incremental, esta vuelta se salta y con el checkpoint de 0082 no se pierde
  # nada — la próxima pasada del cron (10 min) recoge lo que falte. Una corrida
  # lanzada A MANO sí espera el lock (el workflow pasa "-w 900"): si alguien
  # aprieta el botón es porque quiere el dato ahora, no un "vuelvo luego".
  # shellcheck disable=SC2086
  flock ${SII_INGEST_FLOCK_OPTS:--n} "$INGEST_LOCK" \
    node scraper/ingest-sii-mapasui.mjs --dir "$OUT/predios" \
    || echo "⏭ Otra ingesta tiene el lock (o falló) — se reintenta en la próxima vuelta."
}

watchdog
ingesta
