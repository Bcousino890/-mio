# Motor de Referencia Catastral para Chile — investigación y propuesta de arquitectura

**v0.1 · 2026-06-20 · solo investigación/diseño, sin código.** Equivalente chileno del motor RC14/RC20 español (`docs/DESIGN.md` §7, `db/migrations/0003_cadastre.sql`, `0009_rc_resolution.sql`).

---

## 1. Resumen ejecutivo

España y Chile **no son simétricos** en este punto, y eso cambia la arquitectura:

- En España, el Catastro expone **servicios web públicos** (DNPRC/RCCOOR) sin convenio previo, con rate-limit conocido (1 rps), y la geometría INSPIRE es **descargable en bloque** para cargarla en PostGIS. Por eso el diseño actual hace PIP local + enriquecimiento puntual vía API.
- En Chile, el **SII no ofrece un equivalente público de DNPRC/RCCOOR**. Su herramienta web (Mapas SII) está respaldada por **ArcGIS Server**, pero el acceso programático (WMS/WMTS) está **reservado por convenio a municipalidades** ("Servicios de Interoperabilidad de Cartografía Digital SII-Mapas", autorizado resolución por resolución, p.ej. reso51/2026 para la Municipalidad de Graneros). Los términos de uso del sitio público prohíben expresamente la extracción automatizada y el uso comercial/redistribución de la información.

Conclusión de diseño: el "RC chileno" **no puede heredar 1:1** el patrón "PIP local + API pública cacheada" de España. Hace falta un híbrido: **point-in-polygon contra geometría de terceros (no oficial)** para el nivel de parcela, y una **resolución semi-manual o vía proveedor pagado** para llegar al Rol exacto y al sub-rol de unidad cuando hay copropiedad.

---

## 2. Formato del Rol de Avalúo / Rol Predial

El identificador chileno es el **Rol de Avalúo** (también llamado Rol Predial o sólo "Rol"), administrado por el SII para efectos del Impuesto Territorial (contribuciones).

- **Formato:** `MANZANA-PREDIO` (ej. `2922-27`), o a veces con comuna explícita como prefijo de contexto (`13101-2922-27`, donde `13101` es el código SII de la comuna — Santiago Centro en este ejemplo). El Rol **siempre se interpreta dentro de una comuna**: el mismo par manzana-predio existe en cada comuna por separado, así que la comuna es un dato obligatorio de contexto, no parte del string canónico que se ve en el sitio.
  - **Manzana:** identifica la "cuadra"/agrupación catastral dentro de la comuna (rol grupal, equivalente aproximado — no exacto — a una manzana urbana).
  - **Predio:** identifica el predio dentro de esa manzana.
- **Granularidad — el punto clave para la arquitectura:** el Rol **NO es siempre 1:1 con "una vivienda".** Para una casa o sitio sin subdivisión, el Rol identifica el inmueble completo (equivalente a nuestro RC14, sin necesidad de RC20). Pero para **edificios y condominios bajo la Ley de Copropiedad Inmobiliaria (Ley N.º 21.442, ex Ley 19.537)**, el SII asigna:
  - un **rol matriz** (a veces no tributable directamente, representa el terreno/edificio completo), y
  - un **sub-rol por cada unidad enajenable** (cada departamento, bodega, estacionamiento), generalmente expresado como un tercer número o como roles correlativos dentro de la misma manzana (ej. `2922-27`, `2922-28`, `2922-29`... cada uno un departamento distinto del mismo edificio) — el patrón exacto de numeración de sub-roles no es uniforme entre comunas y se solicita ante la Dirección de Obras Municipales + SII al momento de acogerse a copropiedad.
  - Al buscar **por dirección** en Mapas SII, el sistema típicamente devuelve **una lista de roles candidatos** (todos los departamentos de ese edificio), y el usuario humano elige el suyo — exactamente el mismo problema de ambigüedad que resuelve nuestro matching RC20 en España (m²/planta/habitaciones).

