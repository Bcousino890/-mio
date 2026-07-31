# Investigación: webs propias de corredoras (Chile) — julio 2026

Análisis a fondo de las webs de cinco corredoras para poder barrerlas 24/7 y
hacer seguimiento por código de propiedad, incluidas las fichas que **no** están
en Portal Inmobiliario.

Todo lo que sigue está verificado con peticiones reales a los sitios (curl
directo, sin proxy). No hay nada inferido "por parecido con otra plataforma": la
versión anterior del código estaba construida así y falló en casi todos los
puntos (ver §7).

Sitios analizados:

| Dominio | Plataforma | Fichas publicadas | Listado | Ficha |
|---|---|---|---|---|
| cympropiedades.cl | Ofinet | **759** en venta (+1 arriendo) | HTML paginado, con sesión | `property.asp?idPro=N` |
| elbarrio.cl | Convecta | **668** (631 venta / 71 arriendo) | **JSON público** | `fichaPropiedad.aspx?i=N` |
| magnoliaproperty.cl | Convecta | **1.116** (920 venta) | **JSON público** | `fichaPropiedad.aspx?i=N` |
| keyproperties.com | Convecta | **597** (511 venta / 104 arriendo) | **JSON público** | `fichaPropiedad.aspx?i=N` |
| ppartnersgroup.com | Konnect (propia) | **10.870** en Chile (9.753 venta / 1.117 arriendo) | **API JSON** | `/es-cl/propiedad/<slug>/<cod>/` |

Total accesible: **~14.000 fichas**, todas con su código interno de corredora —
que es la clave con la que el Nivel 1.5 del dedup las engancha al anuncio de
Portal Inmobiliario de la misma corredora, y con la que se detecta lo que solo
está en su web.

---

## 1. Ofinet — cympropiedades.cl

ASP clásico. Footer `Designed by Ofinet`. Tres hallazgos que condicionan el
barrido:

**1.1 · El listado no es el que se creía.** `i_listing-4-column.asp` devuelve
**24 bytes vacíos** (esa vista está comentada en la plantilla). El que sirve
datos es `i_listing.asp`, y exige el juego COMPLETO de parámetros: con un
subconjunto responde vacío.

```
/i_listing.asp?dormitorios=0&select-status=VE&select-property-type=-1
              &select-region=-1&select-location=-1&rbEs=0
              &min-price=&max-price=&condominio=2&idPro=0
```

`select-status`: `VE` venta, `AR` arriendo.

**1.2 · La paginación depende de la sesión.** El filtro se guarda en la sesión
de ASP, no en la URL: las páginas siguientes son `i_listing.asp?Order=ASC&NumPag=N`
a secas. Sin la cookie `ASPSESSIONID*` de la petición que fijó el filtro, la
página 2 devuelve **cero fichas**. Comprobado:

```
p1 con cookie jar → 3243 3728 4428 4651 5421 5437 5452 5658 5836
p2 misma sesión   → 3765 4991 5155 5205 5321 5687 5725 5743 5787
p2 SIN cookie     → (vacío)
```

**1.3 · El paginador miente (lo más caro de descubrir).** Es una **ventana
deslizante**: en la página 1 solo enseña enlaces hasta la 4, en la 4 hasta la 7,
en la 5 de la 2 a la 8. Creerle da **36 fichas**. Avanzando `NumPag` hasta que
una página viene vacía, el listado termina en la **página 86** y son **759
fichas en venta** — 21 veces más inventario del que declara su propio paginador.

El único criterio de parada válido aquí es la página vacía.

**Ficha** (`property.asp?idPro=2747`, verificada campo a campo):

| Dato | Dónde | Valor real |
|---|---|---|
| Código | `ul.amenities-detail` → `Cód.:` | 2747 |
| Precio + operación | `.label.price` / `.label.forrent` | UF 17.500,00 · Venta |
| Tipo | `Tipo:` | Casa |
| Superficies | `Sup.:` (construida/terreno) | 207,63 m² / 400 m² |
| Comuna | `<address>` con `icon-location` | Lo Barnechea, SANTIAGO |
| Dorm./baños | `<li>` con `icon-bedroom` / `icon-bathroom` | 4 / 4 |
| Fotos | `Fotos/<idPro><letra>.jpg` | 17 (a…q) |
| Vídeo | iframe YouTube | sí |
| Contacto | `.contacts-list` | +56966616220 |

