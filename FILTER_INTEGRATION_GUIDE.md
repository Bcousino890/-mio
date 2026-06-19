# Guía de Integración - Panel de Filtros Responsive

## 1. Estructura de Archivos Creados

```
web/
├── components/
│   └── filters/
│       ├── FilterPanel.tsx            # Panel principal con grupos colapsables
│       ├── FilterGroupToggle.tsx       # Wrapper para grupos de filtros
│       ├── FilterRadioGroup.tsx        # Radio buttons (Operación, Anunciante)
│       ├── FilterCheckboxGroup.tsx     # Checkboxes (Tipo vivienda, Características)
│       ├── FilterSelect.tsx            # Selects (Piso, Vista, Orientación)
│       ├── FilterRangeSlider.tsx       # Range sliders (Precio, Superficie)
│       └── FilterSearchBox.tsx         # Search con autocomplete (Ubicación)
├── hooks/
│   └── useFilters.ts                  # Hook para manejar estado y persistencia
├── FILTER_PANEL_DESIGN.md             # Especificación de diseño
└── FILTER_INTEGRATION_GUIDE.md        # Este archivo
```

## 2. Integración Rápida en AnunciosClient.tsx

### Paso 1: Importar componentes y hook

```typescript
'use client'

import { useState, useCallback } from 'react'
import FilterPanel, { type FilterState } from '@/components/filters/FilterPanel'
import { useFilters } from '@/hooks/useFilters'

export default function AnunciosClient() {
  // ... resto del código existente

  // Hook para manejar filtros
  const { filters, updateFilters, clearFilters, toQueryParams } = useFilters()

  // Estado para abrir/cerrar el drawer de filtros en mobile
  const [showFiltersPanel, setShowFiltersPanel] = useState(false)

  // Handlers para aplicar y limpiar filtros
  const handleApplyFilters = useCallback(() => {
    // Los cambios ya están en el state, solo necesitamos resetear la página
    setPage(1)
    setShowFiltersPanel(false)
  }, [])

  const handleClearFilters = useCallback(() => {
    clearFilters()
    setPage(1)
    setShowFiltersPanel(false)
  }, [])

  // Actualizar los parámetros de búsqueda cuando cambian los filtros
  useEffect(() => {
    const params = toQueryParams()
    // Usar los parámetros en la llamada a la API
    // fetch(`/api/listings?${params.toString()}`)
  }, [filters])

  // ... resto del código
}
```

### Paso 2: Integrar UI del panel en el layout

```tsx
return (
  <div className="flex flex-col h-full bg-[var(--c-bg)]">
    {/* Header existente */}
    <header className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-[var(--c-border)] bg-[var(--c-bg)] flex-wrap">
      {/* ... filtros rápidos existentes (Operation, Advertiser, etc) ... */}
      
      {/* Botón de "Más filtros" - abre el panel en mobile */}
      <button
        onClick={() => setShowFiltersPanel(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border md:hidden"
      >
        Más filtros
        {activeCount > 0 && <span className="badge">{activeCount}</span>}
      </button>
    </header>

    <div className="flex flex-1 overflow-hidden gap-3 px-3 py-3">
      {/* Panel lateral en desktop, drawer en mobile */}
      <div className="hidden md:flex md:w-80 md:flex-col">
        <FilterPanel
          filters={filters}
          onFilterChange={updateFilters}
          onApply={handleApplyFilters}
          onClear={handleClearFilters}
          isOpen={true}
          onClose={() => {}}
        />
      </div>

      {/* Drawer modal en mobile */}
      {showFiltersPanel && (
        <div className="fixed inset-0 md:hidden z-40">
          <FilterPanel
            filters={filters}
            onFilterChange={updateFilters}
            onApply={handleApplyFilters}
            onClear={handleClearFilters}
            isOpen={showFiltersPanel}
            onClose={() => setShowFiltersPanel(false)}
          />
        </div>
      )}

      {/* Cards grid + map (código existente) */}
      <div className="flex-1 flex flex-col">
        {/* ... cards y map ... */}
      </div>
    </div>
  </div>
)
```

## 3. Casos de Uso Comunes

### 3.1 Usar filtros sin guardar en localStorage

```typescript
const { filters, updateFilters } = useFilters({
  operation: 'sale',
  price: { min: 100000, max: 500000 }
})
```

### 3.2 Cargar filtros desde URL

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  loadFromQueryParams(params)
}, [])
```

### 3.3 Generar URL shareable

```typescript
const shareUrl = getShareableUrl('https://casafari.com/anuncios')
// Resultado: https://casafari.com/anuncios?operation=sale&price_min=100000&...
```

### 3.4 Acceder al query params para fetch

```typescript
const handleSearch = async () => {
  const params = toQueryParams()
  const response = await fetch(`/api/listings?${params.toString()}&page=1&page_size=30`)
  const data = await response.json()
  setListings(data.results)
}
```

## 4. Personalización de Opciones

Para cambiar las opciones disponibles en los filtros, edita las constantes en `FilterPanel.tsx`:

```typescript
// Tipos de propiedad
const PROPERTY_TYPES = [
  { id: 'piso', label: 'Piso' },
  { id: 'atico', label: 'Ático' },
  // ... añade más
]

// Características
const CHARACTERISTICS = [
  { id: 'balcon', label: 'Balcón' },
  // ... etc
]

