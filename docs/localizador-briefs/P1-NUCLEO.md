# Brief P1 — Núcleo del localizador

> Lee `docs/PLAN-LOCALIZADOR-IA-CL.md` completo antes de escribir código, sobre todo §3 (el embudo), §4 (fases F1, F4b, F5b, F7c, F8) y §10 (orquestación). Este brief resume lo tuyo, no reemplaza el plan.

## Tu puesto

Eres **P1**, el cerebro del sistema: el que decide qué ROL del SII corresponde a cada propiedad. **Tus piezas son las de mayor riesgo del proyecto** — un peso mal calibrado une propiedades que no son la misma o escribe ROLes equivocados en fichas reales de clientes. Eres también la ruta crítica: P3 depende de tu F1 para tener datos reales.

- **Modelo**: `/model claude-fable-5`, esfuerzo alto de razonamiento.
- **`/code-review` obligatorio antes de CADA push.** Sin excepciones.
- **Rama**: `feat/localizador-p1-nucleo`
- **Migración reservada**: `0100` (solo tuya)
- **Arrancas el día 1**, no dependes de nadie para F1.

## Archivos de los que eres dueño

```
web/lib/property-locator-cl.ts            (nuevo, tu pieza central)
web/lib/sii-match-cl-v2.ts                ← TUYO EN EXCLUSIVA (scoring)
web/lib/captar-pipeline.ts                ← TUYO EN EXCLUSIVA
web/app/api/chile/property-locator/route.ts
scraper/lib/locator-feeder-cl.mjs         (nuevo — el registro en el worker lo hace P2)
scraper/lib/score-pair-cl.mjs             (F8)
scraper/lib/clustering-cl.mjs             (F8)
scraper/calibrate-locator-cl.mjs          (F7c)
scraper/eval-locator-cl.mjs               (tu instrumento de medición)
db/migrations/0100_property_locator_cl.sql
```

## Lo que ya existe y debes reutilizar (no reinventes)

| Pieza | Dónde | Qué hace |
|---|---|---|
| `findSiiCandidatesV3()` | `web/lib/captar-pipeline.ts:309` | Candidatos por radios progresivos [100,300,1000,2500] m + fallback trigram de dirección + superficie ±50% |
| `scoreCandidateV3()` | `web/lib/sii-match-cl-v2.ts:341` | Scoring log-odds con señales de superficie/dorms/tipo |
| `decideMatch()` | mismo archivo | Umbrales: auto-confirm ≥0.92, margen 0.15, log-odds 2.2, revisión ≥0.65 |
| `resolveRolAtPoint()` | `captar-pipeline.ts:1051` | Point-in-polygon contra `cadastre_parcels_cl` |
| `normalizeClRol()` | `web/lib/rol-format.ts` | Formato canónico de ROL — crítico: conviven dos formatos (`"3810-21"` vs `"03810-00021"`) |

## Tus tareas, en orden

### 1. F1 — Localizador determinista por clúster (primero, desbloquea a P3)

Cierra la "Fase 7/H11" pendiente: `property_cl.rol_matriz` y `rol_confidence` existen desde la migración `0064` y están **vacíos**.

**Migración `0100`**: tabla `property_locator_cl` + columnas `property_cl.rol_match_method`, `rol_matched_at`. Esquema exacto en §4-F1 del plan — es un **contrato congelado** (§10.3) que P3 lee.

**`web/lib/property-locator-cl.ts`**, dos funciones:

`buildClusterEvidence(propertyClId)` — la clave del sistema. Un clúster tiene N anuncios de **corredoras distintas**, cada una con su pin corrido a distinto lugar. Eso es una ventaja, no un problema:
- **Pins**: uno por corredora (mediana si una tiene varios anuncios); centroide = mediana geométrica; `pin_dispersion_m` = distancia máxima entre corredoras. `property_cl.manual_latitude/longitude` manda sobre todo (dispersión 0). Interpretación: <150 m ⇒ pin confiable; >800 m ⇒ difuminado, pesa más la dirección y la física.
- **Dirección**: `exact_address` si existe; si no, la más larga con número entre los miembros → `address_full` (activa el camino de log-odds 4.2 de `addressEvidence`, la señal más fuerte del scoring).
- **Física consensuada**: mediana de `sqm_terreno`/`sqm_construida`, moda de dorms/baños, pisos; piscina/condominio/orientación por regex sobre `features` + `description`.
- **Fotos**: unión dedupeada por pHash/`content_hash` de todos los anuncios del clúster.

`locateProperty(propertyClId)` — evidencia → `findSiiCandidatesV3()` → `decideMatch()`. Si auto-confirma: escribe `property_cl.rol_matriz` (con `normalizeClRol`), `rol_confidence`, `location_confidence='confirmed'`, `exact_address` = dirección SII, `rol_match_method='locator_v1'`, y propaga a los `listings_cl` miembros **sin pisar confirmaciones de mayor confianza**. SmartBC se beneficia solo (`address_real` ya viaja desde la dirección SII).

**Endpoint** `POST /api/chile/property-locator {limit}`: clústeres pendientes priorizando `listing_count DESC, corredora_count DESC` (más evidencia primero). Auth con token interno — patrón exacto en `scraper/process-uploads.mjs:10-14` → `/api/admin/process-uploads-worker`.

