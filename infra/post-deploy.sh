#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# casafari-mio · post-deploy.sh — aplicar migraciones SQL tras deploy
# ─────────────────────────────────────────────────────────────────────────────
# Ejecuta TODAS las migraciones en /db/migrations/ en orden (0001, 0002, ...).
# Se llama automáticamente tras deploy.sh.
#
# Uso:
#   bash infra/post-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_DIR/db/migrations"

# Source .env para obtener DATABASE_URL
if [ ! -f "$REPO_DIR/.env" ]; then
  echo "❌ No existe .env — cópialo de .env.example y rellena los valores"
  exit 1
fi
set -a
source "$REPO_DIR/.env"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL no definida en .env"
  exit 1
fi

echo "▶ Esperando a que PostgreSQL esté listo..."
for i in {1..30}; do
  if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    echo "✅ PostgreSQL listo"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Timeout esperando PostgreSQL"
    exit 1
  fi
  echo "  · Intento $i/30..."
  sleep 1
done

echo ""
echo "▶ Aplicando migraciones en orden..."
cd "$MIGRATIONS_DIR"

# Array de migraciones (en orden)
MIGRATIONS=(0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013)

for num in "${MIGRATIONS[@]}"; do
  MIGRATION_FILE="${num}_*.sql"
  FILE=$(ls $MIGRATION_FILE 2>/dev/null | head -1)

  if [ -z "$FILE" ]; then
    echo "⏭️  Migración $num: no encontrada (saltando)"
    continue
  fi

  echo "▶ Aplicando: $FILE"

  # Intenta aplicar; si falla por "ya existe", continúa (idempotente)
  if psql "$DATABASE_URL" -f "$FILE" 2>&1 | grep -q "already exists"; then
    echo "  ℹ️  (ya existe, saltando)"
  elif psql "$DATABASE_URL" -f "$FILE"; then
    echo "  ✅ Ok"
  else
    echo "  ❌ Error aplicando $FILE"
    exit 1
  fi
done

echo ""
echo "✅ Todas las migraciones aplicadas"
