# Integración con SmartBC (CRM de Benjamín Cousiño Propiedades)

Empuja las captaciones ya trabajadas de `-mio` al CRM comercial de SmartBC vía su
API pública v1, para eliminar el alta manual (hoy: la marca `property_cl.smart_crm_at`,
que solo declara "ya la subí a mano").

**Estado: implementado y validado en dry-run contra la API real. Sin ejecutar
todavía contra la base de datos de producción** (esta sesión no tiene acceso a
`DATABASE_URL`; ver §8).

| Pieza | Fichero |
|---|---|
| Cliente HTTP (auth, reintentos, idempotencia, rate limit) | `scraper/lib/smartbc-client.mjs` |
| Mapeo campo a campo (funciones puras) | `scraper/lib/smartbc-mapper.mjs` |
| Sincronizador (consulta, lotes, diffs, log) | `scraper/lib/smartbc-sync-cl.mjs` |
| CLI | `scraper/sync-smartbc-cl.mjs` |
| Log de sincronización | `db/migrations/0091_smartbc_sync_cl.sql` |
| Tests (68, sin red ni BD) | `scraper/lib/smartbc-{client,mapper,sync-cl}.test.mjs` |

---

## 1. Verificación previa (hecha)

| Paso | Resultado |
|---|---|
| `GET /api/v1/ping` | `200` · cliente `crm chile` (slug `crm-chile`, país `cl`) · scopes `captaciones:read`, `captaciones:write`, `catalogos:read` · 120 req/min |
| `GET /api/v1/openapi` | OpenAPI 3.1 descargado (65 KB, 15 rutas). `Captacion` tiene `additionalProperties: false` → un campo desconocido es `validation_error`, como advierte el contrato |
| `GET /api/v1/catalogos?tipo=enums` | Las 7 listas cerradas, idénticas a la documentación |
| `GET /api/v1/catalogos?tipo=pipelines` | Pipeline `Captaciones` (default) con 9 etapas: `draft`, `preliminary_data`, `assigned` ("Para llamar"), `contacting`, `field_visit`, `revision`, `confirmed`, `converted_to_property`, `rejected` |
| `GET /api/v1/catalogos?tipo=usuarios` | 7 usuarios del equipo |
| `GET /api/v1/catalogos?tipo=regiones` | **`[]` vacío** |
| `GET /api/v1/catalogos?tipo=comunas` | **`[]` vacío** (probado sin filtro y con `?region=`) |
| `GET /api/v1/catalogos?tipo=zonas` | **`[]` vacío** |

> **Hallazgo a resolver con SmartBC.** El contrato pide normalizar región y comuna
> contra el catálogo, pero los tres catálogos geográficos vienen vacíos. En el
> OpenAPI, `region` y `commune` son texto libre (`string`, máx. 120), así que la
> normalización real ocurre en su servidor. Mientras esos catálogos no se publiquen,
> normalizamos contra **nuestra** tabla `chile_comunas` (346 comunas, nombre y región
> oficiales) y verificamos comuna a comuna en dry-run que SmartBC las acepte sin
> `warnings`. No inventamos texto libre, pero tampoco podemos validar contra su lista.

---

## 2. Unidad de sincronización e identidad

**Una captación de SmartBC = una fila de `captaciones_cl`.**

- `external_id` = **`captaciones_cl.id`** (uuid, PK) con prefijo: `mio-<uuid>`.
  Es el único identificador estable del origen: no cambia nunca, no depende del
  contenido, y sobrevive a re-scrapes, merges de dedup y cambios de precio.
- Descartados a propósito: `source_url` (el contrato prohíbe usar URLs y además la
  URL de un aviso caduca), `property_cl.id` (cambia cuando el dedup fusiona
  propiedades — migración 0079 `manual_merge`), y cualquier hash del contenido.

**Regla anti-duplicado interno.** Dos filas de `captaciones_cl` (dos URLs distintas)
pueden apuntar al mismo `property_cl`. Sincronizar ambas crearía en SmartBC dos
captaciones para un mismo inmueble físico — justo lo que su pestaña "Corredoras"
existe para evitar. Por eso, cuando varias captaciones comparten `property_cl_id`,
**solo sincroniza la principal** y los anuncios de las demás viajan como `listings[]`.
Criterio de "principal" (el mismo que ya usa el backfill de la migración 0083):
`owner_name IS NOT NULL` → `phones IS NOT NULL` → `updated_at` más reciente.

