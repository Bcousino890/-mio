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
# Limpiar locks viejos de procesos muertos (prevenir bloqueos persistentes)
if [ -e "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
  if ! kill -0 "$OLD_PID" 2>/dev/null; then
    rm -f "$LOCKFILE"
  elif [ -n "$OLD_PID" ]; then
    echo "✗ Ya hay un scrape TGR en curso (PID $OLD_PID). Abortando."
    exit 1
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# Cada Selenium worker deja un chrome/chromedriver huérfano si el script padre
# se mata con pkill/kill -9 (eso no se propaga a los hijos). Tras suficientes
# relanzamientos en el día estos huérfanos se acumulan, agotan la RAM del VPS
# y dejan sin recursos a la sesión nueva (causa real de quedar "atascado" pese
# a que el lanzamiento en sí se vea exitoso). Limpiar siempre al iniciar.
pkill -9 -f "chromedriver-standalone/chromedriver" 2>/dev/null || true
pkill -9 -f "google/chrome/chrome" 2>/dev/null || true

if [ -f .env ]; then
  set -a; source .env; set +a
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "✗ Falta POSTGRES_PASSWORD (revisa .env)"
  exit 1
fi
export DATABASE_URL="postgres://casafari:${POSTGRES_PASSWORD}@127.0.0.1:5433/casafari"

echo "▶ Verificando Google Chrome del sistema (Selenium lo necesita para los certificados TGR)..."
# El paquete apt "chromium" en Ubuntu es solo un wrapper que instala la versión
# snap-confinada por Canonical. Bajo AppArmor, esa build no puede escribir en
# rutas arbitrarias de /tmp (como el --user-data-dir único por worker que
# necesitamos para evitar locks de perfil compartido entre workers paralelos),
# lo que causa "Chrome instance exited" al crear la sesión de Selenium. Por
# eso instalamos Google Chrome estable vía .deb directo (sin snap/AppArmor).
GOOGLE_CHROME_BIN="/usr/bin/google-chrome-stable"
if [ ! -x "$GOOGLE_CHROME_BIN" ]; then
  apt-get update -qq
  wget -q -O /tmp/google-chrome-stable.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/google-chrome-stable.deb
  rm -f /tmp/google-chrome-stable.deb
fi
# Usamos la ruta absoluta directamente en vez de "command -v": en runs previos,
# "command -v google-chrome-stable" devolvió vacío justo tras la instalación
# (el binario no estaba aún reflejado en el PATH de ese subshell), dejando
# CHROME_BINARY="" y haciendo que Selenium cayera a su autodetección, que
# fallaba con "no chrome binary at /usr/bin/google-chrome-stable" pese a que
# el binario sí existía. Verificamos explícitamente con -x antes de exportar.
if [ ! -x "$GOOGLE_CHROME_BIN" ]; then
  echo "✗ google-chrome-stable no quedó instalado en $GOOGLE_CHROME_BIN tras la instalación"
  exit 1
fi
# /usr/bin/google-chrome-stable es un symlink a /opt/google/chrome/google-chrome,
# que a su vez NO es el binario real sino un script wrapper de ~1KB (configura
# variables de entorno y hace exec del binario verdadero). ChromeDriver valida
# que CHROME_BINARY sea un ELF de Chrome real, así que rechaza el wrapper con
# "no chrome binary" aunque bash sí pueda ejecutarlo directamente (por eso el
# diagnóstico de lanzarlo a mano vía bash funcionaba pero Selenium fallaba).
# Apuntamos directo al binario real junto al wrapper.
REAL_CHROME_BIN="$(dirname "$(readlink -f "$GOOGLE_CHROME_BIN")")/chrome"
if [ -x "$REAL_CHROME_BIN" ]; then
  export CHROME_BINARY="$REAL_CHROME_BIN"
else
  export CHROME_BINARY="$GOOGLE_CHROME_BIN"
fi

# ChromeDriver: NO usamos el paquete apt "chromium-driver" — confirmado por
# diagnóstico que es un wrapper transicional de Ubuntu que en realidad invoca
# el chromedriver del snap chromium (chromium-chromedriver, perfil AppArmor
# snap.chromium.chromedriver, "aa-status" lo muestra activo). Ese perfil
# confina el proceso a las rutas permitidas por el sandbox de snap y bloquea
# el acceso a /opt/google/chrome/* (donde vive Google Chrome estable), lo que
# causaba el "no chrome binary at ..." instantáneo (1ms, sin intento real de
# stat/exec) sin importar si apuntábamos al wrapper o al binario real de
# Chrome. Instalamos en su lugar el chromedriver oficial standalone (Chrome
# for Testing), sin snap/AppArmor, en una versión que matchee la de Chrome.
CHROMEDRIVER_STANDALONE_DIR="/opt/chromedriver-standalone"
CHROMEDRIVER_BIN="$CHROMEDRIVER_STANDALONE_DIR/chromedriver"
CHROME_VERSION="$("$CHROME_BINARY" --version | grep -oP '[\d.]+' | head -1)"
if [ ! -x "$CHROMEDRIVER_BIN" ] || [ "$("$CHROMEDRIVER_BIN" --version 2>/dev/null | grep -oP '[\d.]+' | head -1)" != "$CHROME_VERSION" ]; then
  echo "▶ Instalando chromedriver standalone $CHROME_VERSION (sin snap/AppArmor)..."
  mkdir -p "$CHROMEDRIVER_STANDALONE_DIR"
  command -v unzip >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq unzip; }
  CD_URL="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chromedriver-linux64.zip"
  wget -q -O /tmp/chromedriver-standalone.zip "$CD_URL"
  rm -rf /tmp/chromedriver-extract
  mkdir -p /tmp/chromedriver-extract
  unzip -q -o /tmp/chromedriver-standalone.zip -d /tmp/chromedriver-extract
  cp /tmp/chromedriver-extract/chromedriver-linux64/chromedriver "$CHROMEDRIVER_BIN"
  chmod +x "$CHROMEDRIVER_BIN"
  rm -rf /tmp/chromedriver-standalone.zip /tmp/chromedriver-extract
