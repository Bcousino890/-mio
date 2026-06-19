# Panel de Filtros - Componentes

## Visión General

Componentes reutilizables y totalmente responsive para un panel de filtros elaborado en Casafari. Los componentes están diseñados para funcionar tanto en desktop (panel lateral) como en mobile (drawer modal).

## Estructura de Componentes

### FilterPanel.tsx
Componente principal que agrupa todos los filtros. Maneja:
- Grupos colapsables de filtros
- Estado de cada filtro
- Botones de aplicar y limpiar
- Responsive layout (lateral en desktop, drawer en mobile)

**Props:**
```typescript
interface FilterPanelProps {
  filters: FilterState              // Estado actual de filtros
  onFilterChange: (filters: FilterState) => void  // Callback al cambiar
  onApply: () => void               // Callback al aplicar
  onClear: () => void               // Callback al limpiar
  isOpen: boolean                   // Mostrar/ocultar (mobile)
  onClose: () => void               // Cerrar drawer
}
```

**Uso:**
```tsx
<FilterPanel
  filters={filters}
  onFilterChange={updateFilters}
  onApply={handleApply}
  onClear={handleClear}
  isOpen={isOpen}
  onClose={closePanel}
/>
```

### FilterGroupToggle.tsx
Wrapper colapsable para grupos de filtros con animación suave.

**Props:**
```typescript
interface FilterGroupToggleProps {
  id: string                        // ID único del grupo
  label: string                     // Nombre a mostrar
  isExpanded: boolean               // Estado expandido/colapsado
  onToggle: (id: string) => void   // Callback de toggle
  children: ReactNode               // Contenido del grupo
}
```

### FilterRadioGroup.tsx
Radio buttons para filtros mutuamente excluyentes (Operación, Tipo de Anunciante).

**Props:**
```typescript
interface FilterRadioGroupProps {
  name: string
  value: string                     // Valor seleccionado
  onChange: (value: string) => void
  options: Array<{ id: string; label: string }>
}
```

**Ejemplo:**
```tsx
<FilterRadioGroup
  name="operation"
  value={filters.operation}
  onChange={(val) => updateFilters({ operation: val })}
  options={[
    { id: 'all', label: 'Todas' },
    { id: 'sale', label: 'Venta' },
    { id: 'rent', label: 'Alquiler' },
  ]}
/>
```

### FilterCheckboxGroup.tsx
Checkboxes para múltiples selecciones (Tipo de Propiedad, Características).

**Props:**
```typescript
interface FilterCheckboxGroupProps {
  name: string
  values: string[]                  // Array de valores seleccionados
  onChange: (values: string[]) => void
  options: Array<{ id: string; label: string }>
  columns?: 1 | 2 | 3              // Número de columnas (default: 1)
}
```

**Ejemplo:**
```tsx
<FilterCheckboxGroup
  name="propertyTypes"
  values={filters.propertyTypes}
  onChange={(vals) => updateFilters({ propertyTypes: vals })}
  options={[
    { id: 'piso', label: 'Piso' },
    { id: 'atico', label: 'Ático' },
  ]}
  columns={2}
/>
```

### FilterSelect.tsx
Dropdown select para filtros con muchas opciones.

**Props:**
```typescript
interface FilterSelectProps {
  label?: string                    // Label del select
  value: string                     // Valor seleccionado
  onChange: (value: string) => void
  options: Array<{ id: string; label: string }>
  placeholder?: string              // Texto por defecto
}
```

### FilterRangeSlider.tsx
Range slider con inputs numéricos para rangos de valores (Precio, Superficie).

**Props:**
```typescript
interface FilterRangeSliderProps {
  label: string
  min: number                       // Valor mínimo posible
  max: number                       // Valor máximo posible
  step: number                      // Incremento por click
  values: [number, number]          // [minActual, maxActual]
  onChange: (min: number, max: number) => void
  showInputs?: boolean              // Mostrar inputs (default: true)
  unit?: string                     // Unidad (€, m², etc)
  format?: (val: number) => string  // Formateador personalizado
}
```

**Ejemplo:**
```tsx
<FilterRangeSlider
  label="Rango de precio"
  min={0}
  max={1000000}
  step={10000}
  values={[filters.price.min ?? 0, filters.price.max ?? 1000000]}
  onChange={(min, max) =>
    updateFilters({ price: { min, max } })
  }
  showInputs
  unit="€"
  format={(val) => `${(val / 1000).toFixed(0)}k`}
/>
```

### FilterSearchBox.tsx
Search input con autocomplete para ubicaciones.

**Props:**
```typescript
interface FilterSearchBoxProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
}
```

**Datos de sugerencias (mock):**
```typescript
const MOCK_SUGGESTIONS = [
  { name: 'Centro', type: 'neighborhood' },
  { name: 'Salamanca', type: 'neighborhood' },
  // ... más sugerencias
]
```

Para integrar con una API real, editar `FilterSearchBox.tsx`:

```typescript
// En lugar de MOCK_SUGGESTIONS, usar:
async function fetchSuggestions(query: string) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${query}&format=json`
  )
  return response.json()
}
```

## Estados del Componente FilterState

```typescript
interface FilterState {
  // Operación y Anunciante
  operation: 'all' | 'sale' | 'rent'
  advertiserType: 'all' | 'particular' | 'professional'