---

## 3. Disparador: qué es "confirmada"

⚠️ **"Confirmada" significa dos cosas distintas en cada lado, y confundirlas
corrompe el pipeline de SmartBC:**

| | Qué significa |
|---|---|
| **`-mio`** | El **rol SII y el dueño** están confirmados (prob. ≥ 0.92 y, si `match_verified`, la dirección del certificado TGR coincide con la del SII). Es confianza **documental sobre la identidad del inmueble**. |
| **SmartBC** | `owner.confirmed` = **el dueño quiere vender**, y mueve la ficha a la etapa "Confirmada". Es una **decisión comercial** que solo puede tomar quien habló con el propietario. |

Nadie llama al propietario desde `-mio`. Por tanto **`owner.confirmed` nunca se
envía** (ni `true` ni `false`), y **la etapa `confirmed` nunca se fija por API**.
Eso lo decide el equipo de SmartBC tras la llamada.

**Condición de envío propuesta** (fila lista para que la llamen):

```sql
stage = 'contact_found'              -- tiene dueño Y teléfonos
AND needs_review = false             -- el rol no quedó en revisión manual
AND match_confidence IN ('confirmed','high')
AND owner_name IS NOT NULL
AND jsonb_array_length(phones) > 0
```

Y se re-sincroniza cuando `updated_at` avanza respecto del último envío registrado.

---

## 4. Mapeo campo a campo

Origen: `captaciones_cl` (`cap`), su `listings_cl` principal (`l`), su `property_cl`
(`p`), `chile_comunas` (`com`) y `corredoras_cl` (`cor`).

### 4.1 Ficha (raíz)

| SmartBC | Origen | Transformación |
|---|---|---|
| `external_id` | `cap.id` | `mio-<uuid>` |
| `title` | `cap.title` | truncar a 500 |
| `description` | `l.description` | truncar a 20 000 |
| `operation` | `cap.operation` | `sale`→`venta`, `rent`→`arriendo` |
| `price` + `currency` | `cap.price_raw`, `cap.currency`, `l.price_uf` | Moneda dual: si el aviso se publicó en UF → `price = l.price_uf`, `currency = "uf"`; si no → `price = cap.price_raw` (CLP), `currency = "clp"`. Nunca se envía el CLP convertido junto a `currency: "uf"` |
| `bedrooms`, `bathrooms` | `cap.bedrooms`, `cap.bathrooms` | directo |
| `square_meters` | `cap.sqm` | superficie total / terreno |
| `useful_square_meters` | `cap.raw_extracted->>'sqm_construida'` | superficie construida |
| `property_type` | `cap.property_type` | tabla §4.6 |
| `features` | `l.features` + derivados de `raw_extracted` | añade `"Piscina"` (`has_pool`), `"N estacionamientos"` (`parking`), `"N bodegas"` (`storage`), `"Condominio"` (`is_condo`); máx. 100 |
| `source_url` | `cap.source_url` | directo |
| `source_site` | `l.portal` | `portalinmobiliario` |
| `cover_photo_url` | `cap.selected_photo_urls[0]` ?? `l.stored_photos[0].bucket_url` ?? `cap.photos[0]` | la foto que el equipo eligió a mano manda |
| `broker_name` | `cor.name_normalized` ?? `l.advertiser_name` | corredora del aviso original |
| `external_reference` | `l.seller_reference` | código interno de la corredora |
| `portal_publication_number` | `l.external_id` | sin el prefijo `MLC-` |
| `published_ago` | — | **no se envía**: el origen no guarda la fecha de publicación del portal, solo `portal_first_seen_at` (cuándo lo vimos nosotros). Derivar "Publicado hace N meses" de ese dato sería mentir |

### 4.2 Ubicación

| SmartBC | Origen | Notas |
|---|---|---|
| `region` | `com.region` | ej. "Región Metropolitana de Santiago". Catálogo remoto vacío (§1) |
| `commune` | `com.name` ?? `cap.comuna_label` | **campo del equipo**: solo se escribe si está vacío |
| `zone` | `p.localidad` ?? `l.localidad` | sector/balneario con identidad propia |
| `subzone` | — | el origen no tiene ese nivel |
| `address_scraped` | `cap.address` | dirección tal cual la publicó el aviso |
| `address_real` | `cap.sii_direccion` | **campo del equipo**. Es la dirección exacta del catastro SII para el rol resuelto — mejor dato que el del aviso. Se envía: si el equipo ya puso una, la API la protege sola |
| `address_verified` | `cap.match_verified` | **campo del equipo**. Solo se envía cuando es `true` (dirección TGR = dirección SII, confirmación documental) |
| `latitude`, `longitude` | `cap.latitude`, `cap.longitude` | |
| `rol_propiedad` | `cap.sii_rol` | **campo del equipo**. Formato "manzana-predio" (ej. `795-198`) |

