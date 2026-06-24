#!/bin/bash
# Scrape Portal Inmobiliario — Vitacura (casas, arriendo + venta)
# Usage: bash SCRAPE-VITACURA.sh [--skip-test]

set -e

SKIP_TEST=${1:-""}

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Portal Inmobiliario Vitacura Scraper ===${NC}"
echo ""

# Check environment
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}✗ DATABASE_URL not set${NC}"
  echo "Set it: export DATABASE_URL='postgres://user:pass@localhost:5432/casafari'"
  exit 1
fi

echo -e "${GREEN}✓ DATABASE_URL configured${NC}"

# Optional proxy config
if [ -n "$PROXY_PROVIDER" ]; then
  echo -e "${GREEN}✓ PROXY_PROVIDER=$PROXY_PROVIDER${NC}"
else
  echo -e "${YELLOW}⚠ No proxy configured (will use direct VPS IP)${NC}"
fi

cd "$(dirname "$0")"

# ============================================================================
# PHASE 0.5: Rate-limit validation spike (10 listings)
# ============================================================================

if [ "$SKIP_TEST" != "--skip-test" ]; then
  echo ""
  echo -e "${YELLOW}Phase 0.5: Testing rate-limit (10 listings)...${NC}"

  node scrape-multi-portal.mjs \
    --portals portalinmobiliario \
    --zone casa/vitacura-metropolitana \
    --op rent \
    --limit 10 \
    --no-proxy \
    --dry-run 2>&1 | tail -20

  RATE_LIMIT_TEST=$?

  if [ $RATE_LIMIT_TEST -ne 0 ]; then
    echo -e "${RED}✗ Rate-limit spike failed. Check output above for 429/403 errors.${NC}"
    echo "Possible solutions:"
    echo "  1. Wait 5-10 minutes and retry"
    echo "  2. Enable proxy: export PROXY_PROVIDER=geonode"
    echo "  3. Increase delay: add --delay 3000 flag"
    exit 1
  fi

  echo -e "${GREEN}✓ Rate-limit test passed${NC}"
  echo ""
  sleep 2
fi

# ============================================================================
# Phase 1: Scrape ARRIENDO (Rent)
# ============================================================================

echo -e "${YELLOW}Phase 1: Scraping Vitacura casas ARRIENDO (rent)...${NC}"

node scrape-multi-portal.mjs \
  --portals portalinmobiliario \
  --zone casa/vitacura-metropolitana \
  --op rent \
  --max-pages 60 \
  2>&1 | tee "/tmp/vitacura-rent-$(date +%s).log"

RENT_RESULT=$?

if [ $RENT_RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ Arriendo (rent) scraping completed${NC}"
else
  echo -e "${RED}✗ Arriendo (rent) scraping failed${NC}"
  exit 1
fi

# Brief pause between operations
sleep 5

# ============================================================================
# Phase 2: Scrape VENTA (Sale)
# ============================================================================

echo ""
echo -e "${YELLOW}Phase 2: Scraping Vitacura casas VENTA (sale)...${NC}"

node scrape-multi-portal.mjs \
  --portals portalinmobiliario \
  --zone casa/vitacura-metropolitana \
  --op sale \
  --max-pages 60 \
  2>&1 | tee "/tmp/vitacura-sale-$(date +%s).log"

SALE_RESULT=$?

if [ $SALE_RESULT -eq 0 ]; then
  echo -e "${GREEN}✓ Venta (sale) scraping completed${NC}"
else
  echo -e "${RED}✗ Venta (sale) scraping failed${NC}"
  exit 1
fi

# ============================================================================
# Phase 3: Verification
# ============================================================================

echo ""
echo -e "${YELLOW}Phase 3: Verifying data in database...${NC}"

# Query: count by operation
VERIFICATION_SQL="
SELECT
  COUNT(*) as total,
  operation,
  COUNT(DISTINCT external_id) as unique_listings
FROM listings_cl
WHERE portal = 'portalinmobiliario'
  AND is_active = true
GROUP BY operation
ORDER BY operation;
"

echo "$VERIFICATION_SQL" | psql "$DATABASE_URL" -t

# Query: latest listings
echo ""
echo "Latest 5 Vitacura listings:"
psql "$DATABASE_URL" -c "
SELECT
  external_id,
  price,
  currency,
  operation,
  bedrooms,
  square_meters,
  updated_at
FROM listings_cl
WHERE portal = 'portalinmobiliario'
  AND is_active = true
ORDER BY updated_at DESC
LIMIT 5;
"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${GREEN}=== Scraping Complete ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Visit https://crm.cremme.es/chile/anuncios to view the listings"
echo "  2. Filter by Vitacura or sort by 'Más recientes'"
echo "  3. Check the map for markers in Santiago (Vitacura area)"
echo ""
echo "Logs saved to:"
echo "  /tmp/vitacura-rent-*.log"
echo "  /tmp/vitacura-sale-*.log"
echo ""
