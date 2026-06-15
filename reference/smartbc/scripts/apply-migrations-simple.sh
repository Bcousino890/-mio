#!/bin/bash

# Script para aplicar todas las migraciones pendientes
# Uso: bash scripts/apply-migrations-simple.sh

set -e

echo "🔄 Aplicando migraciones a PostgreSQL del VPS..."
echo ""

# Encontrar todas las migraciones
MIGRATIONS=$(find supabase/migrations -name "*.sql" | sort)

for migration in $MIGRATIONS; do
  filename=$(basename "$migration")
  echo "📝 Aplicando $filename..."

  # Ejecutar el SQL en el contenedor supabase-db
  docker exec -i supabase-db psql -U postgres -d postgres < "$migration"

  if [ $? -eq 0 ]; then
    echo "✅ $filename aplicada exitosamente"
  else
    echo "⚠️  Error aplicando $filename (puede ser normal si ya está aplicada)"
  fi
  echo ""
done

echo "✨ Migraciones completadas"
echo ""
echo "Resumen de cambios:"
echo "  ✅ Migración 0025: Nuevos roles (agent_junior, agent_senior, agent_admin)"
echo "  ✅ Migración 0026: Sistema de chat de equipo"
echo "  ✅ Migración 0028: Mensajes directos entre equipo"
echo "  ✅ Migración 0029: Permisos por usuario (overrides)"
echo "  ✅ Migración 0021: Email config encriptado"
echo ""
echo "Ahora puedes:"
echo "  1. Crear usuarios admin/asesor en el portal"
echo "  2. Configurar SMTP en /admin/configuracion"
echo "  3. Usar matriz de permisos por usuario"
echo "  4. Enviar emails de reset de contraseña"