### 4.3 Propietario y seguimiento

| SmartBC | Origen | Notas |
|---|---|---|
| `owner.name` | `cap.owner_name` | nombre del certificado TGR (o el titular DealerNet si TGR no corrió) |
| `owner.phone` | mejor teléfono de `cap.phones[]` | orden: `calidad` → `ranking` → móvil con WhatsApp primero |
| `owner.contact` | derivado | ej. `"RUT 12.345.678-9 · 4 teléfonos vía DealerNet"` |
| `owner.confirmed` | — | **nunca se envía** (§3) |
| `notes` | derivado, solo procedencia | ej. `"Rol SII 795-198 · match 0.97 verificado con TGR · origen casafari-mio"`. Campo del equipo: si ya escribieron algo, no se pisa |
| `revision_notes`, `next_action_at`, `next_action_note` | — | no se envían: son del trabajo comercial del equipo |

### 4.4 `contacts[]` (máx. 20)

- **Titular**: `external_id: "mio-<uuid>-owner"`, `contact_type: "owner"`,
  `contact_name: cap.owner_name`, `rut: cap.owner_rut`, `phone` = el mejor teléfono,
  `has_whatsapp` = `phones[].whatsapp`, `extra_phones[]` = el resto de sus teléfonos
  (máx. 20) con `label` = `tipo`/`categoria` de DealerNet.
- **Relacionados** (`cap.relacionados[]` = `{rut, dv, nombre, relacion}`): se envía
  **solo el relacionado que tenga al menos un teléfono** asociado (el cruce se hace por
  `phones[].relacion` ↔ `relacionados[].relacion`). Un relacionado sin teléfono no
  aporta nada al equipo y el tope son 20 contactos — DealerNet llega a devolver decenas.
  `external_id: "mio-<uuid>-rel-<rut>"`.
- Mapeo de `relacion` → `contact_type`: `Cónyuge` → `spouse`; `Hijo`, `Hija`, `Madre`,
  `Padre`, `Hermano/a`, `Suegro/a`, `Cuñado/a`, `Nieto/a`, `Tío/a`, `Sobrino/a` →
  `family` (con el texto original en `relationship`); todo lo demás (`Empleador`,
  sociedades…) → `other`, también con `relationship`.

### 4.5 `photos` y `listings[]`

**`photos`** — `mode: "sync"`, hasta 60, `position` = orden de galería.
Se prefiere `l.stored_photos[].bucket_url` (ya re-alojadas en nuestro bucket Hetzner,
no caducan) sobre las URLs del portal; `cap.photos[]` como último recurso.
`selected_photo_urls` **no** recorta la galería: solo elige la portada (§4.1) — es un
subconjunto pensado para la verificación visual con IA, no la galería del inmueble.

**`listings[]`** (máx. 20) — todos los `listings_cl` del mismo `property_cl`, que es
literalmente "la misma propiedad publicada por otras corredoras". Deduplicados por
`source_url`, como pide el contrato.

| SmartBC | Origen |
|---|---|
| `source_url` *(obligatorio)* | `l.source_url` |
| `external_id` | `mio-lst-<listings_cl.id>` |
| `source_site` | `l.portal` |
| `broker_name` | `cor.name_normalized` ?? `l.advertiser_name` |
| `external_reference` | `l.seller_reference` |
| `title`, `description`, `bedrooms`, `bathrooms` | directo |
| `price`, `currency` | misma regla de moneda dual que §4.1 |
| `square_meters` / `useful_square_meters` | `l.square_meters` / `sqm_construida` |
| `region`, `commune`, `zone`, `address_scraped`, `latitude`, `longitude` | vía `l.comuna_id` → `chile_comunas` |
| `cover_photo_url`, `photo_urls[]` | `l.stored_photos[].bucket_url` (máx. 60) |
| `features`, `operation` | directo / `sale`→`venta` |
| `portal_publication_number` | `l.external_id` sin `MLC-` |
| `broker_website_url`, `broker_price`, `broker_currency`, `broker_scraped_at`, `broker_scrape_error` | el anuncio gemelo de `source_type='agency_web'` (crawl de la web propia de la corredora, enlazado por código interno). **Se pliega dentro del aviso del portal de la misma corredora**, no se manda como aviso aparte: es exactamente la distinción portal/web-propia que SmartBC modela, y así su histórico de precios separa bien los dos orígenes |
| `scrape_status`, `scrape_error` | `l.status` (`active`/`gone`) y el último error de crawl |
| `published_ago` | — (mismo motivo que §4.1) |

