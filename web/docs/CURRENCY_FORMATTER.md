# Diferenciación Visual UF vs CLP en Catastro

## Resumen

Se implementó un sistema de diferenciación visual entre Unidades de Fomento (UF) y pesos chilenos (CLP) en la tabla de roles del módulo de Catastro Chile (`web/app/chile/catastro/page.tsx`).

## Cambios Implementados

### 1. Nuevo módulo de utilidades: `web/lib/currency-formatter.ts`

Contiene funciones para:
- **`formatCLP(value)`** - Formatea valores en pesos CLP (ej: "$50.000" o "$50M")
- **`formatUF(value, decimals)`** - Formatea valores en UF (ej: "50,00 UF")
- **`clpToUF(clpValue)`** - Convierte CLP a UF
- **`ufToCLP(ufValue)`** - Convierte UF a CLP
- **`getUFValue()`** - Retorna el valor actual de UF desde variable de entorno
- **`formatCurrency(value, decimalsUF)`** - Retorna objeto con ambos formatos
- **`formatCurrencyDual(value, displayUF)`** - Retorna string con formato primario

### 2. Actualización de `web/app/chile/catastro/page.tsx`

#### Cambios de imports:
- Añadido `Toggle2` de lucide-react para el botón del toggle
- Importado funciones del nuevo módulo `currency-formatter`

#### Estado global:
- Nuevo estado `showUF` para controlar la visualización de UF vs CLP
- Inicializado en `false` (por defecto muestra CLP)

#### Helpers de renderizado:
- **`renderCurrency(value)`** - Renderiza valor en formato único (CLP o UF según estado)
- **`renderCurrencyDual(value)`** - Renderiza valor con ambas unidades (principal + secundaria)

#### UI Components:
- **Toggle button** en la sección de "Roles count" que permite cambiar entre CLP y UF
- Botón muestra:
  - Fondo gris/slate cuando está en CLP
  - Fondo azul cuando está en UF
  - Tooltip con valor actual de UF en CLP

#### Áreas afectadas:
1. **Tabla de roles** (línea 523-547)
   - Columna "Avalúo" cambia color: gris → azul al cambiar a UF
   - Valor se actualiza en tiempo real

2. **Panel de detalle de rol** - Sección "Avalúos fiscales" (línea 391-408)
   - Muestra dos líneas: valor principal en grande + valor secundario en gris pequeño
   - Primario cambia color según el modo (gris CLP / azul UF)

3. **Lista de unidades del edificio** (línea 482-502)
   - Mismo comportamiento que tabla principal
   - Color cambia según visualización activa

### 3. Configuración: `web/.env.example`

Añadida variable:
```
UF_VALUE=36500
```

- Define el valor de UF en CLP
- Por defecto: 36.500 CLP (valor aproximado 2024-2025)
- Configurable según actualización del SII

## Características Visuales

### Modo CLP (por defecto)
```
Toggle: "CLP" (gris)
Tabla: "$ 50.000.000" (gris)
Detalle: 
  $ 50.000.000
  50 UF             (gris pequeño)
```

### Modo UF
```
Toggle: "UF" (azul)
Tabla: "50 UF" (azul)
Detalle:
  50 UF             (azul)
  $ 50.000.000      (gris pequeño)
```

## Localización

- Formatos usan `'es-CL'` para separadores de miles
- Valores monetarios usan punto (.) para separador de miles y coma (,) para decimales en formato UF

## Ejemplo de uso en componentes

```tsx
// Renderizar moneda en formato único (cambia según toggle)
<td>{renderCurrency(rolData.avaluo_fiscal_total)}</td>

// Renderizar moneda con ambas unidades
<div>{renderCurrencyDual(rolData.avaluo_exento)}</div>

// Acceder al valor de UF actual
const ufValue = getUFValue(); // 36500
```

## Archivos Modificados

1. `/web/app/chile/catastro/page.tsx` - Lógica de UI y componentes
2. `/web/lib/currency-formatter.ts` - Nuevo módulo (creado)
3. `/.env.example` - Variables de entorno

## Notas de Desarrollo

- El toggle está disponible globalmente para toda la tabla
- El estado se persiste mientras el usuario está en la página
- No se guarda en localStorage (se reinicia al recargar la página)
- El valor de UF se puede actualizar fácilmente via variable de entorno
- La conversión es en tiempo real: no requiere llamadas API adicionales
