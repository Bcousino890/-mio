# SmartBC CRM — Auditoría Completa y Cambios Aplicados

**Fecha:** 2026-06-10
**Rama de desarrollo:** `claude/adoring-pasteur-3OgFB` → merge a `main`
**Stack:** Next.js 15 (App Router) · Supabase self-hosted (GoTrue + PostgreSQL en contenedor Docker `supabase-db`) · VPS Hetzner · PM2
**Importante:** NO se usa Vercel ni Supabase Cloud. Todo corre en el VPS propio.

---

## 1. Resumen Ejecutivo

Se completó una auditoría integral del CRM SmartBC cubriendo el módulo de Particulares (captación de anuncios de Idealista/Fotocasa), seguridad de endpoints de administración, experiencia de usuario del panel admin y el flujo de recuperación de contraseña por email.

Resultados principales:

- **Particulares:** eliminado el tope de 1000 registros visibles, extracción de teléfonos funcionando en Idealista **y** Fotocasa con sistema de confianza, historial de contactos por particular (nueva tabla + UI), visibilidad de anuncios retirados y desglose por portal.
- **Seguridad:** 5 endpoints de admin que estaban sin protección (o con protección insuficiente) ahora exigen rol de staff/admin.
- **UX:** nueva ficha de cliente, nuevo dashboard con métricas en tiempo casi real, pestañas en solicitudes, filtros/ordenación en clientes y ~80 cadenas nuevas de i18n (ES/EN/FR/DE).
- **Email:** corregida la causa raíz por la que los enlaces de recuperación de contraseña apuntaban a `localhost:3137`, y añadido fallback de configuración SMTP por variables de entorno.

Todos los cambios están en código y compilando. **Queda pendiente aplicar en el VPS la migración 0033 y verificar variables de entorno SMTP** (ver sección 6).

---

## 2. Tabla de Cambios por Prioridad

| Prioridad | Área | Cambio | Estado |
|---|---|---|---|
| P1 | Particulares | Paginación servidor (100/página) + botón "Cargar más"; eliminado límite de 1000 | ✅ Hecho |
| P1 | Particulares | Extracción de teléfono en Fotocasa además de Idealista (patrones JSON específicos) | ✅ Hecho |
| P1 | Particulares | Scoring de confianza de teléfonos (HIGH / MEDIUM / LOW-descartado) + validación de teléfono español | ✅ Hecho |
| P1 | Particulares | Anuncios retirados (`taken_down_at`) visibles vía toggle, con datos completos | ✅ Hecho |
| P1 | Particulares | Historial de interacciones de contacto: tabla `particulares_contacts` (migración 0033) + componente `ContactLog` | ✅ Hecho (migración pendiente en VPS) |
| P1 | Particulares | Desglose por portal en el StatCard de total (idealista: N · fotocasa: N) | ✅ Hecho |
| P1 | Particulares | El cron de scraping ya no descarta `advertiser_type = "unknown"`; solo descarta `"professional"` confirmado | ✅ Hecho |
| P3 | Seguridad | `/api/admin/particulares` exigía nada → ahora rol staff (401/403) | ✅ Hecho |
| P3 | Seguridad | `/api/admin/idealista/save-config` → solo admin (owner/admin) | ✅ Hecho |
| P3 | Seguridad | `/api/admin/idealista/test-connection` → solo admin | ✅ Hecho |
| P3 | Seguridad | `/api/admin/idealista/publish-info` → advisor o superior | ✅ Hecho |
| P3 | Seguridad | `/api/admin/calendario/events` → `getCurrentProfile()` + chequeo `STAFF_ROLES` en GET y POST | ✅ Hecho |
| P4 | UX | Nueva ficha de cliente `/admin/clientes/[id]` | ✅ Hecho |
| P4 | UX | Tabla de clientes: filtro activo/inactivo + ordenación (nombre/recientes/favoritos/visitas) | ✅ Hecho |
| P4 | UX | Solicitudes: vista por pestañas + acción de cancelar | ✅ Hecho |
| P4 | UX | Nuevo `/admin/dashboard` con 4 tarjetas de métricas + feed de actividad (revalida cada 30 s) | ✅ Hecho |
| P4 | UX | i18n: ~80 cadenas nuevas en ES/EN/FR/DE | ✅ Hecho |
| P5 | Email | Fix de URL en enlaces de recuperación de contraseña (`NEXT_PUBLIC_PORTAL_URL`) | ✅ Hecho |
| P5 | Email | Fallback SMTP por variables de entorno cuando `email_config` (BD) está vacía | ✅ Hecho (verificar env en VPS) |

