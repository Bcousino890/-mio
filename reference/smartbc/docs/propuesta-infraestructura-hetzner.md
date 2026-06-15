# Propuesta: servidor propio para el portal (Hetzner)

**Para:** Benjamín Cousiño
**De:** Fabri (desarrollo)
**Fecha:** 24 de mayo de 2026
**Decisión que se pide:** aprobar o no el cambio de proveedor de infraestructura del portal.

---

## 1. Resumen en 30 segundos

Hoy el portal se apoya en **Supabase** (un servicio gestionado que nos da base de datos, login de usuarios, almacenamiento de fotos y copias de seguridad, todo automático). Cuesta unos **23 €/mes** cuando pasemos a producción.

Propongo mover esa infraestructura a un **servidor propio en Hetzner** (proveedor europeo, datos en la UE). Coste: **~9 €/mes**. Ahorro: **~170 €/año**.

**La contrapartida honesta:** con Supabase, si algo falla a las 3 de la mañana, lo arregla su equipo. Con servidor propio, lo arreglo yo, y soy yo quien garantiza las copias de seguridad. El ahorro es real pero modesto; lo importante es decidir si queremos asumir esa responsabilidad a cambio.

**Mi recomendación:** explico las dos opciones abajo y al final doy mi opinión clara.

---

## 2. Qué tenemos hoy

El portal necesita cuatro cosas para funcionar, y hoy las da Supabase, ya montadas y mantenidas por ellos:

| Pieza | Para qué sirve |
|---|---|
| Base de datos | Guarda clientes, propiedades, visitas, mensajes |
| Login / usuarios | El acceso privado de clientes y administradores |
| Almacenamiento | Las fotos de las propiedades (con nuestra marca de agua) |
| Copias de seguridad | Recuperar los datos si algo se rompe |

**Coste actual:** gratis mientras desarrollamos (plan free). Al lanzar a producción con clientes reales, ~23 €/mes (plan Pro, necesario por las copias de seguridad y el rendimiento).

---

## 3. Qué propongo

Alquilar un **servidor en Hetzner** e instalar ahí ese mismo software (Supabase es de código abierto, se puede instalar en nuestro propio servidor). 

**Lo importante para el negocio:** el portal **funciona exactamente igual**. El cliente no nota nada. No hay que reescribir el trabajo ya hecho — solo cambia *dónde* viven los datos.

### Servidor recomendado

> **Hetzner CX32** — 4 procesadores, 8 GB de memoria, 80 GB de disco
> Ubicación: Finlandia o Alemania (UE, cumple RGPD/protección de datos)
> **Coste: ~9 €/mes con IVA** (servidor 6,80 € + dirección IP 0,50 € + impuestos)

Es más que suficiente para arrancar. Si el portal crece, se amplía a un plan mayor en minutos, sin reinstalar nada.

---

## 4. Comparativa de costes

| Concepto | Supabase (actual) | Hetzner (propuesto) |
|---|---|---|
| Cuota mensual | ~23 €/mes | ~9 €/mes |
| **Coste anual** | **~276 €/año** | **~108 €/año** |
| Copias de seguridad | Incluidas y automáticas | Las configuro yo (sin coste extra) |
| Actualizaciones de seguridad | Las hace Supabase | Las hago yo |
| Soporte si se cae | Su equipo, 24/7 | Yo |
| Datos en la UE (RGPD) | Configurable | Sí (servidor en UE) |

**Ahorro: ~170 €/año.**

---

## 5. Lo que ganamos y lo que asumimos

**Ganamos:**
- ~170 €/año de ahorro
- Control total de nuestros datos, en territorio europeo
- Sin depender de los precios futuros de Supabase

**Asumimos:**
- **Mantenimiento:** actualizaciones de seguridad del servidor (mensual), vigilar que todo siga en pie, renovar certificados (esto se automatiza).
- **Responsabilidad de las copias de seguridad:** es lo más crítico. Con datos de clientes reales, perder la base de datos sería gravísimo. Lo configuraré con copias automáticas diarias a un sitio separado, pero la responsabilidad pasa a ser nuestra.
- **Si el servidor falla, el portal se cae hasta que yo lo levante.** Con Supabase, su equipo lo cubre.

---

## 6. Plan de trabajo

Trabajo de **1 a 2 días** para dejarlo funcionando:

1. Contratar el servidor en Hetzner
2. Instalar el software (Supabase autoalojado con Docker)
3. Conectar nuestro dominio y certificado de seguridad (HTTPS)
4. Migrar los datos actuales (base de datos + fotos)
5. **Configurar copias de seguridad automáticas diarias** ← prioridad máxima
6. Cambiar la configuración del portal para que use el nuevo servidor
7. Probar que todo funciona (login, fotos, permisos) antes de dar por buena la migración

Después, mantenimiento continuo de ~1-2 horas al mes.

---

## 7. Riesgos y cómo los cubro

| Riesgo | Mitigación |
|---|---|
| Perder datos de clientes | Copias automáticas diarias a almacenamiento separado + prueba de restauración |
| El servidor se cae | Hetzner tiene 99,9% de disponibilidad; puedo restaurar en otro servidor desde la copia |
| Brecha de seguridad | Servidor con firewall, accesos cerrados, actualizaciones al día |
| Que yo no esté disponible | Documentación del montaje para que otro técnico pueda tomar el relevo |

---

## 8. Mi recomendación honesta

El cambio **tiene sentido si estamos cómodos asumiendo el mantenimiento de un servidor**. El ahorro (~170 €/año) es real pero modesto comparado con lo que mueve una sola operación inmobiliaria.

Dos caminos razonables:

**Opción A — Migrar ahora a Hetzner.**
Mejor momento es ahora, antes de tener clientes reales (menos datos, menos riesgo). Ahorramos desde el día uno. Asumimos el mantenimiento.

**Opción B — Quedarnos en Supabase de momento.**
Seguimos avanzando funcionalidades y revisamos esto justo antes del lanzamiento. Pagamos ~13 €/mes más, pero a cambio de cero mantenimiento y de que un equipo profesional cubre las copias y las caídas.

**Mi opinión:** si vamos a tener tráfico modesto al principio (que es lo esperable), **migrar a Hetzner es una buena jugada de ahorro siempre que entendamos que la responsabilidad de las copias de seguridad es nuestra**. Si prefieres máxima tranquilidad y cero riesgo operativo en el arranque, Supabase los 13 €/mes de más los vale. Ambas son decisiones defendibles; necesito tu visto bueno para una u otra.

---

*Cualquier duda, me dices y lo vemos.*
