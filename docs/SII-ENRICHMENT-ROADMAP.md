# Roadmap: Enriquecimiento de Datos SII Chile

> Resultado de investigación de repositorios públicos (junio 2026).
> Todos los datos provienen de fuentes oficiales abiertas — sin scraping de sii.cl.

---

## Estado actual de `sii_roles_cl`

La tabla ya existe (migración `0021_sii_catastro_cl.sql`) y contiene:

| Campo | Origen | Estado |
|---|---|---|
| `rol` (manzana-predio) | CSV oficial SII | ✅ presente |
| `sii_comuna_code` | CSV oficial SII | ✅ presente |
| `direccion` | CSV oficial SII | ✅ presente |
| `avaluo_fiscal_total` | CSV oficial SII | ✅ presente |
| `avaluo_exento` | CSV oficial SII | ✅ presente |
| `contribucion_semestral` | CSV oficial SII | ✅ presente |
| `codigo_destino_principal` | CSV oficial SII | ✅ presente |
| `superficie_terreno_m2` | CSV oficial SII | ✅ presente |
| `rol_padre` / `rol_bien_comun_*` | CSV oficial SII | ✅ presente |
| `serie` (agrícola/no agrícola) | CSV oficial SII | ✅ presente |

### Campos que faltan (oportunidades de enriquecimiento)

| Campo | Fuente | Dificultad |
|---|---|---|
| `lat` / `lng` | CSV oficial SII S2-2025 (1.13M predios con coords) | 🟢 Baja — `\COPY` masivo |
| `geom` (polígono) | IDE Chile / Geoportal MINVU WFS | 🟡 Media — WFS por comuna |
| `nombre_propietario` | CSV oficial SII (columna `nombre`) | 🟢 Baja — ya en CSV |
| `avaluo_afecto` | CSV oficial SII | 🟢 Baja — ya en CSV |
| `rol_cobro_cuota_trimestral` | Rol de Cobro SII (CSV semestral) | 🟢 Baja — ya en schema |
| `dfl2_flag` | Deducido: superficie_util ≤ 140m² | 🟢 Baja — cálculo local |
| `cbr_foja/numero/anio` | Escrituras CBR (dataset público) | 🟡 Media — ETL CSV CBR |
| `precio_uf_ultimo` | Escrituras CBR | 🟡 Media — JOIN con tabla cbr |
| `mediana_uf_zona_h3` | H3 spatial index + escrituras CBR | 🔴 Alta — PostGIS + H3 |

---

## Fuentes de datos (todas oficiales y gratuitas)

### 1. CSV oficial SII — Descarga manual por comuna
- **URL**: sii.cl → Avalúos y Contribuciones → "Descarga de Información Vigente por Comuna"
- **Archivos**: `BRTMPCATASN_*` (no agrícola) + `BRTMPCATASAL_*` (agrícola) + Rol de Cobro
- **Contiene**: todos los campos de `sii_roles_cl` + coordenadas en dataset S2-2025
- **Importación**: `\COPY sii_roles_cl FROM 'archivo.csv' DELIMITER ';' CSV HEADER`
- **Referencia**: `scraper/lib/sii-catastro-cl.mjs` ya implementa el parser

### 2. IDE Chile / Geoportal MINVU — Polígonos prediales (WFS)
- **URL**: `https://ide.minvu.cl/` (capa "Predios") o `https://www.ide.cl/`
- **Cobertura**: ~170 de 346 comunas
- **Formato**: WFS OGC estándar → GeoJSON/GeoPackage
- **Target table**: `cadastre_parcels_cl` (ya existe en migración `0020`)
- **Campo join**: `rol` = "manzana-predio" (mismo formato en ambas tablas)

### 3. Escrituras CBR — Historial de transacciones
- **Origen**: Conservador de Bienes Raíces (~70 jurisdicciones)
- **Dataset**: CSV público con fecha, monto CLP/UF, rol vinculado
- **Referencia**: `FelipeCabelloE/api-catastral` implementó el ETL completo
  - `scripts/etl_cbr.py` — normalización CSV → PostgreSQL
  - `scripts/compute_h3.py` — índice H3 nivel 8 (~460m radio) para comparables
