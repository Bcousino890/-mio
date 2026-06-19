# Filtro Mejorado "Particular | Agencia"

## Descripción General

El nuevo filtro de anunciante (`FilterAdvertiserSection.tsx`) reemplaza la simple selección radio entre "Todos", "Particular" y "Agencia" con una estructura más compleja que soporta múltiples sub-opciones para cada modo.

## Estructura del Filtro

```
OPERADOR PRINCIPAL (radio)
├── Todo
│   └── Muestra todos los anuncios sin restricción
├── Particular
│   ├── Sólo particulares (advertiser_type = 'particular')
│   ├── Listado como privado por la agencia (TODO: is_private_by_agency = true)
│   └── Ex-Listado como privado por la agencia (TODO: was_private_by_agency = true)
└── Agencias
    ├── Con esta agencia
    │   └── Selector desplegable de agencias
    ├── Exclusividad
    │   ├── Ambos (exclusive = true OR false)
    │   ├── Sólo exclusivos (exclusive = true)
    │   └── Sólo no exclusivos (exclusive = false)
    └── Excluir esta agencia
        └── Selector desplegable de agencias a excluir
```

## Componentes Involucrados

### 1. **FilterAdvertiserSection.tsx** (Nuevo)
Componente principal que maneja toda la lógica del filtro mejorado.

**Props:**
```typescript
interface FilterAdvertiserSectionProps {
  value: AdvertiserFilterState
  onChange: (value: AdvertiserFilterState) => void
  agencies: Agency[]              // Lista de agencias para selectores
  isLoadingAgencies?: boolean     // Estado de carga de agencias
}
```

**Estado:**
```typescript
interface AdvertiserFilterState {
  mode: 'all' | 'particular' | 'agency'
  particularOptions: {
    onlyParticular: boolean
    isPrivateByAgency: boolean     // TODO: BD
    wasPrivateByAgency: boolean    // TODO: BD
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

### 2. **FilterPanel.tsx** (Actualizado)
Ahora integra `FilterAdvertiserSection` en lugar del simple `FilterRadioGroup`.

**Cambios:**
- Importa `FilterAdvertiserSection` y `AdvertiserFilterState`
- Agrega props `agencies` e `isLoadingAgencies`
- Reemplaza la sección "PARTICULAR / AGENCIA" con el nuevo componente
- Actualiza `calculateActiveFilters()` para contar el nuevo filtro

### 3. **useFilters.ts** (Actualizado)
Hook que maneja el estado global de filtros y persistencia.

**Cambios principales:**
- Agrega `advertiserFilter: AdvertiserFilterState` al estado inicial
- `toQueryParams()`: Serializa el nuevo filtro a URL params
- `loadFromQueryParams()`: Deserializa URL params al estado de filtro

## Flujo de Uso

### 1. En el Componente que Usa FilterPanel

```tsx
import { useFilters } from '@/hooks/useFilters'
import FilterPanel from '@/components/filters/FilterPanel'

function MyComponent() {
  const { filters, updateFilters, toQueryParams } = useFilters()
  const [agencies, setAgencies] = useState([])
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(false)

  // Cargar agencias
  useEffect(() => {
    const fetchAgencies = async () => {
      setIsLoadingAgencies(true)
      try {
        const response = await fetch('/api/agencies')
        const data = await response.json()
        setAgencies(data)
      } finally {
        setIsLoadingAgencies(false)
      }
    }
    fetchAgencies()
  }, [])

  return (
    <FilterPanel
      filters={filters}
      onFilterChange={updateFilters}
      onApply={() => {
        const params = toQueryParams()
        // Navegar o hacer request con params
      }}
      onClear={() => clearFilters()}
      isOpen={isOpen}
      onClose={onClose}
      agencies={agencies}
      isLoadingAgencies={isLoadingAgencies}
    />
  )
}
```

### 2. Generar Query API

El hook `useFilters()` genera automáticamente params URL válidos:

```typescript
const params = toQueryParams()
// Ejemplos de salida:

// Particular + solo particulares
// advertiser_mode=particular&only_particular=true

// Agencia + agencia específica + solo exclusivos
// advertiser_mode=agency&agency_id=uuid-123&exclusive_mode=only

// Agencia + excluir agencia
// advertiser_mode=agency&exclude_agency_id=uuid-456
```

### 3. Backend: Procesar Filtros

El backend debe procesar estos parámetros y construir la query SQL:

```python
# Pseudo-código (Python/FastAPI)