Dos trampas en la ficha:

- La clase CSS es `forrent` **también para las ventas**. Manda el texto
  (`Venta` / `Arriendo`), no el nombre de la clase.
- Debajo hay un **sidebar de propiedades relacionadas** con las fotos de otras
  fichas (`fotos/4722a.jpg`, `fotos/4606a.jpg`…). Sin acotar al `idPro` de la
  ficha, una propiedad de 17 fotos se guarda con 40, y las de más son de otras
  casas — justo el material con el que el dedup por imagen decide si dos
  anuncios son el mismo inmueble.

Sin coordenadas: el mapa de la ficha se resuelve por dirección.

---

## 2. Convecta — elbarrio.cl, magnoliaproperty.cl, keyproperties.com

ASP.NET WebForms sobre el producto **prop360** (las fotos se sirven desde
`demoazimg.prop360.cl`, lo que delata la plataforma aunque el cliente reescriba
la plantilla entera).

**2.1 · Hay un endpoint JSON público.** Lo encontré leyendo
`/assets/js/listado_v04.min.js`. El listado no se renderiza en servidor: lo pide
el front a

```
/recursos/publico.ashx?ac=listadoPropiedades&op=…&pa=<página>&…
```

y la respuesta trae el HTML de las tarjetas ya renderizado **más el total de
fichas y el paginador**:

```json
[{ "listing": "<div class='item-wrap'>…", "paginador": "…",
   "numRegistros": "668", "title": "668 Propiedades en venta y arriendo…" }]
```

20 fichas por página. `numRegistros` da el total exacto, así que el barrido está
acotado de antemano — nada que ver con el "hasta que se acabe" de Ofinet.

`op`: `0` todas, `1` venta, `2` arriendo.

**2.2 · Dos dialectos de parámetros.** La misma plataforma expone el endpoint
con dos juegos de nombres según la versión instalada:

| | acción | operación | página | comuna | orden |
|---|---|---|---|---|---|
| corto (elbarrio, keyproperties) | `ac=` | `op` | `pa` | `co` | `or` |
| largo (magnolia) | `acci=` | `oper` | `pagi` | `comu` | `orde` |

En vez de mantener un mapa dominio→dialecto (que se desincroniza cuando el
proveedor actualiza a un cliente), se manda **un querystring con los dos juegos**:
cada backend lee los suyos e ignora el resto. Verificado en los tres dominios.

Detalle no obvio: el dialecto largo exige que las claves vacías **vengan
presentes** (`orde`, `pred`, `preh`, `tlis`). Omitirlas devuelve `[{"error":"si"}]`.

**2.3 · El código de la propiedad aparece de dos formas.** `data-id='12828'` en
elbarrio y keyproperties; solo en el `href='/8812?leng=es'` en magnolia. Hay que
leer las dos.

**2.4 · La URL de ficha corta no es universal.** `/{código}` funciona en
elbarrio y magnolia pero devuelve **500** en keyproperties. La que responde en
los tres es `/fichaPropiedad.aspx?i=<código>`, así que es la canónica.

**2.5 · Tres plantillas de ficha distintas**, y las tres están en producción:

| | elbarrio | magnolia | keyproperties |
|---|---|---|---|
| Datos | `<li><strong>Etiqueta:</strong> valor` | `<td class='detail-title'>` + `<td>` | `.property_meta` con iconos |
| Precio | `Precio: UF 28.300` | fila `Venta` / `Arriendo` | `.estadoAV .precioEAV` |
| Etiquetas | `M2 Constr.`, `M2 Terreno` | `Sup. útil`, `Sup. total` | `Cons.`, `Terreno` |
| Vacío | ausente | `-` | ausente |

En la de keyproperties el número no lleva etiqueta: lo identifica el **icono**
(`fa-bed` dormitorios, `fa-bath` baños, `fa-object-group` superficie).

