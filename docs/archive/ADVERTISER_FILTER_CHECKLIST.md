# Checklist de Implementación del Filtro "Particular | Agencia"

## Fase 1: Integración Frontend (COMPLETADA)

- [x] Crear `FilterAdvertiserSection.tsx` con estructura jerárquica
- [x] Actualizar `FilterPanel.tsx` para integrar nuevo componente
- [x] Actualizar `useFilters.ts` para manejar nuevo estado
- [x] Exportar tipos `AdvertiserFilterState` desde componente
- [x] Implementar serialización a URL params
- [x] Implementar deserialización desde URL params
- [x] Crear documentación completa (ADVERTISER_FILTER_DOCS.md)
- [x] Crear ejemplos de uso (USAGE_EXAMPLES.tsx)
- [x] Crear queries SQL de ejemplo (advertiser_filter_queries.sql)
- [x] Crear diagrama de estructura visual (FILTER_STRUCTURE.md)
- [x] Crear resumen de implementación (IMPLEMENTATION_SUMMARY.md)

## Fase 2: Integración en Componentes (TODO)

### Paso 2.1: Actualizar componente que usa FilterPanel

- [ ] Importar tipos `Agency` desde FilterPanel
- [ ] Crear estado para `agencies` y `isLoadingAgencies`
- [ ] Agregar `useEffect` para cargar agencias desde API
- [ ] Pasar props a `FilterPanel`:
  ```tsx
  <FilterPanel
    // ... props existentes
    agencies={agencies}
    isLoadingAgencies={isLoadingAgencies}
  />
  ```

Archivos que probablemente necesiten actualización:
- `web/pages/anuncios.tsx` (o equivalente)
- `web/app/anuncios/page.tsx` (si es Next.js 13+)
- Componente principal que renderiza FilterPanel

### Paso 2.2: Crear endpoint `/api/listings/agencies` en Backend

```typescript
// GET /api/listings/agencies
// Retorna lista de agencias distintas

interface Agency {
  agency_id: string  // o uuid
  agency_name: string
}

// Respuesta:
// [
//   { "agency_id": "uuid-123", "agency_name": "Agencia A" },
//   { "agency_id": "uuid-456", "agency_name": "Agencia B" }
// ]
```

Query SQL:
```sql
SELECT DISTINCT
  advertiser_name as agency_name,
  NULL as agency_id  -- TODO: cambiar a agency_id cuando exista columna
FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name IS NOT NULL
  AND advertiser_name != ''
ORDER BY advertiser_name ASC
LIMIT 1000;
```

## Fase 3: Implementación Backend (TODO)

### Paso 3.1: Actualizar endpoint de listings para procesar nuevos parámetros

```python
# GET /api/listings
# Nuevos parámetros soportados:

@app.get("/api/listings")
def get_listings(
    advertiser_mode: str = "all",
    only_particular: bool = False,
    agency_id: str = None,
    exclusive_mode: str = "both",  # both | only | only_non
    exclude_agency_id: str = None,
    # ... otros parámetros existentes
):
    query = Listing.query.filter(Listing.is_active == True)

    # Aplicar filtro de anunciante
    if advertiser_mode == "particular":
        query = query.filter(Listing.advertiser_type == "particular")
        # TODO: Cuando existan columnas en BD
        # if only_particular:
        #     query = query.filter(Listing.is_private_by_agency == False)
        #                   .filter(Listing.was_private_by_agency == False)

    elif advertiser_mode == "agency":
        query = query.filter(Listing.advertiser_type == "professional")
        if agency_id:
            # TODO: Cambiar a agency_id cuando exista columna
            query = query.filter(Listing.advertiser_name == agency_id)
        if exclusive_mode == "only":
            query = query.filter(Listing.exclusive == True)
        elif exclusive_mode == "only_non":
            query = query.filter(Listing.exclusive == False)
        if exclude_agency_id:
            query = query.filter(Listing.advertiser_name != exclude_agency_id)

    # ... resto de filtros

    return paginate(query)
```

### Paso 3.2: Validar parámetros

```python
def validate_advertiser_filter(advertiser_mode, exclusive_mode):
    """
    Validar que los parámetros del filtro sean coherentes
    """
    valid_modes = ['all', 'particular', 'agency']
    valid_exclusive_modes = ['both', 'only', 'only_non']
    
    if advertiser_mode not in valid_modes:
        raise ValueError(f"Invalid advertiser_mode: {advertiser_mode}")
    
    if exclusive_mode not in valid_exclusive_modes:
        raise ValueError(f"Invalid exclusive_mode: {exclusive_mode}")
    
    return True
```

## Fase 4: Base de Datos (TODO - Migración 0018)

### Paso 4.1: Crear archivo de migración

Crear archivo: `/db/migrations/0018_add_advertiser_columns.sql`

