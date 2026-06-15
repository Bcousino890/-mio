<div align="center">

<img src="public/logo.png" alt="Benjamín Cousiño Propiedades" width="280" />

# SmartBC

**Plataforma inmobiliaria privada de Benjamín Cousiño Propiedades · Madrid**

CRM, sindicación de propiedades, captación automatizada y portal del cliente — todo en una sola plataforma.

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-self--host-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Hetzner](https://img.shields.io/badge/Hosting-Hetzner_VPS-D50C2D?style=flat-square&logo=hetzner&logoColor=white)](https://www.hetzner.com/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![React PDF](https://img.shields.io/badge/PDF-react--pdf-FF4136?style=flat-square&logo=adobeacrobatreader&logoColor=white)](https://react-pdf.org/)

</div>

---

## ✨ Qué es

SmartBC es la plataforma cerrada que opera **Benjamín Cousiño Propiedades**, agencia de alta gama de Madrid. Une en un solo sistema:

- 🏛️ **Portal del cliente** — cada cliente accede solo a las propiedades que encajan en su perfil (zona, presupuesto, estancia), guarda favoritos y solicita visitas.
- 🎯 **Dashboard admin** — gestión de clientes, propiedades, agencias colaboradoras, comisiones, edición rica de ficha y galería.
- 🔗 **SmartLinks** — enlaces públicos y enlaces únicos con tracking que la agencia envía por WhatsApp/email. Preview Open Graph optimizado.
- 📄 **PDF descargable** — ficha profesional de la propiedad en 2 páginas, con branding BC, foto + galería.
- 🤝 **Sindicación** — motor automático que importa el catálogo de agencias colaboradoras (Level Real Estate como piloto) cada 6 h.
- 📥 **Import por link** — pegar un URL de Idealista/Fotocasa/Inmoweb y la propiedad entra en el catálogo en segundos.
- 🕵️ **Captación de particulares** — detecta automáticamente anuncios de Idealista publicados por particulares (no agencias) en zonas premium de Madrid. Pipeline de leads para el equipo comercial.

---

## 🧩 Stack

<table>
<tr>
<td><b>Frontend</b></td>
<td>

Next.js 15 (App Router · Server Components) · TypeScript · Tailwind CSS · i18n (es/en/fr/de) · React PDF · Lucide icons

</td>
</tr>
<tr>
<td><b>Backend</b></td>
<td>

Supabase self-hosted (Postgres + Auth + Storage + Realtime) en VPS · Server Actions · RLS · migraciones SQL versionadas

</td>
</tr>
<tr>
<td><b>Infra</b></td>
<td>

Hetzner Cloud · Caddy + Let's Encrypt · Docker · PM2 · Cron jobs · Backups diarios

</td>
</tr>
<tr>
<td><b>Sindicación / Scraping</b></td>
<td>

Cheerio (HTML) · Sharp (imágenes) · Playwright + stealth · Smartproxy residencial · Wayback Machine API · cURL con TLS fingerprint propio · Open Graph

</td>
</tr>
<tr>
<td><b>Geo</b></td>
<td>

Nominatim / OpenStreetMap (geocoding cacheado) · iframe maps con overlay de zona aproximada

</td>
</tr>
</table>

---

## 🚀 Desarrollo local

```bash
npm install
cp .env.example .env.local   # rellena las claves Supabase
npm run dev
```

Abre [http://localhost:3137](http://localhost:3137). Puerto fijo `3137` para evitar colisiones con otros proyectos.

---

## 🗂️ Estructura

```
app/
  (admin)/             # dashboard interno (propiedades, clientes, sindicación, particulares)
  (cliente)/           # portal del cliente final
  compartir/[slug]/    # SmartLink estable (URL pública por propiedad)
  c/[token]/           # SmartLink único por envío comercial (tracking IP/UA/timestamp)
  og/property/[slug]/  # endpoint OG image (preview WhatsApp/Twitter)
  p/[slug]/[idx]/      # proxy de fotos para no exponer rutas de CDN externos
  api/cron/            # crons de sync, particulares, check-bajas

lib/
  sync/                # motor de sindicación + import-by-link + particulares
    scrapers/          # Level, Fotocasa, Idealista, Inmoweb, Mobilia helper
    import-by-link/    # cadena de fallbacks anti-bot (fetch → proxy → Playwright → Wayback)
    particulares/      # detector particular vs profesional
  pdf/                 # generador PDF (react-pdf)
  geo/                 # geocoding cacheado (Nominatim)
  i18n/                # diccionarios es/en/fr/de
  db/                  # adapters + queries + types Supabase

supabase/migrations/   # esquema SQL versionado
public/                # logo, assets estáticos
```

---

## 🛡️ Sindicación y anti-bot

Para alimentar el catálogo desde portales externos, SmartBC implementa una **cadena de fallbacks** que resuelve cada nivel de bloqueo:

1. **Fetch directo** — el camino fácil.
2. **Proxy residencial Smartproxy** — IP española rotativa cuando el portal bloquea datacenters.
3. **Playwright + stealth** — navegador real con `puppeteer-extra-plugin-stealth` para portales con detección JS.
4. **Wayback Machine** — fallback final si el portal aplica DataDome agresivo.
5. **cURL con UA de WhatsApp** — descubrimiento clave para Idealista: el bot de WhatsApp está en whitelist de DataDome para previews. cURL replica el TLS fingerprint que el bot legítimo usa.

Cada portal tiene un extractor dedicado que tras obtener el HTML conoce sus propias particularidades (formato de fotos, JSON embebido, normalización de zonas, etc.).

---

## 🤖 Automatizaciones (cron en el VPS)

| Trabajo | Frecuencia | Descripción |
|---|---|---|
| **Sync sindicación** | cada 6 h | Refresca el catálogo de agencias colaboradoras |
| **Captación particulares** | cada 6 h | Scrape de anuncios de particulares en zonas premium de Madrid |
| **Check bajas** | cada 12 h | Revisita propiedades importadas; archiva las que el dueño retiró |
| **Backup BD** | diario 04:00 | pg_dump → `/opt/backups`, rotación 14 días |

---

## 📜 Licencia

Software propietario · **© Benjamín Cousiño Propiedades**

No se permite la redistribución ni el uso sin autorización explícita.