  // Tipo de Propiedad
  propertyTypes: string[]  // ['piso', 'atico', 'chalet']

  // Rangos
  price: { min: number | null; max: number | null }
  squareMeters: { min: number | null; max: number | null }
  pricePerSqm: { min: number | null; max: number | null }
  bedrooms: { min: number | null; max: number | null }
  bathrooms: { min: number | null; max: number | null }
  yearBuilt: { min: number | null; max: number | null }
  daysOnMarket: { min: number | null; max: number | null }
  parcelSize: { min: number | null; max: number | null }

  // Detalles
  floor: string | null
  view: string | null
  orientation: string | null
  furnished: boolean | null
  energyRating: string | null
  characteristics: string[]

  // Ubicación
  location: string | null
  distance: number | null
}
```

## Hook useFilters

Maneja la persistencia y conversión de filtros.

```typescript
const {
  filters,                    // Estado actual
  updateFilters,             // (updates: Partial<FilterState>) => void
  clearFilters,              // () => void
  resetToDefaults,           // () => void
  toQueryParams,             // () => URLSearchParams
  getShareableUrl,           // (baseUrl?: string) => string
  loadFromQueryParams,       // (params: URLSearchParams) => void
} = useFilters()
```

### Persistencia

Los filtros se guardan automáticamente en localStorage bajo la clave:
```typescript
'casafari:filters:current'
```

Para deshabilitar:
```typescript
// Usar estado local en lugar de hook
const [filters, setFilters] = useState<FilterState>(initialState)
```

## Responsive Design

### Desktop (md+)
- Panel fijo en sidebar izquierdo
- Ancho: 360px
- Scroll interno si hay muchos filtros

### Mobile (xs/sm)
- Drawer modal desde abajo
- Fullscreen (85% del viewport)
- Overlay opaco detectable

### Breakpoints
```
xs:   0-320px   (Mobile portrait)
sm:   320-640px (Mobile landscape)
md:   640-768px (Tablet)
lg:   768-1024px (Desktop pequeño)
xl:   1024-1280px (Desktop)
2xl:  1280px+   (Desktop grande)
```

## Animaciones

Todas las animaciones respetan `prefers-reduced-motion`:

- **Grupo expandible**: `expandHeight` (0.2s)
- **Drawer entrada**: `slideInFromBottom` (0.3s)
- **Overlay fade**: `fadeIn/fadeOut` (0.2s)
- **Range thumb hover**: `scale` (0.15s)
- **Badge pulse**: Infinito

Ver `filters.css` para más detalles.

## Accesibilidad

- ✅ Labels correctamente asociados con inputs
- ✅ ARIA attributes (`aria-expanded`, `aria-controls`)
- ✅ Navegación por teclado completa
- ✅ Focus management
- ✅ Color contrast WCAG AA
- ✅ Reducción de movimiento soportada

## Performance

Optimizaciones incluidas:

- **Debounce range sliders**: 300ms
- **Memoization**: Componentes puros con React.memo
- **useMemo**: Cálculo de activeFilterCount
- **Event delegation**: En SelectOption lists
- **CSS transitions**: Aceleradas por GPU

## Testing

Ejemplo de test para FilterRadioGroup:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import FilterRadioGroup from '@/components/filters/FilterRadioGroup'

describe('FilterRadioGroup', () => {
  it('should select option on click', () => {
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

    fireEvent.click(screen.getByRole('radio', { name: /sale/i }))
    expect(onChange).toHaveBeenCalledWith('sale')
  })
})
```

## Estilos Personalizados

Importa los estilos en tu componente principal:

```typescript
import '@/components/filters/filters.css'
```

O usa variables CSS para personalizar:

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

## Integración Paso a Paso

1. Copiar carpeta `filters/` a `components/`
2. Copiar `useFilters.ts` a `hooks/`
3. Importar en tu página principal
4. Conectar con estado y API
5. Testear responsive

Ver `FILTER_INTEGRATION_GUIDE.md` para más detalles.

## FAQ

**P: ¿Cómo agrego un nuevo filtro?**
R: Edita `FilterState` en `FilterPanel.tsx`, añade el control UI en el panel, y actualiza `useFilters.ts` para incluirlo en `toQueryParams()`.

**P: ¿Cómo cambio las opciones de Tipo de Propiedad?**
R: Edita la constante `PROPERTY_TYPES` en `FilterPanel.tsx`.

**P: ¿Cómo integro con Google Places API?**
R: En `FilterSearchBox.tsx`, reemplaza `MOCK_SUGGESTIONS` con llamadas a la API.

**P: ¿Por qué los filtros persisten?**
R: El hook `useFilters()` usa localStorage. Para deshabilitarlo, usa estado local.

**P: ¿Soporta URL shareable?**
R: Sí, usa `getShareableUrl()` del hook para generar URLs con parámetros.

## Archivos Relacionados

- `FILTER_PANEL_DESIGN.md` - Especificación completa
- `FILTER_INTEGRATION_GUIDE.md` - Guía de integración
- `FILTER_EXAMPLES.md` - Ejemplos de código
- `/hooks/useFilters.ts` - Hook de estado
