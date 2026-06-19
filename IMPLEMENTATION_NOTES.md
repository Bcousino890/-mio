# Multi-Source Photo Scraping Implementation

## Overview

Enhanced the scraper to extract photos from both Idealista and CRM agency websites (Mobilia, Inmoweb, Level, Fotocasa, Vivanuncios), combining them in a single database record with source tracking.

## Changes Made

### 1. Database Schema (Migration 0017)

**File:** `/db/migrations/0017_add_agency_photos_to_listings.sql`

New columns added to `listings` table:
- `agency_photos` (JSONB): Array of photo URLs extracted from CRM website
- `photos_by_source` (JSONB): Optional consolidated structure `{"idealista": [...], "mobilia": [...]}` for future use
- `photo_source_status` (TEXT): Tracks availability state: `idealista_only | agency_only | both | failed | unknown`
- `agency_photo_count` (INTEGER): Denormalized count for efficient queries
- `agency_photos_fetched_at` (TIMESTAMPTZ): Timestamp of last CRM scraping attempt

**Indexes created:**
- `idx_listings_agency_photo_count`: Query listings with CRM photos
- `idx_listings_photo_source_status`: Filter by source status
- `idx_listings_needs_crm_photos`: Find listings needing CRM photo backfill
- `idx_listings_agency_photos_fetched`: Track scraping attempts

### 2. Photo Extraction Module

**File:** `/scraper/lib/crm-photo-extractor.mjs` (NEW)

Exports `extractPhotosFromCRM(crmName, html, agencyDomain, referenceId)` function that:
- Detects CRM type and applies specific extraction patterns
- Supports: MOBILIA, INMOWEB, LEVEL, FOTOCASA, VIVANUNCIOS, IDEALISTA
- Per-CRM extraction patterns:
  - **Mobilia**: `data-original` attribute in img tags + thumbnail→original URL transformation
  - **Inmoweb**: Gallery/carousel patterns + data-* attributes + JS arrays
  - **Level**: Modern data-* attributes + React-rendered components
  - **Fotocasa**: img src + data-src lazy loading + JSON arrays
  - **Vivanuncios**: Standard img tags + data-src + filtered for non-UI images
