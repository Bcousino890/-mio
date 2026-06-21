<div align="center">

# 🏙️ casafari-mio

**Plataforma propia de inteligencia inmobiliaria — captación + análisis de mercado**
**Mercado inicial: Madrid · venta + alquiler**

</div>

---

## Qué es

`casafari-mio` es una **plataforma nueva** (estilo Casafari + Lystos) para **captar** y **analizar** el mercado inmobiliario, construida desde cero con un enfoque distinto al CRM `smartbc`.

El núcleo diferencial es un **motor de Referencia Catastral (RC14/RC20)**: convierte anuncios anonimizados de los portales en **inmuebles físicos identificados por referencia catastral**, deduplicados entre portales, y los explota como:

- 🎯 **Captación / Lead Flow** — particulares, exclusivas rotas (mismo inmueble en varias agencias), bajadas de precio, novedades de mercado.
- 📊 **Análisis de mercado** — €/m² por zona, time-on-market, descuentos, stock, mapas de calor.
- 💶 **Valoración (AVM)** — comparables por referencia catastral + informe PDF.
- 🔌 **API de datos** — exponer todo lo anterior (estilo Lystos).

> **Importante:** esto NO es smartbc. smartbc es el CRM/portal existente; casafari-mio es la capa de captación e inteligencia. Algunas piezas de smartbc se **reutilizarán** (detección de particulares, scrapers), pero la arquitectura y el enfoque son nuevos.

---

## Estructura del repositorio

```
casafari-mio/
├── docs/                         # Documentación de arquitectura y planificación
│   ├── PLAN-MAESTRO.md           # Plan maestro (arquitectura, stack, roadmap, costes)
│   └── PLAN-ADENDA-CODIGO-REAL.md# Adenda: gaps reales vs código existente
├── reference/
│   └── smartbc/                  # Código actual de smartbc — SOLO REFERENCIA
│                                 # (de aquí se reutilizan: detector particulares, scrapers)
└── README.md
```

A medida que se construya la plataforma nueva, el código vivirá en la **raíz** (no dentro de `reference/`).

---

## Documentación clave

- **[Plan Maestro](docs/PLAN-MAESTRO.md)** — visión, arquitectura global, modelo de datos (clave canónica RC20), reparto del VPS, capa de IA (<€30/mes), costes y roadmap por fases.
- **[Adenda — código real](docs/PLAN-ADENDA-CODIGO-REAL.md)** — qué ya existe en smartbc, los gaps reales (dedup cross-portal, mercado completo, zonas/municipios), y la arquitectura revisada sobre el stack existente.

---

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| **Mercado inicial** | Madrid (venta + alquiler) |
| **Zonas de arranque** | Barrio Salamanca, Almagro, Ibiza (capital) + Pozuelo y La Moraleja (municipios) |
| **Stack** | TypeScript + **Postgres self-hosted (VPS) + PostGIS**. Sin Supabase ni Vercel. Reutiliza scrapers/detector de smartbc. |
| **Infra** | 1× Hetzner CX43 (8 vCPU / 16 GB / 160 GB) |
| **Proxies** | Geonode residential (empezar con trial 10 GB) |
| **IA** | OpenRouter solo como *fallback* (<€30/mes; objetivo real €2-8). Cero IA en el camino principal. |
| **Dedup** | Clave canónica **RC20** (referencia catastral de la vivienda). |
| **Retención** | Nunca se borra: anuncios retirados se conservan (`is_active=false` + `taken_down_at`). |

---

## Módulo Chile — Fuentes de datos catastrales

El módulo Chile ingiere datos del SII y catastro para análisis de propiedades en comunas como Las Condes, Vitacura, Providencia, etc.

### Fuentes oficiales y públicas

| Fuente | URL | Descripción |
|---|---|---|
| **SII — Descarga vigente por comuna** | https://www4.sii.cl/mapasui/internet/#/contenidos/descargarInformacionVigente | Archivos planos (BRTMPCATASN, BRTMPCATASNL, BRTMPCATASA, BRTMPCATASAL, BRTMPROLSEM) por comuna. Sin login. |
| **SII — Información histórica por año** | https://www4.sii.cl/mapasui/internet/#/contenidos/descargarInformacionHistorica | Mismos archivos históricos por semestre. |
| **mindicador.cl — UF diaria** | https://mindicador.cl/api/uf/{yyyy} | API REST pública sin auth. UF histórica por año. |
| **IDE Chile / Geoportal MINVU** | https://ide.minvu.cl | WFS OGC público para polígonos prediales. Sin autenticación. |

### catastral.cl — Proyecto Tremen (datos vectorizados del SII)

[catastral.cl](https://catastral.cl) es un proyecto open source liderado por [@crishernandezmaps](https://github.com/crishernandezmaps) que procesa los CSVs oficiales del SII y los convierte en capas GIS con polígonos prediales. Cubre 9.4M predios de Chile.

| Recurso | URL | Descripción |
|---|---|---|
| **catastral.cl** | https://catastral.cl | Portal de descarga de datos prediales Chile. CSV nacional + GeoPackages por semestre. |
| **street.catastral.cl** | https://street.catastral.cl | Visor de calles y predios a nivel nacional. |
| **Tremen Tech** | https://tremen.tech | Empresa detrás de catastral.cl. Procesamiento de datos SII a nivel nacional. |
| **roles-backend** | https://github.com/crishernandezmaps/roles-backend | Backend del proyecto catastral.cl. API y procesamiento de roles SII. |
| **roles-frontend** | https://github.com/crishernandezmaps/roles-frontend | Frontend del visor catastral. |
| **catastral.cl (repo)** | https://github.com/crishernandezmaps/catastral.cl | Repositorio principal del proyecto catastral.cl. Datos, scripts y documentación. |

> **Nota técnica:** catastral.cl bloquea acceso programático (HTTP 403). Los datos deben descargarse manualmente desde el portal. El CSV nacional (`catastro_YYYY_N.csv`) contiene ~9.4M filas con 38 columnas (formato delimitado por comas, con header). La subida de este CSV se puede hacer directamente desde Configuración → Subir archivos SII.

### Scripts incluidos

- `scraper/download-catastral-gpkg.mjs` — Genera comandos `ogr2ogr` para cargar GeoPackages en `cadastre_parcels_cl`
- `scraper/ingest-sii-s1-2026.mjs` — Ingesta CSV oficiales del SII S1-2026 por comuna
- `scraper/fetch-uf-mindicador.mjs` — Descarga UF diaria desde mindicador.cl

### Documentación de investigación

Ver [`docs/INVESTIGACION-CATASTRO-CL-2026.md`](docs/INVESTIGACION-CATASTRO-CL-2026.md) para el roadmap completo de enriquecimiento SII, hallazgos de investigación sobre catastral.cl y fases planificadas.

---

## Estado

🚧 **En desarrollo activo.** Madrid (Fase 1) + Chile catastral (Fase 2). Ver [`docs/INVESTIGACION-CATASTRO-CL-2026.md`](docs/INVESTIGACION-CATASTRO-CL-2026.md) para el roadmap de Chile.