**2.5 bis · Las etiquetas varían dentro del MISMO dominio.** No basta con una
plantilla por dominio: magnoliaproperty.cl escribe la superficie construida como
`Sup. útil` en unas fichas y `Sup. construida` en otras; keyproperties.com como
`Cons.` o como `Útil`. Lo mismo el terreno (`M2 Terreno` / `Sup. total` /
`Sup. terreno`). Con listas cerradas de etiquetas, cada variante sale `null` en
silencio — una casa de 625 m² guardada sin metros. Se emparejan por patrón.

Ojo con dos que **no** son la superficie del inmueble y estaban a un carácter de
colarse: `Sup. terreno` empieza igual que `Sup. útil`, y `Terraza 6 M²` /
`M2 Terraza: 31 M2` es un espacio exterior. Ambas se excluyen explícitamente y
la terraza se guarda aparte, en características.

**2.5 ter · Fichas publicadas en venta Y arriendo a la vez.** El estado dice
`Venta y Arriendo` y los dos precios van en un solo campo:

```
<span class='spanEAV'>Venta  y Arriendo </span>
<span class='precioEAV'>V: UF 2.600 | A: $ 500.000</span>
```

Hay que separarlos; si no, la etiqueta queda como "venta y arriendo", no casa
con ninguna de las que se buscan y la ficha se guarda **sin precio**. Manda el de
venta, que es la operación con la que se capta.

**2.6 · Lo que da la ficha** (elbarrio/12828, verificado):

precio en UF **y en pesos** (UF 28.300 / $1.155.907.557), código, m² construidos
y de terreno, dormitorios, baños, **gastos comunes**, **contribuciones**,
estacionamientos, características (piscina, bodega…), descripción completa,
vídeo de YouTube, 25 fotos a resolución original y **coordenadas exactas**
(`-33.2777328489578, -70.62578542541551`), escondidas en el `onclick` del tab de
mapa. Las coordenadas permiten cruzar la ficha contra el catastro SII por rol sin
geocodificar la dirección.

**2.7 · Precio por metro cuadrado — la trampa de datos.** Los terrenos se
publican muy a menudo como **`UF 3,30/m2`** o `UF 1,09/m2`: precio **unitario**,
no total. Guardarlo tal cual mete un sitio de 5.100 m² como si costara UF 3,30, y
ese número entra en las medias de mercado, en los filtros de rango y en el dedup
sin que nadie lo mire dos veces — un terreno "de UF 3" al lado de casas de
UF 30.000 no llama la atención: simplemente ensucia.

**Decisión tomada:** el precio queda en `NULL` y el dato se conserva en
`features` con el total calculado aparte y marcado como derivado:

```
Precio unitario: UF 1,09/m2
Precio total estimado: UF 782.288 (1.09 × 717695 m²)
```

Preferimos "sin precio" —que se ve y se puede revisar— antes que un total que la
corredora nunca publicó presentado como si lo hubiera hecho. El cálculo valida
bien: la propia descripción de esa ficha dice `UF 782.287`.

Si se prefiere que el total derivado se guarde como precio, es un cambio de una
línea en `convecta.mjs` — pero conviene decidirlo a la vista de este trade-off.

---

## 3. Konnect — ppartnersgroup.com (plataforma propia)

Next.js. No es un CRM de terceros sino la plataforma del grupo Property
Partners. El listado se resuelve en cliente contra una **API JSON pública**:

```
/api/properties/listing/?countryId=cl&typeId=all&operation=sell&page=1
```

100 fichas por página, `pagination.maxPages` acota el barrido, y **devuelve el
objeto completo de cada propiedad**, no un resumen de tarjeta. Es más rica que la
ficha HTML, así que el adaptador **no descarga la ficha**: bajarla sería una
petición por propiedad para obtener menos datos.

Trae: `externalId` (código interno, ej. `HU0920`), coordenadas, superficies
construida y de terreno, dormitorios, baños, estacionamientos, bodegas,
orientación, antigüedad, gastos comunes, fotos, vídeo, **oficina y agente**,
`status`, `exclusive`, `totalViews`, `totalFavorites`, `publishedAt` /
`firstPublishedAt` (días en mercado como dato, no como estimación) y
**`priceHistory`**.

