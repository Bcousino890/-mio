# SII Enrichment Roadmap — Unificación Visor Catastral + Catastro Chile

**v1.0 · 2026-07-10 · Análisis de `/chile/street` y `/chile/catastro` + lluvia de ideas de unificación**

Este documento consolida el roadmap de enriquecimiento SII para Chile (referenciado desde `CLAUDE.md`; hasta ahora estaba repartido entre `PLAN-MAESTRO.md`, `INVESTIGACION-CATASTRO-CL-2026.md`, `RC-CHILE-INVESTIGACION.md` y los comentarios de las migraciones).

---

## 1. Estado actual: dos módulos que hablan de lo mismo sin hablarse

| | `/chile/street` (Visor catastral) | `/chile/catastro` (Catastro Chile) |
|---|---|---|
| Archivo | `web/app/chile/street/page.tsx` | `web/app/chile/catastro/page.tsx` (~1.250 líneas) |
| Mapa | `web/components/map/StreetViewMap.tsx` con **polígonos de parcelas reales clicables** (`/api/chile/parcels-bbox` → `cadastre_parcels_cl`) | `web/components/map/GoogleMapsView.tsx` con **solo pins** (`use-sii-role-pins`, `use-cadastre-parcels`) |
| Datos del predio | Ficha mínima: avalúo, exento, contribución, destino, link genérico a SII | Ficha completa: detalle rol + construcciones + **dueño DealerNet** + **certificado TGR** + unidades de edificio + UF/CLP + distribución de superficies |
| Búsqueda | `/api/chile/sii-search` (rol + dirección trigram + fallback mapasui) | `/api/chile/sii-roles-list` (filtros destino/avalúo/superficie/ubicación, orden, paginación) |
| Estado en URL | Ninguno (no hay deep-links) | Ninguno |

**El problema:** el mejor mapa está en `street` y los mejores datos en `catastro`. Al hacer clic en una parcela en `street` solo se ven 4 números; para el dueño o la deuda TGR hay que ir a `catastro` y buscar el rol a mano. Duplicación real: dos componentes de mapa, dos búsquedas, dos fichas, dos diccionarios `DESTINO`.

### Decisión de mapa (2026-07-10)

**Imagen base: satélite de Google vía tiles estáticos gratis** (`https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}`, `lyrs=y` = híbrido con nombres de calles), sin API key ni SDK oficial de Google (que factura pasado el crédito mensual — no es "gratis siempre"). Patrón que ya estaba en producción en `ListingMatchMap.tsx`. **Aplicado** en `StreetViewMap.tsx` y `GoogleMapsView.tsx`; el satélite Esri queda retirado de estos visores.

**Botón "Google Earth"** junto a las coordenadas del predio (ficha de catastro y tarjeta de street): abre `earth.google.com/web` centrado en el punto con vista 3D (helper `googleEarthUrl` en `web/lib/map-links.ts`). **Aplicado.**

### Inventario de APIs (`web/app/api/chile/`)

| Endpoint | Usado por | Tablas |
|---|---|---|
| `sii-search` | street (barra única: rol o dirección) | `sii_roles_cl` + fallback `sii_mapasui_predios_cl` |
| `sii-roles-list` | catastro (lista filtrada/paginada) | `sii_roles_cl` LEFT JOIN `property_rc_cl` |
| `sii-rol-detail` | catastro (ficha completa + construcciones) | `sii_roles_cl`, `sii_construcciones_cl` |
| `sii-building-units` | catastro (unidades de un edificio por `rol_padre`) | `sii_roles_cl` |
| `sii-roles-in-zone` (POST shape) | **nadie** (implementado sin UI) | `cadastre_parcels_cl` + `sii_roles_cl` (PostGIS) |
| `sii-roles-geojson` | catastro (pins por viewport) | `sii_roles_cl` |
| `parcels-bbox` | street (polígonos por viewport) | `cadastre_parcels_cl` |
| `parcel-geojson` | street (polígono del rol seleccionado) | `cadastre_parcels_cl` |
| `sii-stats` / `cadastre-geojson` | catastro (header / capa parcelas) | `sii_roles_cl` / `cadastre_parcels_cl` |
| `dealernet-lookup` / `dealernet-buscar` | catastro (dueño por RUT / candidatos por nombre) | `dealernet_*_cl` |
| `tgr-lookup` | catastro (certificado TGR, headless ~10-25 s, caché 24 h) | `tgr_certificados` |

### Enriquecimiento ya migrado (base de datos)

- `0021` — núcleo `sii_roles_cl` + `sii_construcciones_cl` (archivos planos SII subidos a mano, nunca scrapeados).
- `0029` — `lat`/`lng`/`geom` (Point + GiST + trigger) + `nombre_propietario` + `dfl2_flag` (generada, ≤140 m²).
- `0030` — `sii_transacciones_cl` (ventas CBR: escritura, monto CLP/UF, foja, h3, `uf_por_m2` generado) + vista `sii_transacciones_recientes_cl`. **Sin UI ni API todavía.**
- `0040` — `superficie_construida_m2` sincronizada por trigger desde construcciones.
- `0045-0046` — `tgr_certificados` + detalle (espejo Postgres del scraper TGR).
- `0035/0053` — DealerNet: contactos, teléfonos, direcciones, emails, relacionados.
- `0047` — pipeline de captaciones. `0052` — `sii_mapasui_predios_cl` (scrape, separado a propósito de los datos oficiales).