```sql
-- ───────────────────────────────────────────────────────────────────────────
-- 0018 · Agregar columnas para filtro mejorado de anunciante
-- ───────────────────────────────────────────────────────────────────────────

-- Marcar anuncios listados como privados por agencia
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_private_by_agency boolean 
  DEFAULT false NOT NULL;

-- Marcar anuncios que FUERON privados (histórico)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS was_private_by_agency boolean 
  DEFAULT false NOT NULL;

-- Marcar anuncios como exclusivos
ALTER TABLE listings ADD COLUMN IF NOT EXISTS exclusive boolean 
  DEFAULT false NOT NULL;

-- Crear índices para optimización
CREATE INDEX IF NOT EXISTS idx_listings_is_private_by_agency
  ON listings(is_private_by_agency) WHERE is_private_by_agency = true;

CREATE INDEX IF NOT EXISTS idx_listings_was_private_by_agency
  ON listings(was_private_by_agency) WHERE was_private_by_agency = true;

CREATE INDEX IF NOT EXISTS idx_listings_exclusive
  ON listings(exclusive, advertiser_type) 
  WHERE advertiser_type = 'professional';

-- Opcional: crear tabla agencies para mejor gestión
-- CREATE TABLE IF NOT EXISTS agencies (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   name text NOT NULL UNIQUE,
--   created_at timestamptz DEFAULT now(),
--   updated_at timestamptz DEFAULT now()
-- );
-- ALTER TABLE listings ADD COLUMN IF NOT EXISTS agency_id uuid 
--   REFERENCES agencies(id) ON DELETE SET NULL;
```

### Paso 4.2: Ejecutar migración

```bash
# Modo manual (con herramienta de migraciones del proyecto)
npm run migrate:up 0018

# O directamente en BD
psql -U postgres -d casafari < /db/migrations/0018_add_advertiser_columns.sql
```

### Paso 4.3: Validar cambios en BD

```sql
-- Verificar que columnas existan
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'listings' 
  AND column_name IN ('is_private_by_agency', 'was_private_by_agency', 'exclusive');

-- Verificar índices
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'listings' 
  AND indexname LIKE 'idx_listings_%exclusive%';
```

## Fase 5: Testing (TODO)

### Paso 5.1: Unit Tests - FilterAdvertiserSection

```bash
# Crear archivo: web/components/filters/__tests__/FilterAdvertiserSection.test.tsx

# Tests a implementar:
- ✓ Debe mostrar modo 'all' por defecto
- ✓ Debe cambiar a 'particular' cuando se selecciona radio
- ✓ Debe cambiar a 'agency' cuando se selecciona radio
- ✓ Debe expandir sección particular cuando se selecciona
- ✓ Debe expandir sección agencia cuando se selecciona
- ✓ Debe permitir seleccionar checkboxes de particulares
- ✓ Debe cargar lista de agencias
- ✓ Debe permitir seleccionar agencia del dropdown
- ✓ Debe permitir seleccionar exclusividad
- ✓ Debe permitir excluir agencia
- ✓ Debe generar onChange callback correcto
- ✓ Debe deshabilitar opciones privadas (falta BD)
```

### Paso 5.2: Integration Tests - useFilters

```bash
# Crear archivo: web/hooks/__tests__/useFilters.test.ts

# Tests a implementar:
- ✓ toQueryParams debe generar advertiser_mode=all
- ✓ toQueryParams debe generar advertiser_mode=particular&only_particular=true
- ✓ toQueryParams debe generar advertiser_mode=agency&agency_id=X
- ✓ toQueryParams debe generar advertiser_mode=agency&exclusive_mode=only
- ✓ toQueryParams debe generar advertiser_mode=agency&exclude_agency_id=X
- ✓ loadFromQueryParams debe deserializar correctamente
- ✓ Debe persistir en localStorage
- ✓ Debe cargar desde localStorage al montar
```

### Paso 5.3: E2E Tests

```bash
# Crear archivo: e2e/advertiser_filter.spec.ts (Playwright/Cypress)

# Tests a implementar:
- ✓ Usuario puede abrir panel de filtros
- ✓ Usuario puede seleccionar "Particular"
- ✓ Usuario puede seleccionar "Sólo particulares"
- ✓ Usuario puede seleccionar "Agencias"
- ✓ Usuario puede seleccionar agencia del dropdown
- ✓ Usuario puede seleccionar exclusividad
- ✓ Usuario puede excluir agencia
- ✓ Click en "Aplicar" genera URL correcta
- ✓ URL con parámetros pre-llena filtros
- ✓ Filtros persisten en localStorage
```

## Fase 6: Habilitación de Opciones Privadas (TODO - Después de Migración)

Una vez ejecutada la migración 0018:

### Paso 6.1: Habilitar checkboxes de privados en FilterAdvertiserSection

