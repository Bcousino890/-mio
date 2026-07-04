# Datos que faltan para "matchear perfecto" en Chile — y cómo obtenerlos gratis

**v0.1 · 2026-07-04 · investigación + tester ejecutable.**
Contraparte chilena del motor RC14/RC20 español. Se apoya en
`scraper/lib/identity-resolution-cl.mjs` (6 estrategias), `scraper/lib/cadastre-cl.mjs`
(`findParcelByPoint`, `detectSuspiciousPin`), `db/migrations/0021_sii_catastro_cl.sql`
(`sii_roles_cl`) y `0052_sii_mapasui_predios_cl.sql`.

> **Encuadre legal.** El objetivo es **no comercial** (señal interna de identidad
> catastral para deduplicación/matching, nunca redistribución ni reventa del dato).
> Aun así este documento **solo** usa fuentes que son legítimamente gratuitas:
> (a) la descarga oficial de autoservicio del SII, (b) datasets abiertos derivados
> de información pública bajo la **Ley 20.285 de Transparencia**, y (c) servicios
> OGC/ArcGIS abiertos por diseño para consumo programático. **No** se propone
> saltarse autenticación, evadir WAF/anti-bot ni scrapear sistemas protegidos —
> eso ni hace falta ni daría datos fiables. La tabla `sii_mapasui_predios_cl`
> (scraping del visor SII) queda **fuera** de esta propuesta por ser legalmente
> más frágil; aquí se cubren los mismos huecos por vías limpias.

---

## 1. Qué significa "matchear perfecto" y qué señales ya existen

El matching CL (`identity-resolution-cl.mjs`) combina 6 estrategias: triangulación
entre anuncios, geocodificación declarada vs pin, **point-in-polygon catastral**,
huella física (m²/dorm/baños/tipo) vs metadata SII, fuentes complementarias y
firma aérea. El *ground truth* de identidad es el **Rol de Avalúo SII**
("manzana-predio" por comuna), con dos niveles análogos a RC14/RC20:

- **Nivel edificio/parcela** = rol sin sub-rol (o rol matriz).
- **Nivel unidad** = sub-rol de la unidad enajenable (departamento) en copropiedad.

Ya poblado en BD: `sii_roles_cl` (rol, dirección, avalúo, superficie, destino,
copropiedad) desde los **archivos planos oficiales del SII** subidos a mano.

## 2. Los huecos reales (qué falta para llegar al 100%)

