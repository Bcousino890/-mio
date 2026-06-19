# Panel de Filtros Elaborado y Responsive - Casafari

## 1. WIREFRAME DESKTOP (Panel Lateral)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HEADER (sticky)                                  │
│  Search | Op | Adv | Drops | [Más filtros ▼] | Sort | [Map] [List] │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────────────────────────────────┐
│  FILTER PANEL    │  │        PROPERTY CARDS (responsive grid)      │
│  (Lateral 360px) │  │   ┌────────┐  ┌────────┐  ┌────────┐         │
│                  │  │   │  Card  │  │  Card  │  │  Card  │         │
│ [Restablecer]    │  │   │        │  │        │  │        │         │
│ [Aplicar]        │  │   └────────┘  └────────┘  └────────┘         │
│                  │  │   ┌────────┐  ┌────────┐  ┌────────┐         │
│ ━ OPERACIÓN      │  │   │  Card  │  │  Card  │  │  Card  │         │
│   ◉ Todo        │  │   │        │  │        │  │        │         │
│   ○ Venta       │  │   └────────┘  └────────┘  └────────┘         │
│   ○ Alquiler    │  │                                               │
│                  │  │         < Anterior | Pág. 1 de 10 | Siguiente >│
│ ━ PARTICULAR/AGE │  └──────────────────────────────────────────────┘
│   [☐ Todo]      │
│   [☑ Agencia]   │
│   [☐ Particular]│
│                  │
│ ━ TIPO VIVIENDA  │
│   [☑] Piso      │
│   [☐] Ático     │
│   [☐] Chalet    │
│   [☐] Dúplex    │
│                  │
│ ━ PRECIO (€)    │
│   MIN: [______]  │
│   MAX: [______]  │
│   ▬▬▬▬▬●▬▬▬▬▬   │
│                  │
│ ━ DORMITORIOS    │
│   MIN: [0+    ▼] │
│   MAX: [5+    ▼] │
│                  │
│ ━ BAÑOS          │
│   MIN: [1+    ▼] │
│   MAX: [4+    ▼] │
│                  │
│ ━ SUPERFICIE (m²)│
│   MIN: [______]  │
│   MAX: [______]  │
│   ▬▬▬●▬▬▬▬▬▬▬   │
│                  │
│ ━ PRECIO/m²     │
│   MIN: [______]  │
│   MAX: [______]  │
│                  │
│ ▼ UBICACIÓN      │
│   🔍 [Búsqueda] │
│   [Mapa (click)] │
│                  │
│ ▼ DETALLES ADV.  │
│   Piso/Planta:   │
│   [Cualquiera ▼] │
│                  │
│   Vista:         │
│   [Seleccionar▼] │
│                  │
│   Orientación:   │
│   [Seleccionar▼] │
│                  │
│   ☑ Muebles      │
│   ☐ Ascensor     │
│   ☑ Balcón       │
│                  │
│   Energética:    │
│   ○ A ○ B ○ C   │
│   ○ D ○ E ○ F   │
│                  │
│   Año construc.: │
│   MIN [____] MAX [____]
│                  │
│ ▼ LOCALIZACIÓN   │
│   📍 Zona:       │
│   [Centro     ▼] │
│                  │
│   Distancia:     │
│   [____ km]      │
│                  │
│ ▼ AVANZADO       │
│   Días mercado:  │
│   MIN [____] MAX [____]
│                  │
│   Parcela (m²):  │
│   MIN [____] MAX [____]
│                  │
│ [   Restablecer    ] │
│ [     Aplicar      ] │
└──────────────────┘
```

## 2. WIREFRAME MOBILE (Drawer/Modal)

```
┌─────────────────────────────┐
│ ✕  Filtros avanzados   [x]  │  ← Header sticky
├─────────────────────────────┤
│ Scroll area (full viewport) │
│                             │
│ ━ OPERACIÓN                 │
│   ◉ Todo                    │
│   ○ Venta                   │
│   ○ Alquiler                │
│                             │
│ ━ PARTICULAR/AGENCIA        │
│   [☐] Todo                  │
│   [☑] Agencia               │
│   [☐] Particular            │
│                             │
│ ━ TIPO VIVIENDA             │
│   [☑] Piso                  │
│   [☐] Ático                 │
│   [☐] Chalet                │
│   [☐] Dúplex                │
│   [☐] Estudio               │
│   [☐] Loft                  │
│                             │
│ ━ PRECIO (€)                │
│   MIN [______] MAX [______] │
│   ▬▬▬●▬▬▬▬▬▬▬          │
│                             │
│ ━ DORMITORIOS               │
│   MIN [0+    ▼]             │
│                             │
│ ━ BAÑOS                     │
│   MIN [1+    ▼]             │
│                             │
│ ... (rest of filters)       │
│                             │
├─────────────────────────────┤
│ [Restablecer] [Aplicar (5)] │  ← Footer sticky
└─────────────────────────────┘
```

## 3. Estructura de Componentes

### 3.1 Componentes Principales

```
FiltersPanel (Nuevo)
├── FilterHeader
│   ├── Título + Contador
│   └── Botón Cerrar (mobile)
├── FilterGroupSection
│   ├── FilterGroupToggle (▼ Nombre)
│   └── FilterGroupContent (animated)
│       ├── FilterRadioGroup
│       ├── FilterCheckboxGroup
│       ├── FilterRangeSlider
│       ├── FilterSelect
│       ├── FilterSearch
│       └── FilterMap
└── FilterFooter
    ├── ClearFiltersButton
    ├── ApplyButton
    └── FilterCountBadge
