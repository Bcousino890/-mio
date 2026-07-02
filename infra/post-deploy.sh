#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · post-deploy.sh — aplicar migraciones SQL tras deploy
# ─────────────────────────────────────────────────────────────────────────────
# Aplica las migraciones de /db/migrations/ que aún no estén registradas en la
# tabla schema_migrations, en orden por nombre de archivo, UNA sola vez cada
# una y con ON_ERROR_STOP.
#
# Por qué el tracking con schema_migrations (y no re-ejecutar todo):
#   - La versión anterior corría CADA archivo DOS veces (una piped a
#     `grep "already exists"` y, si no matcheaba, otra "de verdad") — las
#     migraciones de datos se ejecutaban doble en cada deploy.
#   - Sin ON_ERROR_STOP, un error a mitad de archivo dejaba migraciones
#     aplicadas a medias sin que el deploy fallara.
#   La primera pasada tras este cambio re-aplica los archivos existentes una
#   última vez (son idempotentes: CREATE IF NOT EXISTS / ON CONFLICT) y los
#   registra; desde ahí, cada deploy solo ejecuta lo nuevo.
#
# Corre los psql DENTRO del contenedor de Postgres (docker compose exec): el
# VPS no tiene cliente psql y el puerto host (5433) no es el estándar.
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

PSQL="$COMPOSE exec -T -e PGPASSWORD=$POSTGRES_PASSWORD postgres psql -U casafari -d casafari -v ON_ERROR_STOP=1 -q"

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

# Tabla de tracking (idempotente)
$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)" >/dev/null

echo ""
echo "▶ Aplicando migraciones pendientes..."
cd "$MIGRATIONS_DIR"

APPLIED=0
SKIPPED=0
for FILE in $(ls *.sql 2>/dev/null | sort); do
  ALREADY=$($PSQL -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '$FILE'" | tr -d '[:space:]')
  if [ "$ALREADY" = "1" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "▶ Aplicando: $FILE"
  # El volumen ../db/migrations:/migrations:ro expone el mismo archivo dentro
  # del contenedor con el mismo nombre.
  if $PSQL -f "/migrations/$FILE"; then
    $PSQL -c "INSERT INTO schema_migrations (filename) VALUES ('$FILE') ON CONFLICT DO NOTHING" >/dev/null
    APPLIED=$((APPLIED + 1))
    echo "  ✅ Ok"
  else
    echo "  ❌ Error aplicando $FILE — deploy detenido (no se registró como aplicada)"
    exit 1
  fi
done

echo ""
echo "✅ Migraciones: $APPLIED aplicadas, $SKIPPED ya registradas"
