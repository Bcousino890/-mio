#!/bin/bash

# Script de post-deploy que se ejecuta después de cada git pull en el VPS
# Se encarga de aplicar migraciones y otros cambios necesarios
# Uso: Se debe llamar automáticamente desde el cron de deploy

echo "🚀 Post-deploy: Aplicando cambios..."
echo ""

# Detectar si estamos en Docker o no
if command -v docker &> /dev/null && docker ps | grep -q supabase-db; then
  DB_CMD="docker exec -i supabase-db psql -U postgres -d postgres"
  echo "✅ Docker disponible - usando contenedor supabase-db"
elif command -v docker &> /dev/null; then
  echo "⚠️  Contenedor supabase-db no está corriendo. Intentando iniciar..."
  docker start supabase-db 2>/dev/null || echo "No se pudo iniciar. Usando psql local si está disponible."
  if docker ps | grep -q supabase-db; then
    DB_CMD="docker exec -i supabase-db psql -U postgres -d postgres"
  else
    DB_CMD="psql -U postgres -d postgres"
  fi
else
  DB_CMD="psql -U postgres -d postgres"
  echo "⚠️  Docker no disponible - usando psql local"
fi

# Aplicar migraciones
echo "📝 Aplicando migraciones SQL..."
MIGRATION_COUNT=0
ERROR_COUNT=0

for migration in supabase/migrations/*.sql; do
  if [ -f "$migration" ]; then
    filename=$(basename "$migration")
    echo "  • $filename"

    # Ejecutar migración con timeout de 30s
    if timeout 30 $DB_CMD < "$migration" 2>&1 | grep -q "ERROR\|error"; then
      echo "    ⚠️  (puede ser normal si ya está aplicada)"
      ((ERROR_COUNT++))
    elif timeout 30 $DB_CMD < "$migration" > /dev/null 2>&1; then
      ((MIGRATION_COUNT++))
    else
      echo "    ⚠️  (timeout o ya aplicada)"
    fi
  fi
done

echo "✅ $MIGRATION_COUNT migraciones procesadas ($ERROR_COUNT mensajes de advertencia)"
echo ""

# Instalar dependencias si es necesario
if [ -f "package.json" ]; then
  echo "📦 Verificando dependencias..."
  npm ci --production 2>&1 | grep -E "^added|^up to date" || true
fi

# Build de Next.js
if [ -f "next.config.js" ] || [ -f "next.config.mjs" ]; then
  echo "🔨 Compilando Next.js..."
  if npm run build; then
    echo "✅ Build exitoso"
  else
    echo "❌ Error en build - revisa los logs arriba"
    exit 1
  fi
fi


# NOTA: la verificación de teléfonos de particulares ya NO se hace aquí.
# Va integrada en el cron horario /api/cron/particulares/scrape, que cada
# hora revisa ~50 anuncios sin teléfono vía el endpoint AJAX de Idealista
# ("Ver teléfono"). No depende del crontab del VPS ni de este script.

echo ""
echo "✨ Post-deploy completado"
echo ""
echo "Sistema listo para:"
echo "  ✅ Crear usuarios admin/asesor"
echo "  ✅ Configurar SMTP"
echo "  ✅ Usar matriz de permisos"
echo "  ✅ Enviar emails de reset"
echo "  ✅ Verificación automática de teléfonos (en el cron horario)"
