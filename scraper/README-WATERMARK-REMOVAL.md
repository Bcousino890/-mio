# Watermark Removal & Multi-Portal Scraping

## Overview

The scraper now includes automatic **watermark removal** for images from multiple real estate platforms, extracting clean (unbranded) photos for display in the app. This document explains how it works and how to use it.

## Platforms Supported

### Idealista ✅ (Full Support)
- **Parser**: HTML parsing with regex fallbacks
- **Watermark**: Handled via **Mobilia** and **Inmoweb** patterns (see below)
- **Photo Sources**:
  - Idealista's own CDN (img*.idealista.com): mostly clean
  - Mobilia CDN (media.mobiliagestion.es): Level Real Estate, Housingo, etc.
  - Inmoweb CDN (various hosts): multi-tenant platform

### Fotocasa ⚠️ (Stub — Parser TBD)
- **Status**: HTML structure differs from Idealista; requires custom parser
- **Watermark**: Generally clean (no aggressive transformation)
- **Next Steps**: Implement Fotocasa-specific HTML parser

### Habitaclia ⚠️ (Stub — Parser TBD)
- **Status**: Requires custom parser
- **Watermark**: Generally clean
- **Next Steps**: Implement Habitaclia-specific HTML parser

### Agency Websites ✅ (Implicit)
- **Watermark**: Handled based on detected CRM type (Mobilia, Inmoweb, etc.)
- **Integration**: When scraping agency URLs, CRM-specific cleaners apply

---

## Watermark Removal System

### How It Works

All photos are run through `cleanPhotos(urls, sourceHint)` in `lib/watermark-removal.mjs` before being stored. This function:

1. **Detects the image host/pattern**
2. **Applies platform-specific transformations**
3. **Deduplicates URLs** (same resource in multiple sizes)
4. **Returns clean URL** (or original if no transformation applies)

### Supported Transformations

#### Mobilia (`.jpg` → `-original.jpg`)

Used by: **Level Real Estate**, **Housingo**, **other Mobilia-based agencies**

**How it works:**
- Images hosted on `media.mobiliagestion.es`
- Mobilia watermarks photos with agency branding
- The `-original.jpg` variant is the same image without the watermark
- Safe transformation: only applies to `/Images/` paths, rejects `Flags/` (logo images)

**Example:**
```
Input:  https://media.mobiliagestion.es/Images/1234567/photo.jpg
Output: https://media.mobiliagestion.es/Images/1234567/photo-original.jpg
```

**Reference:** From smartbc project; confirmed to work across multiple Level/Housingo properties.

#### Inmoweb (Thumbnail → High Quality)

Used by: **Inmoweb** (multi-tenant platform), **TerraHomes**, **custom agency sites on Inmoweb**

**How it works:**
- Remove thumbnail suffixes: `/thumbs/`, `-thumb`, `-small`, etc.
- Conservatively upgrades small variants to full-size versions
- Never invents URLs that don't exist in the HTML

**Example:**
```
Input:  https://example.com/photos/apartment-thumb.jpg
Output: https://example.com/photos/apartment.jpg
```

#### Fotocasa (Pass-through)

**Status:** No transformation (images usually clean)  
**Fallback:** If needed, can add CDN-specific upgrades later

#### Habitaclia (Pass-through)

**Status:** No transformation (images usually clean)  
**Fallback:** If needed, can add CDN-specific upgrades later

---

## Usage

### Single Portal (Idealista)

Use the existing `scrape-zone.mjs`:

```bash
# Scrape a specific zone with watermark removal (automatic)
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca/goya --op rent --dry-run

# Output: listings-goya.json with clean photos
```

Photos are automatically cleaned via watermark removal, no extra steps needed.

### Multiple Portals

Use the new `scrape-multi-portal.mjs`:

```bash
# Scrape Idealista only (same as scrape-zone.mjs but via multi-portal framework)
node scraper/scrape-multi-portal.mjs --portals idealista --zone madrid/barrio-de-salamanca/goya --op rent --dry-run

# Scrape Idealista + Fotocasa (Fotocasa will stub for now)
node scraper/scrape-multi-portal.mjs --portals idealista,fotocasa --zone madrid --op sale --limit 10

# All portals (when Fotocasa/Habitaclia parsers are implemented)
node scraper/scrape-multi-portal.mjs --portals idealista,fotocasa,habitaclia --zone madrid
```

**Flags:**
- `--portals <csv>`: Comma-separated list of portals (default: `idealista`)
- `--zone <slug>`: Zone slug (required)
- `--op <rent|sale>`: Operation (default: `rent`)
- `--limit N`: Max listings per portal (default: unlimited)
- `--dry-run`: Don't write to DB; output to `/tmp/scraped-*.json`
- `--no-proxy`: Ignore proxy config
- `--max-pages N`: Max pages to scrape per portal (default: 60)

### With Proxies (Remote Scraping)

Set proxy environment variables before running:

```bash
# Using SmartProxy (residential rotating IPs)
export PROXY_PROVIDER=smartproxy
export SMARTPROXY_PROXY_HOST=gate.smartproxy.com
export SMARTPROXY_PROXY_PORT=7000
export SMARTPROXY_PROXY_USER=user
export SMARTPROXY_PROXY_PASS=pass

node scraper/scrape-multi-portal.mjs --portals idealista --zone madrid/barrio-de-salamanca/goya --op rent
```

