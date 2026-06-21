# Investigación de Catastro Chileno — Junio 2026

Documento de investigación de fuentes de datos catastrales públicas para Chile,
junto con el roadmap de funcionalidades futuras del módulo Chile de Casafari Mio.

---

## 1. Fuentes de datos investigadas

### 1.1 catastral.cl (Tremen / Cristóbal Hernández @crishernandezco)

**URL:** https://catastral.cl/descargas

**Resumen:**
- 9.4M predios con polígonos vectorizados, 342 comunas
- Datos hasta S2-2025 (1.6 GB CSV)
- Semestre activo: S2-2025. S1-2026 pendiente de publicación.

**Formato CSV:**
- 38 columnas separadas por `|` (pipe)
- Columnas clave:
  - `comuna`, `manzana`, `predio` — identificadores del rol SII
  - `dc_direccion` — dirección del predio
  - `dc_avaluo_fiscal` — avalúo fiscal en pesos
  - `dc_sup_terreno` — superficie de terreno en m²
  - `dc_cod_destino` — destino (habitacional, comercial, etc.)
  - `dc_bc1_*` / `dc_bc2_*` — bienes componentes (construcciones)
  - `dc_padre_*` — predio padre (para derechos)

**Limitaciones:**
- Lat/lon NO vienen en el CSV principal — están en CSVs auxiliares por comuna
- Bloquea acceso programático (responde HTTP 403)
- Descarga manual requerida en la URL indicada arriba

---

### 1.2 roles-backend (crishernandezmaps/roles-backend)

Repositorio de referencia técnica para la arquitectura de ingesta.

**Stack:**
- FastAPI + PostgreSQL 16 + PostGIS 3.5 + Docker

**Datos:**
- 9.4M predios actuales
- 136M históricos (16 semestres 2018-2025)

**ETL:**
- psycopg3 COPY protocol (bulk insert)
- Batches de 2000 filas
- Índices dropeados durante bulk load y reconstruidos al finalizar

**API endpoints relevantes:**
- `GET /predios` — búsqueda por dirección/rol
- `GET /predios/nearby` — búsqueda por proximidad (ST_DWithin)
- `GET /predios/:comuna/:manzana/:predio/evolucion` — historial semestral

**Coordenadas:**
Las lat/lon provienen de CSVs SII auxiliares por comuna, procesados con
el script `06_load_coordinates.py` del mismo repositorio.

---

### 1.3 Polígonos prediales

#### CIREN ArcGIS REST (predios rurales)

**URL base:**
```
https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer/0/query
```

- WFS real para predios rurales, paginable por bounding box
- Sin autenticación requerida
- Cobertura: predios rurales a nivel nacional

**Ejemplo de consulta:**
```
?geometry=-71.2,-33.6,-70.8,-33.2
&geometryType=esriGeometryEnvelope
&spatialRel=esriSpatialRelIntersects
&outFields=*
&f=geojson
```

#### SII Visor (predios urbanos)

**URL:** https://mapas4.sii.cl

- Solo expone WMS (imágenes raster) — no WFS vectorial
- WFS vectorial disponible únicamente bajo convenio municipal firmado con el SII
- No accesible para terceros sin convenio

#### Solución técnica de catastral.cl para polígonos urbanos

Tremen usa la siguiente pipeline para vectorizar predios urbanos:
1. Scraping de tiles WMS del SII (imágenes públicas, sin autenticación)
2. Segmentación semántica con U-Net o SAM (Meta Segment Anything Model)
3. Georreferenciación de los segmentos resultantes
4. Vectorización con Frame Field Learning