**Trampas verificadas:**

- El parámetro correcto es **`operation`**, no `operationId`. `operationId` la
  API lo **ignora en silencio** y devuelve el listado sin filtrar con un total
  idéntico al de "sin filtro" — parece que funciona porque responde 200 con
  datos. Con `operation=rent` son 1.117; con `operationId=rent`, 10.870.
- Sin `countryId=cl` devuelve el inventario global del grupo: **16.264** fichas
  de Chile, Uruguay, EE.UU., España y Argentina.
- Las coordenadas son GeoJSON **`[lng, lat]`**. Invertirlas manda las
  propiedades al océano Índico, y como el mapa igual pinta un pin es un error
  que no salta a la vista.
- `www.ppartnersgroup.com` **redirige a la portada en inglés** (`/en-us/`). La
  base correcta es el dominio desnudo con locale `es-cl`.
- `videos` llega como array que puede traer cadenas vacías.

El sitemap (`/server-sitemap/cl.xml`) **no** lista propiedades individuales —
solo sucursales—, así que no sirve como vía de descubrimiento.

---

## 4. Cómo queda implementado

- `db/migrations/0088_…sql` — plataforma `konnect`, columna `base_url`
  (la URL **no** se puede derivar del dominio) y `last_declared_count` (lo que
  el sitio dice tener, frente a lo que el crawl recogió: si declarado > recogido,
  el barrido se quedó corto y se ve).
- `scraper/lib/crm-adapters/convecta.mjs` — endpoint JSON, dos dialectos, tres
  plantillas de ficha, precio por m².
- `scraper/lib/crm-adapters/ofinet.mjs` — listado real, sesión, fotos acotadas.
- `scraper/lib/crm-adapters/konnect.mjs` — API JSON, ficha completa desde el listado.
- `scraper/lib/crawl-corredora-web-cl.mjs` — recorre el listado **entero** con
  los tres criterios de parada combinados; cookie jar por operación cuando la
  plataforma lo exige.
- `scraper/lib/fetch.mjs` — perfil `corredora` (UA de navegador; el truco del UA
  de WhatsApp es específico de Idealista), soporte de cookie jar y umbral de
  cuerpo mínimo configurable (una página de listado vacía son pocos bytes y se
  tomaba por respuesta corrupta).
- `scraper/lib/detect-corredora-crm-cl.mjs` — reconoce `konnect`, el CDN
  prop360, y el `meta author` de Convecta **con guion** (`Convecta - Desarrollos
  Informaticos`, que es como lo escribe elbarrio.cl y que el patrón anterior no
  reconocía).

El worker ya tenía los jobs `corredora-web-crawl-cl` y `corredora-web-scheduler-cl`
enganchados: no hizo falta tocarlos.

**Los cinco targets quedan registrados con `enabled = false`.** Registrar no es
activar: se encienden con un `UPDATE` cuando se quiera arrancar el barrido.

---

## 5. Cadencia recomendada

Son sitios pequeños, de bajo tráfico y sin anti-bot. El crawler va secuencial,
sin proxy y con 4 s entre peticiones (H22). Con eso, un barrido completo es:

| Dominio | Peticiones | Duración aprox. |
|---|---|---|
| ppartnersgroup.com | ~110 (solo listado) | ~7 min |
| cympropiedades.cl | ~85 + 759 fichas | ~1 h |
| magnoliaproperty.cl | ~60 + 1.116 fichas | ~1,3 h |
| elbarrio.cl | ~40 + 668 fichas | ~50 min |
| keyproperties.com | ~40 + 597 fichas | ~45 min |

Cadencia diaria (`interval_hours = 24`) por target, que es el valor por defecto.
El tope por corrida (`maxDetails`) está en 400: la primera pasada de los sitios
grandes necesitará varias corridas o subirlo puntualmente.

---

## 6. Lo que habilita esto

Con el código interno de cada ficha y el `corredora_id` fijado:

1. **Inventario oculto** — fichas en la web propia que no están en Portal
   Inmobiliario: son leads de captación directos.
2. **Seguimiento por código** — el mismo código en PI y en la web permite seguir
   una propiedad aunque cambie de precio, de fotos o de portal.