- **Target**: nueva tabla `sii_transacciones_cl` (pendiente)

### 4. mindicador.cl — UF diaria
- **URL**: `https://mindicador.cl/api/uf/{yyyy}`
- **Uso**: convertir avalúos históricos a UF al día actual
- **Gratuito**: sí, sin autenticación

---

## Schema migrations pendientes

### Migración A: Coordenadas en `sii_roles_cl`
```sql
ALTER TABLE sii_roles_cl
  ADD COLUMN IF NOT EXISTS lat  double precision,
  ADD COLUMN IF NOT EXISTS lng  double precision,
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_geom
  ON sii_roles_cl USING gist(geom);
```

### Migración B: Tabla de transacciones CBR
```sql
CREATE TABLE IF NOT EXISTS sii_transacciones_cl (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rol_id          uuid REFERENCES sii_roles_cl(id) ON DELETE CASCADE,
  sii_comuna_code text NOT NULL,
  rol             text NOT NULL,
  fecha_escritura date,
  monto_clp       bigint,
  monto_uf        numeric(12, 2),
  h3_index        text,           -- H3 nivel 8 (~460m)
  fuente          text DEFAULT 'cbr',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transacciones_cl_rol    ON sii_transacciones_cl(sii_comuna_code, rol);
CREATE INDEX IF NOT EXISTS idx_transacciones_cl_h3     ON sii_transacciones_cl(h3_index);
CREATE INDEX IF NOT EXISTS idx_transacciones_cl_fecha  ON sii_transacciones_cl(fecha_escritura);
```

### Migración C: DFL 2 flag y nombre propietario
```sql
ALTER TABLE sii_roles_cl
  ADD COLUMN IF NOT EXISTS nombre_propietario  text,
  ADD COLUMN IF NOT EXISTS dfl2_flag           boolean GENERATED ALWAYS AS (
    superficie_terreno_m2 IS NOT NULL AND superficie_terreno_m2 <= 140
  ) STORED;
```

---

## Plan de implementación (orden sugerido)

### Fase 1 — Sin nueva infraestructura (esta semana)
1. **Migración A**: agregar `lat`, `lng`, `geom` a `sii_roles_cl`
2. **Migración C**: agregar `nombre_propietario` y `dfl2_flag`
3. Re-importar CSV SII S2-2025 (que ya incluye coordenadas) con el parser actualizado
4. Integrar `mindicador.cl/api/uf` en la API para mostrar avalúo en UF al día

### Fase 2 — Polígonos IDE Chile
5. Script ETL para descargar WFS de comunas prioritarias (Vitacura, Las Condes, Providencia, Ñuñoa, La Reina, Lo Barnechea)
6. Poblar `cadastre_parcels_cl` con polígonos + centroide
7. Mostrar polígono en mapa catastro

### Fase 3 — Historial de transacciones CBR
8. **Migración B**: tabla `sii_transacciones_cl`
9. ETL escrituras CBR (adaptar `FelipeCabelloE/api-catastral/scripts/etl_cbr.py`)
10. Cálculo H3 índice para comparables de mercado

---

## Repositorios de referencia investigados

| Repo | Hallazgo clave |
|---|---|
| `FelipeCabelloE/api-catastral` | ETL completo SII (10.5M predios) + CBR + H3. Referencia arquitectónica directa |
| `DanielD-S/sii-predios` | Pipeline polígonos prediales desde WMS IDE Chile → GeoPackage |
| `vicenteaguero/PropOS` | CRM inmobiliario chileno con IA (ANITA). Stack: FastAPI + Supabase |
| `soreavis/property-deep-dive` | Playbook metodología análisis CL: DFL 2, CBR Foja/Número, riesgos sísmicos |
| `mindicador.cl` | API gratuita UF diaria: `GET https://mindicador.cl/api/uf/{yyyy}` |

---

## Lo que NO vamos a hacer
- ❌ Scraping de `sii.cl` (prohibido por TOS y bloqueado HTTP 403)
- ❌ Proveedores comerciales (dataprop.cl, databam.cl)
- ❌ ClaveÚnica / autenticación como tercero en nombre de propietarios
