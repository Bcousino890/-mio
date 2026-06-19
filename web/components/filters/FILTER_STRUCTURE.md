# Estructura Visual del Filtro Mejorado "Particular | Agencia"

## Árbol de Opciones

```
FILTRO ADVERTISER (FilterAdvertiserSection)
│
├── 🔘 TODO (Radio seleccionado)
│   └── Muestra todos los anuncios sin restricción
│       Query: WHERE is_active = true
│
├── 🔘 PARTICULAR (Radio + expandible)
│   │
│   └── [Si se expande y está seleccionado]
│       ├── ☐ Sólo particulares
│       │   Query: WHERE advertiser_type = 'particular'
│       │
│       ├── ☐ Listado como privado por agencia (DISABLED - TODO: BD)
│       │   Query: WHERE advertiser_type = 'particular' 
│       │           AND is_private_by_agency = true
│       │
│       └── ☐ Ex-Listado como privado por agencia (DISABLED - TODO: BD)
│           Query: WHERE advertiser_type = 'particular'
│                   AND was_private_by_agency = true
│
└── 🔘 AGENCIAS (Radio + expandible)
    │
    └── [Si se expande y está seleccionado]
        ├── ☐ Con esta agencia
        │   │
        │   └── [Si se selecciona]
        │       ├── Dropdown selector de agencias
        │       └── Query: WHERE advertiser_type = 'professional'
        │                   AND advertiser_name = '${selected_agency}'
        │
        ├── 🔘 Exclusividad (Radio, solo visible si agencia seleccionada)
        │   ├── ◉ Ambos
        │   │   Query: WHERE exclusive IN (true, false)
        │   ├── ○ Sólo exclusivos
        │   │   Query: WHERE exclusive = true
        │   └── ○ Sólo no exclusivos
        │       Query: WHERE exclusive = false
        │
        └── ☐ Excluir esta agencia
            │
            └── [Si se selecciona]
                ├── Dropdown selector de agencias
                └── Query: WHERE advertiser_type = 'professional'
                            AND advertiser_name != '${excluded_agency}'
```

## Estados de la UI

### Estado Replegado (Inicial)

```
┌─ Tipo de Anunciante ─────────────────┬───┐
│ ⚫ Todo                               │   │
│ ⭕ Particular                        │ ▼ │
│ ⭕ Agencias                          │   │
└─────────────────────────────────────┴───┘
```

### Estado Expandido - Particular

```
┌─ Tipo de Anunciante ─────────────────┬───┐
│ ⚫ Todo                               │   │
│ ⭕ Particular                        │ ^ │
│    ☐ Sólo particulares              │   │
│    ☐ Listado como privado...        │   │
│    ☐ Ex-Listado como privado...     │   │
│ ⭕ Agencias                          │   │
└─────────────────────────────────────┴───┘
```

### Estado Expandido - Agencias

```
┌─ Tipo de Anunciante ─────────────────┬───┐
│ ⚫ Todo                               │   │
│ ⭕ Particular                        │   │
│ ⭕ Agencias                          │ ^ │
│    ☐ Con esta agencia               │   │
│       ▼ Seleccionar agencia         │   │
│       [Agencia A          ]          │   │
│       [Agencia B          ]          │   │
│       [Agencia C          ]          │   │
│                                      │   │
│    Exclusividad                     │   │
│    ◉ Ambos                          │   │
│    ○ Sólo exclusivos                │   │
│    ○ Sólo no exclusivos             │   │
│                                      │   │
│    ☐ Excluir esta agencia           │   │
│       ▼ Seleccionar agencia         │   │
│       [Agencia A          ]          │   │
│       [Agencia B          ]          │   │
│       [Agencia C          ]          │   │
└─────────────────────────────────────┴───┘
```

## Flujos de Interacción

### Flujo 1: Seleccionar "Particular"

```
Usuario hace click en radio "Particular"
    ↓
Se expande automáticamente la sección
    ↓
Se muestran checkboxes de opciones
    ↓
Usuario selecciona: "Sólo particulares" ✓
    ↓
Estado se actualiza en tiempo real
    ↓
Contador de filtros activos aumenta
    ↓
Usuario hace click en "Aplicar"
    ↓
Se genera URL: ?advertiser_mode=particular&only_particular=true
    ↓
Se navega o hace request a API
```

### Flujo 2: Seleccionar "Agencias"