**Implicación de diseño:** Chile **sí necesita una separación a dos niveles análoga a RC14/RC20** — pero el "RC14 chileno" (nivel edificio/parcela) es el **rol matriz o la manzana-predio sin sub-rol**, y el "RC20 chileno" (nivel unidad) es el **rol con sub-rol específico de la unidad**, resuelto por el mismo tipo de matching de m²/destino que ya usamos. La diferencia es que en España la geometría INSPIRE ya viene a nivel de parcela/edificio de forma estructurada y exhaustiva; en Chile la geometría de manzanas/lotes es de calidad y cobertura desigual (ver §4) y el sub-rol no es derivable de un servicio público equivalente a DNPRC.

---

## 3. La herramienta Mapas SII (`www4.sii.cl/mapasui`) — ¿API o solo navegador?

**Hallazgo principal: no hay una API pública oficial documentada equivalente a DNPRC/RCCOOR.** El acceso programático existe técnicamente (la app está construida sobre ArcGIS Server, que expone REST por diseño), pero:

- El SII formalizó un programa de **"Servicios de Interoperabilidad de Cartografía Digital SII-Mapas"** vía **WMS y WMTS** (estándares OGC), pero el acceso se concede **solo a municipalidades**, mediante **oficio formal** dirigido al SII identificando un funcionario responsable, y queda **autorizado por resolución publicada caso por caso** (se encontraron resoluciones de 2025/2026 autorizando a municipios específicos, ej. Graneros). Las condiciones de uso explícitas: solo para "fines propios" del municipio, dentro de sus competencias legales, con **confidencialidad** y **prohibición expresa de cualquier otro uso** — esto excluye explícitamente a una empresa privada como casafari-mio, aunque el dato final (avalúo, rol) sea "público" en el sentido de consultable manualmente.
- Los **Términos del sitio web del SII** (`sii.cl/sobre_el_sii/terminos_sitio_web.html`) prohíben expresamente: (a) cualquier "captura y posterior reproducción de la información" sin autorización expresa del SII; (b) mecanismos automáticos que afecten el funcionamiento de la plataforma; (c) uso **comercial** de la información obtenida (el uso permitido es "personal y no comercial"); (d) transferir, comercializar o redistribuir la información. Esto aplica al sitio público de consulta (incluyendo `zeus.sii.cl/avalu_cgi/...` y Mapas SII), no solo a los servicios de interoperabilidad municipal.
- **No se detectó** documentación de un portal de desarrolladores, un endpoint REST/JSON oficial abierto, ni un servicio análogo a RCCOOR (coordenada → rol) accesible sin convenio.
- Indicio técnico relevante: existen capas en **ArcGIS Online** tituladas *"Parcelas Estimadas desde Mapa Catastral SII"* y *"Predios y Áreas Homogéneas SII"*, publicadas por terceros (no por el SII), con advertencia explícita de que **los polígonos fueron digitalizados manualmente**, que las áreas son aproximadas, y que el dato "tiene carácter referencial" y "no debe considerarse oficial ni exacto". Esto confirma que la geometría catastral fina (parcela exacta) **no está disponible en bruto y oficial** como sí lo está el INSPIRE español — lo que circula son reconstrucciones de terceros a partir de lo visible en el visor.
- **Existen proveedores comerciales de pago** (BaseAPI, SimpleAPI/SimpleMapas) que envuelven los datos de Mapas SII en una API REST/JSON propia ("misma información que el SII tiene en su aplicación de mapas"). Esto sugiere que técnicamente es viable extraer los datos (probablemente vía scraping del propio visor o de los servicios internos que usa, dado que no citan una API oficial del SII como fuente), pero **trasladan a sus clientes el riesgo legal/los términos de uso** — no eliminan el problema, lo subcontratan. Antes de integrar cualquiera de estos proveedores habría que revisar sus propios términos (de dónde sacan el dato, si garantizan legalidad de reuso comercial).
- **No se observó CAPTCHA** en las búsquedas básicas reportadas (rol, dirección), pero sí controles de "uso personal/no comercial" en los términos, que funcionan como restricción contractual más que técnica — el control técnico real (WAF / bot-detection) existe: nuestros propios intentos de `WebFetch`/`curl` contra dominios `sii.cl` y `arcgis.com` relacionados devolvieron **HTTP 403** de forma consistente, indicando bloqueo activo a tráfico no-navegador.

---

## 4. Fuentes alternativas / complementarias

