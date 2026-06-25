# PRC Zonificación — Guía de Implementación

**Fecha**: Junio 2026  
**Alcance**: Cargar zonas de regulación (PRC) para Vitacura, Las Condes, Lo Barnechea, Colina, Providencia  
**Fuente de datos**: Manual (hardcoded) + ArcGIS services (future)  
**Status**: 🟢 Listo para implementar

---

## Visión General

Enriquecer cada predio SII con su zona de regulación catastral y normativas asociadas:
- Altura máxima permitida
- Densidad de viviendas/ha
- Usos de suelo permitidos/prohibidos
- FAR / FOS

```
sii_roles_cl (9.4M predios)
    ↓ (ST_Intersects con geometría)
prc_zonas (zonas de cada comuna)
    ↓ (enriquecimiento)
Análisis de mercado por zona + Normativas para inversores
```

---

## Arquitectura

### 1. Tabla `prc_zonas` (Migración 0037)

```sql
CREATE TABLE prc_zonas (
  id uuid PRIMARY KEY,
  sii_comuna_code text,           -- "13132" = Vitacura
  zona_nombre text,               -- "Zona 2 Condominios"
  altura_maxima_m int,
  densidad_viviendas_ha int,
  usos_permitidos text[],
  geom geometry(MultiPolygon, 4326),
  ...
);
```

### 2. Enriquecimiento de `sii_roles_cl`

```sql
ALTER TABLE sii_roles_cl ADD COLUMN prc_zona_id uuid;
ALTER TABLE sii_roles_cl ADD COLUMN prc_zona_nombre text;
ALTER TABLE sii_roles_cl ADD COLUMN prc_altura_maxima_m int;
-- ...
```

### 3. Funciones SQL

- `populate_prc_zona_for_rol()` — Asignar zona a un rol específico
- `populate_prc_zonas_for_comuna()` — Batch update para toda una comuna

---

## Pasos de Implementación

### Paso 1: Ejecutar migración

```bash
psql $DATABASE_URL -f db/migrations/0037_zonificacion_prc.sql
```

✅ Crea:
- Tabla `prc_zonas`
- Columnas en `sii_roles_cl`
- Funciones SQL para population

---

### Paso 2: Cargar datos de zonas

#### Opción A: Desde línea de comandos (recomendado)

```bash
# Cargar todas las 5 comunas
node scraper/load-prc-zonas.mjs --all

# + asignar automáticamente a roles SII
node scraper/load-prc-zonas.mjs --all --populate
```

#### Opción B: Una comuna a la vez

```bash
node scraper/load-prc-zonas.mjs --comuna vitacura --populate
node scraper/load-prc-zonas.mjs --comuna lascondes --populate
```

**Output esperado:**
```
📍 Insertando 3 zonas para Vitacura (13132)
  ✅ Zona 1 - Residencial Unifamiliar
  ✅ Zona 2 - Condominios Cerrados
  ✅ Zona 3 - Mixta

🔄 Asignando zonas a roles de 13132...
✅ Actualizados 2847 roles con zonas

✨ Insertadas 3/3 zonas
```

---

### Paso 3: Verificar población

```sql
-- Cuántos roles tienen zona asignada por comuna
SELECT
  sii_comuna_code,
  COUNT(*) AS total_roles,
  COUNT(prc_zona_id) AS roles_con_zona,
  ROUND(100.0 * COUNT(prc_zona_id) / COUNT(*), 1) AS cobertura_pct
FROM sii_roles_cl
WHERE sii_comuna_code IN ('13132', '13114', '13115', '13301', '13123')
GROUP BY sii_comuna_code
ORDER BY sii_comuna_code;
```

**Esperado:**
```
 sii_comuna_code | total_roles | roles_con_zona | cobertura_pct
-----------------+-------------+----------------+---------------
 13114           |        4521 |           4521 |         100.0
 13115           |        2156 |           2156 |         100.0
 13123           |        3847 |           3847 |         100.0
 13132           |        2847 |           2847 |         100.0
 13301           |        1892 |           1892 |         100.0
(5 rows)
```

---

### Paso 4: APIs disponibles

#### `GET /api/chile/prc-zona`

Obtener zona + normativas de un rol:

```bash
curl "http://localhost:3000/api/chile/prc-zona?rol=795-198&comuna=13132"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rol": {
      "rol": "795-198",
      "direccion": "Apoquindo 3600",
      "avaluo_fiscal_total": 250000000,
      "superficie_construida_total_m2": 450
    },
    "prc_zona": {
      "nombre": "Zona 2 Condominios Cerrados",
      "codigo": "C2",
      "normativas": {
        "altura_maxima_m": 45,
        "numero_pisos_maximo": 12,
        "densidad_viviendas_ha": 350,
        "fos_maximo": 0.65,
        "far_maximo": 2.1
      },
      "usos": {
        "permitidos": ["H", "C", "D", "O"],
        "prohibidos": ["I", "M", "A"]
      }
    }
  }
}
```

#### `GET /api/chile/prc-zona?lat=-33.37&lng=-70.54&comuna=13132`

Obtener zona por coordenadas (punto-in-polygon):

```bash
curl "http://localhost:3000/api/chile/prc-zona?lat=-33.37&lng=-70.54&comuna=13132"
```

