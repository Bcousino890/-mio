# Brief P3 — Producto y entrenamiento

> Lee `docs/PLAN-LOCALIZADOR-IA-CL.md` completo antes de escribir código, sobre todo §4 (fases F7a, F7b, F5a) y §10 (orquestación). Este brief resume lo tuyo, no reemplaza el plan.

## Tu puesto

Eres **P3**, la interfaz y el corpus de entrenamiento. Construyes la pantalla donde el usuario confirma en segundos si una casa es la correcta — y cada clic suyo entrena al sistema. Eres además el dueño de todo el conocimiento humano acumulado: las captaciones ya confirmadas, los pins corregidos a mano y las uniones de propiedades que el usuario ya hizo.

- **Rama**: `feat/localizador-p3-producto`
- **Migración reservada**: `0104`
- **Arrancas el día 1** con datos mock — no esperas a P1.

### Modelo y esfuerzo por tarea

Tu puesto es el más barato de operar: **Sonnet 5 cubre casi todo**.

| Tarea | `/model` | Esfuerzo | Por qué |
|---|---|---|---|
| `0104` migración | `claude-sonnet-5` | Bajo | DDL simple |
| F7a script de semilla | `claude-sonnet-5` | Medio | ETL con mapeo cuidadoso de fuentes |
| F7b pantalla y carrusel | `claude-sonnet-5` | Medio | UI React, patrón del repo |
| F7b mapa con pins por corredora | `claude-sonnet-5` | Medio | Reutiliza `corredora-pin-colors.ts` |
| F7b atajos de teclado y flujo | `claude-sonnet-5` | Medio | UX, iterar rápido |
| **F7b query de active learning** | `claude-opus-5` (o Sonnet si no hay) | **Alto** | Elegir qué caso mostrar decide cuánto aprende el sistema |
| F7b endpoint `/confirm` | `claude-sonnet-5` | Medio | Escribe ROL: cuida `normalizeClRol` |
| Etiquetas desde merge/split | `claude-sonnet-5` | Medio | Extensión acotada de un endpoint |
| F5a cola de revisión | `claude-sonnet-5` | Medio | Reutiliza endpoints existentes |
| F9 UI de departamentos (Ola 2) | `claude-sonnet-5` | Medio | Lista corta de unidades candidatas |

**Si no tienes Opus**: la query de active learning con Sonnet funciona; solo asegúrate de probar el criterio con datos reales (¿los casos que salen son de verdad los dudosos?) antes de darlo por bueno.

## Archivos de los que eres dueño

```
web/app/chile/localizador/page.tsx                          (nuevo — pestañas Revisión + Entrenar)
web/app/api/chile/property-locator/[id]/confirm/route.ts     (nuevo)
web/app/api/chile/property-locator/entrenar/route.ts         (nuevo)
web/lib/property-cl-merge.ts                                 (modificas)
scraper/seed-locator-labels-cl.mjs                           (nuevo)
db/migrations/0104_locator_labels_cl.sql
```

## Por qué tu puesto es urgente

El gold set actual son **~73 captaciones confirmadas** (no 15.000 — esos son los anuncios totales). Con 73 etiquetas no se calibra nada, y sin calibración el sistema no llega al 90% de acierto. Tu pestaña "Entrenar" es lo que hace crecer el corpus rápido, así que **no eres una fase tardía: eres el tercer merge del proyecto**.

## Tus tareas, en orden

### 1. Migración `0104` — `locator_labels_cl` (lo primero)

Esquema exacto en §4-F7a del plan. Resumen: `kind` ∈ `rol_match`/`pair_match`; `property_cl_id`; `rol` + `sii_comuna_code` (para rol_match); `listing_a` + `listing_b` (para pair_match); `label` ∈ `yes`/`no`/`unsure`; `source` ∈ `entrenar_tab`/`review_queue`/`captacion_confirmada`/`manual_merge`/`manual_split`/`pin_manual`; `signals jsonb` (snapshot de las señales al momento de etiquetar — esto es lo que luego calibra P1).

Es un **contrato congelado** (§10.3): P1 la lee para calibrar. Puedes añadir columnas, nunca renombrar ni quitar.

### 2. F7a — Semilla: importar el conocimiento humano que ya existe

`scraper/seed-locator-labels-cl.mjs`, script idempotente que llena `locator_labels_cl` con lo que el usuario ya decidió:

- captaciones con `sii_rol` confirmado → `source='captacion_confirmada'`;
- pins manuales (`property_cl.manual_latitude/longitude` → `resolveRolAtPoint`) → `source='pin_manual'`;
- **todas las uniones y separaciones manuales de propiedades de corredoras distintas** (`property_merge_log_cl`: action merge → pares con `label='yes'`; action split → `label='no'`) → `source='manual_merge'`/`'manual_split'`;
- pares de `listing_match_cl` con `decided_by='human'`.

**Hecho cuando**: el corpus arranca en varios cientos de etiquetas en vez de 73.

### 3. F7b — La pestaña "Entrenar" (tu pieza principal)