---

## 3. Detalles Técnicos por Área

### 3.1 Prioridad 1 — Módulo de Particulares

#### Paginación sin tope de 1000 registros
- **Problema:** la vista de particulares cargaba como máximo 1000 filas (límite por defecto de PostgREST/Supabase), ocultando registros antiguos sin aviso.
- **Solución:** paginación por offset en el servidor a través del nuevo endpoint `GET /api/admin/particulares/paginated`, con páginas de **100 registros** y botón **"Cargar más"** en el cliente. El total real se obtiene con count exacto, no con el tamaño del array.

#### Extracción de teléfonos: Idealista + Fotocasa
- **Problema:** la extracción de teléfono solo funcionaba para Idealista; los anuncios de Fotocasa quedaban sin teléfono.
- **Solución:**
  - Los extractores de ambos portales (`lib/sync/import-by-link/extractors/idealista.ts` y `fotocasa.ts`) ahora invocan `detectAdvertiserFromHtml` del detector compartido.
  - Se añadieron patrones JSON específicos de Fotocasa: claves `"userPhone"`, `"mobilePhone"` y el atributo `data-ga-phone`, entre otros.
- **Scoring de confianza:**

  | Nivel | Fuente | Acción |
  |---|---|---|
  | HIGH | Atributos de datos / JSON embebido del portal | Se guarda |
  | MEDIUM | Enlaces `tel:` | Se guarda |
  | LOW | Texto suelto / heurísticas débiles | **Se descarta** |

- **Validación:** todo teléfono debe cumplir el patrón español `^(\+34)?[6789]\d{8}$` antes de persistirse.

#### Anuncios retirados
- Los particulares con `taken_down_at` ya no desaparecen: un toggle en la UI permite mostrarlos/ocultarlos, conservando todos sus datos (precio histórico, teléfono, etc.).

#### Historial de interacciones de contacto
- **Nueva tabla:** `particulares_contacts` (migración `supabase/migrations/0033_particulares_contacts.sql`). ⚠️ **Pendiente de aplicar en el VPS.**
- **UI:** componente `ContactLog` (en `app/(admin)/admin/particulares/particulares-client.tsx`) que registra interacciones de tipo **llamada / whatsapp / email / visita / nota**, con resultado (outcome) y notas libres.
- **API:** `GET`/registro vía `/api/admin/particulares/contacts`.

#### Desglose por portal
- El StatCard de total muestra en el pie el desglose `idealista: N · fotocasa: N`.

#### Cron de scraping — anunciantes "unknown"
- **Problema:** el cron descartaba todo anuncio con `advertiser_type = "unknown"`. Fotocasa con frecuencia no expone el flag de profesional, así que se perdían particulares legítimos.
- **Solución:** solo se descartan anuncios con `"professional"` **confirmado**; los `"unknown"` se conservan.

### 3.2 Prioridad 3 — Seguridad de endpoints

