# PRC Zonificación — Guía de Implementación

**Fecha**: Junio 2026  
**Alcance**: Cargar zonas de regulación (PRC) para 4 comunas prioritarias de Santiago  
**Fuente de datos**: Manual (hardcoded) + ArcGIS services (future)  
**Status**: 🟢 Listo para implementar

---

## 📊 Alcance Exacto

Basado en datos reales de: https://crm.cremme.es/api/debug/sii-roles-status

| Comuna | Código SII | Zonas | Roles Totales | Con Coordenadas | Coverage |
|--------|-----------|-------|--------------|-----------------|----------|
| **Vitacura** | 15160 | 3 | 225,462 | 219,338 (97%) | ✅ 100% |
| **Las Condes** | 15108 | 2 | 390,000 | 360,233 (92%) | ✅ 100% |
| **Lo Barnechea** | 15161 | 2 | 148,515 | 134,073 (90%) | ✅ 100% |
| **Colina** | 14201 | 2 | 118,806 | 110,997 (93%) | ✅ 100% |
| **Providencia** | 13123 | — | **0** | 0 | ❌ NO CARGADO |
| — | — | — | — | — | — |
| **TOTAL (4 comunas)** | — | **11 zonas** | **882,783 roles** | **824,641 (93%)** | ✅ **100%** |

### ⚠️ Códigos SII CORRECTOS (importantes)

Los códigos en la migración 0022 eran **incorrectos**. Los códigos reales tras ingesta catastral.cl S2-2025:

| Comuna | Código CORRECTO | Código Antiguo (0022) | 
|--------|-----------------|----------------------|
| Vitacura | **15160** | ~~13132~~ |
| Las Condes | **15108** | ~~13114~~ |
| Lo Barnechea | **15161** | ~~13115~~ |
| Colina | **14201** | ~~13301~~ |
| Providencia | **13123** | 13123 ✓ (pero sin datos en BD) |

---

## Visión General

Enriquecer cada predio SII con su zona de regulación catastral y normativas asociadas:
- Altura máxima permitida
- Densidad de viviendas/ha
- Usos de suelo permitidos/prohibidos
- FAR / FOS

```
sii_roles_cl (882,783 predios en 4 comunas)
    ↓ (ST_Intersects con geometría)
prc_zonas (11 zonas regulatorias)
    ↓ (enriquecimiento)
Análisis de mercado por zona + Viabilidad constructiva
```

---

## Arquitectura

### 1. Tabla `prc_zonas` (Migración 0037)

```sql
CREATE TABLE prc_zonas (
  id uuid PRIMARY KEY,
  sii_comuna_code text,           -- "15160" = Vitacura (código correcto)
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
ALTER TABLE sii_roles_cl ADD COLUMN prc_densidad_viv_ha int;
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

```bash
# Cargar todas las 4 comunas (Providencia se salta por no estar en BD)
node scraper/load-prc-zonas.mjs --all --populate
```

**Output esperado:**
```
📍 Insertando 3 zonas para Vitacura (15160)
  ✅ Zona 1 - Residencial Unifamiliar
  ✅ Zona 2 - Condominios Cerrados
  ✅ Zona 3 - Mixta

🔄 Asignando zonas a roles de 15160...
✅ Actualizados 225462 roles con zonas

📍 Insertando 2 zonas para Las Condes (15108)
  ✅ Zona Residencial Unifamiliar
  ✅ Zona Comercial

🔄 Asignando zonas a roles de 15108...
✅ Actualizados 390000 roles con zonas

... (similar para Lo Barnechea 15161 y Colina 14201)

✨ Total insertadas: 11 zonas
✨ Total roles enriquecidos: ~882,783
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
WHERE sii_comuna_code IN ('15160', '15108', '15161', '14201')
GROUP BY sii_comuna_code
ORDER BY sii_comuna_code;
```

**Resultado esperado:**
```
 sii_comuna_code | total_roles | roles_con_zona | cobertura_pct
-----------------+-------------+----------------+---------------
 14201           |     118,806 |      118,806   |         100.0
 15108           |     390,000 |      390,000   |         100.0
 15160           |     225,462 |      225,462   |         100.0
 15161           |     148,515 |      148,515   |         100.0
-----------------+-------------+----------------+---------------
 TOTAL           |     882,783 |      882,783   |         100.0
