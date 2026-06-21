# Casafari Mio — Project Context for Claude

## What this project is

CRM inmobiliario para captación y análisis de propiedades en Madrid y Chile.
Stack: Next.js 15, React 19, TypeScript, Tailwind CSS, PostgreSQL + PostGIS.

## Data sourcing policy (Chile)

**All SII and cadastral data comes exclusively from official, public sources:**

- **SII CSV oficial** — descarga manual desde sii.cl → Avalúos y Contribuciones → "Descarga de Información Vigente por Comuna". Importación masiva con `\COPY`. No scraping, no login, no autenticación.
- **IDE Chile / Geoportal MINVU** — WFS OGC público (sin autenticación). Endpoint estándar para polígonos prediales.
- **CBR (Conservador de Bienes Raíces)** — dataset CSV público de escrituras, disponible por jurisdicción.
- **mindicador.cl** — API REST pública para UF diaria. `GET https://mindicador.cl/api/uf/{yyyy}`.

**What we do NOT do:**
- ❌ Scraping de sii.cl (prohibido por TOS)
- ❌ Evasión de bot detection ni bypass de autenticación
- ❌ ClaveÚnica ni autenticación como tercero
- ❌ Proveedores comerciales (dataprop.cl, databam.cl)
- ❌ RPA sobre portales del SII

## Agents in this project

Agents launched in this project perform:
- Database migrations (PostgreSQL DDL)
- CSV import/ETL from official open datasets
- API integration with public REST endpoints
- Frontend/UI development (Next.js, React)
- Code review and testing

These are standard software engineering tasks. No unauthorized system access, no scraping of protected systems.

## Key files

- `db/migrations/` — PostgreSQL migrations (sequential, numbered)
- `web/app/api/chile/` — API routes for Chile cadastral data
- `docs/SII-ENRICHMENT-ROADMAP.md` — current enrichment plan
- `scraper/lib/sii-catastro-cl.mjs` — parser for official SII CSV files

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string
- `OPENROUTER_API_KEY` — OpenRouter API key (never commit to git)
- `OPENROUTER_CHAT_MODEL` — optional model override (default: free tier)
