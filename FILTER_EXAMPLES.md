# Ejemplos de Uso - Panel de Filtros

## 1. Ejemplo Básico: Usar el Hook

```typescript
import { useFilters } from '@/hooks/useFilters'

export default function MyComponent() {
  const { filters, updateFilters, clearFilters } = useFilters()

  return (
    <div>
      <p>Operación: {filters.operation}</p>
      <p>Precio: {filters.price.min} - {filters.price.max}</p>

      <button
        onClick={() => updateFilters({ operation: 'sale' })}
      >
        Filtrar por Venta
      </button>

      <button onClick={clearFilters}>Limpiar todo</button>
    </div>
  )
}
```

## 2. Integración en AnunciosClient.tsx (Simplificada)

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import FilterPanel from '@/components/filters/FilterPanel'
import { useFilters } from '@/hooks/useFilters'

const PAGE_SIZE = 30

export default function AnunciosClient() {
  const [listings, setListings] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showFiltersPanel, setShowFiltersPanel] = useState(false)

  // Usar el hook de filtros
  const { filters, updateFilters, clearFilters, toQueryParams } = useFilters()

  // Calcular contador de filtros activos
  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== null && (typeof v === 'boolean' || (typeof v === 'object' && Object.values(v).some(x => x !== null)) || (Array.isArray(v) && v.length > 0))
  ).length

  // Fetch de anuncios cuando cambian los filtros o página
  useEffect(() => {
    const controller = new AbortController()
    
    const fetchListings = async () => {
      try {
        setLoading(true)
        
        // Obtener parámetros de filtros
        const params = toQueryParams()
        params.set('page', String(page))
        params.set('page_size', String(PAGE_SIZE))
        params.set('sort', 'recent')
        
        const response = await fetch(`/api/listings?${params.toString()}`, {
          signal: controller.signal
        })
        
        if (!response.ok) throw new Error('Error fetching listings')
        
        const result = await response.json()
        setListings(result.data || [])
        setTotal(result.total || 0)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Error:', err)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchListings()
    return () => controller.abort()
  }, [filters, page, toQueryParams])

  // Handlers
  const handleApplyFilters = useCallback(() => {
    setPage(1) // Reset a primera página
    setShowFiltersPanel(false)
  }, [])

  const handleClearFilters = useCallback(() => {
    clearFilters()
    setPage(1)
    setShowFiltersPanel(false)
  }, [])

  return (
    <div className="flex flex-col h-full bg-[var(--c-bg)]">
      {/* Header con filtros rápidos */}
      <header className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-[var(--c-border)]">
        {/* Botón Más filtros (mobile) */}
        <button
          onClick={() => setShowFiltersPanel(true)}
          className={`flex md:hidden items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            activeFilterCount > 0
              ? 'bg-blue-950/60 border-blue-800/40 text-blue-400'
              : 'bg-[var(--c-card)] border-[var(--c-border-card)] text-slate-600'
          }`}
        >
          Más filtros
          {activeFilterCount > 0 && (
            <span className="text-[10px] bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Otros elementos del header... */}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Panel lateral (desktop) */}
        <div className="hidden md:flex md:w-80 md:flex-col border-r border-[var(--c-border)]">
          <FilterPanel
            filters={filters}
            onFilterChange={updateFilters}
            onApply={handleApplyFilters}
            onClear={handleClearFilters}
            isOpen={true}
            onClose={() => {}}
          />
        </div>

        {/* Drawer modal (mobile) */}
        {showFiltersPanel && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setShowFiltersPanel(false)}
            />
            <div className="fixed bottom-0 left-0 right-0 h-[85vh] z-50 md:hidden">
              <FilterPanel
                filters={filters}
                onFilterChange={updateFilters}
                onApply={handleApplyFilters}
                onClear={handleClearFilters}
                isOpen={showFiltersPanel}
                onClose={() => setShowFiltersPanel(false)}
              />
            </div>
          </>
        )}

        {/* Lista de propiedades */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Contador */}
          <div className="flex-none px-4 py-2 border-b border-[var(--c-border)]">
            <p className="text-xs text-slate-500">
              {total > 0 ? (
                <>
                  Mostrando <span className="font-semibold text-slate-300">{(page - 1) * PAGE_SIZE + 1}</span> a{' '}
                  <span className="font-semibold text-slate-300">{Math.min(page * PAGE_SIZE, total)}</span> de{' '}
                  <span className="text-slate-400">{total}</span> anuncios
                </>
              ) : (
                'Sin resultados'
              )}
            </p>
          </div>

          {/* Grid de cards */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-slate-500">Cargando...</p>
              </div>
            ) : listings.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-slate-500">No hay resultados</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {listings.map((listing) => (
                  <PropertyCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </div>

          {/* Paginación */}
          <div className="flex-none flex items-center justify-center gap-3 px-4 py-3 border-t border-[var(--c-border)]">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-30"
            >
              Anterior
            </button>
            <span className="text-xs text-slate-500">Página {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={listings.length < PAGE_SIZE}
              className="px-3 py-1.5 text-xs border rounded-lg disabled:opacity-30"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

## 3. Ejemplo: Filtros por Defecto

```typescript
export default function SearchPage() {
  // Inicializar con filtros por defecto
  const { filters, updateFilters } = useFilters({
    operation: 'rent',
    price: { min: 500, max: 2000 },
    bedrooms: { min: 1, max: 3 },
  })

  return (
    <FilterPanel
      filters={filters}
      onFilterChange={updateFilters}
      onApply={() => {}}
      onClear={() => {}}
      isOpen={true}
      onClose={() => {}}
    />
  )
}
```

## 4. Ejemplo: Cargar Filtros desde URL

```typescript
'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useFilters } from '@/hooks/useFilters'

export default function SearchResults() {
  const searchParams = useSearchParams()
  const { loadFromQueryParams, filters } = useFilters()

  // Cargar filtros desde URL
  useEffect(() => {
    loadFromQueryParams(searchParams)
  }, [searchParams])

  // URL como: /anuncios?operation=sale&price_min=100000&price_max=500000

  return <p>Buscando: {filters.operation}</p>
}
```

## 5. Ejemplo: Generar URL Shareable

```typescript
import { useFilters } from '@/hooks/useFilters'

export default function ShareFiltersButton() {
  const { getShareableUrl } = useFilters()

  const handleShare = () => {
    const url = getShareableUrl('https://casafari.com/anuncios')
    navigator.clipboard.writeText(url)
    alert('URL copiada al portapapeles!')
  }

  return <button onClick={handleShare}>Compartir búsqueda</button>
}
```

## 6. Visualización del Estado de Filtros

```typescript
import { useFilters } from '@/hooks/useFilters'

export default function FilterDebugger() {
  const { filters, toQueryParams } = useFilters()

  return (
    <div className="p-4 bg-slate-900 text-slate-300 text-xs font-mono rounded-lg">
      <h3 className="mb-2 font-bold">Estado actual de filtros:</h3>
      <pre>{JSON.stringify(filters, null, 2)}</pre>

      <h3 className="mt-4 mb-2 font-bold">Query params:</h3>
      <pre>{toQueryParams().toString()}</pre>
    </div>
  )
}
```

## 7. Flujo de Aplicación de Filtros

```
Usuario abre AnunciosClient
│
├─ Hook useFilters() carga filtros del localStorage
│
├─ Panel muestra en lateral (desktop) o botón (mobile)
│
├─ Usuario hace cambios en filtros
│  └─ updateFilters() actualiza estado local
│     └─ Cambios se guardan en localStorage
│
├─ Usuario hace clic en "Aplicar"
│  └─ handleApplyFilters()
│     └─ Reset página a 1
│     └─ Cierra drawer en mobile
│
├─ useEffect detects filtros cambió
│  └─ toQueryParams() genera URL params
│  └─ fetch(`/api/listings?${params}`)
│
├─ Backend devuelve resultados filtrados
│  └─ setListings(data)
│  └─ Render grid actualizado
│
└─ Usuario ve resultados filtrados
```

## 8. Tipos de Filtros en Acción

### Radio Buttons (Operación)
```
┌─────────────────────┐
│ ◉ Todas             │
│ ○ Venta             │
│ ○ Alquiler          │
└─────────────────────┘
```

### Checkboxes (Tipo de propiedad)
```
┌─────────────────────┐
│ ☑ Piso    ☐ Ático   │
│ ☑ Chalet  ☐ Dúplex  │
│ ☐ Estudio ☐ Loft    │
└─────────────────────┘
```

### Range Slider (Precio)
```
┌─────────────────────┐
│ Precio (€)          │
│ ▬▬▬●▬▬▬▬▬▬▬      │
│ MIN [100000]        │
│ MAX [500000]        │
│ 100.000 € — 500.000 €
└─────────────────────┘
```

### Select (Piso/Planta)
```
┌─────────────────────┐
│ [Cualquiera      ▼] │
│ [Planta baja     ]  │
│ [Entresuelo      ]  │
│ [1º piso         ]  │
│ [2º+ piso        ]  │
└─────────────────────┘
```

### Search Box (Ubicación)
```
┌─────────────────────┐
│ 🔍 Buscar zona... │
│ ┌─────────────────┐ │
│ │ Centro          │ │
│ │ Salamanca       │ │
│ │ Gran Vía        │ │
│ └─────────────────┘ │
└─────────────────────┘
```

## 9. Respuesta de API Esperada

```json
{
  "success": true,
  "data": [
    {
      "id": "prop-1",
      "title": "Piso en Centro, Madrid",
      "operation": "sale",
      "price": 350000,
      "square_meters": 120,
      "price_sqm": 2916,
      "bedrooms": 3,
      "bathrooms": 2,
      "zone_name": "Centro",
      "advertiser_type": "professional",
      "photos": ["url1", "url2"],
      "days_on_market": 15
    }
  ],
  "total": 1250,
  "total_pages": 42,
  "page": 1,
  "page_size": 30
}
```

## 10. Adaptabilidad Responsive

### Desktop (lg+)
```
┌────────────────────────────────┬──────────────────────────┐
│ [Filtros]                      │ Cards 3x3                │
│ Lateral 360px                  │ Sidebar fijo             │
│                                │                          │
│ ━ Operación                    │ ┌──┐ ┌──┐ ┌──┐          │
│ ━ Tipo Propiedad               │ │  │ │  │ │  │          │
│ ━ Precio                       │ └──┘ └──┘ └──┘          │
│ ━ Dormitorios                  │ ┌──┐ ┌──┐ ┌──┐          │
│ [Limpiar] [Aplicar]            │ │  │ │  │ │  │          │
│                                │ └──┘ └──┘ └──┘          │
└────────────────────────────────┴──────────────────────────┘
```

### Mobile (xs/sm)
```
┌──────────────────────────────┐
│ [Más filtros ▼] | Op | Adv   │ ← Header fijo
├──────────────────────────────┤
│ Cards 2x2                    │
│ ┌──────┐ ┌──────┐           │
│ │      │ │      │           │
│ └──────┘ └──────┘           │
│ ┌──────┐ ┌──────┐           │
│ │      │ │      │           │
│ └──────┘ └──────┘           │
└──────────────────────────────┘
        ▼
  [Drawer sube]
┌──────────────────────────────┐
│ ✕ Filtros avanzados (5)      │
├──────────────────────────────┤
│ ━ Operación                  │
│   ◉ Todas                    │
│   ○ Venta                    │
│   ○ Alquiler                 │
│ ━ Tipo Propiedad             │
│   [✓] Piso                   │
│   [✓] Chalet                 │
│   [ ] Dúplex                 │
│ ━ Precio (€)                 │
│   [100000] — [500000]        │
│ ▬▬▬●▬▬▬▬▬▬▬              │
│                              │
│ ... más secciones ...        │
├──────────────────────────────┤
│ [Limpiar] [Aplicar (5)]      │
└──────────────────────────────┘
```

## 11. Transiciones y Animaciones

```typescript
// Grupo colapsable
const groupAnimation = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.2 }
}

// Drawer entrada
const drawerAnimation = {
  initial: { y: '100%', opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: '100%', opacity: 0 },
  transition: { duration: 0.3, ease: 'easeOut' }
}

// Range slider thumb hover
const thumbHover = {
  scale: 1.2,
  boxShadow: '0 0 12px rgba(59, 130, 246, 0.6)'
}
```

## 12. Estados Especiales

### Sin resultados
```
┌────────────────────────────┐
│ 🎯                         │
│ No hay resultados          │
│ Ajusta los filtros para    │
│ ver más anuncios           │
│                            │
│ [← Volver] [Limpiar]       │
└────────────────────────────┘
```

### Cargando
```
┌────────────────────────────┐
│ ⏳                         │
│ Cargando anuncios...       │
│                            │
│ [Animación de carga]       │
└────────────────────────────┘
```

### Con muchos filtros aplicados
```
┌──────────────────────────────┐
│ [Más filtros (12)] | Op | Adv │
│ Filtros aplicados:           │
│ [Venta] [Piso] [300k-600k]   │
│ [Madrid] [2+ hab] [Ascensor] │
│ [Limpiar filtros]            │
└──────────────────────────────┘
```