| Fuente | Qué ofrece | Acceso programático | Limitación clave |
|---|---|---|---|
| **IDE Chile / Geoportal.cl** (SNIT, coordinado desde 2006) | Catálogo nacional de >3.500 datasets, incluida capa **"Predios"** (publicada por MINVU) y resultados del **Grupo de Trabajo "Parcelas Catastrales"** (SII + Bienes Nacionales + MINVU + CIREN + INE) | WMS/WFS/WCS estándar OGC, descarga directa de capas | Cobertura **parcial**: el grupo de trabajo reporta cartografía estandarizada para solo **~170 comunas** (de 346) a la fecha de los últimos reportes públicos; actualización de la capa "Predios" cada ~8 meses; granularidad y completitud variable por comuna |
| **CIREN (`esri.ciren.cl`)** | Capas de **"Propiedades Rurales"** por región con campo explícito de **Rol SII del predio** | ArcGIS REST (FeatureServer/MapServer) — formato técnicamente idéntico al usado en España | Enfocado en predios **rurales/agrícolas**, no en departamentos urbanos (poco útil para el caso de uso Madrid-like de pisos urbanos; sí útil si Chile expande a parcelas/terrenos) |
| **IDE MBN** (Ministerio de Bienes Nacionales, `ide.bienes.cl`) | Límites de propiedad fiscal, catastro de bienes del Estado | Geoportal con descargas | No cubre propiedad privada urbana, que es el grueso del mercado objetivo |
| **GEOMOP / `rest-sit.mop.gob.cl`** | Capas de infraestructura del MOP (no catastro predial per se) | ArcGIS REST | No resuelve roles ni parcelas privadas |
| **Municipalidades (DOM — Dirección de Obras)** | Permisos de edificación, planos de loteo, a veces visores propios | Muy heterogéneo, comuna por comuna, casi siempre no API | Sin estandarización; requeriría scraping/integración por comuna, no escalable de inicio |
| **Conservador de Bienes Raíces (CBR)** | Registro de dominio (propietario legal), hipotecas, gravámenes — el "ground truth" legal de propiedad | Trámite online vía ChileAtiende/portal del conservador respectivo, **de pago, no abierto, sin API** | Útil más adelante para verificar titularidad, no para resolución geométrica; no sustituye al SII para point-in-polygon |
| **Proveedores comerciales (BaseAPI, SimpleAPI/SimpleMapas, catastral.cl, mapcity.com)** | Envuelven datos del SII/catastro en API o dataset propio, algunos con metodología propia (catastral.cl describe "metodología" de construcción de su propio dataset predial) | API REST de pago | Dependencia de tercero; legalidad de la fuente original no siempre transparente; coste recurrente |

**Conclusión de §4:** no existe en Chile un único dataset abierto con la cobertura y exhaustividad del INSPIRE español. La mejor aproximación realista combina **IDE Chile/Geoportal (capa Predios + resultados del grupo de trabajo Parcelas Catastrales)** como geometría base donde exista, complementada con **consulta puntual al Rol via SII** (manual o vía proveedor de pago) para los casos donde el polígono no esté disponible o se necesite el dato fiscal (avalúo, destino) que solo tiene el SII.

---

## 5. Arquitectura propuesta — motor RC Chile (RC14-CL / RC20-CL)

Manteniendo el principio del diseño español ("RC bajo demanda, no en masa", `docs/DESIGN.md` §7, `0009_rc_resolution.sql`), la diferencia es **qué pasos son automatizables sin fricción legal/técnica y cuáles no**:

**Nivel 1 — `rc14_cl` (parcela/edificio, equivalente a manzana-predio sin sub-rol):**
1. PIP del punto difuso del anuncio (Portalinmobiliario.com, Yapo, etc. — el "Idealista chileno") contra una tabla `cadastre_parcel_cl` cargada desde **IDE Chile/Geoportal (capa Predios)** allí donde la comuna esté cubierta por el Grupo de Trabajo Parcelas Catastrales (~170 comunas, calidad/fecha variable por comuna — auditar cobertura real para las comunas objetivo de Chile antes de comprometerse a este flujo).
2. Si la comuna no tiene cobertura en IDE Chile, o el polígono no resuelve con confianza, **fallback**: usar el centroide/dirección normalizada del anuncio para hacer una **consulta puntual semi-automatizada** (no en masa) contra Mapas SII por dirección — entendiendo que esto puede requerir automatización tipo Playwright (con los riesgos legales del §3) o, más seguro contractualmente, un **proveedor de pago (SimpleAPI/BaseAPI)** que ya asume ese rol de intermediario.
3. Resultado: `manzana-predio` (sin sub-rol) + comuna → equivalente a RC14.