3. **Cambios de precio reales** — comparando contra el precio publicado, no
   contra el CLP derivado de la UF (que sube casi a diario).
4. **Cruce con catastro** — las coordenadas exactas de Convecta y Konnect
   permiten resolver el rol SII sin geocodificar.

---

## 7. Por qué había que reescribirlo

El código anterior estaba escrito sobre supuestos, no sobre HTML real. Pasado
contra las fichas de verdad daba:

| Ficha | Campo | Devolvía | Real |
|---|---|---|---|
| elbarrio/12828 | código | `12` | `12828` |
| elbarrio/12828 | dormitorios | 2 | 4 |
| elbarrio/12828 | m² | 13 | 393 |
| cym/2747 | operación | arriendo | **venta** |
| cym/2747 | tipo | departamento | **casa** |
| cym/2747 | comuna | `"s Comuna"` | Lo Barnechea |
| cym/2747 | fotos | 1 | 17 |
| magnolia/8812 | precio | *(ninguno)* | UF 9,50 |
| magnolia/8812 | dormitorios | 25 | *(no tiene)* |

El código truncado a `12` es el peor de la lista: `seller_reference` existe
exactamente para enganchar el enlace determinista con Portal Inmobiliario, y
truncado no casa nunca — el enlace fallaba en silencio.

La causa común: un `parseDetailGeneric` compartido que barría el **texto plano**
de la página con expresiones regulares, bajo la idea de que "Convecta y Ofinet
son ASP.NET y escriben los datos parecido". El texto corrido no distingue los
campos de la ficha de los del sidebar de propiedades relacionadas, ni
`Código: 12.828` de `M2 Constr.: 393` pegado detrás. Ese parser genérico se ha
retirado; cada plataforma parsea su propia estructura.

Los tests también estaban construidos sobre fixturas inventadas y pasaban en
verde mientras los parsers devolvían todo lo anterior. Los de ahora usan
recortes literales del markup real de cada sitio.

Cobertura: **180 tests** en la suite del scraper, más una auditoría contra los
sitios en vivo — **96 fichas reales** (24 por dominio, muestreadas de páginas
repartidas por todo el listado: 1, 3, 6, 11 y 17).

Resultado de la auditoría: **96/96 parseadas**, sin un solo hueco de código,
precio, comuna, fotos, tipo ni operación. Los únicos campos vacíos son 6 fichas
sin superficie **porque el sitio no la publica** (verificado una a una: la tabla
dice literalmente `Sup. útil: - m`, o directamente no trae el campo).

Muestrear poco esconde fallos: con 6 fichas todo parecía correcto. Las 96
destaparon tres defectos reales —etiquetas de superficie no cubiertas, fichas
duales sin precio y `Terraza` confundible con la superficie construida— que ya
están corregidos y con test de regresión.

---

## 8. Pendiente / limitaciones conocidas

- **`bpropiedades.cl` no publica inventario.** Es una de las semillas de la
  migración 0069 y responde 200 con la plataforma Ofinet reconocible, pero su
  buscador devuelve **cero fichas** en venta, arriendo y agencias, y hasta su
  carrusel de destacadas viene con `property.asp?idPro=` vacío. No es un fallo
  del parser: no hay nada que barrer. Queda registrada y desactivada.
- **Ofinet no da coordenadas.** Sus fichas resuelven el mapa por dirección, así
  que el cruce con catastro para cympropiedades.cl necesita geocodificar.
- **El pipeline no se ha ejercitado contra una base real.** Los parsers y el
  crawler están verificados contra los sitios en vivo, y el upsert contra un
  cliente Postgres en memoria; falta una corrida con `DATABASE_URL` de verdad
  antes de activar ningún target.
- **`maxDetails` está en 400 por corrida.** La primera pasada de los sitios
  grandes (magnolia 1.116, cym 759) necesitará varias corridas o subirlo
  puntualmente.
- **El total declarado se suma entre operaciones**, y una ficha publicada en
  venta y arriendo cuenta en las dos. Sirve para detectar que el barrido se
  quedó corto, no como cifra exacta del inventario.