```

---

## APIs Disponibles

### `GET /api/chile/prc-zona`

Obtener zona + normativas de un rol:

```bash
curl "http://localhost:3000/api/chile/prc-zona?rol=795-198&comuna=15108"
```

Response:
```json
{
  "success": true,
  "data": {
    "rol": {
      "rol": "795-198",
      "direccion": "Apoquindo 3600",
      "avaluo_fiscal_total": 250000000
    },
    "prc_zona": {
      "nombre": "Zona 2 Condominios Cerrados",
      "normativas": {
        "altura_maxima_m": 45,
        "numero_pisos_maximo": 12,
        "densidad_viviendas_ha": 350
      },
      "usos": {
        "permitidos": ["H", "C", "D", "O"],
        "prohibidos": ["I", "M"]
      }
    }
  }
}
```

### `GET /api/chile/prc-zonas-list`

Listar todas las zonas de una comuna:

```bash
curl "http://localhost:3000/api/chile/prc-zonas-list?comuna=15108"
```

Response:
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "nombre": "Zona Residencial Unifamiliar",
      "normativas": {
        "altura_maxima_m": 12,
        "densidad_viviendas_ha": 120
      },
      "estadisticas": {
        "numero_roles": 150000,
        "valor_m2_promedio": 12500
      }
    },
    ...
  ]
}
```

---

## Datos Cargados

### Vitacura (15160) — 225,462 roles

- **Zona 1**: Residencial Unifamiliar (12m, 100 viv/ha)
- **Zona 2**: Condominios Cerrados (45m, 350 viv/ha)
- **Zona 3**: Mixta (65m, 500 viv/ha)

### Las Condes (15108) — 390,000 roles

- **Zona 1**: Residencial Unifamiliar (12m, 120 viv/ha)
- **Zona 2**: Comercial (45m, 300 viv/ha)

### Lo Barnechea (15161) — 148,515 roles

- **Zona 1**: Residencial Rural (8m, 30 viv/ha)
- **Zona 2**: Urbana Extensiva (20m, 200 viv/ha)

### Colina (14201) — 118,806 roles

- **Zona 1**: Urbana Central (35m, 250 viv/ha)
- **Zona 2**: Industrial (25m, 100 viv/ha)

---

## Casos de Uso

### 1. Análisis de Mercado

Estadísticas separadas por zona (más homogéneo):

```sql
SELECT
  pz.zona_nombre,
  COUNT(*) AS num_propiedades,
  AVG(sr.avaluo_fiscal_total / sr.superficie_construida_total_m2)::int AS valor_m2_promedio
FROM sii_roles_cl sr
JOIN prc_zonas pz ON sr.prc_zona_id = pz.id
WHERE sr.sii_comuna_code = '15160'
GROUP BY pz.zona_nombre;
```

### 2. Viabilidad Constructiva

Determinar si proyecto es viable:

```ts
const altura_proyecto = 18 * 3.5;  // ~63m
if (zona.normativas.altura_maxima_m >= altura_proyecto) {
  return "✅ Viable";
} else {
  return "❌ Excede máximo permitido";
}
```

### 3. Filtros en Búsqueda

"Mostrar solo propiedades en zonas que permiten >40m":

```sql
SELECT sr.* FROM sii_roles_cl sr
JOIN prc_zonas pz ON sr.prc_zona_id = pz.id
WHERE sr.sii_comuna_code = '15108'
  AND pz.altura_maxima_m >= 40;
```

---

## Roadmap Futuro

- [ ] Integración con ArcGIS services públicos (si existen)
- [ ] Descarga automática de MINVU WFS para todas las 346 comunas
- [ ] Cargar Providencia (si se ingesta en futuro)
- [ ] Geometría real (polígonos) en lugar de solo atributos
- [ ] UI en `/chile/street` mostrando zonas
- [ ] Sincronización con actualizaciones de PRC (municipal)

---

## Troubleshooting

### ¿Roles sin zona asignada?

```sql
SELECT COUNT(*) FROM sii_roles_cl
WHERE sii_comuna_code = '15160'
  AND prc_zona_id IS NULL
  AND lat IS NOT NULL
  AND lng IS NOT NULL;
```

Si hay resultados, las coordenadas están fuera del área de cobertura de las zonas.

---

## Referencias

- **Status real de datos**: https://crm.cremme.es/api/debug/sii-roles-status
- **Fuente de datos**: catastral.cl S2-2025 (9.4M roles Chile)
- **Códigos SII**: Confirmados tras ingesta catastral.cl 2025-S2
