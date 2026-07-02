# Migraciones SQL — casafari-mio

Las migraciones viven en `/db/migrations/` (numeradas `0001..NNNN`) y se
aplican automáticamente tras cada deploy vía `infra/post-deploy.sh`.

## Cómo funciona

```
git push origin main
    ↓
VPS detecta cambios (~5 min) → git pull && npm run build && pm2 restart (deploy.sh)
    ↓
deploy.sh llama post-deploy.sh
    ↓
post-deploy.sh aplica SOLO las migraciones pendientes, en orden, una vez
    ↓
✅ BD actualizada
```

### Tracking con `schema_migrations`

`post-deploy.sh` mantiene una tabla:

```sql
CREATE TABLE schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

- Cada archivo `*.sql` se aplica **una sola vez** (si no está registrado) con
  `psql -v ON_ERROR_STOP=1` — un error a mitad de archivo detiene el deploy y
  NO registra la migración, para que se reintente tras corregirla.
- Los archivos se descubren dinámicamente (`ls *.sql | sort`) — no hay lista
  manual que se pueda quedar desactualizada.
- Histórico: la versión anterior del script ejecutaba cada archivo DOS veces
  (una para un `grep "already exists"` y otra "real") y sin ON_ERROR_STOP;
  por eso las migraciones antiguas son todas idempotentes. La primera pasada
  con el script nuevo las re-aplica una última vez y las registra.

## Aplicar manualmente

```bash
# Todas las pendientes (igual que el deploy)
bash infra/post-deploy.sh

# Una específica (no queda registrada — mejor usar el script)
psql $DATABASE_URL < db/migrations/0047_captaciones_cl.sql
```

## Ver estado

```bash
psql $DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY filename"
psql $DATABASE_URL -c "\dt"
```

## Crear una migración nueva

1. Crear `/db/migrations/00XX_descripcion.sql` con el siguiente número libre
   (¡revisar `ls db/migrations | tail` para no duplicar numeración! Las
   duplicadas 0033/0034 históricas se renombraron a 0048/0049).
2. Hacerla **idempotente** (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO
   NOTHING`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`, …): el
   tracking evita re-ejecuciones, pero la idempotencia salva los casos de
   restore/replay.
3. Commit + push a `main`; el VPS la aplica en el siguiente deploy.

### Template

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 00XX · Descripción breve de qué hace
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nueva_tabla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS idx_nueva_tabla_algo ON nueva_tabla(algo);
```

## Migraciones destacadas

| Rango | Qué cubren |
|---|---|
| 0001–0013 | Base Madrid: extensiones, zonas, catastro RC, listings/property, dedup, vistas de mercado, CRM |
| 0014–0019 | Dedup scoring, fotos de agencia, ubicación normalizada |
| 0020–0046 | Módulo Chile: catastro SII, comunas, listings_cl, DealerNet, TGR, coordenadas |
| 0047 | `captaciones_cl` — pipeline de captación URL → rol → dueño → teléfonos |
| 0048–0049 | (renombradas desde 0033/0034 duplicadas) comunas restantes + códigos SII |
| 0050 | `refresh_market_views()` — refresco de vistas materializadas |

## Troubleshooting

- **"ERROR: ... already exists" detiene el deploy** — la migración no es
  idempotente; añadir `IF NOT EXISTS`/`ON CONFLICT` y volver a desplegar.
- **"connection refused"** — Postgres no está listo; el script espera 30 s.
- **Registrar a mano una migración aplicada fuera del script:**
  `INSERT INTO schema_migrations (filename) VALUES ('00XX_archivo.sql') ON CONFLICT DO NOTHING;`

---

**Última actualización:** Jul 2026
**Script:** `infra/post-deploy.sh` · **Integrado en:** `infra/deploy.sh`
