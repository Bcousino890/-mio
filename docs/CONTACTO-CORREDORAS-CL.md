# Ficha de empresa de la corredora: ¿de dónde sale el teléfono?

**2026-07-29 · Plan Anuncios CL · H4/H21 · migración `0083_corredora_contacto_cl.sql`**

Pregunta de partida: *¿se puede obtener el número de teléfono de cada corredora,
para armar una ficha de empresa (web, teléfono, ejecutivas, jefes/dueños)?*

Respuesta corta: **sí, pero solo por una vía — su propia web**. El portal donde
publican no da teléfonos, y ninguna cantidad de scraping de Portal Inmobiliario
lo cambia. Lo que sigue es lo que se probó, con el resultado de cada intento.

---

## 1. Lo que se probó, una por una

| Fuente | Intento | Resultado |
|---|---|---|
| **API de Mercado Libre** | `GET api.mercadolibre.com/users/330115905` | ❌ `HTTP 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES`. Exige `access_token` — queda confirmado lo que el plan daba por "sin confirmar" (§1). Y aun autenticada, la API **no expone el teléfono del vendedor**: es dato privado de la cuenta. |
| **API de ítems de ML** | `GET api.mercadolibre.com/items/MLC731121741` | ❌ Mismo 403. |
| **Ficha de Portal Inmobiliario** | Descarga de la ficha del anuncio con UA de navegador | ❌ El contacto es un **formulario**; el número no está en el HTML. Los "teléfonos" que aparecen al buscar dígitos en el HTML son falsos positivos (hashes de imagen). |
| **Portales de terceros** (chilepropiedades, Emol, Doomos, toctoc) | Perfil de la corredora | ⚠️ El perfil existe, pero el teléfono está detrás de JS/formulario. **Sí aportan otra cosa**: Emol publica el RUT de la corredora en la URL del perfil (`rl=R78987370-4L0` → RUT 78.987.370-4), útil para razón social. |
| **Registro de Empresas y Sociedades (RES)** | `registrodeempresasysociedades.cl/BuscarActuaciones.aspx` | ⚠️ **CAPTCHA**. Consultable a mano (da socios y representante legal), no automatizable. |
| **SII · consulta de situación tributaria** | Por RUT | ⚠️ CAPTCHA. Misma situación. |
| **Web propia de la corredora** | Home + páginas institucionales | ✅ **Funciona.** Teléfono, WhatsApp, email, dirección, redes y —cuando publican página de equipo— **nombres, cargos, correos y móviles de cada ejecutiva y de las socias/fundadoras**. |

## 2. La prueba que decidió la implementación

Contra las cuatro webs de corredora ya registradas en `corredora_web_targets_cl`:

| Corredora | Teléfonos | Email | Dirección | Redes | Personas |
|---|---|---|---|---|---|
| finhabit.cl (Convecta) | +56 9 9537 7271 (WhatsApp) | info@finhabit.cl | Av. Padre Hurtado Norte 1947, Vitacura | — | 0 |
| magnoliaproperty.cl (Convecta) | 3 (fijo + 2 móviles) | hola@magnoliaproperty.cl | Vespucio Norte 1128, Vitacura | 5 redes | 0 |
| cympropiedades.cl (Ofinet) | +56 9 3401 8822 (WhatsApp) | contacto@cympropiedades.cl | — | 1 red | 0 |
| bpropiedades.cl (Ofinet) | 24 | 23 | — | 2 redes | **22 con nombre, cargo, correo y móvil** |

El caso de bpropiedades.cl es el que justifica todo el módulo: su página de
equipo entrega la ficha completa —"Verónica Boetsch Vicuña · Socia Fundadora ·
vboetsch@… · +56 9 9334 3428"— que es exactamente el dato de captación buscado.

**Sin adaptador por CRM, a propósito.** El inventario necesita un parser por
plataforma; los datos de contacto no: `tel:`, `mailto:`, `wa.me`, el enlace a
Google Maps y el JSON-LD son universales. El mismo extractor funcionó igual en
Convecta, en Ofinet y serviría en una web a medida.

## 3. Cómo se usa

