# Implementación del Filtro Mejorado "Particular | Agencia"

## Resumen Ejecutivo

Se ha implementado un sistema mejorado de filtrado por tipo de anunciante que reemplaza la simple selección radio (Todo/Particular/Agencia) con una estructura jerárquica que permite:

- **Modo Particular**: Filtrar por anuncios de particulares con sub-opciones para anuncios privados (futuro)
- **Modo Agencia**: Filtrar por agencias específicas con opciones de exclusividad y exclusión
- **Persistencia**: Todos los filtros se guardan en localStorage
- **URL Shareable**: Los filtros se pueden serializar a URL params para compartir búsquedas

## Cambios Realizados

### 1. Nuevos Componentes

#### FilterAdvertiserSection.tsx (NUEVO)
- **Ubicación**: `/web/components/filters/FilterAdvertiserSection.tsx`
- **Función**: Componente principal que gestiona todo el filtro de anunciante
- **Características**:
  - Estructura jerárquica con radio (operador) + checkboxes/selectores (sub-opciones)
  - Expansión/colapso de secciones particulares y agencias
  - Selectores dinámicos para agencias cargadas desde API
  - Validación de estado para asegurar coherencia lógica
  - Soporte para opciones futuras (privados) con placeholder disabled

**Estado manejado**:
```typescript
interface AdvertiserFilterState {
  mode: 'all' | 'particular' | 'agency'
  particularOptions: {
    onlyParticular: boolean
    isPrivateByAgency: boolean      // TODO: BD
    wasPrivateByAgency: boolean     // TODO: BD
  }
  agencyOptions: {
    agencyId: string | null
    agencyName: string | null
    exclusive: boolean
    exclusiveMode: 'both' | 'only' | 'only_non'
    excludeAgencyId: string | null
  }
}
```

### 2. Cambios en Componentes Existentes

#### FilterPanel.tsx (ACTUALIZADO)
- **Cambios**:
  - Agrega import de `FilterAdvertiserSection` y `AdvertiserFilterState`
  - Agrega props `agencies?: Agency[]` e `isLoadingAgencies?: boolean`
  - Reemplaza la sección "PARTICULAR / AGENCIA" con `<FilterAdvertiserSection />`
  - Actualiza `calculateActiveFilters()` para contar el nuevo filtro
  - Agrega interfaz `Agency` para tipar agencias

- **Ejemplo de uso**:
```tsx
<FilterPanel
  filters={filters}
  onFilterChange={updateFilters}
  onApply={handleApply}
  onClear={clearFilters}
  isOpen={isOpen}
  onClose={onClose}
  agencies={agencies}
  isLoadingAgencies={isLoadingAgencies}
/>
```

#### useFilters.ts (ACTUALIZADO)
- **Cambios**:
  - Agrega `advertiserFilter: AdvertiserFilterState` al estado inicial (`INITIAL_STATE`)
  - Actualiza `toQueryParams()` para serializar el nuevo filtro:
    - `advertiser_mode`: El modo principal (all/particular/agency)
    - `only_particular`: Para particulares sin privados
    - `agency_id`: ID de agencia seleccionada
    - `exclusive_mode`: both/only/only_non
    - `exclude_agency_id`: Agencia a excluir
  - Actualiza `loadFromQueryParams()` para deserializar desde URL
  - Mantiene compatibilidad con el campo antiguo `advertiserType`

- **Query params generados**:
```
advertiser_mode=all                              # Todo
advertiser_mode=particular&only_particular=true # Solo particulares
advertiser_mode=agency&agency_id=uuid-123       # Agencia específica
advertiser_mode=agency&exclusive_mode=only      # Solo exclusivos
advertiser_mode=agency&exclude_agency_id=uuid   # Excluir agencia
```

### 3. Documentación

#### ADVERTISER_FILTER_DOCS.md
Documentación completa del componente incluyendo:
- Estructura del filtro (árbol visual)
- Interfaz de props
- Flujo de uso en aplicación
- Requisitos de base de datos
- Query parameters
- Comportamiento UI

#### USAGE_EXAMPLES.tsx
6 ejemplos prácticos:
1. Componente básico con FilterPanel
2. Cambiar modo manualmente
3. Configurar filtros específicos
4. Cargar desde URL
5. Generar URL params
6. Componente personalizado