```
Usuario hace click en radio "Agencias"
    ↓
Se expande automáticamente la sección
    ↓
Se muestran opciones de agencia + exclusividad
    ↓
Usuario selecciona checkbox "Con esta agencia"
    ↓
Se habilita dropdown de selección de agencias
    ↓
Usuario selecciona agencia: "Agencia X"
    ↓
Usuario selecciona: "Sólo exclusivos"
    ↓
Estado se actualiza:
  {
    mode: 'agency',
    agencyOptions: {
      agencyId: 'uuid-123',
      agencyName: 'Agencia X',
      exclusiveMode: 'only',
      excludeAgencyId: null
    }
  }
    ↓
Usuario hace click en "Aplicar"
    ↓
Se genera URL: ?advertiser_mode=agency&agency_id=uuid-123&exclusive_mode=only
    ↓
Request a API: /api/listings?advertiser_mode=agency&agency_id=uuid-123&...
```

### Flujo 3: Excluir Agencia

```
Usuario selecciona modo "Agencias"
    ↓
Checkboxes se muestran
    ↓
Usuario selecciona checkbox "Excluir esta agencia"
    ↓
Se habilita dropdown para seleccionar agencia a excluir
    ↓
Usuario selecciona: "Agencia Y"
    ↓
Estado se actualiza:
  {
    mode: 'agency',
    agencyOptions: {
      agencyId: null,
      agencyName: null,
      exclusiveMode: 'both',
      excludeAgencyId: 'uuid-456'
    }
  }
    ↓
URL: ?advertiser_mode=agency&exclude_agency_id=uuid-456
    ↓
Backend filtra: WHERE advertiser_name != 'Agencia Y'
```

## Combinaciones Válidas de Filtros

```
┌─────────────────────────────────────────────────────────────┬──────────────┐
│ COMBINACIÓN                                                 │ VÁLIDA       │
├─────────────────────────────────────────────────────────────┼──────────────┤
│ Mode: all                                                   │ ✓ Sí         │
├─────────────────────────────────────────────────────────────┼──────────────┤
│ Mode: particular                                            │ ✓ Sí         │
│ Mode: particular + onlyParticular                          │ ✓ Sí         │
│ Mode: particular + isPrivateByAgency                       │ ✓ Sí (futura)│
│ Mode: particular + wasPrivateByAgency                      │ ✓ Sí (futura)│
│ Mode: particular + múltiples opciones privadas            │ ✓ Sí (futura)│
├─────────────────────────────────────────────────────────────┼──────────────┤
│ Mode: agency                                                │ ✓ Sí         │
│ Mode: agency + agencyId                                    │ ✓ Sí         │
│ Mode: agency + agencyId + exclusiveMode                   │ ✓ Sí         │
│ Mode: agency + excludeAgencyId                             │ ✓ Sí         │
│ Mode: agency + agencyId + excludeAgencyId                 │ ✓ Sí         │
│ Mode: agency + exclusiveMode sin agencyId                 │ ? Parcial    │
└─────────────────────────────────────────────────────────────┴──────────────┘
```

## Estado TypeScript Completo

```typescript
interface AdvertiserFilterState {
  // Operador principal que determina el tipo de filtro
  mode: 'all' | 'particular' | 'agency'

  // Sub-opciones cuando mode === 'particular'
  particularOptions: {
    // Anuncios publicados directamente por el propietario
    onlyParticular: boolean
    
    // Anuncios que la agencia tiene listados como privados
    // (no visibles en portal público, solo para agencia)
    // TODO: Requiere columna BD is_private_by_agency
    isPrivateByAgency: boolean
    
    // Anuncios que FUERON listados privados pero ya no
    // TODO: Requiere columna BD was_private_by_agency
    wasPrivateByAgency: boolean
  }

  // Sub-opciones cuando mode === 'agency'
  agencyOptions: {
    // ID de la agencia seleccionada (del dropdown)
    agencyId: string | null
    
    // Nombre de la agencia para mostrar
    agencyName: string | null
    
    // Indicador binario (deprecated, usar exclusiveMode)
    exclusive: boolean
    
    // Tipo de exclusividad a filtrar
    // 'both': mostrar exclusivos Y no exclusivos
    // 'only': mostrar SOLO exclusivos
    // 'only_non': mostrar SOLO no exclusivos
    exclusiveMode: 'both' | 'only' | 'only_non'
    
    // ID de agencia a EXCLUIR de resultados
    // Útil para: "Mostrar todas EXCEPTO esta agencia"
    excludeAgencyId: string | null
  }
}
```

## Ejemplos de Queries Generadas

