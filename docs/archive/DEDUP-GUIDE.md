# Guía de Deduplicación y Matching de Propiedades

## Resumen Ejecutivo

El sistema de deduplicación agrupa anuncios duplicados (mismo piso en múltiples portales/webs) bajo una entidad `property` canónica, resolviendo uno de los principales retos en agregación inmobiliaria: detectar que el anuncio A (Idealista) y B (Fotocasa) son el MISMO inmueble.

**Arquitectura: 4 capas**
1. **Hard match RC20**: Si dos anuncios comparten referencia catastral → mismo property (trivial, sin scoring)
2. **Blocking**: Filtrado rápido por geolocalización, bedrooms exactos, m² ±8% (ST_DWithin 150m)
3. **Scoring multi-señal**: Combina 9 señales (distancia, precio, texto, pHash) con pesos configurables
4. **Clustering**: Union-Find que agrupa matches confirmados transitivamente

**Principios**
- Sesgo hacia minimizar falsos positivos (incorrect merge ≫ missed duplicate en coste)
- Detección de anomalías: limit máximo de componente (20 nodos) para evitar "black hole entities"
- pHash sin descargar imágenes: calcula hash perceptual en memoria durante scraping

---

## Capa 1: Hard Match (RC20)

**Estado**: Ya implementado en schema original (`property.rc20 UNIQUE`).

Si ambos anuncios tienen el mismo `rc20` (referencia catastral 20 caracteres), son definitivamente el mismo inmueble. No requiere scoring ni review.

```sql
-- Si ambos listings tienen rc20, deduplicación trivial:
UPDATE listings SET property_id = X WHERE rc20 = 'same_value'
```

---

## Capa 2: Blocking (Filtrado Rápido)

**Implementación**: Función SQL `find_match_candidates()` (ya existía en 0008).

Para cada listing nuevo sin `property_id`, busca candidatos compatibles:
- ST_DWithin(geom, 150m) → radio geográfico
- bedrooms exactos (o ambos NULL)
- square_meters ±8% de tolerancia

**Mejoras en 0014** (índices):
- Índice parcial `idx_match_candidates_pending` sobre `status='candidate'`
- Índice compuesto GiST `(geom, bedrooms)` para colapsar filtros espacial+categórico

Eficiencia: **O(log N) búsqueda en BD** en vez de O(N) scan completo.

```javascript
// Llamada desde dedup-job.mjs
const candidates = await client.query(
  'SELECT * FROM find_match_candidates($1, 150, 0.08)',
  [listing.id]
);
```

---

## Capa 3: Scoring Multi-Señal

**Implementación**: 
- `matching.mjs`: cálculo de scores y decisiones en Node.js
- `calculate_match_signals()` SQL: calcula 9 señales atómicas en paralelo

### Señales Disponibles

| Señal | Tipo | Fuente | Rango | Peso Defecto |
|-------|------|--------|-------|--------------|
| `distance_m` | Distancia euclidiana | ST_Distance | 0..150m | -0.15 |
| `sqm_diff_pct` | Diferencia % de m² | SQL | 0..50% | -0.10 |
| `bedrooms_same` | Coincidencia exacta | SQL | bool | +0.15 |
| `bathrooms_diff` | Diferencia de baños | SQL | 0..3+ | -0.05 |
| `price_diff_pct` | Diferencia % precio | SQL | 0..50% | -0.08 |
| `text_similarity` | pg_trgm (trigrama) | SQL | 0..1 | +0.12 |
| `phash_distance` | Hamming distance | SQL | 0..64 bits | -0.20 |
| `property_type_same` | Tipo inmueble | SQL | bool | +0.10 |
| `operation_same` | Venta vs alquiler | SQL | bool | +0.10 |

### Función de Scoring

```javascript
// Formulación Fellegi-Sunter simplificada
score = sigmoid(Σ(weight_i × normalized_signal_i))

// Ejemplo:
// - Dos pisos a 50m, mismo m², mismo precio → score ≈ 0.92 (confirmar auto)
// - Dos pisos a 300m, precio ±25%, bedrooms ≠ → score ≈ 0.60 (review)
// - Dos pisos a 2km → score < 0.30 (rechazar)
```

### Umbrales de Decisión

```
score ≥ 0.90 → confirmed (auto-merge)
0.75 ≤ score < 0.90 → candidate (revisión humana)
score < 0.75 → rejected (descartar)
```