#### advertiser_filter_queries.sql
Ejemplos de SQL queries para cada combinación de filtros:
- Todo
- Solo particulares
- Particulares con privados (futuro)
- Agencias específicas
- Agencias con exclusividad
- Exclusión de agencias

## Requisitos de Base de Datos

### Existentes (Funcionan Ahora)
```sql
listings.advertiser_type      -- 'particular' | 'professional'
listings.advertiser_name      -- Nombre del anunciante
listings.is_active            -- Estado del anuncio
```

### Futuros (TODO - Migración 0018)
```sql
-- Agregar columnas para nuevas opciones
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_private_by_agency boolean DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS was_private_by_agency boolean DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS exclusive boolean DEFAULT false;

-- Crear índices
CREATE INDEX idx_listings_is_private_by_agency ON listings(is_private_by_agency) 
  WHERE is_private_by_agency = true;
CREATE INDEX idx_listings_was_private_by_agency ON listings(was_private_by_agency)
  WHERE was_private_by_agency = true;
CREATE INDEX idx_listings_exclusive ON listings(exclusive, advertiser_type)
  WHERE advertiser_type = 'professional';

-- Opcional: crear tabla agencies para mejor gestión
CREATE TABLE agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE listings ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES agencies(id);
```

### Script SQL Ejemplo
Ver `/db/sql_examples/advertiser_filter_queries.sql` para queries completas.

## Estructura de Archivos

```
/web/components/filters/
├── FilterAdvertiserSection.tsx        (NUEVO)
├── FilterPanel.tsx                    (ACTUALIZADO)
├── FilterRadioGroup.tsx               (sin cambios)
├── FilterCheckboxGroup.tsx            (sin cambios)
├── FilterRangeSlider.tsx              (sin cambios)
├── FilterSelect.tsx                   (sin cambios)
├── FilterSearchBox.tsx                (sin cambios)
├── FilterGroupToggle.tsx              (sin cambios)
├── filters.css                        (sin cambios)
├── README.md                          (existente)
├── ADVERTISER_FILTER_DOCS.md          (NUEVO)
├── USAGE_EXAMPLES.tsx                 (NUEVO)
└── IMPLEMENTATION_SUMMARY.md          (NUEVO - este archivo)

/web/hooks/
├── useFilters.ts                      (ACTUALIZADO)

/db/sql_examples/
└── advertiser_filter_queries.sql      (NUEVO)
```

## Cómo Integrar en la Aplicación

### 1. Cargar Agencias en el Componente Principal

```tsx
// pages/anuncios.tsx o component-que-usa-FilterPanel

const [agencies, setAgencies] = useState([])
const [isLoadingAgencies, setIsLoadingAgencies] = useState(false)

useEffect(() => {
  const fetchAgencies = async () => {
    setIsLoadingAgencies(true)
    try {
      const response = await fetch('/api/listings/agencies')
      const data = await response.json()
      setAgencies(data.map(a => ({ id: a.agency_id, name: a.agency_name })))
    } finally {
      setIsLoadingAgencies(false)
    }
  }
  fetchAgencies()
}, [])
```

### 2. Pasar Props a FilterPanel

```tsx
<FilterPanel
  filters={filters}
  onFilterChange={updateFilters}
  onApply={handleApply}
  onClear={clearFilters}
  isOpen={isOpen}
  onClose={onClose}
  agencies={agencies}
  isLoadingAgencies={isLoadingAgencies}
/>
```

### 3. Endpoint Backend para Agencias

```python
# /api/listings/agencies
# GET /api/listings/agencies
# Response:
# [
#   { "agency_id": "uuid-123", "agency_name": "Agencia A" },
#   { "agency_id": "uuid-456", "agency_name": "Agencia B" }
# ]

# Query SQL:
SELECT DISTINCT
  advertiser_name as agency_name,
  NULL as agency_id  -- TODO: cuando exista columna agency_id
FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name IS NOT NULL
  AND advertiser_name != ''
ORDER BY advertiser_name ASC
```

### 4. Backend: Procesar Filtros

