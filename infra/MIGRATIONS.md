# Migraciones SQL — casafari-mio

Las migraciones SQL están en `/db/migrations/` y se aplican **automáticamente** tras cada deploy.

## Cómo funcionan

### Flujo automático
```
git push origin main
    ↓
VPS detecta cambios (~5 min)
    ↓
VPS: git pull && npm run build && pm2 restart (deploy.sh)
    ↓
deploy.sh llama post-deploy.sh
    ↓
post-deploy.sh aplica todas las migraciones en orden
    ↓
✅ BD actualizada
```

### Script de post-deploy
- **Archivo:** `infra/post-deploy.sh`
- **Qué hace:**
  1. Lee `DATABASE_URL` de `.env`
  2. Espera a que PostgreSQL esté listo (timeout 30s)
  3. Aplica migraciones en orden: `0001, 0002, ..., 0013`
  4. Ignora migraciones que ya existen (idempotente)

### Migraciones disponibles

| Num | Archivo | Descripción | Estado |
|-----|---------|-------------|--------|
| 1 | `0001_extensions.sql` | PostGIS, pg_trgm, unaccent, pgcrypto | ✅ |
| 2 | `0002_zones.sql` | Taxonomía (provincia→distrito→barrio) | ✅ |
| 3 | `0003_cadastre.sql` | Catastro (RC14, RC20) | ✅ |
| 4 | `0004_property_listings.sql` | Tablas principales (property + listings) | ✅ |
| 5 | `0005_price_history_changes.sql` | Histórico de precios + eventos | ✅ |
| 6 | `0006_scrape_orchestration.sql` | Orquestación de scraping | ✅ |
| 7 | `0007_captacion_market_views.sql` | Vistas materializadas | ✅ |
| 8 | `0008_dedup_matching.sql` | Deduplicación difusa | ✅ |
| 9 | `0009_rc_resolution.sql` | Funciones de resolución RC | ✅ |
| 10 | `0010_opportunities.sql` | Tabla de oportunidades | ✅ |
| 11 | `0011_seed_salamanca_barrios.sql` | Seed: barrios Salamanca | ✅ |
| 12 | `0012_agencies_crm_map.sql` | ✨ NUEVA: Detección de CRM | ✅ |
| 13 | `0013_add_crm_columns_to_listings.sql` | ✨ NUEVA: Columnas de CRM en listings | ✅ |

## Aplicar migraciones manualmente

Si necesitas aplicar migraciones sin deploy:

```bash
# Opción 1: Ejecutar el script
bash infra/post-deploy.sh

# Opción 2: Aplicar una migración específica
psql $DATABASE_URL < db/migrations/0013_add_crm_columns_to_listings.sql

# Opción 3: Aplicar todas en línea
for f in db/migrations/*.sql; do psql $DATABASE_URL < "$f"; done
```

## Verificar qué migraciones están aplicadas

```bash
# Conectar a la BD
psql $DATABASE_URL

# Ver esquema (tables, extensions, etc.)
\dt
\dx

# Verificar tabla específica
\d listings
```

## Crear una nueva migración

1. Crear archivo en `/db/migrations/` con nombre: `00XX_descripcion.sql`
   - Ej: `0014_add_user_preferences.sql`
2. Escribir SQL (se ejecutará automáticamente en el siguiente deploy)
3. Commit + push a `main`
4. VPS la aplicará automáticamente

### Template para migración nueva
```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 00XX · Descripción breve de qué hace
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nueva_tabla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_nueva_tabla_algo ON nueva_tabla(algo);
```

## Notas importantes

- ✅ Las migraciones son **idempotentes** — se pueden ejecutar múltiples veces sin error
- ✅ Se aplican **en orden** (0001, 0002, ..., 0013, etc.)
- ✅ El script espera a que PostgreSQL esté listo
- ❌ NO se aplican en deployment de git pull manual (hay que llamar `post-deploy.sh`)
- ❌ NO se pueden revertir automáticamente (PostgreSQL no lo soporta nativamente)

## Troubleshooting

### "Error: relation already exists"
Es normal. Las migraciones son idempotentes — se ignoran si ya existen.

### "Error: connection refused"
PostgreSQL no está listo. El script espera 30s; si sigue fallando, revisar logs de Postgres.

### "Migration N not found"
Archivo no existe o nombre incorrecto. Verificar que esté en `/db/migrations/` con nombre `00XX_*.sql`.

---

**Última actualización:** Jun 2026  
**Script:** `infra/post-deploy.sh`  
**Integrado en:** `infra/deploy.sh`
