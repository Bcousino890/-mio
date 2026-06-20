#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · post-deploy.sh — aplicar migraciones SQL tras deploy
# ─────────────────────────────────────────────────────────────────────────────
# Ejecuta TODAS las migraciones en /db/migrations/ en orden (0001, 0002, ...).
# Se llama automáticamente tras deploy.sh.
#
# Corre los psql DENTRO del contenedor de Postgres (docker compose exec) en vez
# de contra el host: el VPS no tiene el cliente `psql` instalado, y el puerto
# publicado en el host (5433, ver docker-compose.yml) no coincide con el que
# documenta .env.example (5432) — ambos motivos hacían que esto fallara en
# silencio en TODOS los deploys hasta ahora (el error quedaba enmascarado por
# `|| true` en deploy.sh). Dentro del contenedor no hay que lidiar con ninguno
# de los dos: se habla con Postgres por su puerto interno de siempre.
#
# Uso:
#   bash infra/post-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_DIR/db/migrations"
COMPOSE="docker compose -p casafari --env-file $REPO_DIR/.env -f $REPO_DIR/infra/docker-compose.yml"

if [ ! -f "$REPO_DIR/.env" ]; then
  echo "❌ No existe .env — cópialo de .env.example y rellena los valores"
  exit 1
fi
set -a
source "$REPO_DIR/.env"
set +a

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "❌ POSTGRES_PASSWORD no definida en .env"
  exit 1
fi

PSQL="$COMPOSE exec -T -e PGPASSWORD=$POSTGRES_PASSWORD postgres psql -U casafari -d casafari"

echo "▶ Esperando a que PostgreSQL esté listo..."
for i in {1..30}; do
  PG_ERR=$($PSQL -c "SELECT 1" 2>&1 >/dev/null) && { echo "✅ PostgreSQL listo"; break; }
  if [ $i -eq 30 ]; then
    echo "❌ Timeout esperando PostgreSQL"
    echo "   Último error: $PG_ERR"
    exit 1
  fi
  echo "  · Intento $i/30..."
  sleep 1
done

echo ""
echo "▶ Aplicando migraciones en orden..."
cd "$MIGRATIONS_DIR"

# Se descubren dinámicamente TODOS los *.sql presentes (orden numérico por
# nombre de archivo) en vez de mantener a mano una lista — una lista fija se
# queda desactualizada en silencio: migraciones nuevas simplemente no corren,
# sin ningún error ni warning (pasó con 0016-0021, nunca llegaron a producción).
for FILE in $(ls *.sql 2>/dev/null | sort); do
  echo "▶ Aplicando: $FILE"

  # El volumen ../db/migrations:/migrations:ro expone el mismo archivo dentro
  # del contenedor con el mismo nombre.
  if $PSQL -f "/migrations/$FILE" 2>&1 | grep -q "already exists"; then
    echo "  ℹ️  (ya existe, saltando)"
  elif $PSQL -f "/migrations/$FILE"; then
    echo "  ✅ Ok"
  else
    echo "  ❌ Error aplicando $FILE"
    exit 1
  fi
done

echo ""
echo "✅ Todas las migraciones aplicadas"