**Feeder** `scraper/lib/locator-feeder-cl.mjs`: hace `fetch(APP_URL + '/api/chile/property-locator')`. Pide a **P2** que registre la cola `locator-feeder-cl` con cron `37 * * * *` (él es el dueño de `worker-cl.mjs`).

**`scraper/eval-locator-cl.mjs`** — constrúyelo junto con F1, es tu instrumento de medición para todo lo demás. Gold set que ya existe: captaciones con `sii_rol` confirmado (link de la migración `0083`) y clústeres con pin manual (`resolveRolAtPoint(manual_lat, manual_lng)` = rol esperado). Imprime precisión y cobertura por comuna.

**Alcance**: RM completa desde el día 1 — por radios donde hay coordenadas SII, por dirección trigram donde no. Las 4 comunas con polígonos (Las Condes 15108, Vitacura 15160, Lo Barnechea 15161, Colina 14201) son tu banco de calibración.

**Hecho cuando**: `eval-locator-cl.mjs` corre y la **precisión de `auto_confirmed` es ≥95%** en el gold set. Si baja, sube umbrales antes de avanzar — este gate aplica a todas tus fases siguientes.

### 2. F4b — Señal de footprint (cuando P2 tenga `parcel_footprint_stats_cl` en main)

Extiende `SiiCandidateRow` (`sii-match-cl-v2.ts:43-62`) con `footprint_main_m2`, `footprint_total_m2`, `building_count` (LEFT JOIN a la MV por `normalizar_rol_cl(rol)` + comuna, poblado en `findSiiCandidatesV3`). Nueva señal `footprintEvidence()` en el array de `scoreCandidateV3`: huella esperada ≈ `sqm_construida / pisos`, tope **±0.9 log-odds** (Open Buildings tiene error de segmentación, nunca decisoria); `building_count = 0` con casa construida ⇒ −0.8.

**Crítico — el dataset es inferencia de mayo 2023**: si `anio_construccion` SII > 2022 o el anuncio dice "nueva/a estrenar", `building_count = 0` **NO penaliza** (la señal se anula, no resta). Sin esto, todas las casas nuevas quedan mal puntuadas.

### 3. F5b — Re-score visual (cuando P2 tenga los atributos y P3 la cola)

Reusa `verifyCandidatesVisually()` de `web/lib/visual-match-cl.ts:71` (de P2) dentro de `locateProperty()`, **solo** cuando queda `needs_review` con top-2 cercanos: 4-8 mejores fotos exteriores vs tiles de los top-4 candidatos. Inyecta `visual_score` y re-puntúa — el camino de rescore ya existe en `captar-pipeline.ts` (~línea 895). Cachea los veredictos en `evidence`.

### 4. F7c — Calibración continua

`scraper/calibrate-locator-cl.mjs`, cron semanal: regresión logística sobre `locator_labels_cl.signals` (el corpus que llena P3) → propone pesos log-odds recalibrados para `scoreCandidateV3`, `footprintEvidence` y los pesos de par del dedup, con datos chilenos reales en vez de los pesos a ojo actuales. Es álgebra en CPU, corre en segundos, sin API.

**Los pesos nuevos se aplican tras revisar el reporte, NUNCA en caliente.** Con <300 etiquetas solo reporta; la calibración se activa al superar ~300 por tipo.

### 5. F8 — Dedup 2.0

Extiende `CL_PAIR_WEIGHTS`/`CL_HARD_SIGNALS` en `score-pair-cl.mjs` leyendo señales **ya calculadas** por P2 (coste marginal $0):

| Señal nueva | Peso propuesto | Origen |
|---|---|---|
| Mismo ROL localizado | **+0.70** (casi decisoria) | tu F1 |
| `numero_casa_ocr` igual | +0.45 | P2 F3 |
| Embeddings de foto near-dup | +0.45 | F6 (futura) |
| Mismo condominio/calle+nº (NLP) | +0.35 | P2 F2 |
| Pistas geocodificadas <100 m | +0.15 | P2 F2 |
| Atributos visuales compatibles | +0.10 | P2 F3 |
| **Atributos visuales incompatibles** | **−0.40** (guardarraíl) | P2 F3 |

Los pesos definitivos los calibra tu F7c con las uniones manuales reales del usuario. También: extiende el grafo `graphology` de `clustering-cl.mjs` a nodos heterogéneos (anuncio, propiedad, ROL, corredora, teléfono, condominio).

## Reglas que no se rompen

- **`/code-review` antes de cada push** — todas tus piezas son críticas.
- Gate de precisión ≥95% en auto_confirmed antes de cada merge que toque scoring.
- Migraciones idempotentes (`IF NOT EXISTS`); tests con deps inyectadas.
- **Nunca** revierta decisiones humanas: `decided_by='human'`, `manual_property_lock`, pins manuales. El upsert de pares ya lleva `WHERE decided_by = 'auto'` — respeta ese patrón.
- El blocking chileno es **deliberadamente laxo** (10+ corredoras republican con datos inconsistentes): no lo "arregles" para que se parezca al de España.
- **Nunca** edites archivos de otro puesto — pide el cambio en el PR. En particular `worker-cl.mjs` es de P2.
- Tras cada merge a main: `git fetch origin main && git rebase origin/main`.