### 4.6 Tipo de propiedad

| Origen (`property_type`) | SmartBC |
|---|---|
| `casa` | `house` |
| `departamento` | `apartment` |
| `terreno`, `parcela`, `sitio` | `land` |
| `oficina` | `office` |
| `local`, `local comercial`, `bodega`, `industrial` | `commercial` |
| cualquier otro / `NULL` | `other` + valor original en `metadata.property_type_origen` |

### 4.7 Workflow y metadata

| SmartBC | Valor |
|---|---|
| `pipeline` | no se envía (usa el del país) |
| `stage` | **a decidir** — ver §6 |
| `assigned_to_email` | no se envía: SmartBC reparte automáticamente y la asignación es suya |
| `options` | no se envía. Nunca forzamos `overwrite_manual_fields` ni `force_fields` |
| `metadata` | `{ origen: "casafari-mio", captacion_id, property_cl_id, listing_cl_id, sii_rol, sii_comuna_code, match_score, match_confidence, match_verified, tgr_status, dealernet_status, relacionados_total, relacionados_enviados, property_type_origen }` |

---

## 5. Lo que NO se envía, y por qué

| Campo de SmartBC | Motivo |
|---|---|
| **`attempts[]`** | El origen **no registra intentos de contacto con el propietario**: nadie llama desde `-mio`, esa es precisamente la conversación que ocurre en SmartBC. Lo más parecido que tenemos es `dealernet_query_log`, que es un log de consultas a un servicio de datos, no una llamada al dueño. Mapearlo sería fabricar un historial de contacto que no existió. **Esto incumple el criterio de aceptación nº 2 ("con todas sus secciones… e intentos") y no tiene arreglo desde el origen.** |
| `owner.confirmed`, `stage: confirmed` | §3: es la decisión comercial del equipo |
| `published_ago` | §4.1: no tenemos la fecha de publicación real |
| `subzone`, `revision_notes`, `next_action_*` | sin equivalente en el origen |

Y al revés — datos ricos del origen **sin hueco en el contrato**, que van a `metadata`
para no perderlos ni forzarlos en campos que significan otra cosa:

| Dato del origen | Por qué no encaja |
|---|---|
| `match_score`, `match_signals`, `candidates` | La auditoría de por qué creemos que el rol es ese. SmartBC solo tiene `rol_propiedad`, sin campo de confianza |
| `owner_rut_candidates` | Candidatos DealerNet cuando el RUT quedó ambiguo. Enviar un RUT dudoso como `contacts[].rut` sería peor que no enviarlo |
| `emails[]` | El contrato admite `contacts[].email` (uno) pero no una lista con categoría/fuente. Se envía el primero del titular; el resto queda en `metadata` |
| `uf_rate` / `uf_rate_date` / `price_usd` | SmartBC guarda un precio y una moneda, sin la tasa ni su fecha. El histórico de precios comparado entre fechas se queda en el origen |
| `location_confidence`, `identity_signals` | Confianza de la ubicación (4 niveles). SmartBC solo tiene el booleano `address_verified` |
| `corredora_count`, `exclusivity_ratio` | Señales de exclusividad/canje del inmueble |

---

## 6. Decisiones tomadas (todas configurables)

Se implementaron con el valor recomendado; ninguna está enterrada en el código.

| Decisión | Valor por defecto | Cómo cambiarlo |
|---|---|---|
| Condición de envío | `contact_found` + sin revisión + dueño + teléfono (§3) | `PENDING_SQL` en `smartbc-sync-cl.mjs` |
| Etapa inicial | `assigned` ("Para llamar"): la ficha llega con dueño y teléfono verificados, así que entra directa en la cola de llamadas | `--stage preliminary_data`, o `--stage ''` para no opinar |
| `notes` de procedencia | Sí, una línea con rol, score y si está verificado con TGR | `--no-notes` |