| Endpoint | Antes | Ahora |
|---|---|---|
| `/api/admin/particulares` | **Completamente abierto** (sin auth) | Chequeo de rol staff; responde 401 sin sesión y 403 sin rol |
| `/api/admin/idealista/save-config` | Sin restricción de rol adecuada | Solo admin (`owner`/`admin`) |
| `/api/admin/idealista/test-connection` | Sin restricción de rol adecuada | Solo admin |
| `/api/admin/idealista/publish-info` | Sin restricción de rol adecuada | Advisor o superior |
| `/api/admin/calendario/events` | `auth.getUser()` pelado (cualquier usuario autenticado, incluso clientes) | `getCurrentProfile()` + chequeo `STAFF_ROLES` en GET y POST |

### 3.3 Prioridad 4 — UX del panel admin

- **Ficha de cliente** `/admin/clientes/[id]`: datos de contacto, actividad, favoritos, historial de visitas, preferencias y notas internas.
- **Tabla de clientes:** filtro activo/inactivo y ordenación por nombre, actividad reciente, favoritos o visitas.
- **Solicitudes:** vista por pestañas (pendientes / confirmadas / completadas / canceladas) y nueva acción de **cancelar** solicitud.
- **Dashboard** `/admin/dashboard`:
  - 4 tarjetas: anuncios activos, nuevos en 7 días (con tendencia), total de clientes, solicitudes pendientes.
  - Feed de actividad reciente.
  - Revalidación cada **30 segundos**.
- **i18n:** ~80 cadenas nuevas en español, inglés, francés y alemán (`lib/i18n/dictionary.ts`).

### 3.4 Prioridad 5 — Recuperación de contraseña por email

- **Causa raíz:** `NEXT_PUBLIC_APP_URL` no estaba definida en producción, por lo que los enlaces de reseteo se generaban contra `localhost:3137`.
- **Fix:** la ruta `app/api/auth/forgot-password/route.ts` ahora usa **`NEXT_PUBLIC_PORTAL_URL`** (`https://portal.bcousinoprop.com`) como primera opción para construir el enlace.
- **Fallback SMTP:** `lib/email/send-email.ts` ahora cae a variables de entorno cuando la tabla `email_config` de la BD está vacía: `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `FROM_EMAIL`.
- **SMTP configurado:** `c1362346.ferozo.com`, puerto `465` con SSL. Las credenciales están en `.env.local` (gitignored) — **no se incluyen en este documento por seguridad**.

---

## 4. Archivos Clave Modificados / Creados

### Particulares (P1)
- `app/api/admin/particulares/paginated/route.ts` — **nuevo**, paginación servidor (100/página)
- `app/api/admin/particulares/contacts/route.ts` — **nuevo**, historial de contactos
- `app/api/admin/particulares/route.ts` — guard de staff añadido (también P3)
- `app/(admin)/admin/particulares/particulares-client.tsx` — botón "Cargar más", toggle de retirados, componente `ContactLog`, desglose por portal
- `lib/sync/import-by-link/extractors/fotocasa.ts` — extracción de teléfono (patrones `userPhone`, `mobilePhone`, `data-ga-phone`)
- `lib/sync/import-by-link/extractors/idealista.ts` — usa el detector compartido
- `lib/sync/particulares/idealista-advertiser-detector.ts` — scoring de confianza, validación de teléfono español, manejo de `unknown`
- `supabase/migrations/0033_particulares_contacts.sql` — **nueva migración** (pendiente en VPS)

### Seguridad (P3)
- `app/api/admin/idealista/save-config/route.ts`
- `app/api/admin/idealista/test-connection/route.ts`
- `app/api/admin/idealista/publish-info/route.ts`
- `app/api/admin/calendario/events/route.ts`

### UX (P4)
- `app/(admin)/admin/clientes/[id]/page.tsx` y `app/(admin)/admin/clientes/[id]/client-ficha-view.tsx` — **nueva ficha de cliente**
- `app/(admin)/admin/clientes/clientes-admin-client.tsx` — filtros y ordenación
- `app/(admin)/admin/solicitudes/solicitudes-admin-client.tsx` — pestañas + cancelar
- `app/(admin)/admin/dashboard/page.tsx` y `app/(admin)/admin/dashboard/dashboard-activity.tsx` — **nuevo dashboard**
- `lib/i18n/dictionary.ts` — ~80 cadenas nuevas ES/EN/FR/DE

### Email (P5)
- `app/api/auth/forgot-password/route.ts` — usa `NEXT_PUBLIC_PORTAL_URL`
- `lib/email/send-email.ts` — fallback SMTP por variables de entorno

---

## 5. Recordatorio de Infraestructura (NO cambiar el rumbo)

- Todo corre en el **VPS Hetzner propio**. **No** hay Supabase Cloud ni Vercel.
- PostgreSQL vive en el contenedor Docker **`supabase-db`** del VPS; GoTrue self-hosted.
- `SUPABASE_SERVICE_ROLE_KEY` y `NEXT_PUBLIC_SUPABASE_URL` apuntan al VPS.
- Servidor Next.js gestionado con **PM2**.
- Deploy automático: push a `main` → cron del VPS (cada ~5 min) ejecuta `git pull && npm run build && pm2 restart`.

---

## 6. ⚠️ Pendiente de Deploy — Checklist

Estos pasos deben ejecutarse **en el VPS** (no hay acceso SSH desde este entorno):

- [ ] **Aplicar la migración `0033_particulares_contacts.sql`** con `psql` dentro del contenedor Docker `supabase-db`. Dos opciones:
  - Ejecutar `scripts/post-deploy.sh` (aplica migraciones pendientes), o
  - Usar el botón de migraciones en `/admin/configuracion`.
- [ ] **Verificar variables de entorno en el `.env` del VPS:**
  - `SMTP_SERVER` (= `c1362346.ferozo.com`)
  - `SMTP_PORT` (= `465`)
  - `SMTP_USER`
  - `SMTP_PASSWORD`
  - `FROM_EMAIL`
  - `EMAIL_ENCRYPTION_KEY`
  - `NEXT_PUBLIC_PORTAL_URL` (= `https://portal.bcousinoprop.com`)