@app.get("/api/listings")
def get_listings(
    advertiser_mode: str = "all",
    only_particular: bool = False,
    agency_id: str = None,
    exclusive_mode: str = "both",
    exclude_agency_id: str = None,
    # ... otros filtros
):
    query = Listing.where(is_active=True)

    if advertiser_mode == "particular":
        query = query.where(advertiser_type="particular")
        if only_particular:
            # Solo sólo particulares, sin privados
            pass

    elif advertiser_mode == "agency":
        query = query.where(advertiser_type="professional")
        if agency_id:
            query = query.where(agency_id=agency_id)
        if exclusive_mode == "only":
            query = query.where(exclusive=True)
        elif exclusive_mode == "only_non":
            query = query.where(exclusive=False)
        if exclude_agency_id:
            query = query.where(agency_id != exclude_agency_id)

    return query
```

## Requisitos de Base de Datos

### Existentes ✅
- `listings.advertiser_type` (text): 'particular' | 'professional'
- `listings.advertiser_name` (text): nombre del anunciante
- `listings.is_active` (boolean)

### Futuros (TODO) ⚠️
Para soportar todas las opciones, se necesitan:

```sql
-- Agregar columnas en migración 0018_add_advertiser_columns.sql (propuesto)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_private_by_agency boolean DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS was_private_by_agency boolean DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS exclusive boolean DEFAULT false;

-- Crear índices para optimización
CREATE INDEX idx_listings_is_private_by_agency
  ON listings(is_private_by_agency) WHERE is_private_by_agency = true;
CREATE INDEX idx_listings_was_private_by_agency
  ON listings(was_private_by_agency) WHERE was_private_by_agency = true;
CREATE INDEX idx_listings_exclusive
  ON listings(exclusive, advertiser_type) WHERE advertiser_type = 'professional';
```

## Query Parameters para URL

```
advertiser_mode=all                              # Mostrar todos
advertiser_mode=particular&only_particular=true # Sólo particulares
advertiser_mode=particular&is_private_by_agency=true  # Privados (TODO)
advertiser_mode=agency&agency_id=uuid-123       # Agencia específica
advertiser_mode=agency&exclusive_mode=only      # Solo exclusivos
advertiser_mode=agency&exclusive_mode=only_non  # Solo no exclusivos
advertiser_mode=agency&exclude_agency_id=uuid-456 # Excluir agencia
```

## Comportamiento UI

### Estados

1. **Replegado**: Muestra solo el operador principal (radio)
2. **Expandido "Particular"**: Muestra checkboxes de opciones particulares
3. **Expandido "Agencias"**: Muestra selectores y radios de opciones de agencias

### Flujo de Interacción

```
Usuario selecciona "Particular" (radio)
  ↓
Se expande automáticamente la sección
  ↓
Usuario selecciona checkboxes de opciones
  ↓
Los cambios se reflejan en tiempo real
  ↓
Usuario hace click en "Aplicar"
  ↓
Se genera URL con parámetros
  ↓
Se navega o hace request a API
```

## Testing

### Unit Tests (Componente)

```typescript
describe('FilterAdvertiserSection', () => {
  it('should show "Particular" sub-options when selected', () => {
    // ...
  })
  it('should show "Agencias" sub-options when selected', () => {
    // ...
  })
  it('should generate correct query params', () => {
    // ...
  })
})
```

### Integration Tests (Hook)

```typescript
describe('useFilters', () => {
  it('should serialize advertiser filter to query params', () => {
    // ...
  })
  it('should load advertiser filter from URL params', () => {
    // ...
  })
})
```

## Compatibilidad Backwards

El campo `advertiserType` se mantiene para compatibilidad. El nuevo `advertiserFilter.mode` es complementario:

- Si `advertiserFilter.mode === 'all'`, se usa el campo antiguo `advertiserType`
- Si `advertiserFilter.mode !== 'all'`, el nuevo filtro tiene prioridad

Esto permite migración gradual del código existente.

## Notas Importantes

1. **Opciones deshabilitadas**: Las opciones que requieren columnas BD nuevas (privados) están grises y deshabilitadas hasta que se ejecute la migración
2. **Selectores dinámicos**: La lista de agencias se carga desde API/BD
3. **Validación**: El componente valida que solo estén activas las opciones del modo seleccionado
4. **Persistencia**: Todo el estado se guarda en localStorage vía `useFilters`