```bash
# 25 corredoras con más stock que aún no tienen ficha de contacto
node scraper/enrich-corredoras-contacto-cl.mjs

node scraper/enrich-corredoras-contacto-cl.mjs --limit 200      # tanda grande
node scraper/enrich-corredoras-contacto-cl.mjs --id <uuid>      # una concreta
node scraper/enrich-corredoras-contacto-cl.mjs --max-age 7      # refrescar +7 días
node scraper/enrich-corredoras-contacto-cl.mjs --dry-run        # solo listar
```

El resultado aparece en la ficha `/chile/corredoras/[id]`: bloque **Contacto**
(teléfonos con marca de WhatsApp, emails, dirección, redes, fecha de lectura y
enlace al origen) y bloque **Equipo** (jefaturas primero, luego ejecutivas).

Cadencia sugerida: mensual. Los datos de contacto de una corredora cambian mucho
más despacio que su inventario, y el crawl es de cortesía (4 s entre páginas,
máximo 5 páginas por dominio, sin proxy — mismo criterio de H22).

## 4. El cuello de botella real: el dominio

El enriquecimiento **solo puede correr sobre corredoras con `web_propia_url`**.
Sin dominio no hay teléfono, y esa columna hoy se llena a mano. Por eso el job
distingue `no_web` de `empty` y de `error`: la ficha dice *por qué* falta el
dato en vez de mostrar un hueco.

Ampliar cobertura pasa por poblar ese campo. Vías, de más a menos fiable:

1. **A mano**, empezando por las corredoras de más stock (es una tarde de trabajo
   para el top 50, que cubre la mayor parte del mercado observado).
2. **Buscador con API** (Brave/Serper/Google CSE): buscar el nombre de la
   corredora + "propiedades" y quedarse con el dominio solo si el nombre de la
   corredora aparece en el `<title>`. Verificable y barato, pero es un servicio
   externo de pago y hay que aceptar falsos positivos residuales.
3. **Código interno cruzado** (H21, ya implementado en `link-internal-code-cl.mjs`):
   una vez enlazado un anuncio de PI con una ficha de la web propia por
   `seller_reference`, el dominio queda confirmado sin ambigüedad.

## 5. Precisión: por qué el extractor es tan estricto

Un teléfono equivocado en una ficha comercial es peor que un hueco — se llama a
quien no es. Los falsos positivos que aparecieron de verdad al probar, todos
cubiertos por un test:

- **Hash de imagen**: `.../9369f1147c62480491f933370113c3eb.webp` contiene
  `933370113`, un móvil chileno válido. Se exige frontera de palabra.
- **RUT**: `78.987.370-4` son 9 dígitos y colaba como `+56789873704`. Se
  descarta el patrón de RUT explícitamente.
- **Textos pegados**: `.text()` de cheerio concatena elementos vecinos sin
  espacio y producía el email inexistente `hola@magnoliaproperty.cltel`. Se
  extrae el texto separando elementos.
- **Frases institucionales**: "Somos una corredora con oficina en Av. X 1947"
  tiene un cargo ("corredora") y palabras capitalizadas — y no es una persona.
- **Acentos partidos**: las webs sobre ASP clásico sirven ISO-8859-1; leídas
  como UTF-8, "Vicuña" quedaba en "Vicu". `fetchHtml` ahora decide el charset
  por los bytes (`decodeHtmlBuffer`), lo que además arregla el crawl de
  inventario en esos mismos dominios.

Del texto libre solo se aceptan números con `+56` explícito o precedidos de
"Fono:", "Teléfono:", "Celular:" o "WhatsApp:". Todo lo demás tiene que venir de
un `href` declarado por la propia web.

## 6. Datos personales

Los nombres de ejecutivas y socias son datos personales (Ley 19.628, y Ley
21.719 al entrar en vigor). Lo que se guarda es únicamente lo que **la propia
corredora publica en su web corporativa como canal de contacto profesional**,
junto a la URL exacta de origen y la fecha de lectura (`source_url`,
`last_seen_at`), de modo que cualquier dato sea auditable y borrable. No se
scrapean redes sociales, ni registros civiles, ni fuentes que exijan saltarse un
CAPTCHA o autenticarse.
