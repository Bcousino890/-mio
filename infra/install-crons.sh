#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · install-crons.sh — instalar las tareas periódicas EN EL VPS
# ─────────────────────────────────────────────────────────────────────────────
# Lo llama infra/deploy.sh en cada deploy. Es idempotente: reescribe el bloque
# marcado con # casafari-mio-cron y deja intacto el resto del crontab (ahí vive
# también el `certbot renew` que instala ensure-tls.sh, y lo que el VPS tenga
# de otros proyectos — zintoleads incluido).
#
# ── Por qué el cron vive acá y no en GitHub Actions ─────────────────────────
# El watchdog + ingesta de predios SII corría en un scheduled workflow cada 30
# min (ingest-sii-mapasui-now.yml). Ese workflow no hacía otra cosa que levantar
# un runner Ubuntu — facturado por minuto empezado, y este repo es privado —
# para abrir un SSH al VPS y lanzar un script que ya estaba en el VPS. 48
# arranques de runner al día como mando a distancia.
#
# Además GitHub descarta y retrasa mucho los scheduled runs: el propio workflow
# documentaba huecos reales de 2-3 h pidiendo cada 30 min. El cron local no
# deriva, así que corre cada 10 min y el panel va MÁS al día costando cero.
#
# Los workflows de disparo manual (botón / push al centinela) se quedan como
# están: solo gastan cuando alguien los aprieta.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MARCA="# casafari-mio-cron"
LOG_DIR="/var/log/casafari"

# /var/log/casafari si el deploy corre con permisos para ello; si no (usuario
# sin root), los logs van al output del repo. Se comprueba la ESCRITURA, no
# solo que el mkdir no falle: `mkdir -p` sobre un directorio existente devuelve
# 0 aunque no se pueda escribir en él, y el cron acabaría mandando todo a un
# redirect que falla en silencio.
mkdir -p "$LOG_DIR" 2>/dev/null || true
if [ ! -w "$LOG_DIR" ]; then
  LOG_DIR="$REPO_DIR/scraper/output"
  mkdir -p "$LOG_DIR"
fi

# Las tareas. Cada línea lleva la marca al final para poder reemplazar el
# bloque entero en el próximo deploy sin tocar nada más del crontab.
#
# El watchdog+ingesta se auto-serializa con flock -n, así que dos vueltas
# solapadas no se pisan; el `|| true` evita que cron mande mails de error.
BLOQUE=$(cat <<CRON
*/10 * * * * cd $REPO_DIR && flock -n /tmp/casafari-watchdog-sii-mapasui.lock bash scraper/sii-scraper/watchdog-ingest-sii-mapasui.sh >> $LOG_DIR/watchdog-sii-mapasui.log 2>&1 || true $MARCA
CRON
)

ACTUAL="$(crontab -l 2>/dev/null || true)"
# Quitar el bloque anterior (todas las líneas marcadas) y añadir el nuevo.
NUEVO="$(printf '%s\n' "$ACTUAL" | grep -v -- "$MARCA" || true)"
NUEVO="$(printf '%s\n%s\n' "$NUEVO" "$BLOQUE" | sed '/^$/d')"

if [ "$ACTUAL" = "$NUEVO" ]; then
  echo "✓ Cron de casafari-mio ya instalado y al día."
  exit 0
fi

printf '%s\n' "$NUEVO" | crontab -
echo "✅ Cron de casafari-mio instalado:"
printf '%s\n' "$BLOQUE" | sed 's/^/   /'
echo "   (logs en $LOG_DIR/watchdog-sii-mapasui.log)"

# Rotación mínima del log: sin esto crece sin freno en un VPS chico.
if [ -d /etc/logrotate.d ] && [ -w /etc/logrotate.d ]; then
  cat > /etc/logrotate.d/casafari-mio <<ROTATE
$LOG_DIR/*.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
  copytruncate
}
ROTATE
fi
