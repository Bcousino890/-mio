# Plan — Módulo "Anuncios": scraping 24/7, deduplicación y trazabilidad de corredoras (Chile)

**v1.0 · 2026-07-18 · Documento de arranque para ejecutar en fases con Claude Code**

Este documento es el plan de trabajo para convertir el scraping manual/puntual de
Portal Inmobiliario en un **sistema 24/7 que se retroalimenta solo**, con
deduplicación de propiedades y trazabilidad completa de corredoras, integrado
como un apartado **"Anuncios"** del CRM. Cubre primero **Casas usadas en RM**
(no proyectos nuevos), priorizando las comunas que ya identificaste (Colina,
Lo Barnechea, Las Condes, La Reina, Vitacura, Peñalolén, …), y deja Departamentos
y Terrenos como siguiente ronda con la misma arquitectura.

**No es un documento desde cero**: gran parte de la ingesta, normalización y
motor de matching **ya existen en este repo**. La primera mitad de este plan es
un inventario preciso de lo que ya está hecho (para que Claude Code no lo
reconstruya) y la segunda mitad es la lista concreta de lo que falta para
llegar a "sistema 24/7 con trazabilidad de corredoras".

---

## 1. Lo que YA existe en `casafari-mio` (no reinventar)

| Pieza | Archivo(s) | Estado |
|---|---|---|
| Parser de ficha individual (blob `__NORDIC_RENDERING_CTX__`, no HTML plano) | `scraper/lib/parse-portalinmobiliario.mjs` | ✅ Implementado, validado contra 11 fichas reales (Fase 0) |
| Cliente API pública de Mercado Libre (`/sites/MLC/search`, `/items/{id}`) | `scraper/lib/ml-api-client.mjs` | ✅ Implementado; **sin confirmar en producción** si exige `access_token` |
| Normalización UF/CLP dual + tasa del día | `scraper/lib/uf-rate-cl.mjs`, columnas `price/price_uf/uf_rate/uf_rate_date` en `listings_cl` | ✅ |
| Esquema de anuncios crudos Chile | `db/migrations/0028_listings_cl.sql`, `0033` (property_code+media) | ✅ `listings_cl`, un anuncio = una fila, nunca se sobreescribe destructivamente |
| Registro de cambios entre corridas (altas/bajas/precio/agencia) | `db/migrations/0034_listing_version_log_cl.sql` | ✅ `listing_version_log_cl` — exactamente la "trazabilidad de subidas y bajadas" que pediste, YA modelada |
| Blocking laxo para pares candidatos (10+ corredoras republicando lo mismo) | `scraper/lib/group-candidates-cl.mjs` | ✅ Deliberadamente sin exigir dormitorios/m² exactos (ver cabecera del archivo) |
| Motor de resolución de identidad (6 estrategias: triangulación, geocoding, PIP catastral, huella física, pin sospechoso, firma aérea) | `scraper/lib/identity-resolution-cl.mjs` | ✅ Combina señales en `identity_score` + `location_confidence` |
| Pares candidatos a misma propiedad física | `db/migrations/0028` → tabla `listing_match_cl` | ✅ Solo pares, **sin clustering final** (ver hueco #3) |
| pHash de fotos (reutilizable, agnóstico de país) | `scraper/lib/phash.mjs` | ✅ Compartido con España |
| Detección de CRM/web propia por patrón de URL (para agencias españolas) | `scraper/lib/crm-detector.mjs`, `db/migrations/0012/0013` | ✅ Patrón reutilizable, hoy solo cableado para España |
| Enriquecimiento de dueño real (DealerNet, por RUT) | `docs/DEALERNET-PROTOCOLO.md`, `dealernet_contacts_cl` (0035/0053/0054/0036) | ✅ Ya incluye `portal_url` de dónde salió el contacto |
| UI del apartado Anuncios | `web/app/chile/anuncios/page.tsx` + `/api/chile/anuncios` | ✅ Ya existe, filtra por operación/tipo/precio/confianza, con "solo oportunidades" (precio bajo mediana) |
| Investigación de fondo (anti-bot, estructura de datos, estrategias de identidad) | `docs/research-portalinmobiliario-chile.md` | ✅ Documento de referencia técnica, no repetir aquí |
| Deploy VPS sin downtime, imagen pre-construida en runner | `.github/workflows/deploy.yml`, `infra/deploy.sh`, `infra/docker-compose.yml` | ✅ Hetzner **CX33 compartido** (Postgres+PostGIS, Redis, Nominatim propio CL, app) — **no confundir con el CX43 de 16GB del `PLAN-MAESTRO.md` de Madrid**, ese es otro VPS |
| Cola de trabajos ya instalada como dependencia | `pg-boss` en `scraper/package.json` | ⚠️ Instalada pero **sin usar todavía** — es la pieza que falta cablear para el 24/7 (hueco #2) |

**Conclusión clave:** el "programa avanzado de matching" que pedías ya está
diseñado y en gran parte escrito (`identity-resolution-cl.mjs` +
`group-candidates-cl.mjs` + `matching.mjs`). Lo que falta no es el algoritmo de
matching — es (a) que el scraper recorra Portal Inmobiliario **a escala y
sin parar**, (b) que los pares candidatos se conviertan en **propiedades
canónicas**, y (c) una **entidad "corredora"** con historial, no solo un
campo de texto en cada anuncio.

## 2. Aclaración sobre `smartbc` (repo hermano)

Revisé `github.com/Bcousino890/smartbc` como pediste. Es un CRM multi-país con
un flujo de **"import-by-link"**: pegas la URL de un anuncio (Idealista,
Fotocasa, Inmoweb, Clikalia, Ukio, Urbantechome, Yaencontre) y un extractor
dedicado por portal saca los datos — eso es lo manual que describes. Dos
hallazgos importantes:

1. **Portal Inmobiliario NO tiene extractor dedicado en smartbc** —
   `lib/sync/import-by-link/detect-portal.ts` no lo reconoce, así que cualquier
   link de `portalinmobiliario.com` cae al extractor `generic` (probablemente
   OpenGraph/meta tags, mucho más pobre que el blob Nordic).
2. `smartbc` además tiene un flujo **inverso**: publicar propiedades propias
   HACIA Portal Inmobiliario vía la API de Mercado Libre (OAuth,
   `docs/PORTALINMOBILIARIO_INTEGRATION.md`) — es la vía de salida (subir tus
   captaciones al portal), no la de entrada (leer el mercado). Son cosas
   distintas; no aplica a este plan de ingesta/dedup.

**Conclusión:** el parser Nordic-blob que ya existe en `casafari-mio`
(`parse-portalinmobiliario.mjs`) es más avanzado que cualquier cosa disponible
hoy en `smartbc` para este portal. No hay nada que portar desde allá — construimos
sobre lo que ya tienes acá.

## 3. Los huecos reales (lo que falta construir)

### Hueco 1 — Confirmar rate-limit real en producción (bloqueante)
`docs/PORTAL-INMOBILIARIO-SPIKE-0.5.md` ya define el spike (`scraper/spike-rate-limit-vps.mjs`)
pero no hay evidencia en el repo de que se haya ejecutado y documentado el
resultado contra el VPS real. **Antes de programar un barrido 24/7 hay que
correr este spike una vez** y decidir concurrencia segura / si hace falta
SmartProxy (ya contratado, `SMARTPROXY_CL_*` en secrets).

### Hueco 2 — Crawler de listado (discovery), no solo ficha individual
Hoy `parse-portalinmobiliario.mjs` sabe leer **una ficha** dado su URL/ID. Falta
el crawler que recorra `portalinmobiliario.com/venta/casa/propiedades-usadas/<comuna>-metropolitana`
página por página, extraiga los IDs `MLC-...` del listado y encole el detalle
de cada uno. El research (`docs/research-portalinmobiliario-chile.md`, apéndice)
marca esto explícitamente como no verificado (`parseListPage()`).

### Hueco 3 — Orquestación continua 24/7 en el VPS (el corazón de tu pedido)
Hoy todo se dispara **a mano o por archivo centinela** vía GitHub Actions
(`.github/workflows/scrape-*.yml`, patrón `.launch-*`/`.check-status`) — es
exactamente el "todo manual" que quieres dejar atrás. `pg-boss` (cola sobre el
propio Postgres, ya usa el mismo `DATABASE_URL`) está instalada pero no
cableada. Falta:
- Un **worker Node persistente** (`scraper/worker-cl.mjs`, nuevo) corriendo
  como servicio Docker en `infra/docker-compose.yml` (o `systemd`), no como
  workflow de CI.
- Jobs recurrentes en `pg-boss`: `discovery:<comuna>:<tipo>:<operacion>` (cada
  4-24h según prioridad), `detail:<mlc_id>` (encolado por discovery),
  `identity-resolve:<listing_id>`, `dedup-cluster` (periódico), `broker-enrich:<advertiser>`.
- Detección de baja: si un `MLC-...` activo no aparece en el barrido siguiente
  de su comuna → `taken_down_at` + fila en `listing_version_log_cl` tipo
  `delisted` (la tabla ya soporta esto, falta quien la alimente a escala).

### Hueco 4 — Propiedad canónica (`property_cl`), no solo pares
`listing_match_cl` da pares con score, pero **no existe la tabla `property_cl`**
que agrupe N anuncios de N corredoras bajo una misma propiedad física (el
equivalente chileno de `property`/RC20 en España, ver `db/migrations/0004` y
`0008`). Falta:
- Clustering por componentes conexos sobre `listing_match_cl` con
  `status = 'confirmed'` (reutilizar `graphology` + `graphology-components`,
  ya dependencias del scraper — mismo patrón que España en `lib/clustering.mjs`).
- Elegir el valor de mayor confianza por campo dentro del cluster (coordenadas
  del listing con `location_confidence` más alta, m² más repetido, precio más
  bajo como "precio de mercado" — tal como definiste en la estrategia original).
- Cola de revisión manual para clusters con score intermedio (0.45–0.75 en
  `CL_IDENTITY_THRESHOLDS`, ya definidos en `identity-resolution-cl.mjs`).

### Hueco 5 — Entidad "Corredora" con trazabilidad (hoy es solo texto)
`listings_cl.advertiser_name`/`phone` son campos de texto libre — no existe una
tabla `corredoras_cl` que consolide identidad de la corredora entre sus
republicaciones y calcule métricas. Falta:
- `corredoras_cl` (nombre normalizado, teléfono(s), agrupación por
  `advertiser_type='professional'` + nombre/teléfono recurrente).
- Métricas derivadas: stock activo, velocidad de rotación (días promedio hasta
  `delisted`), % de propiedades que solo publica ella (exclusividad aparente),
  comunas donde opera, historial de cambios de precio agregado.
- `web_propia_url`: extraída por regex de la descripción/campos del anuncio
  cuando la corredora la publica, o por búsqueda web del nombre comercial
  + "corredora" + comuna cuando no — mismo patrón que `crm-detector.mjs`
  (España) pero para el ecosistema de webs de corredoras chilenas.
- Crawler liviano opcional (Fase 5) de esa web propia para detectar inventario
  que no está en Portal Inmobiliario ("stock oculto").

### Hueco 6 — Cobertura real: RM completo por comuna, casas primero
El plan de arranque es exactamente el que ya trajiste: Venta+Arriendo de
**Casas usadas** (no proyectos) en RM, comunas prioritarias primero (Colina,
Lo Barnechea, Las Condes, La Reina, Vitacura, Peñalolén, y luego el resto de
la RM). Deptos y Terrenos quedan para la ronda 2 reusando la misma arquitectura
(el filtro de tipo de propiedad ya es un parámetro de la URL de listado).

---

## 4. Principios de diseño (heredados + nuevos, no negociables)

1. **Nunca se sobrescribe un snapshot.** `listings_cl` se actualiza (mismo
   patrón que ya existe), pero cada cambio relevante deja huella en
   `listing_version_log_cl`. Ya implementado — solo falta alimentarlo a escala.
2. **location_confidence nunca se asume, se calcula.** Ya resuelto por
   `identity-resolution-cl.mjs`; el crawler de discovery no debe tocar esta lógica.
3. **El blocking chileno es deliberadamente laxo** (comuna + operación amplia +
   banda de precio, sin exigir dormitorios/m² exactos) — no "arreglar" esto
   para que se parezca al de España; es una decisión ya documentada y correcta
   para este mercado.
4. **Todo nuevo objeto Chile usa sufijo `_cl`**, en paralelo a España, nunca
   mezclado en las tablas de España (mismo patrón que 0020/0021/0028).
5. **El VPS es compartido y de 8GB** (CX33, con `zintoleads` en el mismo nginx).
   Cualquier proceso 24/7 nuevo se diseña con límites de memoria explícitos en
   `docker-compose.yml`, igual que ya se cuida en `infra/deploy.sh` (swap
   garantizado, `SKIP_BUILD=1`). El `PLAN-MAESTRO.md` de Madrid (CX43, 16GB
   dedicado) **no es el presupuesto de este módulo** — hay que rehacer el
   cálculo de recursos para el VPS real (§6).
6. **API de Mercado Libre como fuente preferida de campos duros, HTML/Nordic
   blob como fallback** — ya es la decisión tomada en `ml-api-client.mjs`;
   el primer trabajo real de Fase 0 es confirmar si sigue siendo accesible sin
   `access_token`.

---

## 5. Arquitectura del sistema 24/7 propuesta

```
                    ┌─────────────── VPS Hetzner CX33 (compartido) ───────────────┐
                    │                                                              │
  Portal Inmobiliario   worker-cl.mjs (proceso Node persistente, PM2 o systemd)    │
  (API MLC + HTML) ─┐   │                                                          │
                    │   │  pg-boss (cola sobre el mismo Postgres, sin Redis extra) │
                    ├──▶│  ┌────────────────────────────────────────────────┐     │
                    │   │  │ discovery:<comuna>:<tipo>:<op>  (cron interno)  │     │
                    │   │  │   → lista de MLC-id nuevos/vistos               │     │
                    │   │  │ detail:<mlc_id>                                 │     │
                    │   │  │   → parse-portalinmobiliario.mjs / ml-api-client│     │
                    │   │  │ identity-resolve:<listing_id>                   │     │
                    │   │  │   → identity-resolution-cl.mjs (ya existe)      │     │
                    │   │  │ dedup-cluster (periódico)                       │     │
                    │   │  │   → NUEVO: listing_match_cl → property_cl       │     │
                    │   │  │ broker-enrich:<advertiser>                      │     │
                    │   │  │   → NUEVO: corredoras_cl + métricas + web propia│     │
                    │   │  └────────────────────────────────────────────────┘     │
                    │   └──────────────────────────┬───────────────────────────┘  │
                    │                              ▼                              │
                    │   PostgreSQL + PostGIS (ya en docker-compose)                │
                    │   listings_cl · listing_version_log_cl · listing_match_cl    │
                    │   property_cl (NUEVO) · corredoras_cl (NUEVO)                │
                    │                              │                              │
                    │                              ▼                              │
                    │   CRM /chile/anuncios (ya existe, se amplía con             │
                    │   propiedad canónica + ficha de corredora)                   │
                    └──────────────────────────────────────────────────────────────┘
```

`worker-cl.mjs` es un proceso Node de vida larga (no un cron de GitHub
Actions): al arrancar, programa los jobs recurrentes de `pg-boss` con la
cadencia por comuna (prioritarias cada 6-8h, resto cada 24h) y deja workers
escuchando la cola. Se despliega como un servicio más de
`infra/docker-compose.yml`, con `mem_limit` explícito, igual que la app y
Postgres ya lo tienen.

---

## 6. Roadmap por fases (para ejecutar en Claude Code)

### Fase 0 — Confirmar supuestos bloqueantes (antes de escribir código nuevo)
1. Ejecutar el spike de rate-limit ya definido (`docs/PORTAL-INMOBILIARIO-SPIKE-0.5.md`)
   contra el VPS real. Documentar resultado (conc. segura, ¿hace falta SmartProxy?).
2. Confirmar si `/sites/MLC/search` y `/items/{id}` siguen accesibles sin
   `access_token` (spike corto con `ml-api-client.mjs`).
3. Verificar el HTML real de una página de listado (`.../venta/casa/propiedades-usadas/las-condes-metropolitana`)
   para terminar `parseListPage()` — hoy no hay muestra real subida al repo.

### Fase 1 — Discovery crawler + cobertura Casas RM (comunas prioritarias)
1. `scraper/lib/discovery-portalinmobiliario-cl.mjs`: recorre listado por
   comuna+operación+tipo=casa, pagina, extrae `MLC-id` + URL.
2. Encolar detalle de cada ID nuevo con `ml-api-client.mjs` (preferido) /
   `parse-portalinmobiliario.mjs` (fallback) → upsert en `listings_cl`.
3. Piloto: Las Condes o Vitacura (volumen medio) antes de las 6 comunas completas.
4. Detección de altas/bajas ya modelada (`listing_version_log_cl`) — verificar
   que el upsert realmente escribe `delisted`/`reactivated`/`price_change` al
   comparar contra el estado anterior.

### Fase 2 — Orquestación 24/7 real
1. `scraper/worker-cl.mjs` + jobs `pg-boss` (discovery recurrente, detail,
   identity-resolve).
2. Nuevo servicio en `infra/docker-compose.yml` (`mem_limit` conservador,
   recordar que comparte VPS con `zintoleads`).
3. Retirar el patrón de disparo manual por archivo centinela para este flujo
   (los workflows de GitHub Actions quedan solo para tareas puntuales/SII, no
   para el barrido continuo de anuncios).

### Fase 3 — Propiedad canónica (`property_cl`) y clustering real
1. Migración `property_cl` (equivalente `property`/0004 de España, con sufijo `_cl`).
2. Job de clustering sobre `listing_match_cl.status = 'confirmed'`
   (componentes conexos, `graphology`).
3. Selección de valor "ganador" por campo dentro del cluster.
4. Cola de revisión manual para score intermedio, expuesta en el CRM.

### Fase 4 — Entidad Corredora + trazabilidad
1. Migración `corredoras_cl` + vínculo `listings_cl.corredora_id`.
2. Job de consolidación (agrupar por nombre normalizado + teléfono recurrente).
3. Métricas: stock activo, rotación, exclusividad, comunas de operación.
4. Extracción de `web_propia_url` (regex sobre descripción/datos del anuncio)
   + enriquecimiento manual/asistido cuando no está explícita.
5. Ficha de corredora en el CRM (`/chile/corredoras/[id]`, nuevo).

### Fase 5 — Ampliar el apartado "Anuncios" del CRM
1. Vista de propiedad canónica con sus N listings + timeline de precio (la
   UI actual ya lista anuncios individuales — falta la vista "1 propiedad, N
   corredoras").
2. Mapa con pines por `property_cl` en vez de por anuncio individual.
3. Cola de revisión de matches dudosos (ya hay UI de badges de confianza que
   extender).
4. (Opcional) Crawler ligero de webs propias de corredoras para inventario oculto.

### Fase 6 — Expansión de cobertura
1. Sumar Departamentos (mismo pipeline, cambia el filtro de tipo en discovery).
2. Sumar Terrenos.
3. Sumar el resto de comunas RM más allá de las 6 prioritarias.

---

## 7. Presupuesto de recursos (VPS real, no el de Madrid)

El VPS de producción de Chile es el **mismo Hetzner CX33 compartido** que ya
corre Postgres+PostGIS, Redis, Nominatim propio y la app Next.js (más
`zintoleads` en el mismo nginx). El `PLAN-MAESTRO.md` de Madrid asume un CX43
de 16GB **dedicado** — no es comparable. Antes de la Fase 2, dimensionar en
conjunto: cuánta RAM real le puede tocar a `worker-cl.mjs` sin arriesgar OOM de
Postgres (el mismo problema que ya resolvió `infra/deploy.sh` con swap
garantizado). Probablemente el worker de scraping deba ser deliberadamente
liviano (curl + parseo, sin Playwright) para caber.

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Rate-limit/WAF de Portal Inmobiliario al pasar de fichas sueltas a barrido continuo | Fase 0 obligatoria antes de escalar concurrencia; SmartProxy CL ya contratado como respaldo |
| OOM en el VPS compartido (Postgres + worker nuevo + app + Nominatim) | `mem_limit` explícito en el nuevo servicio, swap ya garantizado por `deploy.sh`, worker sin navegador headless |
| Falsos positivos de clustering (`property_cl`) por direcciones/pines poco fiables en Chile | Umbrales ya definidos en `CL_IDENTITY_THRESHOLDS` (0.75 confirmado / 0.45 candidato); cola de revisión manual obligatoria antes de exponer "exclusividad rota" como dato comercial |
| Legal/ToS de Mercado Libre al hacer scraping a escala | Rate-limit cortés, no autenticarse con cuenta propia para leer, tratar el dato como señal interna de captación (mismo criterio ya aplicado en `PLAN-MAESTRO.md` para España) |
| Confundir este VPS con el de Madrid al planificar capacidad | Este documento fija explícitamente que es el CX33 compartido (§7) |

## 9. Decisiones que confirmar antes de empezar Fase 1

1. ¿Arrancamos piloto en **una sola comuna** (recomendado: Las Condes o
   Vitacura) antes de las 6 prioritarias completas, para calibrar umbrales con
   volumen manejable — mismo criterio que ya se usó para Salamanca/Goya en España?
2. Cadencia de barrido por comuna prioritaria: ¿cada 6h, 8h o 24h? Define carga
   sobre el VPS compartido y GB de SmartProxy si hiciera falta.
3. ¿El worker 24/7 vive en el mismo contenedor Docker que la app, o como
   servicio separado en `docker-compose.yml`? (Recomiendo separado, con su
   propio `mem_limit`, para no arriesgar la disponibilidad del CRM si el
   scraper se cuelga.)

---

**Próximo paso inmediato:** ejecutar Fase 0 (spike de rate-limit + spike de API
MLC) y traer los resultados aquí antes de tocar código de discovery/orquestación.