// Pisos
const FLOOR_OPTIONS = [
  { id: 'planta_baja', label: 'Planta baja' },
  // ... etc
]
```

## 5. Integración con API Backend

El hook `useFilters()` genera query params automáticamente. Espera que tu API acepte:

```
GET /api/listings?
  operation=rent|sale|all&
  advertiser_type=particular|professional|all&
  property_types=piso,atico,duplex&
  price_min=1000&
  price_max=5000&
  sqm_min=50&
  sqm_max=300&
  price_sqm_min=10&
  price_sqm_max=100&
  bedrooms_min=2&
  bedrooms_max=4&
  bathrooms_min=1&
  bathrooms_max=3&
  year_built_min=2000&
  year_built_max=2024&
  days_on_market_min=0&
  days_on_market_max=90&
  parcel_size_min=0&
  parcel_size_max=5000&
  location=Madrid&
  distance_km=5&
  floor=planta_baja&
  view=calle&
  orientation=sur&
  furnished=true|false&
  energy_rating=A|B|C|D|E|F&
  characteristics=balcon,ascensor,garaje&
  page=1&
  page_size=30&
  sort=recent|price_asc|price_desc|sqm
```

## 6. Estilos y Configuración

### Breakpoints Responsive

El panel se adapta automáticamente:
- **Mobile (xs/sm)**: Drawer fullscreen desde abajo
- **Tablet (md)**: Panel lateral de 320px
- **Desktop (lg+)**: Panel lateral de 360px fijo

### Personalizar colores

Los componentes usan variables CSS:
```css
--c-bg              /* Background principal */
--c-card            /* Fondo de cards */
--c-surface         /* Fondo de inputs */
--c-border          /* Borde principal */
--c-border-card     /* Borde de cards */
--c-active          /* Color activo */
```

Edita en tu tema o agrega en `globals.css`:

```css
:root {
  --c-bg: #0f0f0f;
  --c-card: #1a1a1a;
  --c-surface: #2a2a2a;
  --c-border: #333333;
  --c-border-card: #404040;
  --c-active: #1e3a5f;
}
```

## 7. Accesibilidad

Todos los componentes incluyen:
- Labels correctamente asociados
- ARIA attributes (`aria-expanded`, `aria-controls`)
- Navegación por teclado (Tab, Enter, Espace, Esc)
- Focus management
- Colores con contraste WCAG AA

## 8. Performance

### Optimizaciones incluidas

- Debounce en range sliders (300ms)
- React.memo en componentes puros
- useMemo para cálculo de contadores
- Virtual scroll en listas largas (future)
- Lazy loading de secciones avanzadas

### Tips adicionales

```typescript
// Memoize el panel si tienes muchos filtros
const FilterPanelMemoized = React.memo(FilterPanel)

// Debounce personalizado para búsqueda
const [searchTerm, setSearchTerm] = useState('')
useEffect(() => {
  const timer = setTimeout(() => {
    updateFilters({ location: searchTerm })
  }, 300)
  return () => clearTimeout(timer)
}, [searchTerm])
```

## 9. Testing

### Unit Tests

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import FilterRadioGroup from '@/components/filters/FilterRadioGroup'

describe('FilterRadioGroup', () => {
  it('should call onChange when selecting an option', () => {
    const onChange = jest.fn()
    render(
      <FilterRadioGroup
        name="test"
        value="all"
        onChange={onChange}
        options={[
          { id: 'all', label: 'All' },
          { id: 'sale', label: 'Sale' },
        ]}
      />
    )

    fireEvent.click(screen.getByLabelText('Sale'))
    expect(onChange).toHaveBeenCalledWith('sale')
  })
})
```

### Integration Tests

```typescript
// Aplicar filtros y verificar que se actualizan los resultados
it('should filter listings when applying filters', async () => {
  render(<AnunciosClient />)
  
  // Abrir panel
  fireEvent.click(screen.getByText('Más filtros'))
  
  // Cambiar filtro
  fireEvent.click(screen.getByLabelText('Venta'))
  
  // Aplicar
  fireEvent.click(screen.getByText('Aplicar'))
  
  // Verificar llamada a API
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('operation=sale')
  )
})
```

## 10. Próximos Pasos

### Mejoras Futuras

1. **Mapa interactivo** - Seleccionar zonas dibujando
2. **Historial de filtros** - Guardar últimas búsquedas
3. **Presets** - Guardar combinaciones favoritas
4. **Comparador** - Comparar 2-3 búsquedas
5. **Filtros por precio/m²** - Mejorar rango visual
6. **Autocomplete mejorado** - Integrar Nominatim/Google Places
7. **Filtros guardados** - Guardar en DB si hay login
8. **Notificaciones** - Alertar cuando nuevas propiedades coincidan

### Checklist de Implementación

- [ ] Copiar componentes a `/components/filters/`
- [ ] Copiar hook a `/hooks/useFilters.ts`
- [ ] Integrar `FilterPanel` en `AnunciosClient.tsx`
- [ ] Actualizar `toQueryParams()` en la API
- [ ] Testar responsive en mobile/tablet
- [ ] Añadir tests unitarios
- [ ] Documentar cambios en README
- [ ] Deploy a staging
- [ ] A/B testing (opcional)
- [ ] Deploy a producción