```typescript
// Cambiar en FilterAdvertiserSection.tsx:

// De:
<label className="flex items-center gap-2 cursor-pointer group opacity-50 cursor-not-allowed">
  <input
    type="checkbox"
    disabled
    className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] cursor-not-allowed"
  />
  <span className="text-xs text-slate-500">
    Listado como privado por la agencia
  </span>
</label>

// A:
<label className="flex items-center gap-2 cursor-pointer group">
  <input
    type="checkbox"
    checked={value.particularOptions.isPrivateByAgency}
    onChange={(e) =>
      handleParticularChange('isPrivateByAgency', e.target.checked)
    }
    className="w-4 h-4 rounded border border-[var(--c-border-card)] bg-[var(--c-surface)] checked:bg-blue-600 checked:border-blue-600 cursor-pointer accent-blue-600 focus:ring-2 focus:ring-blue-600/50 focus:ring-offset-0"
  />
  <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
    Listado como privado por la agencia
  </span>
</label>
```

### Paso 6.2: Actualizar toQueryParams en useFilters.ts

```typescript
// Descomentar en toQueryParams():

if (filters.advertiserFilter.particularOptions.isPrivateByAgency) {
  params.set('is_private_by_agency', 'true')
}
if (filters.advertiserFilter.particularOptions.wasPrivateByAgency) {
  params.set('was_private_by_agency', 'true')
}
```

### Paso 6.3: Actualizar backend para procesar parámetros privados

```python
if advertiser_mode == "particular":
    query = query.filter(Listing.advertiser_type == "particular")
    if only_particular:
        query = query.filter(Listing.is_private_by_agency == False)
              .filter(Listing.was_private_by_agency == False)
    if is_private_by_agency:
        query = query.filter(Listing.is_private_by_agency == True)
    if was_private_by_agency:
        query = query.filter(Listing.was_private_by_agency == True)
```

## Fase 7: Monitoreo y Mejoras (TODO)

### Paso 7.1: Analytics

- [ ] Agregar tracking para filtros seleccionados
- [ ] Monitorear qué combinaciones se usan más
- [ ] Identificar opciones no utilizadas

### Paso 7.2: Performance

- [ ] Medir tiempo de carga de agencias
- [ ] Optimizar queries SQL si es necesario
- [ ] Caché de lista de agencias en frontend (10-15 min)

### Paso 7.3: UX

- [ ] Recopilar feedback de usuarios
- [ ] Ajustar labels si es confuso
- [ ] Considerar agregar ayuda contextual (tooltips)

## Archivos Involucrados

### Creados (NUEVOS)
```
web/components/filters/FilterAdvertiserSection.tsx
web/components/filters/ADVERTISER_FILTER_DOCS.md
web/components/filters/USAGE_EXAMPLES.tsx
web/components/filters/FILTER_STRUCTURE.md
web/components/filters/IMPLEMENTATION_SUMMARY.md
db/sql_examples/advertiser_filter_queries.sql
ADVERTISER_FILTER_CHECKLIST.md (este archivo)
```

### Modificados (EXISTENTES)
```
web/components/filters/FilterPanel.tsx
web/hooks/useFilters.ts
```

### A Crear (TODO)
```
db/migrations/0018_add_advertiser_columns.sql
web/pages/anuncios.tsx (o equivalente)
web/components/filters/__tests__/FilterAdvertiserSection.test.tsx
web/hooks/__tests__/useFilters.test.ts
e2e/advertiser_filter.spec.ts
```

## Recursos Útiles

- [Documentación Completa](./web/components/filters/ADVERTISER_FILTER_DOCS.md)
- [Estructura Visual](./web/components/filters/FILTER_STRUCTURE.md)
- [Ejemplos de Uso](./web/components/filters/USAGE_EXAMPLES.tsx)
- [Queries SQL](./db/sql_examples/advertiser_filter_queries.sql)
- [Resumen Implementación](./web/components/filters/IMPLEMENTATION_SUMMARY.md)

## Notas Importantes

1. **Compatibilidad Backwards**: El campo `advertiserType` se mantiene, no hay breaking changes
2. **Progressive Enhancement**: Funciona sin las columnas BD futuras
3. **Opciones Deshabilitadas**: Las opciones privadas están visualmente deshabilitadas hasta que exista la migración
4. **URL Shareable**: Todos los filtros se pueden compartir por URL
5. **Persistencia**: Los filtros se guardan en localStorage automáticamente

## Timeline Sugerido

```
Semana 1: Fases 1-2 (Frontend + API de agencias)
Semana 2: Fase 3 (Backend de filtrado)
Semana 3: Fase 4 (Migración BD)
Semana 4: Fases 5-6 (Testing + Habilitación privados)
Ongoing: Fase 7 (Monitoreo)
```

## Contactos

Para preguntas sobre:
- **Frontend**: Ver ADVERTISER_FILTER_DOCS.md
- **Backend**: Ver IMPLEMENTATION_SUMMARY.md Punto 4
- **BD**: Ver Fase 4 de este checklist