---

## 7. Hallazgo: un elemento inválido SÍ tumba el lote

Comprobado en vivo contra la API (en dry-run, sin escribir):

```
POST /api/v1/captaciones/batch  →  400 validation_error
details: [ {"field":"items.1.property_type","message":"Invalid input"},
           {"field":"items.3.currency","message":"Invalid input"} ]
```

El criterio de aceptación nº 6 dice que "un lote de 100 con un elemento inválido
procesa los 99 buenos y reporta el malo, sin abortar". **Eso solo se cumple para
errores de negocio, no de schema.** El cuerpo entero se valida antes de procesar
nada, así que un enum inventado o un tipo equivocado devuelve `400` para las 100.
Lo que sí hace la respuesta es **nombrar cada índice malo**.

Por eso `sendBatchApartandoInvalidos()` aparta los elementos que `details` señala
y reenvía el resto. Sin eso, una sola captación con un dato raro bloquearía a las
otras 99 en cada corrida, indefinidamente.

En cambio los errores de **negocio** sí vienen por elemento y no rompen nada — un
`assigned_to_email` que no existe devuelve `200` con
`warnings: ["No hay ningún usuario con el email …"]`.

---

## 8. Operación

- **Cliente HTTP** con `Authorization: Bearer $SMARTBC_API_KEY` (variable de entorno,
  nunca en el repo), `Idempotency-Key` en toda escritura, reintentos con espera
  exponencial **solo** en `429`/`500`/`503` (respetando `Retry-After`), y **cero**
  reintentos en `400`/`401`/`403`/`409`.
- **Dry-run primero**: todo el desarrollo con `X-SmartBC-Dry-Run: 1` hasta que ninguna
  respuesta traiga `warnings`.
- **Lotes de 100** por `POST /api/v1/captaciones/batch`, por debajo de 120 req/min y de
  los 2 MB de cuerpo. Un elemento inválido no aborta el lote.
- **Solo lo que cambia**: alta completa con `POST`; los cambios posteriores por `PATCH`
  con los campos que de verdad se movieron (se comparan contra el hash del último
  payload enviado, guardado en el log).
- **Log de sincronización** (tabla nueva `smartbc_sync_cl`): por captación —
  `external_id` enviado, `request_id` devuelto, acción (`created`/`updated`/`unchanged`),
  `changed_fields`, `protected_fields`, `warnings`, hash del payload, último error y
  su código HTTP.

```bash
# 1. Comprobar credenciales (no toca nada)
SMARTBC_API_KEY=sbc_live_… node scraper/sync-smartbc-cl.mjs --ping

# 2. Simulación: valida contra SmartBC y dice qué pasaría, sin escribir
SMARTBC_API_KEY=sbc_live_… node scraper/sync-smartbc-cl.mjs --dry-run

# 3. En serio, solo cuando el dry-run no devuelva ningún warning
SMARTBC_API_KEY=sbc_live_… node scraper/sync-smartbc-cl.mjs --limit 100
```

---

## 9. Qué falta por verificar

Los tests (68) cubren cliente, mapeo y orquestación sin red ni BD, y el payload
completo se validó **en dry-run contra la API real**: `warnings: []`, 32 campos
mapeados, 2 contactos, 2 fotos y el aviso de la corredora con su
`broker_price` plegado desde la web propia.

Lo que **no** se ha podido comprobar en esta sesión, porque exige escrituras
reales en el CRM de producción del equipo (y esta sesión no tiene `DATABASE_URL`):

| Criterio de aceptación | Estado |
|---|---|
| 1. `ping` responde 200 | ✅ verificado |
| 2. Alta con todas sus secciones | ✅ verificado en dry-run (salvo `attempts`, que no se envía — §5) |
| 3. Reenviar sin cambios → `unchanged` | ⏳ el dry-run siempre responde `created`; hace falta una escritura real |
| 4. Cambio de precio → `changed_fields: ["price"]` | ⏳ ídem (el diff sí está cubierto por tests) |
| 5. Misma `Idempotency-Key` no duplica | ⏳ ídem |
| 6. Lote de 100 con uno malo | ✅ verificado en dry-run, con la corrección de §7 |
| 7. El log refleja lo ocurrido | ⏳ requiere BD |

El primer paso en un entorno con `DATABASE_URL` es correr `--dry-run` contra
datos reales y revisar que ninguna respuesta traiga `warnings`.