**Referencia académica:** [Lydorn/Polygonization-by-Frame-Field-Learning](https://github.com/Lydorn/Polygonization-by-Frame-Field-Learning) — estado del arte para vectorización de parcelas catastrales desde imágenes aéreas.

---

### 1.4 Transacciones CBR (Conservador de Bienes Raíces)

**Repositorio de referencia:** [FelipeCabelloE/api-catastral](https://github.com/FelipeCabelloE/api-catastral)

- ETL completo: SII + CBR + indexación H3 nivel 8
- Ninguna fuente investigada tiene esto ya procesado en una API pública gratuita
- Requiere ETL propio adaptando los scripts del repositorio referenciado

---

### 1.5 APIs públicas útiles

| API | URL | Auth | Uso |
|-----|-----|------|-----|
| mindicador.cl | `https://mindicador.cl/api/uf/{yyyy}` | Sin auth | UF diaria |
| BaseAPI | https://baseapi.cl | API key (plan gratuito) | REST sobre datos SII |
| SimpleAPI | https://simpleapi.cl | Por confirmar | Competidor de BaseAPI |

---

## 2. Roadmap de funcionalidades futuras

### Fase 1 — En progreso (S1 2026)

| Estado | Tarea |
|--------|-------|
| ✅ | Ingesta CSV catastral.cl (`catastro_2025_2.csv`, 9.4M predios) |
| ✅ | Parser lat/lng/nombre_propietario en `scraper/lib/sii-catastro-cl.mjs` |
| ⏳ | Migración 0029: columnas `lat`, `lng`, `geom` en `sii_roles_cl` |
| ⏳ | Migración 0030: tabla `sii_transacciones_cl` |
| ⏳ | UF diaria desde mindicador.cl (tabla `uf_diaria_cl`) |

---

### Fase 2 — Polígonos prediales

**Objetivo:** mostrar el polígono del predio en el mapa de la ficha catastro.

**Pasos:**

1. **Predios rurales:** descargar WFS CIREN paginando por bbox
   - Almacenar en tabla `cadastre_parcels_cl` con columna `geom` (PostGIS)
   - Cargar con `ogr2ogr -f PostgreSQL`

2. **Predios urbanos:** evaluar descarga manual de GeoPackages desde catastral.cl
   - Disponibles por región/provincia
   - Join con `sii_roles_cl` por `(comuna, manzana, predio)`

3. **Mapa:** render del polígono en la ficha de predio (MapLibre GL / Leaflet)

---

### Fase 3 — Página pública tipo street.catastral.cl

**Objetivo:** interfaz de búsqueda y consulta de predios, similar a catastral.cl pero integrada en Casafari Mio.

**Funcionalidades:**

- Búsqueda de predios por dirección
  - Índice trigram ya presente en `sii_roles_cl.direccion`
  - Autocompletado con debounce
- Ficha de predio con:
  - Avalúo fiscal, superficie terreno, destino, flag DFL 2
  - Coordenadas lat/lng y pin en mapa
  - Avalúo convertido a UF del día (via mindicador.cl)
- Historial de transacciones CBR (tabla `sii_transacciones_cl`)
- Mediana UF/m² de zona (vista `sii_comparables_h3_cl`)

---

### Fase 4 — Historial y análisis de mercado

**Objetivo:** mostrar el precio de mercado de la zona en la ficha de predio.

**Pasos:**

1. ETL escrituras CBR
   - Adaptar `scripts/etl_cbr.py` de [FelipeCabelloE/api-catastral](https://github.com/FelipeCabelloE/api-catastral)
   - Fuente: dataset CSV público del CBR por jurisdicción

2. Indexación H3
   - Calcular índice H3 nivel 8 (~460m de radio) para cada transacción
   - Librería: `h3-pg` (extensión PostgreSQL) o cálculo en Python

3. Vista `sii_comparables_h3_cl`
   - Mediana UF/m² por hexágono, últimos 12 meses
   - Actualización mensual

4. Integración en ficha de predio
   - Widget "Precio de mercado zona: X UF/m²"
   - Gráfico de evolución de precios (últimos 4 semestres)

---

### Fase 5 — CV polígonos urbanos (investigación aplicada)

**Objetivo:** vectorizar polígonos prediales urbanos a partir de tiles WMS públicos del SII.

**Pipeline técnica:**

```
Tiles WMS SII (www4.sii.cl/mapasui)
    ↓  descarga pública, sin auth
Mosaico georeferenciado (GeoTIFF)
    ↓  gdal_merge / gdal2tiles
Segmentación semántica
    ↓  SAM (Meta) o Frame Field Learning
Polígonos vectoriales
    ↓  post-procesado geometría
Join por bounding box → sii_roles_cl
```

**Referencias:**
- [Meta SAM 2](https://github.com/facebookresearch/segment-anything-2)
- [Frame Field Learning](https://github.com/Lydorn/Polygonization-by-Frame-Field-Learning)
- Técnica documentada en el blog de catastral.cl

**Estado:** investigación futura. Requiere GPU para inferencia a escala nacional.

---

## 3. Política de fuentes de datos

Este proyecto utiliza exclusivamente fuentes públicas oficiales:

| Fuente | Tipo | Auth |
|--------|------|------|
| catastral.cl descargas | CSV descarga manual | Sin auth |
| CIREN ArcGIS REST | WFS OGC público | Sin auth |
| mindicador.cl | API REST pública | Sin auth |
| CBR dataset CSV | CSV público por jurisdicción | Sin auth |
| Tiles WMS SII visor | Imágenes públicas | Sin auth |

**Lo que NO hacemos:**
- Scraping de sii.cl (prohibido por TOS)
- Evasión de bot detection ni bypass de autenticación de SII
- ClaveÚnica ni autenticación como tercero
- Proveedores comerciales de pago (dataprop.cl, databam.cl)
- RPA sobre portales del SII

---

## 4. Referencias y repositorios

| Recurso | URL |
|---------|-----|
| catastral.cl descargas | https://catastral.cl/descargas |
| roles-backend (referencia arquitectura) | https://github.com/crishernandezmaps/roles-backend |
| api-catastral (ETL CBR + H3) | https://github.com/FelipeCabelloE/api-catastral |
| Frame Field Learning | https://github.com/Lydorn/Polygonization-by-Frame-Field-Learning |
| CIREN ArcGIS REST | https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer/0 |
| mindicador.cl | https://mindicador.cl/api |
| BaseAPI | https://baseapi.cl |

---

*Documento generado: junio 2026. Próxima revisión: S1-2026 catastral.cl (pendiente de publicación).*
