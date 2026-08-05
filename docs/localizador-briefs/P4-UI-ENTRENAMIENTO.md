# Brief P4 — UI y entrenamiento

> **Antes de empezar**: lee `docs/PLAN-LOCALIZADOR-IA-CL.md` completo, sobre todo §4 (fases F7a-b, F5a) y §10 (orquestación). Este brief no reemplaza el plan, lo resume.

## Tu puesto

Eres el puesto **P4**. Construyes la interfaz donde el usuario confirma en segundos si una casa es la correcta — y cada clic suyo entrena al sistema. Tu pieza convierte 5 minutos diarios de trabajo humano en >1.000 etiquetas de entrenamiento al mes.

- **Modelo**: `/model claude-sonnet-5` para la UI; `/model claude-opus-5` para la query de selección de casos (active learning, requiere criterio).
- **Rama**: `feat/localizador-p4-ui`
- **Migración reservada**: `0104`
- **Arrancas YA** con datos mock — no esperas a P2.

## Archivos de los que eres dueño

```
web/app/chile/localizador/page.tsx                          (nuevo — pestañas Revisión + Entrenar)
web/app/api/chile/property-locator/[id]/confirm/route.ts    (nuevo)
web/app/api/chile/property-locator/entrenar/route.ts        (nuevo)
web/lib/property-cl-merge.ts                                (modificas)
db/migrations/0104_locator_labels_cl.sql
```

## Por qué tu puesto es urgente

El gold set actual son **~73 captaciones confirmadas** (no 15.000 — esos son los anuncios totales). Con 73 etiquetas no se calibra nada. Tu pestaña "Entrenar" es lo que hace crecer el corpus rápido, así que **no eres una fase tardía: eres el tercer merge del proyecto**.

## Tus tareas, en orden

### 1. Migración `0104` — `locator_labels_cl` (hazla primero, P1 la necesita para su seed)

Esquema exacto en §4-F7a del plan. Resumen: `kind` ∈ `rol_match`/`pair_match`, `property_cl_id`, `rol`+`sii_comuna_code` (para rol_match), `listing_a`+`listing_b` (para pair_match), `label` ∈ `yes`/`no`/`unsure`, `source` ∈ `entrenar_tab`/`review_queue`/`captacion_confirmada`/`manual_merge`/`manual_split`/`pin_manual`, `signals jsonb` (snapshot de las señales al momento de etiquetar — esto es lo que luego calibra P2).

Es un **contrato congelado** (§10.3): P1 escribe en ella con su script de semilla, P2 la lee para calibrar. Puedes añadir columnas, nunca renombrar ni quitar.

### 2. F7b — La pestaña "Entrenar" (tu pieza principal)

`web/app/chile/localizador/page.tsx` con dos pestañas: **Revisión** (cola de baja confianza, F5a) y **Entrenar** (etiquetado rápido).

**Diseño de la pestaña Entrenar — un caso por pantalla:**
- Fotos del anuncio en carrusel (vienen de varias corredoras del mismo clúster — señala de cuál es cada una).
- Mapa con la parcela candidata resaltada + los pins de cada corredora en colores distintos (reutiliza `corredora-pin-colors.ts`).
- Dirección SII propuesta, y comparación física en una línea: m² del anuncio vs m² SII, dormitorios, año de construcción.
- Botones grandes: **"✅ Es exacta" · "❌ No es" · "➡️ Ver otro candidato" · "Saltar"**.
- **Atajos de teclado** (1/2/3/espacio) — el objetivo es etiquetar sin tocar el ratón.

**Active learning** (aquí usa Opus 5): la query prioriza los casos donde el modelo duda — probabilidad del top-1 entre **0.5 y 0.9**. Son los que más enseñan. Intercala ~1 de cada 10 casos de alta confianza para auditar que los auto-confirmados sean realmente correctos.

**Modo pares**: cuando hay pares del dedup en la zona gris (score 0.45-0.75), muestra los dos anuncios lado a lado — "¿Son la misma propiedad?" — y escribe `kind='pair_match'`. Este es el caso de **misma propiedad publicada por corredoras distintas**, el que más le cuesta al sistema.

**Doble efecto de cada confirmación**: "✅ Es exacta" guarda la etiqueta **y** confirma el ROL en `property_cl` (mismo camino que la cola de revisión). El usuario entrena y trabaja a la vez.

**Endpoints**: `/entrenar` (GET siguiente caso, POST etiqueta) y `/[id]/confirm` (escribe `rol_matriz` con `normalizeClRol` de `web/lib/rol-format.ts`, `rol_confidence=1`, `location_confidence='confirmed'`, y la etiqueta con `source='entrenar_tab'` o `'review_queue'`).

**Hecho cuando**: etiquetar 25 casos toma menos de 5 minutos usando solo el teclado.

### 3. Etiquetas desde las uniones manuales (extensión de `property-cl-merge.ts`)

Los endpoints que ya existen — `POST /api/chile/property-cl/merge` y `/split` — son los botones "Unir"/"Separar" que el usuario ya usa a diario en `/chile/propiedades`. Extiéndelos para que **cada unión o separación escriba su etiqueta en `locator_labels_cl` en el momento** (`source='manual_merge'`/`'manual_split'`).

Así el usuario entrena al sistema con su trabajo normal, sin ningún paso extra. (Las uniones *ya hechas* las importa P1 con su script de semilla; tú te encargas de las futuras.)

### 4. F5a — Cola de revisión (pestaña Revisión)

Lista los `property_locator_cl` en estado `needs_review`: fotos del clúster, pins por corredora, candidatos dibujados sobre las parcelas, botones confirmar/rechazar. Endpoints que ya existen y debes reutilizar: `parcels-bbox`, `cadastre-geojson`, `sii-rol-detail`.

## Cómo arrancar sin esperar a nadie

El contrato `candidates` (§10.3 del plan) está congelado, así que **empieza con datos mock** que lo cumplan:

```json
[{"rol": "795-198", "sii_comuna_code": "15108", "direccion": "LOS MILITARES 5000",
  "probability": 0.78, "rank": 1,
  "signals": {"address": 2.1, "distance": -0.3, "land_area": 0.8, "built_area": 0.5,
              "floors": 0.2, "footprint": 0.4, "visual": null},
  "lat": -33.41, "lng": -70.58, "parcel_id": "uuid-..."}]
```

Cuando P2 mergee F1 a main, cambias el mock por la consulta real. Toda tu UI ya estará hecha.

## Reglas que no se rompen

- Migraciones idempotentes; PRs pequeños.
- **Nunca** revierta decisiones humanas — al contrario, tu trabajo es capturarlas. Respeta `manual_property_lock` y `decided_by='human'`.
- La UI nunca debe romperse si faltan datos: sin fotos, sin footprint o sin candidatos, degrada elegantemente (el sistema estará en construcción mientras trabajas).
- **Nunca** edites archivos de otro puesto — en particular `property-locator-cl.ts` y el scoring son de P2. Si necesitas un campo nuevo en `candidates`, pídelo.
- Tras cada merge a main: `git fetch origin main && git rebase origin/main`.
