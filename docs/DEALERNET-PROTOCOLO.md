# DealerNet — Protocolo de integración (Central de Información)

Referencia interna a partir de tres documentos entregados por el proveedor
(no versionados en este repo):

- *DEALERNET — Servicios de Integración, Protocolo General* (v14, agosto 2025)
- *Servicios de Integración — Buscador Múltiple* (producto 3460, doc. agosto 2025)
- *DEALERNET — Servicios de Integración, Protocolo Web-Services* (v11, 103 págs.
  — la spec completa con los payloads de entrada/salida de cada producto)

Endpoint de producción: `https://infows.dealernet.cl/wsinfodlnt.asmx?wsdl`
(HTTPS — el código fuerza https aunque el `.env` tenga la URL antigua en http).
Método SOAP único: `CentralDeInformacion`.

⚠️ Estructura de salida según producto (v11): en 3407/3410 los bloques
`telefono_contacto_*`, `correo_contacto_*` y `residencia_*` cuelgan
directamente de `<colect>`; en 3408 (Verificación Múltiple) van envueltos un
nivel más adentro, en `<telefonos>`/`<correos>`/`<direcciones>`. Los
extractores de `web/lib/dealernet.ts` soportan ambas formas.

⚠️ Cuentas: el retcode 3 ("Cuenta Usuario no habilitada para consulta WS")
apareció con la cuenta de portal `COUSINO.Bcousino` — las consultas WS
requieren la cuenta de web services (`COUSINO.WsProd`), que se configura
desde la pantalla `/dealer`.

## 1. Consulta por RUT (protocolo general)

Es lo que ya implementa `web/lib/dealernet.ts` (`queryDealernet`). Se envía
`<ruts><rut num dv/></ruts>` + una lista de `<prods><prod cod="..."/></prods>`.

Códigos de retorno (`retcode`):

| Código | Significado |
|---|---|
| 0 | Consulta exitosa |
| 1 | Cuenta Usuario no definida |
| 2 | Cuenta Usuario Bloqueada |
| 3 | Cuenta Usuario no habilitada para consulta WS |
| 4 | Clave inválida |
| 5 | Tipo de consulta inválido (`tipocns`) |
| 6 | Rut inválido |
| 99 | Error Dealernet |
| 999 | Error en parámetro obligatorio |

Productos documentados (lista completa del protocolo general; 3407, 3408,
3410 y 3421 están implementados hoy en `DEALERNET_PRODUCTS`):

3401 Comportamiento Civil · 3402 Comportamiento Laboral · 3403 Comportamiento
Penal · 3404 Boletín Concursal · 3407 Contactabilidad · 3408 Verificación
Múltiple · 3409 Directorio Direcciones · 3410 Directorio Teléfonos · 3411
Directorio Correo · 3412 Registro Automotriz · 3413 Índice de Propiedades ·
3414 Activos · 3417 Ficha Empresa · 3419 Cobranza Laboral · 3420 Registro de
Sanciones (SNIFA) · 3421 Registros de Relacionados · 3423 Carga
Familiar-Índice · 3425/3426 Boletín Impagos Vigentes/Históricos · 3427/3428
Boletín Lab. y Prev. Vigente/Histórico · 3429 Boletín de Alertas · 3430
Malla Societaria · 3431-3434 Índice Judicial (Civil/Laboral/Penal/Cobranza) ·
3435 Perfil Comercial · 3439 Boletín de Procesos Penales · 3440
Identificación · 3443 Registro Propiedades · 3450 Persona Expuesta
Políticamente (PEP) · **3460 Buscador Múltiple** (ver abajo).

## 2. Buscador Múltiple (producto 3460)

**Este es el que faltaba**: permite buscar sin conocer el RUT de antemano,
usando otro tipo de payload (`<param><busq tipbusq="..." args="..."/></param>`
en vez de `<ruts>`):

```xml
<root>
  <tipocns>O</tipocns>
  <param>
    <busq tipbusq="{TIPBUSQ}" args="{ARGS}"/>
  </param>
  <prods><prod cod="3460"/></prods>
</root>
```

`tipbusq` acepta:

