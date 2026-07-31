# Integración con SmartBC (CRM de Benjamín Cousiño Propiedades)

Empuja las captaciones ya trabajadas de `-mio` al CRM comercial de SmartBC vía su
API pública v1, para eliminar el alta manual (hoy: la marca `property_cl.smart_crm_at`,
que solo declara "ya la subí a mano").

**Estado: implementado y verificado contra la API real, incluida una prueba de
contrato con escrituras (§10). Falta la corrida contra la base de datos de
producción** — esta sesión no tiene acceso a `DATABASE_URL`.

| Pieza | Fichero |
|---|---|
| Cliente HTTP (auth, reintentos, idempotencia, rate limit) | `web/lib/smartbc/client.mjs` |
| Mapeo campo a campo (funciones puras) | `web/lib/smartbc/mapper.mjs` |
| Normalización geográfica contra su catálogo | `web/lib/smartbc/catalogo.mjs` |
| Sincronizador (consulta, lotes, diffs, log) | `web/lib/smartbc/sync.mjs` |
| CLI (sincronización periódica) | `scraper/sync-smartbc-cl.mjs` |
| Botón "Agregar a Smart" (envío puntual) | `web/app/api/chile/smartbc/route.ts` |
| Selección manual de contactos | `db/migrations/0092_smartbc_seleccion_cl.sql` |
| Log de sincronización | `db/migrations/0091_smartbc_sync_cl.sql` |
| Tests (100, sin red ni BD) | `web/lib/smartbc/*.test.mjs` |

---

## 1. Verificación previa (hecha)

| Paso | Resultado |
|---|---|
| `GET /api/v1/ping` | `200` · cliente `crm chile` (slug `crm-chile`, país `cl`) · scopes `captaciones:read`, `captaciones:write`, `catalogos:read` · 120 req/min |
| `GET /api/v1/openapi` | OpenAPI 3.1 descargado (65 KB, 15 rutas). `Captacion` tiene `additionalProperties: false` → un campo desconocido es `validation_error`, como advierte el contrato |
| `GET /api/v1/catalogos?tipo=enums` | Las 7 listas cerradas, idénticas a la documentación |
| `GET /api/v1/catalogos?tipo=pipelines` | Pipeline `Captaciones` (default) con 9 etapas: `draft`, `preliminary_data`, `assigned` ("Para llamar"), `contacting`, `field_visit`, `revision`, `confirmed`, `converted_to_property`, `rejected` |
| `GET /api/v1/catalogos?tipo=usuarios` | 7 usuarios del equipo |
| `GET /api/v1/catalogos?tipo=regiones` | **16** ✅ |
| `GET /api/v1/catalogos?tipo=comunas` | **346** ✅ (52 en Metropolitana) |
| `GET /api/v1/catalogos?tipo=zonas&comuna=Las Condes` | **7** ✅ |

> **Reportado y arreglado por SmartBC.** Los tres catálogos geográficos devolvían
> `[]`: sus tablas maestras estaban vacías porque el seed original abortaba por dos
> comillas sin escapar (`'O'Higgins'`). Lo reescribieron —16 regiones, 346 comunas,
> 31 sectores— y el handler ya no devuelve `[]` cuando falla la base de datos, sino
> un error explícito. El filtro `?region=` ahora acepta nombre o código (`RM`), sin
> distinguir tildes ni mayúsculas, y cada comuna trae `region_code`.
>
> El arreglo tardó ~35 min en propagarse (migración + despliegue + 10 min de caché):
> a las 19:35 UTC seguía en `[]` y a las 19:37 ya devolvía las 16 regiones.
> Verificado de punta a punta: una captación enviada con nuestra nomenclatura llega
> a su ficha con `commune: "Las Condes"` y `region: "Metropolitana"`.
>
> `web/lib/smartbc/catalogo.mjs` traduce nuestra nomenclatura a la suya
> ("Región Metropolitana de Santiago" → "Metropolitana", "nunoa" → "Ñuñoa") sobre
> texto plegado. Lo que no exista en el catálogo **no viaja**: se acumula en
> `faltantes` y sale en el resumen de la corrida, para llevárselo al equipo de
> SmartBC en vez de forzarlo como texto libre.
>
> **Cruce completo hecho: 56/56 comunas y 3/3 regiones nuestras casan con su
> catálogo, sin discrepancias de región.** La única que no casaba al principio era
> `Til Til`, que ellos escriben `Tiltil` (la grafía oficial). No es una comuna
> ausente sino el mismo topónimo partido distinto, así que se resuelve en el mapeo:
> el índice de comunas se construye con dos claves, con y sin espacios.

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
| `region` | `com.region`, normalizada | Se toma la región **de la comuna del catálogo** (más fiable que la nuestra) y se traduce a su grafía |
| `commune` | `com.name` ?? `cap.comuna_label`, normalizada | **campo del equipo**: solo se escribe si está vacío. Si no está en el catálogo, no viaja (§1) |
| `zone` | `p.localidad` ?? `l.localidad`, normalizada | Sector/balneario. Si la comuna no tiene zonas descargadas, pasa tal cual: no se puede afirmar que falte |
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