Or with Geonode:

```bash
export PROXY_PROVIDER=geonode
export GEONODE_PROXY_HOST=proxy.geonode.com
export GEONODE_PROXY_PORT=9000
export GEONODE_PROXY_USER=user
export GEONODE_PROXY_PASS=pass

node scraper/scrape-multi-portal.mjs --portals idealista,fotocasa --zone madrid
```

Proxies are **optional**; without them, the scraper uses WhatsApp User-Agent + curl (which passes Idealista's DataDome anti-bot).

---

## API Reference

### `cleanPhotoUrl(url, sourceHint?)`

Cleans a single photo URL based on platform-specific rules.

```javascript
import { cleanPhotoUrl } from './lib/watermark-removal.mjs'

const dirty = 'https://media.mobiliagestion.es/Images/1234/photo.jpg'
const clean = cleanPhotoUrl(dirty)
// → 'https://media.mobiliagestion.es/Images/1234/photo-original.jpg'
```

**Parameters:**
- `url` (string): Photo URL to clean
- `sourceHint` (string, optional): Platform hint ('idealista', 'fotocasa', 'habitaclia', 'agency')

**Returns:** Cleaned URL (or original if no transformation applies)

### `cleanPhotos(photos, sourceHint?)`

Batch-cleans multiple photos and deduplicates.

```javascript
import { cleanPhotos } from './lib/watermark-removal.mjs'

const urls = [
  'https://media.mobiliagestion.es/Images/1234/photo.jpg',
  'https://media.mobiliagestion.es/Images/1234/photo.jpg', // duplicate
]

const clean = cleanPhotos(urls, 'idealista')
// → ['https://media.mobiliagestion.es/Images/1234/photo-original.jpg']
```

**Parameters:**
- `photos` (string[]): Array of photo URLs
- `sourceHint` (string, optional): Platform hint

**Returns:** Deduplicated array of cleaned URLs

### Platform Detection Functions

For advanced usage:

```javascript
// Detect if a URL matches a platform pattern
isMobiliaImage(url)    // → boolean
isInmowebImage(url)    // → boolean
isFotocasaImage(url)   // → boolean
isHabitacliaImage(url) // → boolean

// Get the cleaned version
cleanMobiliaImage(url)    // → string
cleanInmowebImage(url)    // → string
cleanFotocasaImage(url)   // → string
cleanAgencyWebImage(url)  // → string
```

---

## Integration with Existing Code

### In `parseDetailPage()` (lib/parse.mjs)

Photos are automatically cleaned after extraction:

```javascript
import { cleanPhotos } from './watermark-removal.mjs'

// ... extract photos from HTML ...

// Apply watermark removal (automatic)
photos = cleanPhotos(photos, 'idealista')
```

### For New Platforms

When implementing Fotocasa or Habitaclia parsers:

```javascript
function parseFotocasaDetailPage(html) {
  // ... extract photos ...
  
  // Pass through watermark removal with the right hint
  photos = cleanPhotos(photos, 'fotocasa')
  
  return { ..., photos }
}
```

---

## Future Enhancements

- [ ] Implement Fotocasa HTML parser (different DOM structure)
- [ ] Implement Habitaclia HTML parser
- [ ] Add agency CRM detection for agency-website scraping
- [ ] Extend Mobilia patterns to other CRM systems
- [ ] Add rate-limiting/backoff strategies per portal
- [ ] Database upsert integration for multi-portal imports

---

## Troubleshooting

### Photo URLs are still showing watermarks

1. **Check the source:** Is it from a known platform (Mobilia, Inmoweb)?
2. **Verify extraction:** Are URLs being captured correctly in the HTML parser?
3. **Test the cleaner:**
   ```bash
   node -e "
   import { cleanPhotoUrl } from './scraper/lib/watermark-removal.mjs'
   const url = 'YOUR_URL_HERE'
   console.log(cleanPhotoUrl(url))
   "
   ```
4. **Add custom pattern:** If a new platform isn't recognized, add it to `PROFILE_ICON_MAP` in the watermark-removal module

### Proxy connection refused

1. Check proxy credentials and host:
   ```bash
   curl -x "http://user:pass@proxy.com:port" https://www.idealista.com
   ```
2. Ensure PROXY_PROVIDER env var is set correctly
3. Test without proxy: `node scraper/scrape-zone.mjs --no-proxy ...`

### Photocopy (Fotocasa) or Habitaclia not scraping

These are stubbed in `scrape-multi-portal.mjs`. Custom HTML parsers are needed:

1. Download sample HTML from the portal
2. Analyze DOM structure (use Firefox DevTools)
3. Write regex/CSS selector patterns to extract listings and details
4. Implement `parseFotocasaListPage()` and `parseFotocasaDetailPage()` in `lib/parse.mjs`
5. Wire into `PORTAL_CONFIG` in `scrape-multi-portal.mjs`

---

**Version:** 1.0  
**Last Updated:** June 17, 2026  
**Maintainer:** Claude Code