| Valor | Búsqueda por |
|---|---|
| `nombre` | Persona natural |
| `empresa` | Persona jurídica |
| `ambas_peremp` | Persona natural o jurídica |
| `telefono` | Teléfono |
| `direccion` | Dirección (formato: `dirección, comuna`) |
| `rol` | Rol (Manzana-Predio, Comuna) |
| `patente` | Patente |

La respuesta trae un listado de candidatos (no un único titular confirmado
como en la consulta por RUT):

```xml
<output>
  <DATOS>
    <DATO>
      <RUT>8712346</RUT>
      <DIGITO>8</DIGITO>
      <CLASIF>P</CLASIF>               <!-- P = persona natural, E = empresa -->
      <DSPNOMBRES>CLAUDIA CAMILA</DSPNOMBRES>
      <DSPAPELLIDOS>PEREZ ROJAS</DSPAPELLIDOS>
      <DSPORG>Inmobiliaria Limitada</DSPORG>
      <PROPIETARIO>Histórico</PROPIETARIO>   <!-- Histórico/Actual -->
      <SIMILITUD>50</SIMILITUD>              <!-- 0-100 -->
      <PROBABILIDAD>Alta</PROBABILIDAD>      <!-- Alta/Media/Baja -->
    </DATO>
    <!-- ... más candidatos ... -->
  </DATOS>
</output>
```

Uso previsto: partiendo de la dirección o el rol de una propiedad (que ya
tenemos vía SII/catastro), obtener candidatos a RUT del propietario y luego
alimentar ese RUT a `queryDealernet` (protocolo general) para traer
teléfonos/emails/direcciones confirmadas.

Implementado en `web/lib/dealernet.ts` como `queryDealernetBuscadorMultiple`
y expuesto en `web/app/api/chile/dealernet-buscar/route.ts` +
`web/components/chile/DuenoLookup.tsx`.

## 3. Registros de Relacionados (producto 3421)

Devuelve la tabla "Relacionados" que muestra el portal DealerNet: filas
RUT / NOMBRE / RELACIÓN (Titular, Sociedad, Socio, Cónyuge, Hijo, Hija,
Empleador, ...). Se consulta por RUT igual que 3407/3410, agregando
`<prod cod="3421"/>`.

Como la estructura XML exacta del payload no está en la doc versionada (vive
en el PDF v11 de 103 páginas), el extractor `extractRelacionados` de
`web/lib/dealernet.ts` recorre el payload del producto en profundidad y toma
como relacionado cualquier nodo con un campo de relación (`relacion`,
`glsrelacion`, `vinculo`, `parentesco`, ...) junto a un RUT o nombre. Si el
DV no viene, se calcula (`computeRutDv`). Persistencia en
`dealernet_relacionados_cl` (migración 0053); UI en
`web/components/chile/DuenoLookup.tsx` con botón "Pedir teléfonos" por fila
para encadenar la consulta de contactabilidad del relacionado.

Lo mismo aplica a la "relación" por teléfono: cuando 3407/3410 anotan de
quién es un número (cónyuge/hijo/sociedad), `extractPhoneRelacion` la captura
por alias y se guarda en `dealernet_phones_cl.relacion`.

## 4. Foto de perfil por teléfono (`idimagen`)

Cada teléfono puede traer un `idimagen` (referencia a la foto de perfil de
WhatsApp que muestra el portal). El web service solo entrega el id; la
imagen la sirve el portal por HTTP con una URL que no está en la doc. Se
configura como plantilla en el `.env`:

```
DEALERNET_IMAGE_URL_TEMPLATE=https://.../imagen?id={id}
```

(abrir una ficha en el portal → clic derecho sobre la foto → "Copiar
dirección de imagen" → reemplazar el id por `{id}`). La app la proxea vía
`/api/chile/dealernet-imagen?id=...` (cache 24h, sin filtrar la URL interna
al navegador); sin plantilla configurada la UI muestra un avatar genérico.

## 5. Pestaña "Dealer" en la app

Toda la funcionalidad de DealerNet (config de credenciales + búsqueda por
RUT + Buscador Múltiple por dirección/rol) está consolidada en una sola
pantalla: `/dealer` (`web/app/dealer/page.tsx`), con item propio en el
sidebar. Antes las credenciales (`DealerNetPanel`) vivían sueltas en
`/settings` — se movieron aquí para no duplicar la config en dos lugares.
