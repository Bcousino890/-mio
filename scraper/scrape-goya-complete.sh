#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Scrape Goya COMPLETO: Alquiler (596) + Venta (691) = 1.287 anuncios
# Ejecución: ./scraper/scrape-goya-complete.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║ 🚀 SCRAPE GOYA COMPLETO: Rent + Sale                                      ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Configurar proxy (SmartProxy con geolocalización Madrid)
export PROXY_PROVIDER=smartproxy
export SMARTPROXY_PROXY_HOST=eu.smartproxy.net
export SMARTPROXY_PROXY_PORT=3120
export SMARTPROXY_PROXY_USER=smart-b04nrjtamr8a_area-ES_city-MADRID
export SMARTPROXY_PROXY_PASS=ZLOutsGkCC5kgmwS

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="scraper/output"
mkdir -p "$OUTPUT_DIR"

echo "📋 Configuración:"
echo "  Zone: madrid/barrio-de-salamanca/goya"
echo "  Proxy: eu.smartproxy.net:3120 (Madrid)"
echo "  Output: $OUTPUT_DIR/"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# ALQUILER (596 anuncios)
# ─────────────────────────────────────────────────────────────────────────────
echo "▶ FASE 1: ALQUILER (596 anuncios, ~30 minutos)"
echo "────────────────────────────────────────────────────────────────────────────"

RENT_OUTPUT="$OUTPUT_DIR/goya-rent-$TIMESTAMP.json"
RENT_LOG="$OUTPUT_DIR/goya-rent-$TIMESTAMP.log"

echo "  Scraping → $RENT_OUTPUT"
time node scraper/scrape-zone.mjs \
  --zone madrid/barrio-de-salamanca/goya \
  --op rent \
  --max-pages 60 \
  --emit-app "$RENT_OUTPUT" \
  > "$RENT_LOG" 2>&1

if [ -f "$RENT_OUTPUT" ]; then
  RENT_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RENT_OUTPUT')).length)")
  echo "  ✅ Alquiler completado: $RENT_COUNT anuncios"
else
  echo "  ✗ Error al generar JSON de alquiler"
  exit 1
fi

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# VENTA (691 anuncios)
# ─────────────────────────────────────────────────────────────────────────────
echo "▶ FASE 2: VENTA (691 anuncios, ~30 minutos)"
echo "────────────────────────────────────────────────────────────────────────────"

SALE_OUTPUT="$OUTPUT_DIR/goya-sale-$TIMESTAMP.json"
SALE_LOG="$OUTPUT_DIR/goya-sale-$TIMESTAMP.log"

echo "  Scraping → $SALE_OUTPUT"
time node scraper/scrape-zone.mjs \
  --zone madrid/barrio-de-salamanca/goya \
  --op sale \
  --max-pages 60 \
  --emit-app "$SALE_OUTPUT" \
  > "$SALE_LOG" 2>&1

if [ -f "$SALE_OUTPUT" ]; then
  SALE_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$SALE_OUTPUT')).length)")
  echo "  ✅ Venta completada: $SALE_COUNT anuncios"
else
  echo "  ✗ Error al generar JSON de venta"
  exit 1
fi

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# CONSOLIDAR
# ─────────────────────────────────────────────────────────────────────────────
echo "▶ FASE 3: CONSOLIDAR Y VALIDAR"
echo "────────────────────────────────────────────────────────────────────────────"

CONSOLIDATED="$OUTPUT_DIR/goya-complete-$TIMESTAMP.json"
node << NODEJS_EOF
const fs = require('fs');
const rent = JSON.parse(fs.readFileSync('$RENT_OUTPUT'));
const sale = JSON.parse(fs.readFileSync('$SALE_OUTPUT'));
const combined = [...rent, ...sale];

console.log('  Combinando:');
console.log('    • Alquiler: ' + rent.length);
console.log('    • Venta: ' + sale.length);
console.log('    • Total: ' + combined.length);

// Deduplicación por external_id (por si hay solapamientos)
const seen = new Set();
const deduped = combined.filter(l => {
  if (seen.has(l.external_id)) return false;
  seen.add(l.external_id);
  return true;
});

console.log('  Después deduplicación: ' + deduped.length);

// Guardar
fs.writeFileSync('$CONSOLIDATED', JSON.stringify(deduped, null, 2));
console.log('  ✅ Guardado en: $CONSOLIDATED');
NODEJS_EOF

echo ""

# ─────────────────────────────────────────────────────────────────────────────
# RESUMEN FINAL
# ─────────────────────────────────────────────────────────────────────────────
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║ ✅ SCRAPING COMPLETADO                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📁 Archivos generados:"
echo "  1. $RENT_OUTPUT"
echo "  2. $SALE_OUTPUT"
echo "  3. $CONSOLIDATED (combined + deduped)"
echo ""
echo "📊 Estadísticas:"
echo "  • Zona: madrid/barrio-de-salamanca/goya"
echo "  • Total anuncios: $(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONSOLIDATED')).length)")"
echo "  • Timestamp: $TIMESTAMP"
echo ""
echo "🚀 Próximos pasos:"
echo "  1. Copiar $CONSOLIDATED a web/lib/listings-goya-full.json"
echo "  2. Hacer git add + commit + push"
echo "  3. Actualizar web para usar el dataset completo"
echo ""