Estos umbrales son **configurables** en `dedup-job.mjs`:
```javascript
await runDedupJob({
  thresholds: { auto: 0.90, review_min: 0.75 }
});
```

---

## Capa 4: Clustering (Union-Find)

**Implementación**: `clustering.mjs` usando librería `graphology`.

### Problema: "Black Hole Entity"

Cadena de matches débiles puede fusionar incorrectamente decenas de propiedades:
```
A=B (score 0.85) → B=C (score 0.85) → C=D (score 0.85)
Transitivamente: A=B=C=D (ERROR si D es un piso diferente)
```

### Solución: Límite de Tamaño + Re-particionado

```javascript
// Si componente > max_component_size (default 20), re-particionar
if (componentSize > 20) {
  // Recalcular con umbral más estricto (≥0.95)
  // Dividir en grupos más pequeños
}
```

### Asignación de property_id Canónico

Para cada grupo confirmado:
1. Elegir listing "canónico" = el más antiguo (`first_seen_at` ASC)
2. Crear `property` nuevo o reutilizar si existe
3. Asignar todos los listings al mismo `property_id`
4. Consolidar atributos (precio mín, m² modo, etc.)

```javascript
// Del clustering:
await client.query(`
  UPDATE listings
  SET property_id = $1, updated_at = now()
  WHERE id = ANY($2::uuid[])
`, [propertyId, listingIds]);
```

---

## pHash (Similitud de Imágenes)

**Implementación**: `phash.mjs` durante scraping.

### Flujo

1. **Descarga en memoria** (no en disco):
   ```javascript
   const response = await fetch(imageUrl);
   const buffer = await response.arrayBuffer();
   ```

2. **Procesa con sharp** (crop border si hay marca de agua):
   ```javascript
   const resized = await sharp(buffer)
     .resize(8, 8, {fit: 'cover'})
     .crop(border: 20px)  // elimina logos/watermarks
     .raw()
     .toBuffer();
   ```

3. **Calcula pHash** (64 bits):
   ```javascript
   const hash = await phash(Buffer.from(resized));
   // Retorna: "abc12def456..." (hex string)
   ```

4. **Guarda en BD**:
   - `cover_phash`: primera foto
   - `photo_phashes[]`: todas las fotos

### Hamming Distance (similitud)

```javascript
// Compara dos pHash
const distance = hammingDistance(hash1, hash2);  // 0..64

// Umbrales recomendados
distance ≤ 10 → 96% similitud (definitivamente duplicado)
distance 11-15 → 94-95% (probable duplicado)
distance > 15 → < 94% (diferente)
```

### Constraints

- **Timeout**: 8 segundos por imagen (evita bloqueos de red)
- **Crop border**: 20px para eliminar watermarks
- **Concurrencia**: máx 3 descargas paralelas (no saturar red)
- **Fallback**: si falla cálculo pHash, continúa sin él (no bloquea scraping)

---

## Ejecución del Job

### Opción 1: Manual

```bash
cd /home/user/casafari-mio/scraper
DATABASE_URL=... node dedup-runner.mjs

# Output:
# [dedup-job] iniciando...
# [dedup-job] procesando 150 listings sin agrupar
# [dedup-job] insertados 45 matches (12 confirmados)
# [clustering] iniciando Union-Find...
# [clustering] 3 componentes encontradas
# [clustering] grupo de 5 listings → property abc123...
# ✅ Job completado: 150 candidatos, 12 matches
```

### Opción 2: Cron (recomendado)

En `infra/deploy.sh` o crontab del VPS:

```bash
# Cada 6 horas (después del scraping)
0 */6 * * * cd /app && DATABASE_URL=... node scraper/dedup-runner.mjs >> /var/log/dedup.log 2>&1
```

O integrado en el pipeline post-deploy:
```bash
# infra/post-deploy.sh (después de migraciones)
node "$REPO_DIR/scraper/dedup-runner.mjs" || true  # non-fatal
```

### Opcin 3: Como parte del scraping

```javascript
// scraper/scrape-zone.mjs (post-scraping)
await runDedupJob({ db_url: process.env.DATABASE_URL });
```

---

## Monitoreo y Tuning

### Tabla de Estado

La tabla `dedup_job_state` guarda:
```sql
SELECT
  job_name,
  status,  -- 'idle' | 'running' | 'failed'
  last_run_at,
  candidates_found,
  candidates_matched,
  last_error
FROM dedup_job_state;
```

