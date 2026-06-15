# Guía rápida: crear el servidor en Hetzner

**Para:** Benjamín
**Tiempo estimado:** 15 minutos
**Qué vas a hacer:** crear la cuenta y el servidor. La configuración técnica la hago yo después; tú solo necesitas dejarlo creado y pasarme un par de datos.

---

## Paso 1 · Crear la cuenta

1. Entra en **https://www.hetzner.com/cloud**
2. Pulsa **Sign Up** (registrarse) y crea la cuenta con el email de la empresa.
3. Verifica el email y añade un método de pago (tarjeta o PayPal). La factura irá a nombre de la empresa.
4. Al entrar, crea un **proyecto nuevo**. Ponle de nombre: **`smartbc`**

---

## Paso 2 · Crear el servidor

Dentro del proyecto, pulsa **Add Server** (añadir servidor) y elige estas opciones **exactamente**:

| Opción | Qué elegir |
|---|---|
| **Type** (tipo) | Línea **CPX** → **CPX32** (4 vCPU · 8 GB RAM · 160 GB) — *NO el CPX22, que tiene poca memoria* |
| **Location** (ubicación) | **Nuremberg** (Alemania) |
| **Image** (sistema) | **Ubuntu** (la versión que ofrezca, 24.04 o 26.04, cualquiera vale) |
| **Networking** | ✅ Deja marcado **IPv4 + IPv6** *(no dejar solo IPv6)* |
| **Backups** | ✅ Actívalo (suma ~20%, vale la pena como copia extra de seguridad) |
| **SSH Keys** | Pega la clave que aparece en el Paso 3 ⬇️ |
| **Name** (nombre) | **`smartbc-portal`** |
| **Nº de servidores** | **1** — *(en el panel derecho debe poner "1 Server", no 2)* |

El resto de opciones se quedan como están por defecto.

**Coste estimado:** ~14,50 €/mes (servidor + IPv4) + ~2,8 €/mes (backups) = **~21 €/mes con IVA**.

---

## Paso 3 · Pegar la clave de acceso (importante)

Para que yo pueda entrar a configurar el servidor, en la sección **SSH Keys** pulsa **Add SSH Key** y pega **este texto completo** (es la clave que me da acceso, es seguro compartirla):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINmtu77ZmxumXvKcUqQMe3KU8yXlXjNdn8I0EKLDRydb fabriirguez@Fabricios-MacBook-Air-160.local
```

Ponle de nombre a la clave: **`fabri`** y guárdala. Asegúrate de que queda **marcada/seleccionada** antes de crear el servidor.

> Si por lo que sea no te deja pegar la clave o te lías, créalo igualmente sin clave: Hetzner te enviará una contraseña por email. En ese caso me pasas esa contraseña por un canal privado (no por email normal) y yo me encargo.

---

## Paso 4 · Crear y avisarme

1. Pulsa **Create & Buy now** (crear y comprar).
2. Cuando termine (1-2 min), el servidor aparecerá con una **dirección IP** (algo tipo `91.99.xx.xx`).
3. **Pásame esa dirección IP.** Con eso ya puedo entrar y montar todo lo demás.

---

## Qué hago yo después (no te preocupes por esto)

- Instalar el software del portal en el servidor
- Conectar el dominio y el certificado de seguridad (HTTPS)
- Pasar los datos actuales al nuevo servidor
- Configurar las copias de seguridad automáticas diarias
- Probar que todo funciona antes de dar el cambio por bueno

---

## Resumen de lo que necesito de ti

1. ✅ Servidor **CX32** creado en **Nuremberg**, con **Ubuntu 24.04**, **IPv4 activado** y **backups activados**
2. ✅ Mi clave SSH pegada (Paso 3)
3. ✅ Me pasas la **dirección IP** del servidor cuando esté creado

Con eso, el resto lo hago yo. Cualquier duda durante el proceso, me llamas.
