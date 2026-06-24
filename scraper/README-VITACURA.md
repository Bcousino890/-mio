# Scraping Vitacura — Portal Inmobiliario

## Overview

This guide walks through scraping all house listings from Portal Inmobiliario for Vitacura (Santiago, RM) in both **arriendo** (rent) and **venta** (sale) operations.

**Target URLs:**
- Rent: https://www.portalinmobiliario.com/arriendo/casa/vitacura-metropolitana
- Sale: https://www.portalinmobiliario.com/venta/casa/vitacura-metropolitana

**Expected volume:** ~150–300 total listings (50–100 rent, 100–200 sale)  
**Runtime:** ~10–15 minutes total  
**Output destination:** PostgreSQL `listings_cl` table, visible at `/chile/anuncios`

---

## Prerequisites

### 1. SSH into the VPS

```bash
ssh casafari@204.168.174.0
```

### 2. Verify Database Connection

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM listings_cl WHERE portal = 'portalinmobiliario';"
```

Should return a count (possibly 0 if this is the first scrape).

### 3. (Optional) Configure Proxy

If you want to use a proxy (recommended for production):

```bash
export PROXY_PROVIDER=geonode  # or smartproxy
export GEONODE_PROXY_HOST=<your-geonode-host>
export GEONODE_PROXY_PORT=<port>
export GEONODE_PROXY_USER=<user>
export GEONODE_PROXY_PASS=<pass>
```

**Without proxy:** The scraper will use the VPS's direct IP. Portal Inmobiliario doesn't appear to have aggressive anti-bot (no WAF detected in research), but rate-limit may kick in with high concurrency.

---

## Running the Scraper

### Quick Start (Recommended)

```bash
cd /opt/casafari/scraper
bash SCRAPE-VITACURA.sh
```

This script:
1. **Phase 0.5:** Tests rate-limit with 10 sample listings (dry-run, no DB write)
2. **Phase 1:** Scrapes all Vitacura casas arriendo (rent)
3. **Phase 2:** Scrapes all Vitacura casas venta (sale)
4. **Phase 3:** Verifies results in the database

### Skip Rate-Limit Test (if you know it's working)

```bash
bash SCRAPE-VITACURA.sh --skip-test
```

---

## Monitoring Progress

### During Scraping (Real-time Logs)

The script outputs progress to `stdout`. You'll see:

```
🔍 Scraping PORTALINMOBILIARIO · casa/vitacura-metropolitana · rent
   Base URL: https://www.portalinmobiliario.com/arriendo/propiedades/casa/vitacura-metropolitana/

  → Página 1...
    ✓ MLC-1847000513 · Casa 3 dormitorios, Vitacura...
    ✓ MLC-1847000514 · ...
  → Página 2...
  ...

  → Descargando detalles...
  → Descargadas 87 fichas
  ✅ Total: 87 propiedades
  💾 listings_cl: 45 insertados, 42 actualizados
```

Logs are also saved to:
- `/tmp/vitacura-rent-*.log`
- `/tmp/vitacura-sale-*.log`

### After Scraping (Database Verification)

```bash
# Count by operation
psql "$DATABASE_URL" -c "
SELECT COUNT(*) as total, operation, COUNT(DISTINCT external_id) as unique_listings
FROM listings_cl
WHERE portal = 'portalinmobiliario' AND is_active = true
GROUP BY operation
ORDER BY operation;
"