## 7. El lote ya no aborta (reportado y arreglado)

Antes, un elemento que incumplía el schema tumbaba el lote entero con un `400`,
en contra de lo que prometía su propia documentación: el cuerpo se validaba
completo antes de procesar ningún elemento. SmartBC lo corrigió — ahora `/batch`
valida el sobre y cada elemento por separado. Verificado en vivo:

```
POST /api/v1/captaciones/batch  →  200
meta.summary: {"total":3,"created":2,"updated":0,"unchanged":0,"failed":1}
data[1]: {"ok":false,"error":{"code":"validation_error",
          "details":[{"field":"property_type","message":"Invalid input"}]}}
```

El sincronizador ya leía los resultados por elemento, así que el camino normal no
cambia. Dos consecuencias sí:

- **`details[].field` se guarda en el log.** Es la parte accionable: dice qué
  campo arreglar en el origen, no solo que algo falló.
- **Un `validation_error` no se reintenta.** `PENDING_SQL` excluye las captaciones
  que fallaron por validación hasta que su `updated_at` avance — el dato está mal
  en nuestro sistema y reenviarlo volvería a fallar en cada corrida, para siempre.
  Los errores transitorios (`429`, `500`, `503`, red) sí se reintentan.

`sendBatchApartandoInvalidos()` se conserva como red de seguridad por si alguna
instancia sigue con el comportamiento antiguo; cuando el arreglo lleve tiempo
asentado se puede borrar.

Los errores de **negocio** siempre vinieron por elemento y siguen igual: un
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

## 9. Hallazgo abierto: un `PATCH` parcial pisa `source_site`

Detectado en la prueba de contrato con escrituras reales. Un `PATCH` que no
incluya `source_site` **lo sobrescribe** con el slug de la integración:

```
PATCH /api/v1/captaciones/<ext>   {"price": 460000000}
→ 200 · changed_fields: ["price", "source_site"]
   source_site: "portalinmobiliario"  →  "crm-chile"
```

Se diffearon las dos fichas completas antes y después de ese `PATCH` mínimo: los
únicos campos tocados fueron `price` (esperado), los timestamps, y `source_site`.
Está aislado a ese campo.

Por qué importa: rompe la premisa de "manda solo lo que cambia". Cada corrección
de precio borraría de qué portal salió el aviso, y como el sincronizador está
pensado para vivir años empujando cambios de precio, la procedencia de todas las
fichas acabaría diciendo `crm-chile`.

**Mitigación en nuestro lado**: `diffPayload()` incluye `source_site` en todo
`PATCH`, cambie o no (y `isEmptyPatch()` lo ignora al decidir si hay algo que
enviar, para que no parezca que todo cambió siempre). Verificado en vivo: con el
escudo, `source_site` se conserva.

**Pendiente de reportar a SmartBC** — el arreglo bueno es suyo: un `PATCH` no
debería aplicar el valor por defecto de un campo que no viene en el cuerpo.

---

## 10. Qué falta por verificar

Los 93 tests cubren cliente, mapeo, catálogo y orquestación sin red ni BD. Además
se corrió una **prueba de contrato con escrituras reales** contra el CRM
(`external_id: mio-test-contrato-20260731`, archivada al terminar):

| Criterio de aceptación | Estado |
|---|---|
| 1. `ping` responde 200 | ✅ |
| 2. Alta con todas sus secciones | ✅ `201 created`, `warnings: []`, 1 contacto · 2 fotos · 1 aviso con su snapshot de precio (salvo `attempts`, que no se envía — §5) |
| 3. Reenviar sin cambios → `unchanged` | ⚠️ **SmartBC no devuelve `unchanged`**: responde `updated` con `changed_fields: []`. No escribe nada, así que el efecto es el correcto, pero el `action` no distingue. El sincronizador cuenta por `changed_fields`, no por `action`, para que el resumen no infle las actualizaciones |
| 4. Cambio de precio → `changed_fields: ["price"]` | ✅ el diff calculado fue `{external_id, price}` y la API confirmó el cambio — con el escudo de `source_site` de §9 |
| 5. Misma `Idempotency-Key` no duplica | ✅ la 2ª llamada devolvió `X-Idempotent-Replay: true` y **el mismo `request_id`** |
| 6. Lote de 100 con uno malo | ✅ `200` con `summary {total:3, created:2, failed:1}` |
| 7. El log refleja lo ocurrido | ⏳ requiere `DATABASE_URL` |

Lo único que sigue sin comprobarse es el punto 7 y la corrida contra captaciones
reales, porque exigen conexión a la base de datos. El primer paso en un entorno
con `DATABASE_URL` es `--dry-run` y revisar que ninguna respuesta traiga
`warnings`.