fi
if [ ! -x "$CHROMEDRIVER_BIN" ]; then
  echo "✗ chromedriver standalone no está disponible tras la instalación"
  exit 1
fi
export CHROMEDRIVER_PATH="$CHROMEDRIVER_BIN"
echo "  CHROMEDRIVER_PATH=$CHROMEDRIVER_PATH"
echo "  CHROME_BINARY=$CHROME_BINARY"

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

# Verificar que CSV se generó correctamente (no vacío)
if [ ! -s "roles_input_rm.csv" ]; then
  echo "✗ CRÍTICO: roles_input_rm.csv vacío o no existe. Docker Postgres falló?" >&2
  exit 1
fi

TOTAL=$(($(wc -l < roles_input_rm.csv) - 1))
if [ "$TOTAL" -lt 1 ]; then
  echo "✗ CRÍTICO: CSV tiene 0 roles (solo header). Abortar." >&2
  exit 1
fi
echo "▶ ${TOTAL} roles a procesar. Lanzando tgr_scraper.py..."

# LOGGING AGRESIVO: capturar TODOS los errores y output
LOG_FILE="/opt/casafari/scraper/output/tgr-debug-$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$(dirname "$LOG_FILE")"

echo "=== DEBUG LOG ===" > "$LOG_FILE"
echo "Started: $(date -u)" >> "$LOG_FILE"
echo "DATABASE_URL: $DATABASE_URL" >> "$LOG_FILE"
echo "CHROME_BINARY: $CHROME_BINARY" >> "$LOG_FILE"
echo "SMARTPROXY_CL_HOST: $SMARTPROXY_CL_HOST" >> "$LOG_FILE"
echo "CSV rows: $TOTAL" >> "$LOG_FILE"
echo "=== Running tgr_scraper.py ===" >> "$LOG_FILE"

./venv/bin/python tgr_scraper.py --input roles_input_rm.csv 2>&1 | tee -a "$LOG_FILE"
SCRAPER_EXIT=$?

echo "=== Scraper exit code: $SCRAPER_EXIT ===" >> "$LOG_FILE"
echo "Ended: $(date -u)" >> "$LOG_FILE"

if [ $SCRAPER_EXIT -ne 0 ]; then
  echo "✗ tgr_scraper.py failed with exit code $SCRAPER_EXIT (see $LOG_FILE)" >&2
  exit $SCRAPER_EXIT
fi