`web/app/chile/localizador/page.tsx` con dos pestañas: **Revisión** (cola de baja confianza) y **Entrenar** (etiquetado rápido).

**Diseño de la pestaña Entrenar — un caso por pantalla:**
- Fotos del anuncio en carrusel (vienen de varias corredoras del mismo clúster — indica de cuál es cada una).
- Mapa con la parcela candidata resaltada + los pins de cada corredora en colores distintos (reutiliza `corredora-pin-colors.ts`).
- Dirección SII propuesta, y comparación física en una línea: m² del anuncio vs m² SII, dormitorios, año de construcción.
- Botones grandes: **"✅ Es exacta" · "❌ No es" · "➡️ Ver otro candidato" · "Saltar"**.
- **Atajos de teclado** (1/2/3/espacio) — el objetivo es etiquetar sin tocar el ratón.

**Active learning** (aquí usa Opus 5): la query prioriza los casos donde el modelo duda — probabilidad del top-1 entre **0.5 y 0.9**. Son los que más enseñan. Intercala ~1 de cada 10 casos de alta confianza para auditar que los auto-confirmados sean realmente correctos.

**Modo pares**: cuando hay pares del dedup en la zona gris (score 0.45-0.75), muestra los dos anuncios lado a lado — "¿Son la misma propiedad?" — y escribe `kind='pair_match'`. Este es el caso de **misma propiedad publicada por corredoras distintas**, el que más le cuesta al sistema.

**Doble efecto de cada confirmación**: "✅ Es exacta" guarda la etiqueta **y** confirma el ROL en `property_cl` (escribe `rol_matriz` con `normalizeClRol` de `web/lib/rol-format.ts`, `rol_confidence=1`, `location_confidence='confirmed'`). El usuario entrena y trabaja a la vez.

**Hecho cuando**: etiquetar 25 casos toma menos de 5 minutos usando solo el teclado.

### 4. Etiquetas desde las uniones manuales futuras

Los endpoints que ya existen — `POST /api/chile/property-cl/merge` y `/split` (`web/lib/property-cl-merge.ts`) — son los botones "Unir"/"Separar" que el usuario ya usa a diario en `/chile/propiedades`. Extiéndelos para que **cada unión o separación nueva escriba su etiqueta en `locator_labels_cl` en el momento** (`source='manual_merge'`/`'manual_split'`).

Así el usuario entrena al sistema con su trabajo normal, sin ningún paso extra. (Las uniones *ya hechas* las importa tu script de semilla; esto cubre las futuras.)

### 5. F5a — Cola de revisión (pestaña Revisión)

Lista los `property_locator_cl` en estado `needs_review`: fotos del clúster, pins por corredora, candidatos dibujados sobre las parcelas, botones confirmar/rechazar. Endpoints que ya existen y debes reutilizar: `parcels-bbox`, `cadastre-geojson`, `sii-rol-detail`.

### 6. Ola 2 — F9 UI de departamentos (cuando P1 tenga el matching de edificios)

En departamentos el sistema no siempre puede aislar la unidad exacta: dentro de un edificio quedan 2-10 unidades gemelas del mismo piso y tipo. La UI debe mostrar **el edificio identificado + la lista corta de unidades candidatas ordenada** (con m² SII, piso estimado, orientación y avalúo de cada una), porque eso ya es accionable para captar aunque el rol exacto se confirme después con el dueño o TGR.

Añade a la pestaña Entrenar el modo "elegir unidad": el usuario ve la lista corta y marca cuál es — otra fuente de etiquetas de alta calidad.

## Cómo arrancar sin esperar a nadie

El contrato `candidates` (§10.3 del plan) está congelado, así que **empieza con datos mock** que lo cumplan:

```json
[{"rol": "795-198", "sii_comuna_code": "15108", "direccion": "LOS MILITARES 5000",
  "probability": 0.78, "rank": 1,
  "signals": {"address": 2.1, "distance": -0.3, "land_area": 0.8, "built_area": 0.5,
              "floors": 0.2, "footprint": 0.4, "visual": null},
  "lat": -33.41, "lng": -70.58, "parcel_id": "uuid-..."}]
```

Cuando P1 mergee F1 a main, cambias el mock por la consulta real y toda tu UI ya está hecha.

## Reglas que no se rompen

- Migraciones idempotentes; PRs pequeños (una pieza por PR).
- **Nunca** revierta decisiones humanas — al contrario, tu trabajo es capturarlas. Respeta `manual_property_lock` y `decided_by='human'`.
- La UI nunca debe romperse si faltan datos: sin fotos, sin footprint o sin candidatos, degrada elegantemente (el sistema estará en construcción mientras trabajas).
- **Nunca** edites archivos de otro puesto — `property-locator-cl.ts` y el scoring son de P1; `worker-cl.mjs` y los prompts son de P2. Si necesitas un campo nuevo en `candidates`, pídelo en el PR.
- Tras cada merge a main: `git fetch origin main && git rebase origin/main`.
