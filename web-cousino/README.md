# Benjamín Cousiño Propiedades — Web

Sitio público de la plataforma inmobiliaria de lujo Benjamín Cousiño
Propiedades (España + Chile). Proyecto independiente del motor de
captación/análisis (`../web`, `../scraper`) — comparte repositorio pero no
código ni base de datos.

## Estado actual (MVP)

- Landing, catálogo de propiedades con filtros (país, tipo, precio, búsqueda)
  y ficha de propiedad detallada.
- Formulario de consulta privada (`/api/inquiries`) — valida y registra en
  log de servidor; no hay persistencia ni envío de email todavía.
- Datos de propiedades en `lib/properties.ts` (mock, sin base de datos).
- Conversión EUR/USD/CLP con tasas estáticas en `lib/currency.ts`.
- Un solo idioma (español). Sin autenticación, sin dashboard de cliente.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3000
```

## Siguientes fases (no implementadas)

Multi-idioma, tasas de cambio en tiempo real, tours 360°/Matterport, login y
dashboard VIP (favoritos, alertas, mensajería), backend con base de datos
real (Prisma/Postgres) y recomendaciones por IA.
