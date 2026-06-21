# Investigación Catastro Chile 2026

Investigación realizada en junio 2026 sobre fuentes de datos catastrales para Chile.

---

## Hallazgos principales

### catastral.cl — Proyecto Tremen

[catastral.cl](https://catastral.cl) es el recurso más completo de datos prediales vectorizados de Chile. Procesa los CSVs oficiales del SII y los convierte en:
- CSV nacional con 9.4M predios (~1.6 GB, `catastro_YYYY_N.csv`)
- GeoPackages por comuna con polígonos prediales
- Visor web de calles: [street.catastral.cl](https://street.catastral.cl)

**Empresa:** [Tremen Tech](https://tremen.tech) — liderado por [@crishernandezmaps](https://github.com/crishernandezmaps)

**Repositorios open source:**
- [crishernandezmaps/catastral.cl](https://github.com/crishernandezmaps/catastral.cl) — proyecto principal
- [crishernandezmaps/roles-backend](https://github.com/crishernandezmaps/roles-backend) — API y procesamiento
- [crishernandezmaps/roles-frontend](https://github.com/crishernandezmaps/roles-frontend) — visor web

**Disponibilidad de datos:**
- Último semestre disponible: **S2-2025**
- S1-2026 aún NO está procesado (usar CSV oficial del SII directamente)
- catastral.cl bloquea acceso programático (HTTP 403) — descarga manual desde el portal

### Formato CSV catastral.cl

El CSV nacional (`catastro_2025_2.csv`) tiene las siguientes características:
- Delimitado por comas (`,`)
- Con header en primera línea
- ~38 columnas con prefijos `dc_` (datos catastrales) y `rc_` (rol de cobro)
- 9.4M filas — procesamiento ~30 minutos en servidor VPS

**Columnas clave:**
| Columna CSV | Campo en BD | Descripción |
|---|---|---|
| `comuna` / `cod_comuna` | `sii_comuna_code` | Código SII de la comuna |
| `manzana` | `manzana` | Número de manzana |
| `predio` | `predio` | Número de predio |
| `dc_direccion` | `direccion` | Dirección del predio |
| `dc_avaluo_fiscal` | `avaluo_fiscal_total` | Avalúo fiscal total (CLP) |
| `dc_avaluo_exento` | `avaluo_exento` | Avalúo exento de contribuciones |
| `dc_contribucion_semestral` | `contribucion_semestral` | Contribución semestral (CLP) |
| `dc_cod_destino` | `codigo_destino_principal` | Código destino (habitacional, comercial, etc.) |
| `dc_sup_terreno` | `superficie_terreno_m2` | Superficie de terreno en m² |
| `dc_bc1_*` / `dc_bc2_*` | `rbc1_*` / `rbc2_*` | Roles bien común |
| `dc_padre_*` | `padre_*` | Rol padre (para departamentos) |

**Nota sobre lat/lon:** Las coordenadas NO están en el CSV principal. Están en archivos auxiliares procesados por el script `06_load_coordinates.py` del proyecto catastral.cl. Si se necesitan coordenadas, hay que obtenerlas de otra fuente (IDE Chile WFS o GeoPackages).

### Fuentes oficiales SII

| Recurso | URL |
|---|---|
| Descarga vigente por comuna | https://www4.sii.cl/mapasui/internet/#/contenidos/descargarInformacionVigente |
| Información histórica por año | https://www4.sii.cl/mapasui/internet/#/contenidos/descargarInformacionHistorica |

**Archivos SII disponibles por comuna:**
- `BRTMPCATASN_YYYY_N_CCCC` — Roles no agrícolas (datos principales)
- `BRTMPCATASNL_YYYY_N_CCCC` — Construcciones no agrícolas
- `BRTMPCATASA_YYYY_N_CCCC` — Roles agrícolas
- `BRTMPCATASAL_YYYY_N_CCCC` — Suelos y construcciones agrícolas
- `BRTMPROLSEM_YYYY_N_CCCC` — Rol de cobro (contribuciones)

### Polígonos prediales

| Fuente | Descripción | Acceso |
|---|---|---|
| catastral.cl GeoPackages | Polígonos vectorizados del SII, por comuna | Descarga manual |
| IDE Chile / Geoportal MINVU | WFS OGC con polígonos prediales | Público sin auth |
| CIREN ArcGIS REST | Predios rurales, API paginada por bbox | Público |

Para cargar un GeoPackage en la BD:
```bash
ogr2ogr -f PostgreSQL "$DATABASE_URL" "/data/gpkg/15108_2025_S2.gpkg" \
  -nln cadastre_parcels_cl -append -progress
```

### UF diaria

API REST pública: `https://mindicador.cl/api/uf/{yyyy}`

```bash
node scraper/fetch-uf-mindicador.mjs --year 2025 --save
```

---

## Roadmap de enriquecimiento SII

### Fase 1 — CSV nacional catastral.cl (completada)
- [x] Subida del CSV `catastro_2025_2.csv` (9.4M filas) desde Settings UI
- [x] Parser con mapeo exacto de columnas `dc_*` del formato catastral.cl
- [x] Migración 0029: lat/lng/geom/dfl2_flag/nombre_propietario en `sii_roles_cl`
- [x] Streaming NDJSON para evitar timeout HTTP en procesamiento largo
- [x] Batch upsert con unnest() arrays (BATCH_SIZE=2000)

### Fase 2 — Coordenadas
- [ ] Cruzar con catastral.cl GeoPackages para obtener centroides de polígonos
- [ ] O usar IDE Chile WFS para obtener geometrías prediales oficiales
- [ ] Poblar columnas `lat`, `lng`, `geom` en `sii_roles_cl`

### Fase 3 — Polígonos prediales
- [ ] Cargar GeoPackages de catastral.cl en `cadastre_parcels_cl`
- [ ] ogr2ogr con `--append` para comunas prioritarias (Las Condes, Vitacura, Providencia)
- [ ] Vista `sii_roles_con_poligono` que une roles con polígono predial

### Fase 4 — Transacciones CBR
- [ ] Tabla `sii_transacciones_cl` (migración 0030 ya aplicada)
- [ ] Ingesta histórica de escrituras del Conservador de Bienes Raíces
- [ ] Vista `sii_comparables_h3_cl`: mediana UF/m² por hexágono H3

### Fase 5 — street.catastral.cl
- [ ] Investigar API de street.catastral.cl para consulta de predio por dirección
- [ ] Posible integración para enriquecer propiedades captadas en Chile

---

## Comunas prioritarias (códigos SII)

| Código | Comuna | Región |
|---|---|---|
| 15131 | Vitacura | Metropolitana |
| 15108 | Las Condes | Metropolitana |
| 15111 | Lo Barnechea | Metropolitana |
| 13119 | Providencia | Metropolitana |
| 13120 | Ñuñoa | Metropolitana |
| 13106 | La Reina | Metropolitana |
| 13101 | Santiago | Metropolitana |
| 13301 | Colina | Metropolitana |

---

## Arquitectura técnica

### Stack de ingesta

```
catastro_2025_2.csv (1.6 GB)
  → Settings UI → /api/admin/sii-upload (streaming NDJSON)
  → sii-catastro-ingest.ts → parseCatastralClCsv()
  → flushRolesEnriquecidosBatch() → PostgreSQL unnest() upsert
  → sii_roles_cl (9.4M filas)
```

### Flag DFL2

La columna `dfl2_flag` en `sii_roles_cl` se calcula automáticamente:
```sql
dfl2_flag = superficie_terreno_m2 IS NOT NULL AND superficie_terreno_m2 <= 140
```
Identifica predios con exención tributaria DFL2 (viviendas ≤ 140 m²).

### H3 Index (transacciones)

Las transacciones CBR usan H3 nivel 8 (~460m de radio) para agrupar comparables por zona:
```sql
-- vista sii_comparables_h3_cl
SELECT h3_index, COUNT(*), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY uf_por_m2) as mediana_uf_m2
FROM sii_transacciones_cl
WHERE fecha_escritura > NOW() - INTERVAL '12 months'
GROUP BY h3_index
```
