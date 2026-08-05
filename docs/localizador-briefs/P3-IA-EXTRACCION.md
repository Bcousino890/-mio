# Brief P3 — IA: prompts y extracción

> **Antes de empezar**: lee `docs/PLAN-LOCALIZADOR-IA-CL.md` completo, sobre todo §4 (fases F2, F3) y §10 (orquestación). Este brief no reemplaza el plan, lo resume.

## Tu puesto

Eres el puesto **P3**. Conviertes texto y fotos en datos estructurados: de una descripción sacas la calle y el condominio; de una foto sacas la piscina, el techo y el número de casa. Tus módulos son **funciones puras** — reciben textos o fotos y devuelven JSON. No tocas el scoring ni la base de propiedades, por eso nunca chocas con P2: él te llama cuando estés listo.

- **Modelo de desarrollo**: `/model claude-opus-5` (un prompt mal hecho mete direcciones falsas al scoring).
- **Rama**: `feat/localizador-p3-ia`
- **Migración reservada**: `0101`
- **Arrancas YA** — no dependes de nadie.

## Archivos de los que eres dueño

```
web/lib/text-clues-cl.ts       (nuevo)
web/lib/photo-attrs-cl.ts      (nuevo)
web/lib/visual-match-cl.ts     ← TUYO EN EXCLUSIVA (ya existe, lo ajustas)
db/migrations/0101_ai_cache_cl.sql
```

## Modelos que usarás en producción (ya configurados en `.env.example`)

| Env | Modelo | Para qué |
|---|---|---|
| `AI_MODEL_CHEAP` | `qwen/qwen3-8b` | F2 — extracción de texto |
| `AI_MODEL_WORKHORSE` | `google/gemini-2.5-flash-lite` | F3 — visión y OCR |

Vía OpenRouter, `temperature: 0`, `usage: {include: true}` para registrar coste real. El patrón HTTP exacto ya está en `web/lib/visual-match-cl.ts:110-130` — cópialo.

## Tus tareas, en orden

### 1. Migración `0101` — el cache (hazla primero, es lo que mantiene el coste ≈$0)

Tabla `ai_cache_cl`, esquema exacto en §4-F2 del plan: PK `(kind, cache_key)`, kinds `text_clues`/`photo_attrs`/`geocode_clue`, `result jsonb`, más `prompt_tokens`, `completion_tokens`, `cost_usd` para control de gasto.

**El cache es la pieza clave del presupuesto**: la misma foto republicada por 3 corredoras se paga al VLM **una sola vez**. Para fotos, `cache_key = content_hash` (viene de `stored_photos`/`media_assets_cl`, que P1 está poblando; fallback a sha256 de la URL mientras tanto). Para textos, sha256 del texto normalizado **+ versión del prompt** (así un cambio de prompt invalida el cache automáticamente).

### 2. F2 — Pistas de texto (`web/lib/text-clues-cl.ts`)

Una llamada por clúster: concatena títulos + descripciones + features de todos los anuncios (truncar a ~6k chars) → `AI_MODEL_CHEAP`.

Prompt (esbozo — refínalo, es tu especialidad):

> "Extrae SOLO datos explícitos del texto de estos anuncios inmobiliarios chilenos (todos de la misma propiedad, publicados por corredoras distintas). Responde JSON: `{calle, numero, condominio, esquina_con, hitos:[{nombre, relacion}], sector, orientacion, pisos, piscina, rol_sii_mencionado, confianza:0-1}`. Si un dato no aparece textualmente, usa null. NO infieras ni inventes."

**Contrato congelado** (§10.3 del plan) — P2 lo consume. Puedes añadir campos, nunca renombrar ni quitar.

Exporta `extractTextClues(texts: string[]): Promise<TextClues>`.

Notas de dominio chileno: `rol_sii_mencionado` es el jackpot (algunos anuncios de parcelas publican el rol directamente → match instantáneo). Los condominios abundan en Colina y Lo Barnechea. "A pasos de Av. X" es un hito geocodificable. Ojo con direcciones parciales: "Los Militares al 5000" no es un número exacto.

**Hecho cuando**: precisión ≥90% en muestra manual de 50 descripciones reales (Colina/Lo Barnechea), y el coste por llamada queda registrado en `ai_cache_cl`.

### 3. F3 — Atributos visuales y OCR (`web/lib/photo-attrs-cl.ts`)

Hasta 10 fotos por clúster → `AI_MODEL_WORKHORSE`, con cache por foto.

Prompt (esbozo):

> "Para cada foto indica `es_exterior` (bool). Solo si es exterior: `{piscina:{presente, forma: rectangular|rinon|oval|L|irregular, posicion_relativa}, pisos_visibles, techo:{material: teja_roja|plano|zinc|otro, color}, estilo: mediterranea|moderna|rustica|otro, numero_casa_ocr:{valor, confianza}, cerros_visibles:{presente, cercania}, quincho, cancha, paneles_solares}`. Usa null si no se distingue. NO adivines: baja `confianza` si hay duda."

Exporta `extractPhotoAttrs(photos: PhotoRef[]): Promise<PhotoAttrs[]>`.

**Regla anti-alucinación (obligatoria)**: la agregación por clúster marca un atributo como "señal fuerte" **solo si aparece en ≥2 fotos o con confianza alta**. Un VLM que inventa una piscina en una foto no debe mover el scoring. Esta agregación es tu responsabilidad, no la de P2.

Por qué importa cada atributo: la forma de la piscina y la huella del techo se comparan luego contra la vista satelital; `numero_casa_ocr` + la calle de F2 fabrican una dirección completa (la señal más fuerte del scoring, log-odds 4.2); los cerros visibles acotan la orientación.

**Hecho cuando**: precisión ≥90% en muestra manual de 50 fotos reales, cache funcionando (segunda pasada = 0 llamadas), coste registrado.

### 4. F5a-visión — Ajustes de `visual-match-cl.ts` (si P2 los necesita)

El comparador fotos↔satélite ya existe y funciona (Esri z19, prompt de piscina/techo/forma/entorno, devuelve `[{rol, score: -1..1, reasons}]`). P2 lo llamará para desempatar candidatos. Si pide ajustes de prompt o de selección de fotos (usar `es_exterior` de tu F3 para elegir las mejores), son tuyos.

Posible mejora a coordinar con P2: abstraer el proveedor de tiles tras un env `SAT_TILE_PROVIDER` — los términos de uso comercial de Esri World Imagery son un hallazgo abierto.

## Reglas que no se rompen

- Tus módulos son **funciones puras**: entra texto/fotos, sale JSON. No escribas en `property_cl`, `listings_cl` ni en el scoring — eso es de P2.
- `temperature: 0` siempre, y `usage: {include: true}` para registrar coste.
- Filosofía del proyecto, ya documentada en `visual-match-cl.ts:6-8`: **"la IA es fallback, no camino principal"**. Tus señales mueven log-odds acotados; nunca confirman solas.
- Todo cacheado antes de llamar al modelo. Si el cache no está poblado, el sistema debe seguir funcionando (degrada, no rompe).
- Migraciones idempotentes; tests con deps inyectadas (mockea las respuestas del modelo).
- **Nunca** edites archivos de otro puesto — pide el cambio en el PR.
- Tras cada merge a main: `git fetch origin main && git rebase origin/main`.
