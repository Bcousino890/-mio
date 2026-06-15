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

## Estado

🚧 **Fase 0 — arranque.** Definida la arquitectura; código de la plataforma nueva por construir. Ver roadmap por fases en el [Plan Maestro](docs/PLAN-MAESTRO.md#8-roadmap-por-fases).
