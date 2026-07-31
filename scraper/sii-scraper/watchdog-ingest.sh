#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# watchdog-ingest.sh — watchdog del scrape SII mapasui + ingesta de
# output/predios/*.jsonl, corriendo LOCAL en el VPS (sin SSH).
#
# Reemplaza al cron de .github/workflows/ingest-sii-mapasui-now.yml: ese
# workflow entraba por SSH cada 30 min solo para ejecutar estos mismos
# comandos ya en el VPS, consumiendo minutos de GitHub Actions sin necesidad
# (el trabajo siempre fue 100% local al servidor). Además fallaba seguido:
# re-ingestar el .jsonl de una comuna ya completa tarda minutos y la sesión
# SSH se cortaba a mitad ("client_loop: send disconnect: Broken pipe", exit
# 255). ingest-sii-mapasui.mjs ahora además salta los archivos sin cambios
# desde la última ingesta, así que corridas normales de este script son
# casi instantáneas una vez que una comuna termina.
#
# infra/deploy.sh instala este script en el crontab del VPS (cada 30 min,
# idempotente) en cada deploy — no depende de GitHub Actions para repetirse.
# ingest-sii-mapasui-now.yml se conserva solo como botón manual
# (workflow_dispatch) para forzar una corrida desde fuera si hace falta.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"
LOCK=/tmp/casafari-scrape-sii-mapasui.lock
OUT=scraper/sii-scraper/output

# ── Watchdog del scrape ──────────────────────────────────────────────────
# Pausa manual (stop-sii-mapasui.yml): mientras exista el flag, el watchdog
# NO relanza. Se limpia al apretar el botón de launch. La ingesta de abajo
# SÍ corre igual (mismo comportamiento que los dos steps separados del
# workflow original).
if [ -f "$OUT/.sii-mapasui-paused" ]; then
  echo "⏸ Scrape SII PAUSADO ($(cat "$OUT/.sii-mapasui-paused")) — el watchdog no relanza."
else
  necesita_relanzar=""
  PID=$(cat "$LOCK" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    # Vivo. ¿Progresa? Checkpoints o JSONL tocados en las últimas 6 h.
    # (Los backoffs anti-429 duran minutos; 6 h sin escribir = colgado.)
    if [ -d "$OUT" ] && [ -n "$(find "$OUT/checkpoints" "$OUT/predios" -newermt '-6 hours' -print -quit 2>/dev/null)" ]; then
      echo "✓ Scrape vivo y con progreso (PID $PID) — nada que hacer."
    elif [ -n "$(find "$LOCK" -newermt '-6 hours' -print -quit 2>/dev/null)" ]; then
      # Corrida joven (<6 h): aún puede estar en venv/descubrimiento sin
      # haber escrito nada — no juzgarla todavía.
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
    echo "✓ Scrape terminado ($(cat "$OUT/.sii-mapasui-complete")) — comuna completa, nada que relanzar."
    rm -f "$LOCK"
  else
    echo "⚠ Scrape muerto sin completar — relanzando..."
    rm -f "$LOCK"
    necesita_relanzar=1
  fi

  if [ -n "$necesita_relanzar" ]; then
    # Velocidad de la corrida original si quedó en disco (RPS/concurrencia).
    # NO se fija SII_COMUNA_CODE: run-sii-mapasui.sh cae en modo COLA y
    # retoma la primera comuna pendiente de comunas-queue.json desde sus
    # checkpoints (salta las ya marcadas .complete-<code>).
    if [ -f "$OUT/.sii-mapasui-params" ]; then
      set -a; source "$OUT/.sii-mapasui-params"; set +a
      echo "  (params: ${SII_RPS:-?} rps × ${SII_CONCURRENCY:-?} · modo cola)"
    fi
    mkdir -p scraper/output
    chmod +x scraper/sii-scraper/run-sii-mapasui.sh
    nohup bash scraper/sii-scraper/run-sii-mapasui.sh \
      > "scraper/output/watchdog-relaunch-$(date +%Y%m%d_%H%M%S).log" 2>&1 < /dev/null &
    NEWPID=$!
    disown
    sleep 3
    if kill -0 "$NEWPID" 2>/dev/null; then
      echo "▶ Scrape relanzado por el watchdog (PID $NEWPID)."
    else
      echo "✗ El relanzamiento no arrancó — revisar scraper/output/ en el VPS."
      exit 1
    fi
  fi
fi

# ── Ingestar output/predios/*.jsonl existente ───────────────────────────────
cd "$REPO_DIR/scraper"
if [ ! -d sii-scraper/output/predios ]; then
  echo "○ No existe sii-scraper/output/predios — nada que ingestar."
  exit 0
fi
if [ -f ../.env ]; then set -a; source ../.env; set +a; fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "✗ Falta POSTGRES_PASSWORD (revisa .env)"
  exit 1
fi
export DATABASE_URL="postgres://casafari:${POSTGRES_PASSWORD}@127.0.0.1:5433/casafari"
if [ ! -d node_modules/pg ]; then
  echo "▶ Instalando dependencias Node del scraper (pg)..."
  npm install --omit=dev --no-audit --no-fund
fi
echo "▶ Ingestando sii-scraper/output/predios/ en sii_mapasui_predios_cl..."
# flock -n: run-sii-mapasui.sh corre su propia ingesta incremental mientras
# scrapea, así que esta vuelta del cron puede caer justo encima. Con el
# checkpoint por bytes de la migración 0090 saltarse una vuelta no pierde nada
# — la siguiente recoge lo que falte — y evita dos ingestas peleando por la
# misma tabla.
flock -n /tmp/casafari-ingest-sii-mapasui.lock \
  node ingest-sii-mapasui.mjs --dir sii-scraper/output/predios \
  || echo "⏭ Otra ingesta tiene el lock (o falló) — se reintenta en la próxima vuelta."