### Discrepancia conocida (documentada para no tropezar de nuevo)

Los `siiCode` hardcodeados en `catastro/page.tsx` (Vitacura `15160`, Las Condes `15108`, Lo Barnechea `15161`, Colina `14201`) **no** son los códigos oficiales `131xx` que asignó la migración `0022`; corresponden a los códigos reales de los archivos SII subidos, alineados en las migraciones `0024-0027` ("align_sii_comuna_codes_with_real_uploads"). Ante cualquier cruce por comuna, la fuente de verdad es `chile_comunas.sii_comuna_code`.

---

## 2. Lo que ya estaba planificado y sigue pendiente de conectar

- **Pestaña "Oferta"** (catastro): hoy pinta `MOCK_LISTING_PINS` (`web/lib/mock-chile-cadastre`). El plan: conectarla al pipeline real de anuncios (Portal Inmobiliario → `/chile/captar-url` → triangulación anuncio→rol SII).
- **Pestaña "Ventas"** (catastro): "Próximamente". La tabla `sii_transacciones_cl` ya existe con datos CBR; falta un endpoint (p. ej. `sii-transacciones`) y la UI (capa en mapa + historial en la ficha del rol).
- **`sii-roles-in-zone`**: endpoint PostGIS completo (polígono/círculo/rectángulo → roles + avalúo agregado) sin ningún consumidor en la UI.
- **Zonas sin datos** en el selector de catastro (Providencia, La Reina, Ñuñoa, Zapallar, Maitencillo, Pucón, Villarrica): CTA a `/settings` para subir archivos SII.

---

## 3. Lluvia de ideas (2026-07-10) — qué construir sobre la unificación

### Núcleo: la unificación en sí (Fase 1)

1. **Un solo módulo "Catastro" con el mapa de street sobre satélite de Google**: mapa a pantalla completa con polígonos clicables; clic en parcela → ficha completa (rol, construcciones, dueño DealerNet, TGR, unidades de edificio). Panel lateral = el panel actual de catastro con sus tabs. `/chile/street` redirige al unificado.
   - Generalizar `StreetViewMap.tsx` (props para pins de roles/oferta + callback de clic) y reemplazar `GoogleMapsView` en catastro.
   - Clic en polígono → `sii-rol-detail`; selección en lista → `parcel-geojson` para pintar/encuadrar (cadena de fallback ya escrita en street: polígono → coords SII → centro comuna → Nominatim).
2. **Deep-links**: estado en URL (`?comuna=&rol=&tab=&filtros`) para compartir un predio por WhatsApp.
3. **Búsqueda unificada**: una barra que acepte dirección, rol, coordenadas o link de Google Maps (casi todo existe en `sii-search`); extraer los diccionarios `DESTINO`/`formatCLP` duplicados a un módulo compartido.

### Capas analíticas sobre los polígonos (Fase 2) — el mapa deja de ser decorativo

4. **Coropletas por parcela**: colorear polígonos por avalúo/m², destino SII, año de construcción, construido vs terreno. El "Casafari chileno" visual.
5. **Capa deuda TGR**: parcelas con `tiene_deuda=true` en rojo → leads con presión de venta (distressed).
6. **Índice de potencial de desarrollo**: terreno grande + construcción vieja/pequeña + avalúo terreno ≫ construcción = candidato a demolición/desarrollo. 100% calculable con datos ya cargados.
7. **Capa DFL2** (`dfl2_flag` ya es columna generada): filtro fiscal clave para inversionistas.
8. **Farming por zona**: dibujar polígono/radio en el mapa → `sii-roles-in-zone` → lista de roles → "obtener dueños" en lote (DealerNet) → exportar CSV de captación.
9. **Watchlists por zona**: guardar el polígono y alertar cuando aparezca oferta nueva o venta CBR dentro.

### Conectar las pestañas muertas (Fase 3)

10. **Oferta real**: reemplazar los mocks por anuncios triangulados → ver qué parcelas están en venta y a qué precio vs avalúo.
11. **Ventas CBR**: capa + historial del predio desde `sii_transacciones_cl` (uf/m² real por manzana).
12. **Oportunidades sobre el mapa**: el módulo `/chile/oportunidades` (precio bajo mediana) como una capa más del visor (cruce oferta vs avalúo vs ventas).

### Producto / salida (Fase 4)

13. **Informe PDF por predio** (ficha + dueño + deuda + comparables de zona), espejo del informe de valoración del plan maestro de Madrid — gancho de captación.
14. **Modo terreno (móvil)**: visor a pantalla completa + geolocalización del captador caminando la zona, tocando parcelas para ver el dueño en la calle.

---

## 4. Estado de ejecución

| Ítem | Estado |
|---|---|
| Satélite de Google (tiles gratis) en los visores | ✅ Hecho (2026-07-10) |
| Botón "Google Earth" junto a coordenadas | ✅ Hecho (2026-07-10) |
| Fase 1: unificación — `/chile/catastro` es el visor único (clic en parcela → ficha completa, polígono del rol seleccionado, deep-links `?zona=&rol=&tab=`, búsqueda global de respaldo, `/chile/street` redirige) | ✅ Hecho (2026-07-10) |
| Fases 2-4 | 💡 Backlog (este documento) |
