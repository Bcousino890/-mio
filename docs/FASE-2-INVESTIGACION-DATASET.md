# FASE 2: Investigación de dataset "Valor de Suelo" en MINVU IDE

## ⚠️ Actualización 2026-07-13 — run v1 de `--auto-find-valor` INCONCLUSO (no negativo)

El primer run del modo automático (24 servicios inspeccionados, luego timeout) tenía un
defecto de fondo: consultaba la **raíz** de cada `FeatureServer`, pero en la REST API de
Esri los `fields` viven en cada **capa** (`…/FeatureServer/<n>?f=json`), no en la raíz.
O sea: **nunca se llegó a mirar un campo de verdad**. Los "Sin campos de valor" eran
vacuos y los "✗ No se pudo describir (HTTP 200)" eran errores del servicio sin mostrar.

**Crawler v2** (mismo modo `auto_find_valor` del workflow) corrige eso:
- Desciende raíz → `layers[]`/`tables[]` → campos de cada capa.
- Tolerante a fallos: un timeout en una capa ya no aborta el run (aquel run murió entero
  por UN `AbortSignal.timeout` de 60s).
- Pagina el catálogo completo siguiendo links `rel=next` y dedupe servicios repetidos.
- Presupuesto de tiempo con resumen PARCIAL en vez de morir sin reporte.

**Además** existe ahora la parte 2 del A0 (`scraper/a0-verify-sii.mjs`, workflow modo
`sii_ckan`): sondea las páginas de estadísticas del SII (¿transferencias con monto o solo
avalúo?), el Observatorio Urbano MINVU (candidato natural del indicador de precio de
suelo fuera del Hub) y el CKAN de datos.gob.cl. Y el modo `cbr_probe` (Fase 6) sondea el
portal del Índice de Propiedad para fijar `--search-url` sin navegador.

**Conclusión pendiente:** hasta que el crawler v2 termine COMPLETO sin candidatas, no se
puede afirmar que el dato no está en ide.minvu.cl.

---

## Estado anterior (2026-07-12)

El scraper `a0-verify-fuentes.mjs` ya está operativo y ha ejecutado diagnostics exitosas en el VPS vía GitHub Actions. El flujo ha avanzado así:

### Paso 1: Búsqueda por términos ✓
```bash
node scraper/a0-verify-fuentes.mjs  # intenta 5 términos de fallback automáticamente
```

**Resultado:** Search API funciona (HTTP 200, formato OGC API - Records confirmado), pero todos los términos retornaron `numberMatched: 0`:
- "valor de suelo"
- "suelo"  
- "observatorio"
- "mercado de suelo"
- "avaluo"

### Paso 2: Diagnóstico exhaustivo ✓
Cuando ningún término encontró resultados, A0 ejecutó automáticamente:

1. **Listado de colecciones** → identifica qué colecciones existen en el catálogo
2. **Dumping de catálogo completo** → lista todos los datasets sin filtro `q` (encontrados 36 datasets)
3. **Inspección de ArcGIS Server directory** → comprobó `/arcgis/rest/services?f=json` (no existe)

**Resultado:** Se identificaron 36 datasets, pero NINGUNO tiene un título que coincida obviamente con "valor de suelo" o palabras clave relacionadas.

Ejemplos de títulos encontrados (según salida de workflow):
- Déficit Habitacional Cuantitativo (Censo 2024)
- FL_Parcelas_agrado
- Llamado 2025
- Áreas Funcionales 2026
- Zonificación_Termica
- Continuo de Construcciones Urbanas
- Regional monitoring dashboards (SM IPT Región de O'Higgins, etc.)
- (+ 28 más no listados en el resumen)

## Próximos pasos

### Opción A: Inspeccionar FeatureServers de los 36 datasets
Cada dataset tiene una URL de servicio Esri (FeatureServer o MapServer). El campo `url` de la salida de `listAllItems()` contiene estos.

**Estrategia:** Ejecutar `--esri-describe <url>` sobre los candidatos más prometedores:
- "Continuo de Construcciones Urbanas" — podría tener valores de construcción/suelo
- "FL_Parcelas_agrado" — si es parcel-related, podría incluir campos de valor
- Cualquier otro dataset que mencione "transacciones", "precio", "mercado", "estimación"

**Comando (una vez identificado el dataset correcto):**
```bash
# Desde GitHub Actions UI: Workflows → "Verificar fuentes" → Run workflow
# Inputs:
#   - use_wfs_fallback: false
#   - hub_url: https://ide.minvu.cl
#   - esri_describe: https://services.arcgis.com/.../FeatureServer/0  (ajustar)
```

### Opción B: Búsqueda en portales alternativos
Si los 36 datasets de ide.minvu.cl no contienen datos de valor de suelo:

1. **geoportal.cl** — IDE nacional, podría tener datos del SII o catastro histórico
2. **catastral.cl** — portal oficial de Conservadores de Bienes Raíces
3. **datos.gob.cl** — catálogo central de datos abiertos
4. **Portal específico del Observatorio del Mercado de Suelo** — si existe independientemente

**Comandos para probar (ajustar URL según portal):**
```bash
node scraper/a0-verify-fuentes.mjs --search "valor de suelo"  # intenta con diferentes portal
node scraper/a0-verify-fuentes.mjs --wfs --wfs-url https://otro-portal.cl/geoserver/wfs  # fallback WFS
```

### Opción C: Alternativa operacional (si el dato simplemente no existe)
Si después de inspeccionar los 36 datasets y portales alternativos no encontramos datos de valor de suelo por zona:

1. **Pivotar a datos agregados:** Usar solo estadísticas SII (transferencias por comuna) + histórico de avalúo
2. **Descargar manualmente:** Bajar el CSV directamente de MINVU si tiene descarga directa (no API)
3. **Contactar MINVU:** Verificar si el dato está disponible pero no indexado en el Hub

## Cómo proceder

**Para el usuario (sin terminal VPS):**

1. **Ver el output de la última ejecución:**
   - GitHub → Actions → "Verificar fuentes de mercado (A0 · MINVU Hub/ArcGIS)"
   - Ver el job log completo
   - Copiar la sección "Listando items de 'dataset'" (los 36 datasets con URLs)

2. **Identificar candidatos:**
   - Revisar los 36 títulos buscando palabras clave: valor, precio, suelo, mercado, transacciones, observatorio
   - Anotar los 3-5 más prometedores + sus FeatureServer URLs

3. **Probar con `--esri-describe`:**
   - Cada candidato: Workflows → "Verificar fuentes" → Run workflow
   - use_wfs_fallback: false
   - esri_describe: <pegar URL del servicio>
   - Revisar salida: ¿campos que huelan a valor (uf_m2, valor, precio, monto)?

4. **Confirmar al encontrar:**
   - Una vez encontrado, anotar el `--esri-url`, `--field-valor`, `--field-zona`, `--field-comuna`
   - Pasar a FASE 3: Ingesta MINVU en Workflows

## Referencias

- **Documentación:** `docs/RUNBOOK-MERCADO-CL.md` §FASE 2
- **Script A0:** `scraper/a0-verify-fuentes.mjs` (ya capaz de todos los modos)
- **Workflow dispatch:** `.github/workflows/verify-mercado-fuentes.yml`
- **Ingesta (cuando A0 termine):** `.github/workflows/ingest-minvu-suelo.yml`

