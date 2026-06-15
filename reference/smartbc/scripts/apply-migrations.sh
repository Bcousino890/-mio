#!/usr/bin/env bash
# Aplica las migraciones SQL de supabase/migrations/ que aún NO se han
# aplicado, usando una tabla de control `schema_migrations` en la BD.
#
# Se ejecuta EN EL VPS (necesita docker + el contenedor `supabase-db`).
# Normalmente lo llama deploy.sh, pero también puedes correrlo suelto:
#   ssh root@178.105.176.3 'bash /opt/smartbc-app/scripts/apply-migrations.sh'
#
# Cómo funciona:
#   - La primera vez crea la tabla `schema_migrations` y marca TODAS las
#     migraciones actuales como ya aplicadas (la BD ya estaba al día, se
#     aplicaban a mano). NO las re-ejecuta.
#   - A partir de ahí, cada vez aplica solo los ficheros .sql nuevos que no
#     estén registrados, en orden, y los registra. Idempotente y seguro.
set -euo pipefail

MIG_DIR="/opt/smartbc-app/supabase/migrations"
DB_CONTAINER="supabase-db"

psql_run() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres "$@"; }

# ¿Existía ya la tabla de control? (para detectar la primera ejecución)
existed=$(psql_run -tAc "select to_regclass('public.schema_migrations') is not null" | tr -d '[:space:]')
psql_run -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now());" >/dev/null

if [ "$existed" != "t" ]; then
  echo "  Primera ejecución del runner: marcando migraciones existentes como aplicadas (sin re-ejecutarlas)…"
  for f in "$MIG_DIR"/*.sql; do
    [ -e "$f" ] || continue
    v="$(basename "$f")"
    psql_run -q -c "INSERT INTO schema_migrations(version) VALUES ('$v') ON CONFLICT DO NOTHING;" >/dev/null
  done
  echo "  Inicializado. A partir de ahora solo se aplicarán migraciones NUEVAS."
  exit 0
fi

applied=0
for f in $(ls "$MIG_DIR"/*.sql | sort); do
  v="$(basename "$f")"
  done_already=$(psql_run -tAc "select 1 from schema_migrations where version='$v'" | tr -d '[:space:]')
  [ "$done_already" = "1" ] && continue
  echo "  → aplicando $v"
  psql_run -v ON_ERROR_STOP=1 < "$f"
  psql_run -q -c "INSERT INTO schema_migrations(version) VALUES ('$v');" >/dev/null
  applied=$((applied + 1))
done

if [ "$applied" -eq 0 ]; then
  echo "  (sin migraciones pendientes)"
else
  echo "  $applied migración(es) aplicada(s)."
fi
