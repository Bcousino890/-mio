# Verificación de WhatsApp de los teléfonos de DealerNet

**Leer entero antes de vincular un número.** Esto puede costar el número que se
use, y esa es una posibilidad asumida, no un accidente.

## Qué problema resuelve

DealerNet entrega por cada teléfono dos señales de WhatsApp:

| Dato | Qué es | Qué le falta |
|---|---|---|
| `ind_whatsapp` | Bandera de la base de DealerNet | **Fecha.** Un número dado de baja hace años puede seguir marcado como WhatsApp. |
| `idimagen` → foto | Foto de perfil que DealerNet capturó en su día | **Fecha.** No es la foto actual del contacto. |

Para quien va a llamar, "tiene WhatsApp" sin fecha y "estaba en WhatsApp el
martes" no son el mismo dato. Este módulo consigue el segundo.

## Qué hace exactamente

Un worker (`scraper/whatsapp-verify-worker.mjs`) mantiene una sesión de
WhatsApp Web multi-dispositivo con [Baileys](https://github.com/WhiskeySockets/Baileys),
vinculada a un número propio, y por cada teléfono de `dealernet_phones_cl`:

1. pregunta si el número está registrado (`onWhatsApp`) — el mismo mecanismo
   que usa la app al sincronizar la agenda;
2. si lo está, pide su foto de perfil (`profilePictureUrl`) y la **descarga**
   (las URL de WhatsApp caducan en horas);
3. guarda el resultado en `whatsapp_verificaciones_cl` con su fecha, y anota
   `foto_cambiada_at` solo cuando el sha256 de la foto es distinto del anterior.

**No envía mensajes.** El titular del número consultado no ve nada.

## Riesgos (los reales, no los teóricos)

- **Esto viola los Términos de Servicio de WhatsApp/Meta**, que prohíben
  clientes no autorizados. El baneo del número verificador es un *cuándo*, no
  un *si*, a volumen sostenido.
- Evidencia pública concreta: un número "Standard" baneado tras verificar
  >10.000 números ([whatsapp-web.js#2213](https://github.com/pedroslopez/whatsapp-web.js/issues/2213));
  Evolution API documenta que su endpoint de verificación masiva "can result in
  complete loss of the WhatsApp account" ([#2228](https://github.com/EvolutionAPI/evolution-api/issues/2228)).
  Ningún mantenedor publica un umbral seguro: los números de abajo son
  heurísticas conservadoras, no garantías.
- **Usar SIEMPRE un número sacrificable.** Nunca el corporativo ni el personal:
  un ban se lleva el número y sus chats.
- **Privacidad/RGPD.** Enriquecer datos de terceros (si tienen WhatsApp, su
  foto) es un tratamiento de datos personales. Hay que tener clara la base
  legal en la jurisdicción que aplique antes de usarlo a volumen.
- **Cadena de suministro npm.** Instalar solo el paquete canónico `baileys`.
  Hay clones maliciosos (caso *lotusbail*, diciembre 2025, >56.000 descargas)
  que roban las credenciales de sesión.

## Ritmo por defecto

Definido en `RITMO_POR_DEFECTO` (`scraper/lib/whatsapp-verify-cl.mjs`) y
cubierto por tests, porque es lo único que separa "enriquecer la base" de
"perder el número":

| Parámetro | Valor | Por qué |
|---|---|---|
| `porMinuto` | 15 | Techo duro. 20-30/min sostenidos ya es agresivo. |
| `jitterMs` | 1,5-4 s | Un ritmo constante es exactamente lo que delata a un cliente automatizado. |
| `pausaCada` / `pausaMs` | 150 checks / 7 min | Rompe el flujo continuo. |
| `topeDiario` | 800 | Muy por debajo de los >10.000 con ban documentado. |

Ajustables por entorno: `WA_VERIFY_POR_MINUTO`, `WA_VERIFY_TOPE_DIARIO`,
`WA_VERIFY_TTL_DIAS` (cada cuántos días se re-verifica un número, default 30).

**Subir el ritmo solo si el número aguanta semanas limpio, y de a poco.** Si
aparecen errores 429, avisos de spam o desconexiones frecuentes: bajar el ritmo
inmediatamente.

## Puesta en marcha

1. **Conseguir un número sacrificable** (SIM barata o número virtual).
2. **Calentarlo ~10 días antes de usarlo**: completar perfil y foto, guardar
   contactos reales, intercambiar mensajes de ida y vuelta. No escanear el QR
   el mismo día del alta.
3. Aplicar la migración `0095_whatsapp_verificacion_cl.sql`.
4. Levantar el worker (no arranca con un `up -d` normal, va con perfil propio
   justamente para que nadie lo encienda sin querer):

   ```bash
   docker compose -p casafari --env-file ../.env --profile whatsapp up -d whatsapp-verify
   ```

5. **Escanear el QR en `Configuración` → panel “Verificador de WhatsApp”**
   (`/settings`). El panel dice de entrada si está **Conectado** (con el número)
   o **No conectado**; el código se pide con el botón **“Ver QR”** — no está a
   la vista de cualquiera que abra Configuración, porque vincula un número real.
   Con el QR abierto, la pantalla repregunta cada 4 s: el código caduca en ~60 s
   y el worker emite uno nuevo. Al vincularse, el bloque se cierra solo.

   Si al pulsar “Ver QR” no hay código, el panel distingue las dos causas: el
   worker levantado y a segundos de emitirlo, o el contenedor apagado — en cuyo
   caso da el comando exacto para levantarlo.

   En el teléfono del número verificador: WhatsApp → Ajustes → Dispositivos
   vinculados → Vincular un dispositivo → apuntar a la pantalla.

   El mismo panel muestra después el estado, el número vinculado, las
   verificaciones de hoy y cuántos números quedan por verificar.

   Si hiciera falta desde consola, el QR crudo está en la base:

   ```sql
   SELECT estado, numero_e164, checks_dia, ultimo_error, qr FROM whatsapp_verificador_cl;
   ```
   ```bash
   npx qrcode-terminal "<contenido del campo qr>"
   ```

### ¿Cada cuánto hay que re-escanear el QR?

**Una sola vez.** La sesión se guarda en el volumen `wa-auth` y sobrevive a
reinicios del contenedor, deploys y reinicios del VPS.

Solo hay que volver a vincular si:

| Situación | ¿Re-escanear? |
|---|---|
| Reinicio del contenedor, deploy, reinicio del VPS | No |
| Se cierra la sesión desde el teléfono (Dispositivos vinculados) | Sí |
| Se borra el volumen `wa-auth` (p. ej. `docker compose down -v`) | Sí |
| El teléfono verificador pasa **~14 días sin conectarse** | Sí — WhatsApp desvincula los dispositivos |
| Meta banea el número | Sí, y con otro número |

El que muerde en la práctica es el del teléfono: si la SIM verificadora queda
en un cajón, a las dos semanas WhatsApp corta la sesión y el worker deja de
verificar. Ese teléfono tiene que encenderse y conectarse cada tanto.

No hay que vigilarlo a mano: el panel de Configuración muestra el estado, y si
deja de estar `conectado` y aparece un QR es que toca re-vincular.

**Antes de vincular, el sistema entero funciona igual que antes**: la ficha
sigue mostrando el dato de DealerNet, rotulado como suyo, y el filtro de envío
al CRM queda inerte (ver más abajo).

## Qué cambia en la aplicación

**Ficha (Dealer, Captación, Propiedades).** Cada teléfono muestra:

- ✅ ícono de WhatsApp con check verde → verificado y activo, con la fecha en
  el tooltip;
- `sin WhatsApp` → verificado y **no** está en WhatsApp (aunque DealerNet diga
  que sí — su dato está desactualizado);
- ícono de WhatsApp atenuado → todavía sin verificar; es el dato de DealerNet,
  sin fecha;
- avatar con anillo verde → la foto es la de WhatsApp de hoy; sin anillo, es la
  copia de DealerNet;
- botón ↻ → pide re-verificación. **No consulta a WhatsApp en el momento**:
  encola el número al principio de la cola del worker. El ritmo no puede
  depender de cuántas veces alguien haga clic.

**Verificar antes de enviar al CRM.** En la ficha de Captación y en el modal
de Propiedades, junto a los botones de envío, está **“Verificar WhatsApp (N)”**:

1. se marcan los teléfonos que interesan (casillas de siempre);
2. se pulsa el botón: esos números pasan al principio de la cola del worker y
   el botón espera, mostrando el avance (`3/6`);
3. al terminar, los que **no** están en WhatsApp **se desmarcan solos** y queda
   un resumen (`✓ 4 con WhatsApp · 2 descartado(s)`);
4. se envía a SmartBC lo que quedó marcado.

La espera es real y tiene tope: el worker consulta a ~15 números/minuto (unos
4 s cada uno), que es el ritmo que protege al número verificador. Para los 3-6
teléfonos de una ficha son segundos. Si alguno no alcanza a resolverse, el
botón lo dice (`2 aún en cola`) en vez de dar por buena una verificación que no
ocurrió; su badge se actualiza cuando el worker pase.

Un número ya verificado sin WhatsApp no se puede volver a marcar: la casilla
queda deshabilitada.

**Envío a SmartBC.** Ningún número que sepamos de baja llega al CRM. La regla
es deliberadamente asimétrica (`filtrarPhonesConWhatsapp`, `web/lib/smartbc/mapper.mjs`):

| Estado del número | ¿Viaja al CRM? |
|---|---|
| Verificado **con** WhatsApp | Sí |
| Verificado **sin** WhatsApp | **No, nunca** |
| Sin verificar todavía | Sí |

Lo último es a propósito: mientras el verificador no haya pasado por un número
—o no esté vinculado— "no sabemos" no puede convertirse en "no tiene", o el CRM
se quedaría sin contactos justo mientras se pone en marcha la verificación.

Si **todos** los teléfonos de una captación resultan de baja, el titular viaja
igual con su nombre, RUT y email, pero **sin teléfono**: la ficha del CRM no se
queda sin dueño, y tampoco lleva un número al que nadie va a contestar.

`has_whatsapp` en el payload del CRM lo manda la verificación cuando existe; la
bandera de DealerNet es solo el respaldo.

**La foto también viaja al CRM.** `contacts[].photo_url` apunta a la foto
verificada (`/api/chile/whatsapp-foto`) cuando la hay, y solo si no la hay a la
copia de DealerNet. La URL lleva la fecha del último check (`&v=`) porque
SmartBC re-aloja las fotos al recibirlas: con una URL fija se quedaría con la
primera para siempre aunque el contacto cambie la suya.

## El historial: quién tenía WhatsApp y foto, y desde cuándo no

`whatsapp_verificaciones_cl` guarda el estado ACTUAL — cada pasada del worker
pisa la anterior. El rastro vive en `whatsapp_verificaciones_hist_cl`
(migración 0096), que responde la pregunta que importa cuando una captación de
hace meses no contesta: **¿este número tenía WhatsApp cuando lo captamos, o
nunca lo tuvo?**

Se escribe **una fila por cambio**, no por pasada (verificar 30 veces lo mismo
no es información):

| `cambios` | Cuándo |
|---|---|
| `{alta}` | Primera verificación del número |
| `{whatsapp}` | Ganó o perdió WhatsApp |
| `{foto}` | Cambió la foto (sha256 distinto) |

Cada fila de tipo `foto` conserva **la imagen de ese momento**, así que se
puede ver la foto que el contacto tenía antes. Una fila por cambio de registro
no duplica la imagen: ya está guardada en su propia fila.

Un `estado = 'error'` (caída de red) **no** escribe historial: un fallo nuestro
no es un cambio del contacto.

En la ficha, un número verificado sin WhatsApp dice en el tooltip desde cuándo
lo perdió (`lo tuvo hasta el 12-10-2026`). Para consultas más amplias:

```sql
-- Historia completa de un número
SELECT verificado_at, cambios, tiene_whatsapp, tiene_foto
  FROM whatsapp_verificaciones_hist_cl
 WHERE phone_e164 = '+56995429258' ORDER BY verificado_at DESC;

-- Qué números perdieron WhatsApp este mes (se cayeron de las campañas)
SELECT DISTINCT phone_e164 FROM whatsapp_verificaciones_hist_cl
 WHERE 'whatsapp' = ANY(cambios) AND tiene_whatsapp = false
   AND verificado_at >= date_trunc('month', now());
```

## Límites conocidos

- **"Sin foto" y "foto restringida a contactos" son indistinguibles.** Ambas
  devuelven vacío. Por eso el campo se llama `tiene_foto`: significa "visible
  para nosotros", no "el contacto no tiene foto".
- La consulta de foto falla de forma intermitente por rate-limiting. Una pasada
  sin foto **no** borra la última foto buena guardada.
- Un fallo de red no degrada a "no tiene WhatsApp": queda `estado = 'error'` y
  se reintenta.
- Si el volumen crece mucho o la continuidad pasa a ser crítica, la alternativa
  es una API de pago (CheckNumber.AI, Whapi.Cloud, Wassenger). La Cloud API
  oficial de Meta **no** expone este dato.

## Archivos

| Archivo | Qué es |
|---|---|
| `db/migrations/0095_whatsapp_verificacion_cl.sql` | Tablas `whatsapp_verificaciones_cl` y `whatsapp_verificador_cl` |
| `db/migrations/0096_whatsapp_historial_cl.sql` | `whatsapp_verificaciones_hist_cl` — el historial de cambios |
| `scraper/lib/whatsapp-verify-cl.mjs` | Lógica: cola, ritmo, persistencia, lectura de la foto |
| `scraper/lib/whatsapp-verify-cl.test.mjs` | Tests (incluido el ritmo) |
| `scraper/whatsapp-verify-worker.mjs` | Cableado con Baileys y bucle |
| `scraper/Dockerfile.whatsapp` | Imagen del worker |
| `web/app/api/chile/whatsapp-verificacion/route.ts` | Lectura + "verificar ahora" |
| `web/app/api/chile/whatsapp-foto/route.ts` | Sirve la foto verificada |
| `web/lib/whatsapp-verificacion-client.ts` | Cliente con batching para la ficha |
| `web/lib/smartbc/mapper.mjs` | `filtrarPhonesConWhatsapp` y `contactPhotoUrl` — filtro y foto del envío al CRM |
| `web/components/admin/WhatsappVerificadorPanel.tsx` | Panel de Configuración: **el QR se escanea aquí** |
| `web/app/api/admin/whatsapp-verificador/route.ts` | Estado + QR renderizado a PNG |