- [ ] **Deploy:** hacer push a `main` y esperar al cron del VPS (~5 min) que ejecuta `git pull && npm run build && pm2 restart`.

---

## 7. Verificación Post-Deploy

Una vez aplicado todo en el VPS, comprobar:

1. **Migración 0033:** abrir un particular en `/admin/particulares` y registrar una interacción (llamada/whatsapp/email/visita/nota). Si la tabla no existe, el `ContactLog` fallará — revisar que la migración se aplicó.
2. **Paginación:** en `/admin/particulares`, verificar que el total mostrado supera 1000 (si corresponde) y que el botón "Cargar más" trae páginas de 100.
3. **Teléfonos Fotocasa:** comprobar que nuevos anuncios de Fotocasa capturados por el cron tienen teléfono cuando el portal lo expone.
4. **Anuncios retirados:** activar el toggle de retirados y confirmar que aparecen registros con `taken_down_at`.
5. **Seguridad:** sin sesión, `GET /api/admin/particulares` debe devolver **401**; con sesión de cliente (no staff), **403**. Repetir con los endpoints de Idealista y calendario.
6. **Dashboard:** `/admin/dashboard` muestra las 4 tarjetas con datos reales y el feed de actividad; los números se actualizan en ~30 s.
7. **Ficha de cliente:** `/admin/clientes/[id]` carga contacto, favoritos, visitas y notas.
8. **Solicitudes:** las pestañas filtran correctamente y la acción de cancelar mueve la solicitud a "canceladas".
9. **Recuperación de contraseña:** solicitar reseteo desde el portal y confirmar que:
   - el email llega (SMTP Ferozo operativo), y
   - el enlace apunta a `https://portal.bcousinoprop.com/...` (no a `localhost:3137`).
10. **i18n:** cambiar de idioma (ES/EN/FR/DE) y verificar que las vistas nuevas no muestran claves sin traducir.

---

*Documento generado el 2026-06-10 como cierre de la auditoría CRM de SmartBC.*
