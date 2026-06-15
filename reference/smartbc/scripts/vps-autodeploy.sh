#!/usr/bin/env bash
# AUTO-DEPLOY del VPS por polling (copia de referencia).
#
# La copia OPERATIVA vive en el VPS en /opt/vps-autodeploy.sh (FUERA del repo,
# para que `git reset --hard` no la sobrescriba mientras se ejecuta). Un cron de
# root la lanza cada 5 minutos:
#     */5 * * * * /opt/vps-autodeploy.sh
#
# Qué hace: si main tiene commits nuevos, sincroniza y reconstruye. Usa una
# clave SSH dedicada de solo-lectura (/root/.ssh/github_pull, cuya pública está
# en la cuenta de GitHub con acceso al repo). Lock con flock para no solaparse.
# Si el build falla, NO reinicia (la app sigue con la build anterior). Log en
# /var/log/smartbc-autodeploy.log.
#
# Si editas este script, recuerda copiarlo también a /opt/vps-autodeploy.sh.
set -uo pipefail
APP=/opt/smartbc-app
LOG=/var/log/smartbc-autodeploy.log
export GIT_SSH_COMMAND="ssh -i /root/.ssh/github_pull -o StrictHostKeyChecking=no"

exec 9>/tmp/smartbc-autodeploy.lock
flock -n 9 || { echo "$(date -Is) [skip] deploy en curso" >> "$LOG"; exit 0; }

cd "$APP" || exit 1
git fetch origin main --quiet 2>>"$LOG" || { echo "$(date -Is) [warn] fetch fallo (clave en GitHub?)" >> "$LOG"; exit 0; }
REMOTE=$(git rev-parse origin/main)
LOCAL=$(git rev-parse HEAD 2>/dev/null || echo none)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date -Is) [deploy] $LOCAL -> $REMOTE" >> "$LOG"
git reset --hard origin/main >>"$LOG" 2>&1
npm install >>"$LOG" 2>&1
# Heap de 4GB: el build creció (mapas, gráficos, chat) y se quedaba sin memoria
# (OOM/SIGABRT). El VPS tiene 7.6GB RAM + swap, así que 4GB de heap entra bien.
if NODE_OPTIONS="--max-old-space-size=4096" npm run build >>"$LOG" 2>&1; then
  pm2 restart smartbc-portal >>"$LOG" 2>&1
  if bash scripts/apply-migrations.sh >>"$LOG" 2>&1; then
    echo "$(date -Is) [ok] deploy completado" >> "$LOG"
  else
    echo "$(date -Is) [warn] app desplegada pero MIGRACIONES fallaron — revisar" >> "$LOG"
  fi
else
  echo "$(date -Is) [error] build fallo; NO se reinicio (sigue build anterior)" >> "$LOG"
fi
