#!/bin/bash
# ═════════════════════════════════════════════════════════════════════════════
# QUICK START: Implementar estructura DISTRITO → ZONA → SUBZONA
# ═════════════════════════════════════════════════════════════════════════════
#
# Este script automatiza los primeros pasos de implementación:
#   1. Crear tablas normalizadas
#   2. Migrar datos históricos
#   3. Validar completitud
#   4. Test del resolver
#
# USO:
#   chmod +x QUICK_START.sh
#   ./QUICK_START.sh
#
# REQUISITOS:
#   - psql instalado
#   - DATABASE_URL en variables de entorno
#   - Node.js 18+ (para tests)
# ═════════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}✗ Falta DATABASE_URL${NC}"
  echo "  Configura: export DATABASE_URL='postgresql://...'"
  exit 1
fi

echo -e "${BLUE}═════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}QUICK START: DISTRITO → ZONA → SUBZONA${NC}"
echo -e "${BLUE}═════════════════════════════════════════════════════════════════${NC}"
echo ""

# FASE 1: Crear tablas
echo -e "${YELLOW}FASE 1: Crear tablas normalizadas...${NC}"
if [ ! -f "db/migrations/0019_normalized_district_zone_subzone.sql" ]; then
  echo -e "${RED}✗ No encontrado: db/migrations/0019_normalized_district_zone_subzone.sql${NC}"
  exit 1
fi

psql "$DATABASE_URL" -f db/migrations/0019_normalized_district_zone_subzone.sql > /dev/null 2>&1
echo -e "${GREEN}✓ Tablas creadas${NC}"

# Validar que se crearon correctamente
DISTRICT_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM districts;" 2>/dev/null || echo "0")
ZONE_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM zones;" 2>/dev/null || echo "0")
SUBZONE_COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM subzones;" 2>/dev/null || echo "0")

echo -e "${GREEN}  · Distritos: $DISTRICT_COUNT${NC}"
echo -e "${GREEN}  · Zonas: $ZONE_COUNT${NC}"
echo -e "${GREEN}  · Subzonas: $SUBZONE_COUNT${NC}"

if [ "$DISTRICT_COUNT" -ne 21 ] || [ "$ZONE_COUNT" -lt 5 ]; then
  echo -e "${RED}✗ Parece que la migración no se ejecutó correctamente${NC}"
  exit 1
fi
echo ""

# FASE 2: Migrar datos históricos
echo -e "${YELLOW}FASE 2: Migrar datos históricos...${NC}"

BEFORE_DISTRICT=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN id END)
  FROM listings WHERE is_active = true;
" 2>/dev/null || echo "0")

psql "$DATABASE_URL" << 'SQL' > /dev/null 2>&1
-- Asignar zone_id basado en zone_raw
UPDATE listings l
SET zone_id = z.id
FROM zones z
WHERE l.zone_id IS NULL
  AND l.zone_raw ILIKE '%' || z.slug || '%'
  AND l.is_active = true;

-- Asignar district_id desde zone_id
UPDATE listings l
SET district_id = d.id
FROM zones z
JOIN districts d ON z.district_id = d.id
WHERE l.zone_id = z.id
  AND l.district_id IS NULL;

-- Asignar subzone_id si zone_raw menciona subzona
UPDATE listings l
SET subzone_id = sz.id
FROM zones z
JOIN subzones sz ON sz.zone_id = z.id
WHERE l.zone_id = z.id
  AND l.subzone_id IS NULL
  AND l.zone_raw ILIKE '%' || sz.slug || '%';
SQL

AFTER_DISTRICT=$(psql "$DATABASE_URL" -tAc "
  SELECT COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN id END)
  FROM listings WHERE is_active = true;
" 2>/dev/null || echo "0")

echo -e "${GREEN}✓ Datos migrados${NC}"
echo -e "${GREEN}  · Listings con district_id asignado: $AFTER_DISTRICT${NC}"
echo ""

# FASE 3: Validar completitud
echo -e "${YELLOW}FASE 3: Validar completitud de datos...${NC}"