### Ejemplo 1: Todo
```sql
SELECT * FROM listings WHERE is_active = true
```
URL: `?advertiser_mode=all`

### Ejemplo 2: Solo Particulares
```sql
SELECT * FROM listings 
WHERE is_active = true 
  AND advertiser_type = 'particular'
```
URL: `?advertiser_mode=particular&only_particular=true`

### Ejemplo 3: Agencia Específica (Todos)
```sql
SELECT * FROM listings 
WHERE is_active = true 
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Agencia X'
```
URL: `?advertiser_mode=agency&agency_id=uuid-123`

### Ejemplo 4: Agencia Específica (Solo Exclusivos)
```sql
SELECT * FROM listings 
WHERE is_active = true 
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Agencia X'
  AND exclusive = true
```
URL: `?advertiser_mode=agency&agency_id=uuid-123&exclusive_mode=only`

### Ejemplo 5: Excluir Agencia
```sql
SELECT * FROM listings 
WHERE is_active = true 
  AND advertiser_type = 'professional'
  AND advertiser_name != 'Agencia Y'
```
URL: `?advertiser_mode=agency&exclude_agency_id=uuid-456`

### Ejemplo 6: Combinado (Agencia X + No Agencia Y)
```sql
SELECT * FROM listings 
WHERE is_active = true 
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Agencia X'
  AND advertiser_name != 'Agencia Y'
```
URL: `?advertiser_mode=agency&agency_id=uuid-123&exclude_agency_id=uuid-456`

## Componente Render

### Props que recibe
```typescript
interface FilterAdvertiserSectionProps {
  value: AdvertiserFilterState          // Estado actual
  onChange: (value: AdvertiserFilterState) => void  // Callback de cambio
  agencies: Agency[]                     // Lista de agencias cargadas
  isLoadingAgencies?: boolean            // Estado de carga
}
```

### Estructura JSX Simplificada
```tsx
<fieldset>
  <legend>Tipo de anunciante</legend>
  
  <div>
    <label>
      <input type="radio" name="mode" value="all" />
      Todo
    </label>
    
    <button onClick={expandParticular}>
      <input type="radio" name="mode" value="particular" />
      Particular
      <ChevronDown />
    </button>
    
    {expandedParticular && (
      <div>
        <label><input type="checkbox" /> Sólo particulares</label>
        <label disabled><input type="checkbox" disabled /> Privados</label>
      </div>
    )}
    
    <button onClick={expandAgency}>
      <input type="radio" name="mode" value="agency" />
      Agencias
      <ChevronDown />
    </button>
    
    {expandedAgency && (
      <div>
        <label><input type="checkbox" /> Con esta agencia</label>
        {agencyCheckboxSelected && <select>{agencies}</select>}
        
        <div>
          <label><input type="radio" /> Ambos</label>
          <label><input type="radio" /> Sólo exclusivos</label>
          <label><input type="radio" /> Sólo no exclusivos</label>
        </div>
        
        <label><input type="checkbox" /> Excluir esta agencia</label>
        {excludeCheckboxSelected && <select>{agencies}</select>}
      </div>
    )}
  </div>
</fieldset>
```

## Lógica de Habilitación/Deshabilitación

```
Mode: 'all'
├── Particular: ✓ VISIBLE (puede clickear)
├── Agencias: ✓ VISIBLE (puede clickear)

Mode: 'particular'
├── Particular sub-opciones: ✓ VISIBLE
│   ├── onlyParticular: ✓ ENABLED
│   ├── isPrivateByAgency: ✗ DISABLED (falta BD)
│   └── wasPrivateByAgency: ✗ DISABLED (falta BD)
├── Agencias sub-opciones: ✗ OCULTO

Mode: 'agency'
├── Particular sub-opciones: ✗ OCULTO
├── Agencias sub-opciones: ✓ VISIBLE
│   ├── Con esta agencia: ✓ ENABLED
│   │   └── Dropdown: [depende de checkbox]
│   ├── Exclusividad: ✓ ENABLED
│   └── Excluir agencia: ✓ ENABLED
│       └── Dropdown: [depende de checkbox]
```

## Performance y Optimización

```
LocalStorage
    ↓
State cacheado en memoria
    ↓
URL Params (compartible)
    ↓
API Request (backend filtra)
    ↓
Resultados cacheados

Ventajas:
- No necesita estado de servidor
- Búsquedas compartibles por URL
- Estados persistentes entre sesiones
- Bajo overhead de requests
```