### Métricas Clave

```sql
-- Tasa de matching
SELECT
  COUNT(*) as total_matches,
  COUNT(*) FILTER (WHERE status='confirmed') as confirmed,
  COUNT(*) FILTER (WHERE status='candidate') as pending_review,
  ROUND(AVG(score), 3) as avg_score
FROM listing_match;

-- Distribución de componentes
SELECT
  COUNT(*) as property_count,
  AVG(listing_count) as avg_listings_per_property,
  MAX(listing_count) as max_listings_in_property
FROM property WHERE listing_count > 1;

-- Propiedades problemáticas (>20 listings)
SELECT
  id, listing_count, portals, created_at
FROM property
WHERE listing_count > 20
ORDER BY listing_count DESC;
```

### Ajuste de Pesos

Si muchos falsos positivos (merges incorrectos):
```javascript
const STRICTER_WEIGHTS = {
  distance_m: -0.25,      // penalizar distancia más
  price_diff_pct: -0.15,  // penalizar precio más
  phash_distance: -0.30   // exigir fotos más similares
};

await runDedupJob({ weights: STRICTER_WEIGHTS });
```

Si muchos falsos negativos (duplicados no detectados):
```javascript
const LOOSER_WEIGHTS = {
  distance_m: -0.10,
  price_diff_pct: -0.05,
  text_similarity: 0.20   // dar más peso al texto
};

await runDedupJob({
  weights: LOOSER_WEIGHTS,
  thresholds: { auto: 0.80, review_min: 0.65 }
});
```

---

## Panel Admin (Fase 2)

**Aún no implementado**, pero la BD está lista:

```javascript
// Interfaz web para revisar candidatos pendientes
GET /api/matches/pending?limit=20
  → {id, listing_a_details, listing_b_details, score, signals, reason}

POST /api/matches/{id}/decide
  → {action: 'confirm'|'reject'|'split'} + comentario

GET /api/properties?suspicious=true
  → Propiedades >20 listings para auditoría
```

---

## Performance y Escalado

### Benchmarks (estimados a escala actual)

| Operación | Datos | Tiempo | Índices |
|-----------|-------|--------|---------|
| find_match_candidates | 5M listings | ~2ms | GiST(geom) |
| calculate_match_signals | 1 pair | ~1ms | Cálculo en SQL |
| Scoring 1000 candidates | 1000 pairs | ~100ms | —— |
| Clustering 500 matches | 500 edges | ~50ms | graphology |
| **Total job (1000 unmatched)** | **~1M cand** | **~1h** | GiST(geom,beds) |

### Escalado Futuro

Si escala crece 10x:

1. **Particionar listings por zone_id** en el job:
   ```javascript
   for (const zoneId of activeZones) {
     await dedupZone(zoneId);  // procesar por zona
   }
   ```

2. **Usar Splink** (Postgres backend) para scoring ML automático:
   ```sql
   -- Reemplazaría matching.mjs
   SELECT * FROM splink_comparisons
   WHERE match_probability > 0.90;
   ```

3. **Paralelizar jobs** con pg-boss (si se necesita <1h latencia):
   ```javascript
   // Job distribuido
   await pgboss.send('dedup-zone', { zone_id });
   ```

---

## Limitaciones Conocidas

1. **Sin cascada de atributos**: Las propiedades creadsa quedan con datos del listing canónico. Mejora futura: consolidar precio/m² de todos.

2. **pHash no maneja crop agresivo**: Si una foto está recortada el 50%, pHash puede fallar. Fallback: usar texto + precio + distancia.

3. **Algoritmo greedy Union-Find**: Decisiones irreversibles. Si un match se confirma erróneamente, requiere intervención manual para revertir.

4. **Sin re-entrenamiento**: Pesos fijos. Futuro: usar histórico de decisiones humanas (Curator Hub style) para reoptimizar automáticamente.

---

## Próximos Pasos

1. **Ejecutar job en VPS** con datos reales y validar distribución de scores
2. **Auditar false positives**: Revisar propiedades >20 listings
3. **Calibrar umbrales** según resultados reales
4. **Panel admin** para revisión humana de candidatos en zona gris (0.75-0.90)
5. **Integración RC20**: Cuando catastro esté disponible, usar como hard match