**Nivel 2 — `rc20_cl` (unidad/departamento, equivalente a rol con sub-rol):**
1. Cuando el Rol matriz corresponde a un edificio en copropiedad (lo indica el propio SII al listar **varios sub-roles para la misma dirección**), se obtiene la lista de candidatos (uno por departamento) — esto **hoy solo es posible vía la búsqueda por dirección en el sitio del SII**, no hay servicio de "lista de unidades de un edificio" análogo a DNPRC.
2. Matching m²/destino/orientación del anuncio contra los sub-roles candidatos (mismo patrón de scoring que el motor RC20 español), produciendo un `rc20_cl` + confianza, o una lista de candidatos si hay ambigüedad (frecuente: la información pública del SII por sub-rol es más pobre que el DNPRC español — a menudo no expone planta/puerta directamente, solo el rol y el avalúo).
3. **Importante:** confirmar contra fuentes legales (ej. CBR) quedaría fuera del alcance automatizable — es un paso manual/opcional reservado a casos de alto valor (debida diligencia), no parte del flujo RC estándar.

**Qué es automatizable sin fricción mayor:**
- Carga en bloque de geometría de IDE Chile/Geoportal (WMS/WFS estándar, sin restricciones de términos de uso draconianas) → PIP local en PostGIS, igual que España.
- Integración con un proveedor de pago tipo SimpleAPI para el dato puntual de Rol/avalúo (API REST normal, sin scraping propio).

**Qué requiere consulta manual o semi-manual (o asumir riesgo):**
- Cualquier resolución directa contra `mapasui.sii.cl` sin convenio municipal: o se hace manualmente por un humano caso por caso (igual que "pedir la dirección exacta" ya es bajo demanda en el diseño español), o se automatiza con Playwright asumiendo el riesgo de violar los términos de uso (no recomendado como default; posible solo como "modo manual asistido" para el operador interno, nunca en bulk ni de cara al usuario final sin revisión legal).
- La obtención de sub-roles de copropiedad con suficiente detalle (planta/puerta) puede no estar disponible públicamente en ningún canal — puede requerir, en casos ambiguos, dejar el resultado como "candidatos sin desambiguar" de forma permanente (a diferencia de España, donde DNPRC casi siempre resuelve la ambigüedad con datos de planta).

---

## 6. Riesgos y preguntas abiertas

1. **Riesgo legal central:** los términos de uso del SII prohíben expresamente uso comercial/redistribución y captura automatizada de su sitio público. Cualquier automatización directa (Playwright contra `mapasui.sii.cl`) expone a casafari-mio a una violación contractual explícita, no solo a un bloqueo técnico (WAF ya observado vía 403). **Decisión pendiente:** ¿se asume ese riesgo en bajo volumen ("bajo demanda", igual que España), se delega 100% a un proveedor de pago (SimpleAPI/BaseAPI) que internaliza el riesgo, o se limita el producto en Chile a una "RC manual a petición" sin pretensión de automatización?
2. **Cobertura geométrica desigual:** IDE Chile cubre ~170/346 comunas con calidad variable y actualización cada 8 meses — hay que auditar específicamente las comunas objetivo (¿Santiago, Las Condes, Providencia, Vitacura — el "Madrid chileno"?) antes de comprometer el diseño a esta fuente como base.
3. **Granularidad de sub-rol insuficiente:** a diferencia del DNPRC español (que devuelve planta/puerta/m² estructurados por unidad), no se confirmó que el SII expanda públicamente metadatos de planta/puerta por sub-rol — el matching RC20-CL podría quedar permanentemente más impreciso/ambiguo que su contraparte española.
4. **Due diligence de proveedores terceros:** antes de integrar BaseAPI/SimpleAPI hay que verificar contractualmente cómo obtienen el dato (¿scraping propio? ¿convenio?) y si su licencia permite el uso que casafari-mio les daría (mostrar "dirección exacta" a un cliente final).
5. **Validar el patrón de sub-roles:** no se encontró una regla numérica universal de cómo el SII asigna sub-roles dentro de un edificio (correlativos en la misma manzana vs. tercer segmento del rol) — esto debería confirmarse empíricamente con 5-10 edificios reales antes de diseñar el parser/matcher.
6. **Verificar vigencia de la Ley 21.442** (Copropiedad Inmobiliaria, sucesora de la Ley 19.537) y su reglamento, para confirmar el procedimiento exacto de asignación de sub-roles y si cambia el formato a futuro.

