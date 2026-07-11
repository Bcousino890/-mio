# Investigación: repos GitHub para compraventas del CBR (Chile) con precio

**v1.0 · 2026-07-11 · Búsqueda y evaluación de repositorios públicos que permitan poblar `sii_transacciones_cl` con precios de cierre del Conservador de Bienes Raíces.**

> **TL;DR (conclusión honesta):** tras abrir el código de los repos candidatos, **no existe ninguna fuente abierta y reproducible que entregue precios de cierre del CBR**. El único repositorio cuyo esquema calza exactamente con lo que buscamos —`FelipeCabelloE/api-catastral`— **no incluye los datos**: su ETL lee un CSV privado (`F.2890_…csv`, es decir el **Formulario 2890 del SII**) que pertenece al ecosistema comercial **Tremen / catastral.cl / Newmark**. Sirve como **referencia de ETL/esquema** (de hecho ya está citado en `db/migrations/0030`), pero **no como fuente de datos**. La vía realista para precios de cierre sigue siendo un **proveedor comercial (databam / TocToc)** importado por CSV al endpoint que ya existe: `POST /api/admin/transacciones-upload`.

Esto **confirma y refuerza** lo que ya anotaba `docs/SII-ENRICHMENT-ROADMAP.md` (Fase 5/6). Además, esta investigación **corrige un error factual**: el comentario de `db/migrations/0030_sii_transacciones_cbr.sql` afirmaba que existe un *"dataset CSV público disponible por jurisdicción"* del CBR — **es falso** y se corrige en este mismo cambio.

---

## 1. Contexto verificado

Las premisas del encargo se verificaron y se sostienen:

- **No hay CSV público del CBR con ventas + precio.** El registro es por jurisdicción (~70 Conservadores) y cada uno expone, a lo sumo, un *Índice de Propiedad* (búsqueda por nombre/comuna/año → foja/número, **sin precio**). Confirmado con los portales de `conservadoresdigitales.cl`, `conservadorchile.com`, `conservadoriquique.cl`.
- **El SII solo publica estadísticas agregadas** por comuna/destino; no transacciones individuales.
- **El precio SÍ existe institucionalmente** en el **Formulario 2890 del SII** ("Declaración sobre Enajenación e Inscripción de Bienes Raíces"), que **notarios y Conservadores** envían al SII por *cada* transferencia, **con el monto**. Pero el F.2890 **no se publica masivamente**: la búsqueda `SII Formulario 2890 dataset/microdatos` solo devuelve el manual de uso y la app de declaración en línea, ninguna descarga abierta. Es el dato que los proveedores comerciales revenden.
- **El scraper del SII "Consultar transferencia de bienes raíces" NO es viable ni permitido**: solo muestra las operaciones donde el usuario **autenticado** es comprador/vendedor, y es un sistema protegido (Clave Única). Fuera de alcance por reglas del encargo.

---

## 2. Tabla rankeada de repos/proyectos evaluados

Leyenda veredicto (1-5) = utilidad **como fuente de precios de cierre del CBR**.