```

### 3.2 Componentes de Filtro Individual

```
FilterRadioGroup
  Props: label, options, value, onChange

FilterCheckboxGroup
  Props: label, options, values, onChange

FilterRangeSlider
  Props: label, min, max, step, onChange, showInputs

FilterSelect
  Props: label, placeholder, options, value, onChange

FilterSearchBox
  Props: placeholder, onSearch, suggestions

FilterMapPicker
  Props: onLocationChange, center, zoom
```

## 4. Estado Global (Redux/Context)

### 4.1 Estructura de Estado

```typescript
type FilterState = {
  // Filtros principales
  operation: 'all' | 'sale' | 'rent'
  advertiserType: 'all' | 'particular' | 'professional'
  propertyTypes: string[]  // ['piso', 'atico', 'chalet']
  
  // Rangos numéricos
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
  characteristics: string[]  // ['balcon', 'ascensor', 'garaje']
  
  // Ubicación
  location: string | null
  coordinates: { lat: number; lng: number } | null
  distance: number | null
  
  // UI
  isDrawerOpen: boolean
  expandedGroups: Set<string>
  activeFilterCount: number
}

type FilterActions = {
  setOperation: (op: Operation) => void
  setAdvertiserType: (type: AdvertiserFilter) => void
  setPropertyTypes: (types: string[]) => void
  setPriceRange: (min: number | null, max: number | null) => void
  // ... más setters
  clearAllFilters: () => void
  toggleFilterGroup: (groupId: string) => void
  openFilterDrawer: () => void
  closeFilterDrawer: () => void
}
```

### 4.2 Implementación con Redux Toolkit

```typescript
// filterSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

const initialState: FilterState = {
  operation: 'all',
  advertiserType: 'all',
  propertyTypes: [],
  price: { min: null, max: null },
  // ... more fields
  isDrawerOpen: false,
  expandedGroups: new Set(),
  activeFilterCount: 0,
}

const filterSlice = createSlice({
  name: 'filters',
  initialState,
  reducers: {
    setOperation: (state, action: PayloadAction<Operation>) => {
      state.operation = action.payload
      state.activeFilterCount = calculateActiveFilters(state)
    },
    setPriceRange: (state, action: PayloadAction<{ min: number | null; max: number | null }>) => {
      state.price = action.payload
      state.activeFilterCount = calculateActiveFilters(state)
    },
    togglePropertyType: (state, action: PayloadAction<string>) => {
      const idx = state.propertyTypes.indexOf(action.payload)
      if (idx > -1) state.propertyTypes.splice(idx, 1)
      else state.propertyTypes.push(action.payload)
      state.activeFilterCount = calculateActiveFilters(state)
    },
    clearAllFilters: (state) => {
      Object.assign(state, initialState)
    },
    toggleFilterGroup: (state, action: PayloadAction<string>) => {
      if (state.expandedGroups.has(action.payload)) {
        state.expandedGroups.delete(action.payload)
      } else {
        state.expandedGroups.add(action.payload)
      }
    },
    openFilterDrawer: (state) => {
      state.isDrawerOpen = true
    },
    closeFilterDrawer: (state) => {
      state.isDrawerOpen = false
    },
  },
})