```python
@app.get("/api/listings")
def get_listings(
    advertiser_mode: str = "all",
    only_particular: bool = False,
    agency_id: str = None,
    exclusive_mode: str = "both",
    exclude_agency_id: str = None,
    # ... otros parámetros de filtro
):
    query = Listing.query.filter(Listing.is_active == True)

    if advertiser_mode == "particular":
        query = query.filter(Listing.advertiser_type == "particular")

    elif advertiser_mode == "agency":
        query = query.filter(Listing.advertiser_type == "professional")
        if agency_id:
            query = query.filter(Listing.advertiser_name == agency_id)
        if exclusive_mode == "only":
            query = query.filter(Listing.exclusive == True)
        elif exclusive_mode == "only_non":
            query = query.filter(Listing.exclusive == False)
        if exclude_agency_id:
            query = query.filter(Listing.advertiser_name != exclude_agency_id)

    return paginate(query)
```

## Testing

### Test Sugerido para FilterAdvertiserSection

```typescript
describe('FilterAdvertiserSection', () => {
  describe('Modo', () => {
    it('debería mostrar todos por defecto', () => {
      // ...
    })

    it('debería cambiar a Particular cuando se selecciona', () => {
      // ...
    })

    it('debería cambiar a Agencias cuando se selecciona', () => {
      // ...
    })
  })

  describe('Sub-opciones Particular', () => {
    it('debería mostrar opciones cuando se expande', () => {
      // ...
    })

    it('debería permitir seleccionar solo particulares', () => {
      // ...
    })

    it('debería deshabilitar opciones privadas hasta que existan columnas BD', () => {
      // ...
    })
  })

  describe('Sub-opciones Agencias', () => {
    it('debería cargar lista de agencias', () => {
      // ...
    })

    it('debería permitir seleccionar agencia específica', () => {
      // ...
    })

    it('debería permitir seleccionar exclusividad', () => {
      // ...
    })

    it('debería permitir excluir agencia', () => {
      // ...
    })
  })

  describe('URL Params', () => {
    it('debería generar advertiser_mode=particular para particular', () => {
      // ...
    })

    it('debería generar advertiser_mode=agency&agency_id=X para agencia', () => {
      // ...
    })
  })
})
```

## Próximos Pasos

1. **Agregar columnas a BD** (Migración 0018)
   - `is_private_by_agency`
   - `was_private_by_agency`
   - `exclusive`
   - Opcionalmente: `agency_id` (si se crea tabla agencies)

2. **Habilitar opciones privadas** en FilterAdvertiserSection
   - Remover `disabled` de checkboxes de privados
   - Actualizar backend para procesar estos parámetros

3. **Agregar endpoint `/api/listings/agencies`**
   - Query SQL que obtenga lista DISTINCTA de agencias

4. **Implementar Backend**
   - Procesar nuevos parámetros de URL
   - Agregar lógica de filtrado en query SQL

5. **Testing**
   - Unit tests del componente
   - Integration tests con API
   - E2E tests de flujo completo

## Compatibilidad

- **Backwards Compatible**: El campo `advertiserType` se mantiene
- **Progressive Enhancement**: El nuevo filtro funciona sin las columnas futuras
- **Graceful Degradation**: Las opciones futuras están deshabilitadas hasta que existan columnas

## Performance

- **Selectores dinámicos**: Cargan agencias una sola vez en `useEffect`
- **Persistencia**: localStorage reduce requests innecesarios
- **URL Params**: Permiten compartir búsquedas sin estado en BD
- **Índices BD**: Recomendados para `is_active`, `advertiser_type`, nuevas columnas

## Notas Técnicas

1. El componente usa `ChevronDown` de lucide-react para el icono de expansión
2. Los estilos usan Tailwind CSS con variables CSS personalizadas (`--c-*`)
3. El estado se maneja con `useState` + `useCallback` para optimización
4. La validación se hace en el componente, no en el backend
5. Las opciones futuras (privados) tienen `disabled` y `opacity-50` como hint visual

## Autor

Implementación del filtro mejorado "Particular | Agencia" con soporte para:
- Sub-opciones jerárquicas
- Selectores dinámicos de agencias
- Persistencia en localStorage
- URL shareable
- Extensibilidad para futuras opciones

Fecha: 2026-06-19
