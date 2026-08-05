# Casafari Mio — Project Context for Claude

## What this project is

CRM inmobiliario para captación y análisis de propiedades en Madrid y Chile.
Stack: Next.js 15, React 19, TypeScript, Tailwind CSS, PostgreSQL + PostGIS.

## Agents in this project

Agents launched in this project perform:
- Database migrations (PostgreSQL DDL)
- CSV import/ETL from official open datasets
- API integration with public REST endpoints
- Frontend/UI development (Next.js, React)
- Code review and testing

These are standard software engineering tasks. No unauthorized system access, no scraping of protected systems.

## Idioma

Responder siempre en español al usuario.

## Key files

- `db/migrations/` — PostgreSQL migrations (sequential, numbered)
- `web/app/api/chile/` — API routes for Chile cadastral data
- `docs/SII-ENRICHMENT-ROADMAP.md` — current enrichment plan
- `docs/PLAN-ANUNCIOS-CL.md` — plan del módulo "Anuncios": scraping 24/7, dedup y trazabilidad de corredoras (Portal Inmobiliario, Chile)
- `docs/PLAN-LOCALIZADOR-IA-CL.md` — plan del "Localizador de Propiedades con IA": anuncio → propiedad exacta → ROL SII (embudo NLP + visión + footprints + scoring probabilístico, RM completa)
- `scraper/lib/sii-catastro-cl.mjs` — parser for official SII CSV files
- `docs/SMARTBC-INTEGRACION.md` — integración con el CRM SmartBC: mapeo campo a campo y operación del sincronizador (`scraper/sync-smartbc-cl.mjs`)
- `docs/WHATSAPP-VERIFICACION.md` — verificación en vivo de WhatsApp (número activo + foto actual) de los teléfonos de DealerNet, y el filtro que impide mandar números de baja al CRM. **Leer antes de tocar el worker**: vincula un número real de WhatsApp y puede ser baneado.

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string
- `OPENROUTER_API_KEY` — OpenRouter API key (never commit to git)
- `OPENROUTER_CHAT_MODEL` — optional model override (default: free tier)
