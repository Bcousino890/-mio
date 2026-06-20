#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · remote-deploy.sh — orquestación remota ejecutada por
# .github/workflows/deploy.yml en el VPS (vía `ssh ... bash remote-deploy.sh`).
#
# Antes este script se enviaba inline como heredoc de `ssh ... bash -s << EOF`.
# Eso es un footgun conocido: cualquier comando dentro del script que herede
# stdin (p.ej. `docker compose exec` sin `-T`, o incluso con `-T` en bucles
# largos como el de post-deploy.sh) puede robarle bytes al pipe SSH que el
# propio `bash -s` todavía no ha leído, descartando en silencio el resto del
# script — exactamente lo que pasó: el bloque de web-cousino (después del
# deploy del CRM) nunca se ejecutaba, sin ningún error visible. Al vivir en un
# archivo real (sincronizado por rsync y ejecutado por ruta), bash lo lee con
# `open()` propio en vez de compartir el pipe de stdin con sus hijos, así que
# ya no hay nada que robar.
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd /opt/casafari

# scraper/output no está en git (se genera en runtime); el rsync
# --delete del paso anterior ya lo excluye, pero si por lo que
# sea no existe (primer deploy, o quedó borrado de una corrida
# vieja antes del exclude) hay que recrearlo o un scrape en
# curso muere con ENOENT al escribir su fail-log.
mkdir -p scraper/output

# .env: si no existe lo crea desde la plantilla; si existe pero le
# falta POSTGRES_PASSWORD (p.ej. de un intento previo fallido), lo completa.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "📄 .env creado desde .env.example"
fi
if ! grep -q '^POSTGRES_PASSWORD=..*' .env; then
  if grep -q '^POSTGRES_PASSWORD=' .env; then
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
  else
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
  fi
  echo "🔑 POSTGRES_PASSWORD generado aleatoriamente"
fi

# Primera vez: bootstrap completo (DB+nginx+TLS). Después: deploy normal.
if docker ps --format '{{.Names}}' | grep -q casafari-app; then
  echo "▶ Deploy incremental (app ya existe)"
  bash infra/deploy.sh
else
  echo "▶ Primera instalación: bootstrap completo"
  bash infra/bootstrap.sh
fi

# Sitio público web-cousino (independiente, sin DB).
if docker ps --format '{{.Names}}' | grep -q casafari-cousino-app; then
  echo "▶ Deploy incremental web-cousino (app ya existe)"
  bash infra/deploy-cousino.sh
else
  echo "▶ Primera instalación web-cousino: bootstrap completo"
  bash infra/bootstrap-cousino.sh
fi