---

## Apéndice — hallazgos técnicos (bullets)

- **Formato del Rol:** `manzana-predio` (ej. `2922-27`), contextualizado por comuna (código SII de 5 dígitos, ej. `13101` = Santiago Centro). No es un único string autocontenido como el RC20 español de 20 caracteres; la comuna viaja siempre como campo separado.
- **Granularidad:** Rol = parcela/sitio para predios sin subdividir; Rol matriz + **sub-rol por unidad** para edificios bajo Ley de Copropiedad Inmobiliaria (21.442, ex 19.537) — confirma la necesidad de dos niveles (RC14-CL / RC20-CL).
- **Mapas SII (`www4.sii.cl/mapasui`):** corre sobre **ArcGIS Server** (confirmado por capas "Mapa Catastral SII" replicadas en ArcGIS Online por terceros), pero **no hay API REST pública documentada**. El acceso programático vía **WMS/WMTS está reservado a municipalidades por convenio/resolución** (ej. resoluciones SII 2025/2026 autorizando municipios puntuales), con uso restringido a "fines propios" y prohibición expresa de cualquier otro uso.
- **Términos de uso del sitio sii.cl:** prohíben expresamente captura/reproducción automatizada no autorizada y cualquier uso **comercial** de la información (uso permitido declarado: "personal y no comercial"); prohíben también redistribución/comercialización.
- **Bloqueo técnico observado:** `WebFetch` y `curl` con user-agent de navegador contra `sii.cl`, `baseapi.cl`, dominios de `arcgis.com`/`ciren.cl` devolvieron consistentemente **HTTP 403** — indicio de WAF/bot-detection activo (Cloudflare u equivalente), no solo restricción contractual.
- **No se observó CAPTCHA** documentado en búsquedas básicas (rol/dirección) en las fuentes consultadas, pero el bloqueo 403 sugiere control técnico igualmente efectivo contra tráfico automatizado simple.
- **Datasets de terceros en ArcGIS Online** ("Parcelas Estimadas desde Mapa Catastral SII", "Predios y Áreas Homogéneas SII"): geometría **digitalizada manualmente**, declarada explícitamente como **referencial, no oficial, no exacta** — no apta como fuente única de verdad geométrica.
- **IDE Chile / Geoportal.cl (SNIT):** >3.500 datasets, capa **"Predios"** (MINVU, actualización ~8 meses), WMS/WFS/WCS estándar OGC, sin restricciones de uso draconianas conocidas — mejor candidato para geometría base, pero con cobertura confirmada de solo **~170/346 comunas** vía el Grupo de Trabajo "Parcelas Catastrales" (SII + Bienes Nacionales + MINVU + CIREN + INE).
- **CIREN (`esri.ciren.cl`):** ArcGIS REST (FeatureServer/MapServer) con capas de **propiedades rurales** que incluyen explícitamente el campo "Rol SII del predio" — arquitectura de acceso idéntica a la española, pero enfocada en predios rurales/agrícolas, no departamentos urbanos.
- **Conservador de Bienes Raíces (CBR):** registro de dominio legal, sin API, trámites de pago vía portal — útil solo para verificación de titularidad a futuro, no para resolución geométrica masiva.
- **Proveedores comerciales detectados:** BaseAPI ("API Mapas SII"), SimpleAPI/SimpleMapas — ambos envuelven datos de Mapas SII en API REST/JSON de pago, declarando explícitamente que es "información pública"; no citan convenio oficial con el SII como fuente, lo que sugiere que internalizan el mismo riesgo de scraping que tendría casafari-mio si lo hiciera in-house.