- Features:
  - Graceful fallback: returns empty array if extraction fails (doesn't block)
  - Auto-deduplication using Set
  - URL validation (well-formed, proper extensions)
  - Icon filtering (avoids UI elements like logos, badges)
  - Watermark cleanup via existing `cleanPhotos()` function
  - Max 40 photos per source (same as Idealista limit)

### 3. Scraper Enhancement

**File:** `/scraper/scrape-zone.mjs`

#### Changes to `enrich()` function:
1. After parsing Idealista detail page, checks if `agency_url` + `agency_crm` + `agency_reference_id` exist
2. If yes, fetches agency website using `fetchWithRetry()` with reduced retry count (2 vs 4)
3. Calls `extractPhotosFromCRM()` to extract photos
4. Handles all error scenarios gracefully:
   - If fetch fails: logs warning, sets `photo_source_status` to `failed` (if no Idealista photos)
   - If extraction fails: logs warning, uses any Idealista photos available
   - If timeout: retries with backoff, then gives up without blocking
5. Sets metadata:
   - `agency_photos`: Array of extracted URLs (empty if failed)
   - `agency_photo_count`: Count for quick access
   - `photo_source_status`: One of [idealista_only | agency_only | both | failed]
   - `agency_photos_fetched_at`: ISO timestamp of attempt
6. Includes mandatory jitter pause between CRM requests

#### Changes to `upsertOne()` function:
1. SQL INSERT extended to include new columns:
   - `agency_photos` (JSONB)
   - `photo_source_status` (TEXT)
   - `agency_photo_count` (INTEGER)
   - `agency_photos_fetched_at` (TIMESTAMPTZ)
2. ON CONFLICT UPDATE clause updated to sync these columns on duplicate

#### Enhanced logging:
- Shows photo breakdown: "3 Idealista + 8 Mobilia" instead of just "11 fotos"
- Only shows CRM info if photos were successfully extracted

## Fallback & Error Handling

### Graceful Degradation

All error scenarios are handled without blocking the scrape:

| Scenario | Behavior |
|----------|----------|
| No agency_url | Skips CRM scraping, uses Idealista photos only |
| CRM website offline | Logs warning, keeps Idealista photos, marks `status=failed` |
| CRM HTML structure changed | Extractor returns empty array, marks `status=idealista_only` |
| Network timeout on CRM | Retries 2x with backoff, gives up, keeps Idealista photos |
| Extraction throws error | Caught by try-catch, returns empty array, continues |
| No photos in CRM | Sets `agency_photo_count=0`, marks `status=idealista_only` |
| Photos in CRM but not Idealista | Sets `status=agency_only`, still keeps record |

### Fallback Priority

Photo sources are combined as:
1. **Primary:** Idealista photos (always present, well-curated)
2. **Secondary:** CRM photos (extracted if available, marked separately)
3. **Consolidation:** Database consumers choose which sources to use

## Database Queries

### Get all photos from all sources:
```sql
SELECT 
  external_id,
  array_length(photos, 1) as idealista_count,
  COALESCE(agency_photo_count, 0) as agency_count,
  photos || COALESCE(agency_photos, '[]'::jsonb) as all_photos
FROM listings
WHERE is_active = true;
```

### Find listings with photos from both sources:
```sql
SELECT * FROM listings
WHERE array_length(photos, 1) > 0 
  AND agency_photo_count > 0
ORDER BY (array_length(photos, 1) + agency_photo_count) DESC;
```

### Track CRM photo scraping success rate:
```sql
SELECT 
  agency_crm,
  COUNT(*) as total_with_crm,
  COUNT(*) FILTER (WHERE agency_photo_count > 0) as with_photos,
  ROUND(100.0 * COUNT(*) FILTER (WHERE agency_photo_count > 0) / COUNT(*), 1) as success_pct
FROM listings
WHERE agency_crm IS NOT NULL
GROUP BY agency_crm;
```

### Find incomplete photos (needs backfill):
```sql
SELECT external_id, agency_crm, agency_domain, agency_reference_id
FROM listings
WHERE agency_crm IS NOT NULL
  AND agency_photo_count = 0
  AND agency_photos_fetched_at IS NULL
LIMIT 100;
```

## Migration Notes

### Zero-Downtime Deployment

1. **Phase 1 (DB):** Apply migration 0017 - adds nullable columns (no existing data affected)
2. **Phase 2 (Code):** Deploy updated scraper - starts populating new columns on next runs
3. **Phase 3 (Optional):** Backfill existing listings with agency_crm but no photos via:
   ```bash
   node scraper/backfill-agency-photos.mjs --batch-size 50 --dry-run
   ```

### Data Consistency

- Existing rows remain unchanged (backward compatible)
- New scrapes automatically populate all columns
- `photo_source_status` defaults to 'idealista_only' (safe assumption)
- `agency_photo_count` defaults to 0 (safe, no duplicates)
- Duplicates handled via `ON CONFLICT ... DO UPDATE` clause

## Testing

### Manual Test (dry-run):
```bash
node scraper/scrape-zone.mjs \
  --zone madrid/barrio-de-salamanca/goya \
  --op rent \
  --dry-run \
  --limit 3
```

### Inspect JSON output:
The `rows` array will include:
- `photos`: Idealista photos (e.g., 3-12 URLs)
- `agency_photos`: CRM photos if extracted (e.g., 0-20 URLs)
- `photo_source_status`: Source state indicator
- `agency_photo_count`: Quick count (should match array_length)

### Check database (post-migration):
```sql
SELECT 
  external_id,
  agency_crm,
  photo_source_status,
  array_length(photos, 1) as idealista_count,
  agency_photo_count,
  agency_photos_fetched_at
FROM listings
WHERE agency_crm IS NOT NULL
LIMIT 10;
```

## Performance Considerations

### Network Load
- CRM requests are serialized (not parallel) to avoid rate limiting
- Reduced retry count (2 vs 4) for CRM to minimize time spent on failures
- Mandatory jitter between CRM requests
- Total time per listing: ~2-4s Idealista + 1-3s CRM (if available)

### Database Load
- New indexes are selective (filtered WHERE clauses)
- JSONB columns are efficient for analytics
- Denormalized `agency_photo_count` avoids slow array_length() calls

### Estimated Timeline
- 100 listings per zone: +5-10 minutes per CRM scrape cycle
- Scales linearly with # of listings with agency CRM

## Future Enhancements

1. **Photo deduplication:** Use `cover_phash` to detect duplicate photos across sources
2. **Consolidated `photos_by_source`:** Backfill to provide unified source tracking
3. **Priority ordering:** Let consumers choose source preference (e.g., prefer CRM originals)
4. **Watermark removal:** Extend `cleanPhotos()` per-CRM specific patterns
5. **Async backfill job:** Scheduled task to fill in photos for existing CRM listings
6. **API enhancement:** Return both sources in `/api/listings` with metadata

## Files Modified

| File | Change | Type |
|------|--------|------|
| `/db/migrations/0017_add_agency_photos_to_listings.sql` | Schema extension | NEW |
| `/scraper/lib/crm-photo-extractor.mjs` | Photo extraction logic | NEW |
| `/scraper/scrape-zone.mjs` | Enrich + upsert + logging | MODIFIED |

## References

- CRM detector: `/scraper/lib/crm-detector.mjs`
- Photo processing: `/scraper/lib/watermark-removal.mjs`
- Idealista parser: `/scraper/lib/parse.mjs`
- Fetch utility: `/scraper/lib/fetch.mjs`