| # | Repo / Proyecto | Qué entrega | ¿Precio de **cierre**? | Fuente real del dato | Cobertura | Frescura | Legalidad / ToS | Licencia | Mantenimiento | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **[FelipeCabelloE/api-catastral](https://github.com/FelipeCabelloE/api-catastral)** | API REST + esquema Postgres `cbr_escrituras` (fecha, monto_pesos, monto_uf, comuna/manzana/predio, h3_8) **+ código ETL** | **En el esquema SÍ, en el repo NO** (data no commiteada) | CSV **privado** `F.2890_Escritura…csv` = **SII Formulario 2890**, bajo carpeta `TREMEN/newmarkchile`. Su `CLAUDE.md` son instrucciones de deploy de **`api.catastral.cl`** → es el backend comercial de Tremen | README dice CBR 2000–2026, 3.1M escrituras, 346 comunas (geo ~1.1M, RM). **No verificable: la data no está en el repo** | Muy reciente (referencia "primer semestre 2026") | No scrapea sistemas autenticados. Pero el dato F.2890 **no es de redistribución abierta** | **Sin LICENSE** (⇒ todos los derechos reservados) | 0★, ~3 commits, 1 autor | **Como fuente de datos: 1/5. Como referencia de ETL/esquema: 4/5** |
| 2 | **[crishernandezmaps/catastral.cl](https://github.com/crishernandezmaps/catastral.cl)** | Pipeline de vectorización del catastro SII: ~9.5M predios, avalúos, superficies, destinos, coords, **polígonos**; ~90 variables | **NO** (avalúo fiscal / "valor comercial" estimado ≠ cierre) | CSV oficiales del **SII** (avalúos). Público | 345 comunas | S2-2025 (S1-2026 pendiente) | Datos públicos SII. OK | Sin licencia clara | **38★ / 13 forks**, activo | **1/5** para cierres (excelente para avalúos/roles/polígonos — ya lo usa este CRM) |
| 3 | **crishernandezmaps/roles-backend** + **roles-frontend** ([roles.tremen.tech](https://roles.tremen.tech/)) | API + visor de roles/avalúos SII (evolución 2018→) | **NO** | SII (avalúos). Público | 342 comunas | S2-2025 | Datos públicos SII. OK | s/d | Ecosistema Tremen, activo | **1/5** para cierres |
| 4 | **[hpneo/m2](https://github.com/hpneo/m2)** | Scraper de portal Nexo Inmobiliario (**Perú**) | **NO** (precio de **oferta**) | Portal inmobiliario (anuncios) | Perú, no Chile | Inactivo (~5 commits) | Scraping de portal | MIT | Inactivo | **1/5** (fuera de alcance) |
| 5 | **[Cerebrock/scraprop](https://github.com/Cerebrock/scraprop)** / **[Data-Market/inmuebles-en-venta](https://github.com/Data-Market/inmuebles-en-venta)** | Scrapers / dataset de **anuncios** de portales | **NO** (precio de **oferta**) | Portales inmobiliarios (asking price) | Variable | Variable | Scraping de portales | Variable | Bajo | **1/5** para cierres |
| — | **[databam.cl](https://databam.cl/)** *(comercial, no repo)* | Data inmobiliaria **Compraventa / Herencia / Adjudicaciones**: ROL, **precio**, coords, naturaleza | **SÍ** | Inscripciones **CBR** (revende F.2890/registro) | 20+ comunas del Gran Santiago | Comercial, fresca | Producto **de pago** | Comercial | Activo | **Fuente real (de pago)** |
| — | **TocToc / apigateway.cl / justdev.it** *(comercial, no repo)* | Analítica y APIs de transacciones / pipelines a medida | **SÍ** | CBR/SII (revendido) | RM y más | Comercial | **De pago**; apigateway además restringe transferencia al participante autenticado | Comercial | Activo | **Fuente real (de pago)** |

> **Escepticismo aplicado (como pedía el encargo):** los repos 2 y 3 dicen "catastro" y hasta traen una columna de "valor comercial por m²", pero **abriendo el código** se confirma que es **avalúo fiscal / estimación**, no precio de cierre. El repo 1 sí tiene la columna de precio real, pero **abriendo `scripts/etl_cbr.py`** se ve que el precio viene de un **CSV local privado**, no de una descarga pública.

---

## 3. Top recomendados

### 🥇 #1 — `FelipeCabelloE/api-catastral` **como referencia de ETL/esquema** (no como fuente de datos)
Es el único artefacto público cuyo **modelo de datos calza 1:1** con `sii_transacciones_cl`, y su lógica de transformación (normalizar CSV → Postgres, calcular H3 res 8) es directamente aplicable. Ya está citado en `db/migrations/0030`. **Pero no aporta los datos**: hay que conseguir el CSV por otra vía.

**Evidencia (código abierto, no supuestos):**
- `scripts/etl_cbr.py` lee `/Users/newmarkchile/Documents/TREMEN/…/F.2890_Escritura 01-01-2018 - 31-03-2026.csv` con columnas `COMUNA, MANZANA, PREDIO, FECHA_ESCRITURA, MONTO_PESOS, MONTO_UF` y escribe `comuna_codigo, manzana, predio, fecha, monto_pesos, monto_uf`.
- `app/routers/cbr.py` consulta una tabla local `cbr_escrituras` (id, fecha, monto_pesos, monto_uf, comuna_codigo, manzana, predio); **sin** fuente pública referenciada.
- `scripts/compute_h3.py` calcula `h3.latlng_to_cell(lat, lon, 8)` a partir de `catastro_actual` (coords del SII).
- **No hay CSV ni carpeta `data/` commiteados** (`.gitignore` los excluye). Sin `LICENSE`.
- `CLAUDE.md` = instrucciones de deploy de **`api.catastral.cl`** ⇒ es el **backend de Tremen/catastral.cl**.

### 🥈 #2 — Proveedor comercial (**databam.cl**) por CSV → endpoint existente
La **única vía realista para precios de cierre**. databam vende explícitamente "Data Inmobiliaria Compra-Venta" con **ROL, precio, coordenadas y naturaleza** para 20+ comunas del Gran Santiago, derivada de inscripciones del CBR. Se integra sin escribir scrapers: su export se mapea al CSV que ya acepta `POST /api/admin/transacciones-upload`.

### 🥉 #3 — Ecosistema **catastral.cl / Tremen** (para el resto de columnas, no el precio)
`catastral.cl` (ya en uso en este CRM) aporta `manzana/predio`, `superficie`, `direccion` y **coordenadas** — lo necesario para **derivar `rol` y `h3_index`** de las transacciones que traiga el proveedor #2, y para rellenar `superficie_m2` cuando el proveedor no la traiga.

---

## 4. Plan de integración concreto (recomendado #1 + fuente #2)

**Destino ya existente:** `POST /api/admin/transacciones-upload` → tabla `sii_transacciones_cl`. El endpoint autodetecta delimitador `;`/`,`, la cabecera define el orden, y **solo `sii_comuna_code` y `rol` son obligatorias**. Columnas aceptadas: `sii_comuna_code, rol, fecha_escritura, monto_clp, monto_uf, superficie_m2, foja_numero_anio, cbr_nombre, h3_index` (`uf_por_m2` es generada, **no** se importa).

### 4.1 Mapeo columna-a-columna

| Columna destino (endpoint) | Origen `api-catastral` (`cbr_escrituras`) | Origen típico proveedor (databam) | Transformación |
|---|---|---|---|
| `sii_comuna_code` *(req.)* | `comuna_codigo` | código/nombre comuna | Resolver contra `chile_comunas.sii_comuna_code` (**fuente de verdad**; ojo con la discrepancia `131xx` vs `151xx` documentada en el roadmap). Si viene el nombre, mapear nombre→código. |
| `rol` *(req.)* | `manzana` + `predio` | `rol` o `manzana`/`predio` | **Derivar rol** = `` `${manzana}-${predio}` `` sin ceros a la izquierda, con el mismo formato que `sii_roles_cl.rol` (ej. `795-198`). |
| `fecha_escritura` | `fecha` | fecha inscripción | `YYYY-MM-DD` (el parser también acepta `DD/MM/YYYY`). |
| `monto_clp` | `monto_pesos` | precio CLP | Entero. El parser limpia miles (`.`) y coma decimal; quitar `$`/espacios si vienen. |
| `monto_uf` | `monto_uf` | precio UF | Numérico. El parser respeta coma decimal y miles con punto. Si falta, ver §4.2. |
| `superficie_m2` | *(vacío)* | superficie (si viene) | **api-catastral NO trae superficie** → queda `NULL` y `uf_por_m2` no se calcula. Si el proveedor la trae, mapear; si no, rellenar desde `sii_roles_cl.superficie_construida_m2`/`superficie_terreno_m2` por rol. |
| `foja_numero_anio` | *(vacío)* | foja/número/año | **api-catastral NO lo trae.** databam sí → formatear `"FOJA/NÚMERO/AÑO"` (ej. `12345/678/2024`). |
| `cbr_nombre` | *(vacío)* | conservador | **api-catastral NO lo trae.** databam sí → nombre del Conservador (ej. `CBR Santiago`). |
| `h3_index` | `h3_8` (si existe) | *(normalmente vacío)* | Si falta, **derivar H3 res 8** (§4.3). |

> **Aviso honesto sobre completitud:** desde el esquema de `api-catastral` **solo** se obtienen `sii_comuna_code, rol, fecha_escritura, monto_clp, monto_uf` (+`h3` si está calculado). `superficie_m2`, `foja_numero_anio` y `cbr_nombre` quedan **vacías** salvo que el proveedor comercial las incluya o se enriquezcan desde `sii_roles_cl`.

### 4.2 Normalización de montos
- El parser del endpoint (`toIntOrNull`/`toNumOrNull`) ya limpia separadores de miles y coma decimal. Quitar `$`/`UF`/espacios antes si el proveedor los incluye.
- **No imputar** el monto faltante salvo necesidad. Si solo viene CLP y se requiere UF (o viceversa), convertir con la **UF diaria a la `fecha_escritura`** usando la API pública ya integrada (`https://mindicador.cl/api/uf/{yyyy}`, ver `scraper/fetch-uf-mindicador.mjs`). El endpoint rechaza filas sin `sii_comuna_code`/`rol`, pero **acepta** filas con monto nulo, así que conservar lo que venga.

### 4.3 Cálculo de `h3_index` nivel 8 (si falta)
Mismo método que `compute_h3.py` de api-catastral (`latlng_to_cell(lat, lon, 8)`), aprovechando que **este CRM ya tiene lat/lng por rol** en `sii_roles_cl` (migraciones 0029/0038):

- **Opción A (pre-cálculo en el CSV):** script Node con `h3-js` que, por cada fila, busca `lat/lng` del rol en `sii_roles_cl` y calcula `latLngToCell(lat, lng, 8)`.
- **Opción B (post-import en SQL):** dejar `h3_index` vacío y poblarlo después con la extensión `h3-pg`:
  ```sql
  UPDATE sii_transacciones_cl t
  SET    h3_index = h3_lat_lng_to_cell(POINT(r.lng, r.lat), 8)::text
  FROM   sii_roles_cl r
  WHERE  r.sii_comuna_code = t.sii_comuna_code
    AND  r.rol = t.rol
    AND  t.h3_index IS NULL
    AND  r.lat IS NOT NULL;
  ```
  Con esto, la vista `sii_comparables_h3_cl` (mediana UF/m² por hexágono, 12 meses) empieza a producir comparables reales.

### 4.4 CSV de ejemplo listo para el endpoint
```csv
sii_comuna_code;rol;fecha_escritura;monto_clp;monto_uf;superficie_m2;foja_numero_anio;cbr_nombre;h3_index
13101;795-198;2024-03-15;185000000;4620.50;72;12345/678/2024;CBR Santiago;
15108;1234-56;2024-05-02;520000000;12980.00;140;9876/543/2024;CBR Santiago;
```
Envío (el endpoint lee el CSV crudo del *body*):
```bash
curl -X POST https://<host>/api/admin/transacciones-upload \
  -H "Content-Type: text/csv" \
  --data-binary @compraventas.csv
# → { "success": true, "inserted": N, "skipped": M }
```

---

## 5. Conclusión honesta

**No existe una fuente abierta viable con precios de cierre del CBR.** El dato de precio existe (Formulario 2890 del SII, alimentado por notarios y Conservadores), pero **no se publica masivamente**; los Conservadores solo exponen el *Índice de Propiedad* (foja/número/año, sin monto) y el SII solo agregados. El repo mejor alineado —`api-catastral`— **contiene el esquema y el ETL pero no los datos**, que provienen de un CSV privado del ecosistema comercial **Tremen / catastral.cl / Newmark**.

**Recomendación realista (sin cambiar de rumbo respecto al roadmap):**
1. **Fuente de datos = proveedor comercial** (databam / TocToc) exportado a CSV → cargar por `POST /api/admin/transacciones-upload` (ya implementado). Formato esperado: el CSV de §4.4.
2. **Reutilizar la lógica de `api-catastral`** (derivación de `rol` = manzana-predio, H3 res 8) como referencia de transformación — ya reflejada en `db/migrations/0030`.
3. **Enriquecer columnas faltantes** (`superficie_m2`, `h3_index`) desde `sii_roles_cl`, que ya está poblado con datos públicos de catastral.cl.
4. **No** construir scrapers del SII autenticado ni de sistemas protegidos (fuera de alcance y de ToS).

---

### Fuentes
- Repo #1 (código inspeccionado): <https://github.com/FelipeCabelloE/api-catastral> — `scripts/etl_cbr.py`, `app/routers/cbr.py`, `scripts/compute_h3.py`, `CLAUDE.md`.
- Repo catastro SII: <https://github.com/crishernandezmaps/catastral.cl> · <https://catastral.cl/metodologia> · <https://roles.tremen.tech/>
- Scrapers de portal (oferta, no cierre): <https://github.com/hpneo/m2> · <https://github.com/Cerebrock/scraprop> · <https://github.com/Data-Market/inmuebles-en-venta>
- Proveedores comerciales: <https://databam.cl/> · TocToc · <https://www.apigateway.cl/products/sii/bienes-raices> · <https://justdev.it/blog/pipeline-datos-sii-conservador-bienes-raices/>
- SII Formulario 2890: <https://www.sii.cl/sitios_de_interes/manual_usuario_f2890_.pdf>
- Índice de Propiedad (sin precio): <https://conservadoresdigitales.cl/> · <https://conservadorchile.com/indice-registro-de-propiedad/>
