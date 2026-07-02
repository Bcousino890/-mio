# Post-Scraping Verification Checklist

After running `bash scraper/SCRAPE-VITACURA.sh`, use this checklist to verify everything worked.

---

## 1. Database Verification

**Expected:** 150–300 listings in `listings_cl` with valid lat/lng and prices

```bash
psql "$DATABASE_URL" -c "
SELECT COUNT(*) as total,
       COUNT(CASE WHEN operation = 'rent' THEN 1 END) as rent,
       COUNT(CASE WHEN operation = 'sale' THEN 1 END) as sale,
       COUNT(CASE WHEN latitude IS NOT NULL THEN 1 END) as with_coords,
       COUNT(CASE WHEN price > 0 THEN 1 END) as with_price
FROM listings_cl
WHERE portal = 'portalinmobiliario' AND is_active = true;
"
```

**Pass if:** total > 100, rent > 20, sale > 50, with_coords ≈ total, with_price ≈ total

---

## 2. Web App — Listing Count

**Expected:** `/chile/anuncios` shows total count (not "0 anuncios")

```bash
# Check API response
curl -s "https://crm.cremme.es/api/chile/anuncios?page=1&page_size=1" | jq '.total'
```

**Pass if:** Returns number > 100

---

## 3. Map Centering

**Expected:** Map centers on Santiago, not Madrid

```bash
# Check a listing's coordinates
curl -s "https://crm.cremme.es/api/chile/anuncios?page=1&page_size=1" | jq '.data[0] | {latitude, longitude, address}'
```

**Pass if:** latitude ≈ -33.4 to -33.7 (Santiago), longitude ≈ -70.5 to -70.8

---

## 4. Filters

| Filter | Command | Expected |
|--------|---------|----------|
| Operation (sale) | `curl "https://crm.cremme.es/api/chile/anuncios?operation=sale" \| jq '.count'` | > 50 |
| Operation (rent) | `curl "https://crm.cremme.es/api/chile/anuncios?operation=rent" \| jq '.count'` | > 20 |
| Price range | `curl "https://crm.cremme.es/api/chile/anuncios?price_min=5000000&price_max=15000000" \| jq '.count'` | > 0 |
| Bedrooms | `curl "https://crm.cremme.es/api/chile/anuncios?bedrooms_min=3" \| jq '.count'` | > 10 |

**Pass if:** All queries return results

---

## 5. Sorting

| Sort | Command | Expected |
|-----|---------|----------|
| Recent | `curl "https://crm.cremme.es/api/chile/anuncios?sort=recent" \| jq '.data[0] | {id, title}'` | Latest listing shows |
| Price asc | `curl "https://crm.cremme.es/api/chile/anuncios?sort=price_asc" \| jq '.data[0].price'` | Lowest price first |
| Price desc | `curl "https://crm.cremme.es/api/chile/anuncios?sort=price_desc" \| jq '.data[0].price'` | Highest price first |

**Pass if:** Different results per sort order

---

## 6. Pagination

```bash
# Check total_pages
curl -s "https://crm.cremme.es/api/chile/anuncios?page_size=30" | jq '.total_pages'

# Check page 2
curl -s "https://crm.cremme.es/api/chile/anuncios?page=2&page_size=30" | jq '.data[0].id'
```

**Pass if:** total_pages > 1, page 2 shows different IDs than page 1

---

## 7. Browser Visual Check

1. **Open:** https://crm.cremme.es/chile/anuncios
2. **Check:**
   - [ ] Sidebar shows listing count (not "0 anuncios")
   - [ ] Map visible on right side (Santiago area, not Madrid)
   - [ ] List items appear (PropertyCards with photos, price, bedrooms)
   - [ ] Hover over a card → map marker highlights
   - [ ] Click a card → marker populates details
   - [ ] Filters work (change "Operación" to "Venta" → count updates)
   - [ ] Sort dropdown works

---

## Summary

| Check | Status | Notes |
|-------|--------|-------|
| Database count | ☐ Pass | Expected 150–300 |
| API returns data | ☐ Pass | `/api/chile/anuncios` |
| Map center (Santiago) | ☐ Pass | lat ≈ -33.5 |
| Filters functional | ☐ Pass | sale, rent, price, beds |
| Sorting works | ☐ Pass | recent, price_asc, price_desc |
| Pagination works | ☐ Pass | >30 listings → pages |
| Browser renders | ☐ Pass | Cards, map, filters visible |

---

## Troubleshooting

| Problem | Check | Solution |
|---------|-------|----------|
| 0 anuncios | DB count | Re-run scraper or check logs |
| Madrid on map | API response | Check lat/lng in data |
| Filters don't work | API params | Check `operation=sale` param |
| Map markers invisible | Catastro fix | Confirm line 232 changed in prod |
