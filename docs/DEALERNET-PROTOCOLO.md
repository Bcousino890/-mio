# DealerNet — Protocolo de integración (Central de Información)

Referencia interna a partir de dos documentos entregados por el proveedor
(agosto 2025, no versionados antes en este repo):

- *DEALERNET — Servicios de Integración, Protocolo General* (v14)
- *Servicios de Integración — Buscador Múltiple* (producto 3460, doc. agosto 2025)

Endpoint de producción: `https://infows.dealernet.cl/wsinfodlnt.asmx?wsdl`
Método SOAP único: `CentralDeInformacion`.

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

Productos documentados (lista completa del protocolo general; solo 3407,
3408 y 3410 están implementados hoy en `DEALERNET_PRODUCTS`):

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

## 3. Pestaña "Dealer" en la app

Toda la funcionalidad de DealerNet (config de credenciales + búsqueda por
RUT + Buscador Múltiple por dirección/rol) está consolidada en una sola
pantalla: `/dealer` (`web/app/dealer/page.tsx`), con item propio en el
sidebar. Antes las credenciales (`DealerNetPanel`) vivían sueltas en
`/settings` — se movieron aquí para no duplicar la config en dos lugares.