STATS=$(psql "$DATABASE_URL" << 'SQL' 2>/dev/null
SELECT
  COUNT(*) AS total,
  COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN id END) AS with_district,
  COUNT(DISTINCT CASE WHEN zone_id IS NOT NULL THEN id END) AS with_zone,
  COUNT(DISTINCT CASE WHEN subzone_id IS NOT NULL THEN id END) AS with_subzone
FROM listings WHERE is_active = true;
SQL
)

TOTAL=$(echo "$STATS" | tail -1 | awk '{print $1}')
WITH_DISTRICT=$(echo "$STATS" | tail -1 | awk '{print $2}')
WITH_ZONE=$(echo "$STATS" | tail -1 | awk '{print $3}')
WITH_SUBZONE=$(echo "$STATS" | tail -1 | awk '{print $4}')

if [ "$TOTAL" -gt 0 ]; then
  PCT_DISTRICT=$((WITH_DISTRICT * 100 / TOTAL))
  PCT_ZONE=$((WITH_ZONE * 100 / TOTAL))
  PCT_SUBZONE=$((WITH_SUBZONE * 100 / TOTAL))

  echo -e "${GREEN}✓ Estadísticas de normalización:${NC}"
  echo -e "${GREEN}  · Total listings (activos): $TOTAL${NC}"
  echo -e "${GREEN}  · Con district_id: $WITH_DISTRICT ($PCT_DISTRICT%)${NC}"
  echo -e "${GREEN}  · Con zone_id: $WITH_ZONE ($PCT_ZONE%)${NC}"
  echo -e "${GREEN}  · Con subzone_id: $WITH_SUBZONE ($PCT_SUBZONE%)${NC}"

  if [ "$PCT_DISTRICT" -lt 50 ]; then
    echo -e "${YELLOW}⚠ Baja cobertura de district_id. Revisar zone_raw con DISTINCT:${NC}"
    echo -e "${YELLOW}  psql \$DATABASE_URL -c \"SELECT DISTINCT zone_raw FROM listings WHERE district_id IS NULL LIMIT 10;\"${NC}"
  fi
else
  echo -e "${YELLOW}⚠ No hay listings activos en la BD (normal si es primera ejecución)${NC}"
fi
echo ""

# FASE 4: Test del resolver
echo -e "${YELLOW}FASE 4: Test del zone-resolver...${NC}"

if [ ! -f "db/test-zone-resolution.mjs" ]; then
  echo -e "${YELLOW}⚠ Archivo de test no encontrado, saltando${NC}"
else
  if command -v node &> /dev/null; then
    if node db/test-zone-resolution.mjs > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Tests del resolver pasaron${NC}"
    else
      echo -e "${YELLOW}⚠ Tests fallaron (normal si no hay zones en BD aún)${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ Node.js no encontrado, saltando tests${NC}"
  fi
fi
echo ""

# RESUMEN FINAL
echo -e "${BLUE}═════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ IMPLEMENTACIÓN COMPLETADA${NC}"
echo -e "${BLUE}═════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "PRÓXIMOS PASOS:"
echo ""
echo "1. Integrar zone-resolver en el scraper:"
echo -e "   ${YELLOW}Ver: scraper/SCRAPER_INTEGRATION.md${NC}"
echo ""
echo "2. Test el scraper:"
echo -e "   ${YELLOW}node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --dry-run --limit 3${NC}"
echo ""
echo "3. Scrapear una zona:"
echo -e "   ${YELLOW}node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --op rent${NC}"
echo ""
echo "4. Ver queries de ejemplo:"
echo -e "   ${YELLOW}cat db/queries-example.sql${NC}"
echo ""
echo "DOCUMENTACIÓN:"
echo -e "   ${YELLOW}IMPLEMENTATION_GUIDE.md${NC}"
echo -e "   ${YELLOW}DISTRICT_ZONE_STRUCTURE_README.md${NC}"
echo -e "   ${YELLOW}db/NORMALIZED_ZONES_ARCHITECTURE.md${NC}"
echo ""