# Latest 10 listings
psql "$DATABASE_URL" -c "
SELECT external_id, price, currency, operation, bedrooms, square_meters, updated_at
FROM listings_cl
WHERE portal = 'portalinmobiliario' AND is_active = true
ORDER BY updated_at DESC
LIMIT 10;
"
```

---

## Viewing Results

### In the Web App

1. Visit **https://crm.cremme.es/chile/anuncios**
2. The page should now show a count (instead of "0 anuncios")
3. Filter by **Operation**: "Venta" or "Arriendo"
4. The map should center on **Santiago** (with pins/markers visible thanks to the catastro fix)

### Via API

```bash
curl "https://crm.cremme.es/api/chile/anuncios?operation=sale&page=1&page_size=30"
```

Response includes: `{ success: true, count: 30, total: X, total_pages: Y, data: [...] }`

---

## Troubleshooting

### Rate-Limit / 429 Errors

**Symptom:** Phase 0.5 fails with "429 Too Many Requests"

**Solution:**
1. Wait 5–10 minutes and retry
2. Enable proxy: `export PROXY_PROVIDER=geonode`
3. Increase delay between requests (the scraper has built-in jitter, but you can customize)

### Parser Errors / Invalid Data

**Symptom:** Logs show "Error parsing MLC-XXX" or null values in columns

**Action:**
- Check if Portal Inmobiliario changed its HTML structure
- Report with example MLC ID to the team
- `parse-portalinmobiliario.mjs` may need updates

### Database Connection Failed

**Symptom:** "FATAL: remaining connection slots reserved for non-replication superuser connections"

**Solution:**
```bash
# Verify the DATABASE_URL is correct
echo "$DATABASE_URL"

# Test connection manually
psql "$DATABASE_URL" -c "SELECT 1;"
```

---

## Customization

### Scrape Only Rent (or Only Sale)

Edit the script or run the command directly:

```bash
# Only arriendo
node scrape-multi-portal.mjs \
  --portals portalinmobiliario \
  --zone casa/vitacura-metropolitana \
  --op rent \
  --max-pages 60

# Only venta
node scrape-multi-portal.mjs \
  --portals portalinmobiliario \
  --zone casa/vitacura-metropolitana \
  --op sale \
  --max-pages 60
```

### Scrape Different Región / Comuna

Replace `casa/vitacura-metropolitana` with your target:

```bash
# La Dehesa (Vitacura neighbor)
--zone casa/la-dehesa-metropolitana

# Barrio Alto (general)
--zone casa/barrio-alto-metropolitana

# All RM
--zone casa  # (no specific commune — may hit rate-limit faster)
```

### Dry-Run (No Database Write)

```bash
node scrape-multi-portal.mjs \
  --portals portalinmobiliario \
  --zone casa/vitacura-metropolitana \
  --op rent \
  --limit 20 \
  --dry-run
```

Outputs JSON to `/tmp/scraped-{timestamp}.json` without touching the database.

---

## Performance

| Metric | Value |
|--------|-------|
| Listings per page | ~48 |
| Pages (Vitacura rent) | ~2–3 |
| Pages (Vitacura sale) | ~2–5 |
| Detail page fetch time | 500–2000ms (with jitter) |
| **Total runtime (both operations)** | ~10–15 minutes |
| **Database inserts/updates** | ~150–300 |

---

## Next Steps (After Vitacura)

Once Vitacura is working:
1. Expand to all RM communes (Lastarria, Ñuñoa, Providencia, etc.)
2. Set up a daily incremental scraper (cron job)
3. Implement change tracking (price drops, delistings)
4. Enrich with SII Rol data for owner contact info

See the main plan at `/root/.claude/plans/hola-stateless-toast.md` for the full roadmap.

---

## Files

- **Scraper:** `/opt/casafari/scraper/scrape-multi-portal.mjs`
- **Parser:** `/opt/casafari/scraper/lib/parse-portalinmobiliario.mjs`
- **Fetch utility:** `/opt/casafari/scraper/lib/fetch.mjs`
- **Script:** `/opt/casafari/scraper/SCRAPE-VITACURA.sh` ← You are here
- **Database schema:** `/opt/casafari/db/migrations/0028_listings_cl.sql`

---

## Questions / Issues

If something breaks:
1. Check the logs in `/tmp/vitacura-*.log`
2. Run the rate-limit test in isolation: `--limit 10 --dry-run`
3. Report the exact error message and MLC ID (if parser-related)