| # | Dato que falta | Por qué bloquea el match perfecto | En BD hoy |
|---|---|---|---|
| **G1** | **Geometría predial (polígonos)** por comuna | Sin polígono no hay **point-in-polygon**: no se puede convertir el pin (lat/lng) de un anuncio en un ROL. Es la estrategia #3 y la que ancla todo lo demás. | Parcial (`cadastre_parcels_cl`, pocas comunas) |
| **G2** | **Coordenada/centroide por ROL** | Para geolocalizar cada rol SII y hacer matching por proximidad (estrategia #2/#4) y validar el pin. | Parcial (0037–0044 poblaron coords de algunas comunas) |
| **G3** | **Sub-rol de unidad en copropiedad** | Para departamentos, el rol matriz no basta: hay que llegar al rol de la unidad concreta (equivalente RC20). | Derivable por huella física, no por geometría |
| **G4** | **Cobertura de comunas** | El grueso del mercado objetivo (RM oriente) necesita las ~10 comunas prioritarias completas, no una muestra. | ~170/346 comunas tienen cartografía estandarizada a nivel país |

**G1 y G2 son el 80% del problema.** Resueltos, `findParcelByPoint` funciona y el
matching por proximidad se vuelve fiable. G3 lo resuelve el motor de huella física
que ya existe. G4 es cuestión de cobertura de la fuente.

## 3. Fuentes gratuitas por hueco (y su encaje legal)

| Fuente | Qué aporta | Huecos | Acceso | Encaje legal |
|---|---|---|---|---|
| **SII — Descarga de Información Vigente por Comuna** (autoservicio oficial) | Roles, dirección, avalúo, superficie, destino, copropiedad | (base de G3) | Descarga **manual** del botón oficial; ya es el pipeline de `sii_roles_cl` | Uso declarado "personal y no comercial" → señal interna ✅ |
| **catastral.cl (proyecto Tremen)** | **Polígonos prediales** (GeoParquet EPSG:4326, ~30 cm) + **coordenadas** + ROL, 342 comunas, 9.4M predios | **G1, G2, G4** | Descarga **manual** por navegador (bloquea acceso programático con 403); índice `comunas_sii.json` | Derivado de info pública **Ley 20.285**; open-source [github.com/crishernandezmaps](https://github.com/crishernandezmaps) ✅ |
| **CIREN — `esri.ciren.cl/server/rest/services`** (`IDEMINAGRI/PROPIEDADES_RURALES`) | Polígonos de predios **rurales** con campo **`rol`** (Rol SII) | G1/G2 (rural) | **ArcGIS REST**, consulta espacial por punto/comuna — abierto por diseño | Servicio público de organismo estatal ✅ |
| **IDE Chile / Geoportal.cl + IDE MINVU (Open Data)** | Capa "Predios" (MINVU), límites, cartografía base | G1 (donde exista) | WMS/WFS OGC + ArcGIS Hub | IDE nacional, datos abiertos ✅ |
| **BCN — geoservicios** | Límites comunales/urbanos, base para geocodificar | apoyo G2 | WFS (algunos endpoints piden token) | Organismo público ✅ |

**Estrategia recomendada:** **catastral.cl** como fuente primaria de G1+G2+G4
(urbano, que es el mercado objetivo) vía descarga manual periódica → carga en
`cadastre_parcels_cl` con `ogr2ogr` (ya previsto en `scraper/download-catastral-gpkg.mjs`,
que hoy espera GeoPackage; ampliar a GeoParquet). **CIREN** como complemento
programático automatizable para lo rural. El SII sigue siendo el ancla oficial del rol.

## 4. El tester — `scraper/test-free-catastro-cl.mjs`

Script Node ESM (usa `curl`, como `scraper/lib/fetch.mjs`, para heredar el proxy).
No requiere BD. Comprueba **en vivo** qué fuente gratuita está disponible y qué
hueco cubre, e intenta una resolución real por punto/comuna.

```bash
# 1) Probar disponibilidad de todas las fuentes gratuitas (con qué hueco cubre cada una)
node scraper/test-free-catastro-cl.mjs --probe

# 2) Resolver un punto (lat,lng) contra las fuentes espaciales (CIREN, etc.)
node scraper/test-free-catastro-cl.mjs --point -33.4013,-70.5713

# 3) Ver la disponibilidad de una comuna en catastral.cl (código SII)
node scraper/test-free-catastro-cl.mjs --comuna 15108

# salida JSON para encadenar en CI/ETL
node scraper/test-free-catastro-cl.mjs --probe --json
```

El tester reporta, por fuente: `ok/estado`, latencia, huecos que cubre (G1..G4) y
si el acceso es **programático** o **descarga manual**. Código de salida `0` si al
menos una fuente por cada hueco crítico (G1, G2) está disponible; `1` si no.

## 5. Siguiente paso operativo

1. Correr `--probe` para fijar qué fuentes están arriba hoy.
2. Descargar de catastral.cl (manual) las ~10 comunas prioritarias (RM oriente) en
   GeoParquet; cargar en `cadastre_parcels_cl` (ampliar el loader a `.parquet`).
3. Para lo rural, automatizar CIREN por `--point` dentro del pipeline de captación.
4. Rellenar G2 con el **centroide del polígono** ya cargado (una query PostGIS),
   evitando geocodificación de pago donde el polígono exista.