export const { setOperation, setPriceRange, togglePropertyType, clearAllFilters, toggleFilterGroup } = filterSlice.actions
export default filterSlice.reducer
```

## 5. Responsive Breakpoints

```typescript
const BREAKPOINTS = {
  xs: 0,      // Mobile portrait (320px)
  sm: 640,    // Mobile landscape (640px)
  md: 768,    // Tablet (768px)
  lg: 1024,   // Desktop small (1024px)
  xl: 1280,   // Desktop large (1280px)
  '2xl': 1536 // Desktop XL (1536px)
}

// Panel Filters
// xs/sm: Drawer (fullscreen o bottom-sheet)
// md+:   Sidebar lateral (360px fixed)

// Grid de Cards
// xs: 1 col
// sm: 2 cols
// md: 2 cols (con map)
// lg: 3 cols (sin map)
// xl: 3 cols (sin map)

// Layout
// xs/sm: Stack vertical (cards encima de map/lista)
// md+:   Side-by-side (map + cards)
```

## 6. Animaciones y Transiciones

```typescript
// Expanding/Collapsing Filter Groups
const groupAnimation = {
  initial: { opacity: 0, height: 0, marginTop: 0 },
  animate: { opacity: 1, height: 'auto', marginTop: 16 },
  exit: { opacity: 0, height: 0, marginTop: 0 },
  transition: { duration: 0.2, ease: 'easeInOut' }
}

// Drawer modal entrada
const drawerAnimation = {
  initial: { x: '-100%', opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '-100%', opacity: 0 },
  transition: { duration: 0.3, ease: 'easeOut' }
}

// Range slider thumb
const thumbAnimation = {
  whileHover: { scale: 1.2, transition: { duration: 0.1 } }
}

// Filter badge count pulse
const badgePulse = {
  animate: { scale: [1, 1.1, 1], transition: { duration: 2, repeat: Infinity } }
}
```

## 7. Características Avanzadas

### 7.1 Search con Autocomplete
```typescript
interface LocationSuggestion {
  name: string
  type: 'neighborhood' | 'street' | 'city'
  coordinates?: [number, number]
  popularity?: number
}

// Integración con Nominatim/Google Places API
```

### 7.2 Mapa Interactivo
```typescript
// Click-to-filter: seleccionar zona en mapa
// Radius filter: círculo de distancia
// Polygon selection: dibuja zona personalizada
// Mostrar heatmap de densidad de propiedades
```

### 7.3 Historial de Filtros
```typescript
// Guardar últimos 5 combinaciones de filtros
// LocalStorage: JSON stringified FilterState
// Botón "Filtros recientes" en panel
```

### 7.4 Comparador de Filtros
```typescript
// Comparar 2-3 combinaciones de filtros
// Ver diferencias en resultados
// Cambiar entre ellos con tabs
```

## 8. Persistencia

```typescript
// LocalStorage
const STORAGE_KEYS = {
  FILTERS: 'casafari:filters:current',
  FILTER_HISTORY: 'casafari:filters:history',
  FILTER_PRESETS: 'casafari:filters:presets'
}

// URL Params (shareable links)
// /anuncios?operation=rent&price_min=1000&price_max=2000&...
```

## 9. Performance

- Debounce range sliders (300ms)
- Memoize FilterGroup components
- Lazy load advanced sections
- Virtual scroll para listas largas (checkboxes/selects)
- React.memo para componentes puros
- useMemo para cálculo de activeFilterCount

## 10. Accesibilidad

```
- ARIA labels en todos los inputs
- Navegación con teclado (Tab, Space, Enter, Esc)
- Focus management para modales
- Color contrast WCAG AA
- Reducción de movimiento (prefers-reduced-motion)
```

## 11. Testing

```typescript
// Unit tests para cada FilterComponent
// Integration tests para FilterPanel + Estado
// E2E tests: aplicar filtros, verificar resultados
// Snapshot tests para estructura HTML
```