#### `GET /api/chile/prc-zonas-list?comuna=13132`

Listar todas las zonas de una comuna + estadísticas:

```bash
curl "http://localhost:3000/api/chile/prc-zonas-list?comuna=13132"
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "nombre": "Zona 1 - Residencial Unifamiliar",
      "codigo": "R1",
      "normativas": {
        "altura_maxima_m": 12,
        "densidad_viviendas_ha": 100
      },
      "estadisticas": {
        "numero_roles": 1247,
        "avaluo_promedio_clp": 180000000,
        "valor_m2_promedio": 15800
      }
    },
    ...
  ]
}
```

---

## Casos de Uso

### 1. Enriquecer Vista de Listing

En `/chile/street`, cuando seleccionan un rol:

```tsx
{rolData.prc_zona && (
  <div className="bg-blue-50 p-3 rounded">
    <h4 className="font-semibold">{rolData.prc_zona.nombre}</h4>
    <p className="text-sm">Max altura: {rolData.prc_zona.normativas.altura_maxima_m}m</p>
    <p className="text-sm">Densidad: {rolData.prc_zona.normativas.densidad_viviendas_ha} viv/ha</p>
  </div>
)}
```

### 2. Análisis de Mercado

Estadísticas separadas por zona:

```sql
SELECT
  pz.zona_nombre,
  COUNT(*) AS numero_propiedades,
  AVG(sr.avaluo_fiscal_total / sr.superficie_construida_total_m2)::int AS valor_m2_promedio,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.avaluo_fiscal_total) AS precio_mediano
FROM sii_roles_cl sr
JOIN prc_zonas pz ON sr.prc_zona_id = pz.id
WHERE sr.sii_comuna_code = '13132'
GROUP BY pz.id, pz.zona_nombre
ORDER BY pz.zona_codigo;
```

### 3. Filtros en Búsqueda

"Mostrar solo propiedades en zonas que permiten altura >40m":

```sql
SELECT sr.* FROM sii_roles_cl sr
JOIN prc_zonas pz ON sr.prc_zona_id = pz.id
WHERE sr.sii_comuna_code = '13132'
  AND pz.altura_maxima_m >= 40;
```

### 4. Viabilidad Constructiva

Inversor: "¿Puedo hacer un edificio de 18 pisos en este rol?"

```ts
const altura_proyecto = 18 * 3.5;  // ~63m
if (zona.normativas.altura_maxima_m >= altura_proyecto) {
  return "✅ Viable";
} else {
  return "❌ Excede máximo permitido";
}
```

---

## Datos Actualmente Cargados

### Comunas: 5

1. **Vitacura** (13132)
   - Zona 1: Residencial unifamiliar (12m, 100 viv/ha)
   - Zona 2: Condominios (45m, 350 viv/ha)
   - Zona 3: Mixta (65m, 500 viv/ha)

2. **Las Condes** (13114)
   - Zona Residencial Unifamiliar (12m, 120 viv/ha)
   - Zona Comercial (45m, 300 viv/ha)

3. **Lo Barnechea** (13115)
   - Zona Residencial Rural (8m, 30 viv/ha)
   - Zona Urbana Extensiva (20m, 200 viv/ha)

4. **Colina** (13301)
   - Zona Urbana Central (35m, 250 viv/ha)
   - Zona Industrial (25m, 100 viv/ha)

5. **Providencia** (13123)
   - Zona Residencial Intensiva (55m, 600 viv/ha)
   - Zona Comercial Intensiva (60m, 400 viv/ha)

**Fuente**: Manual (basado en PRC oficiales + ia-prop pattern)  
**Confianza**: Medium (validar contra documentos oficiales)

---

## Roadmap Futuro

- [ ] Integración con ArcGIS services (si existen públicos)
- [ ] Descarga automática de MINVU WFS para todas las 346 comunas
- [ ] Geometría real (polígonos) en lugar de solo puntos
- [ ] Sincronización con actualizaciones de PRC (municipal)
- [ ] Mayor detalles normativas (estacionamientos, retiros, etc.)

---

## Troubleshooting

### ¿Roles sin zona asignada?

```sql
-- Buscar roles sin zona pero con lat/lng
SELECT COUNT(*) FROM sii_roles_cl
WHERE sii_comuna_code = '13132'
  AND prc_zona_id IS NULL
  AND lat IS NOT NULL
  AND lng IS NOT NULL;
```

**Posibles causas:**
- Rol está fuera del área de cobertura de las zonas
- Geometría no cargada (geom IS NULL)
- Coordenadas incorrectas

**Solución:** Revisar data de entrada, considerar buffer mayor

### ¿Performance lento?

```sql
-- Verificar índices
EXPLAIN ANALYZE
SELECT * FROM sii_roles_cl
WHERE sii_comuna_code = '13132'
  AND prc_zona_id IS NOT NULL
LIMIT 100;
```

Los índices deberían estar ya creados en migración 0037.

---

## Documentación Relacionada

- `/docs/INVESTIGACION-CATASTRO-CL-2026.md` — Roadmap general Chile
- `/db/migrations/0037_zonificacion_prc.sql` — Schema
- `/scraper/lib/arcgis-query.mjs` — Librería genérica (para future ArcGIS)
