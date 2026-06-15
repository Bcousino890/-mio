# 🚀 Guía de Deploy Automático en VPS

Este proyecto está configurado para auto-deployer desde GitHub cada 5 minutos.

## Configuración Actual

El VPS tiene un cron que cada 5 minutos ejecuta:

```bash
cd /home/smartbc && git pull && npm run build && pm2 restart smartbc
```

## Mejora: Post-Deploy Automático

Para que las migraciones se apliquen **automáticamente** sin intervención manual, actualiza el cron:

### 1. **Editar el cron en el VPS**

```bash
crontab -e
```

### 2. **Cambiar la línea de deploy actual**

**De:**
```bash
*/5 * * * * cd /home/smartbc && git pull && npm run build && pm2 restart smartbc
```

**A:**
```bash
*/5 * * * * cd /home/smartbc && git pull && bash scripts/post-deploy.sh && pm2 restart smartbc
```

### 3. **Guardar y listo** ✅

A partir de ahora, cada 5 minutos:
- ✅ Git pull de los cambios
- ✅ Se aplican migraciones SQL automáticamente
- ✅ Se instalan dependencias si es necesario
- ✅ Se compila Next.js
- ✅ Se reinicia el servidor

---

## Alternativa: Script Manual

Si prefieres ejecutar manualmente en el VPS:

```bash
cd /home/smartbc
bash scripts/post-deploy.sh
```

---

## Variables de Entorno Requeridas

En el VPS, asegúrate de tener en `.env.local`:

```env
# Base de datos
DATABASE_URL=postgresql://...

# Supabase (si se usa)
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Email
EMAIL_ENCRYPTION_KEY=tu_clave_segura_aqui
NEXT_PUBLIC_APP_URL=https://portal.bcousinoprop.com

# Next.js
NEXT_PUBLIC_API_URL=https://portal.bcousinoprop.com
```

---

## Logs de Deploy

Los logs se guardan en PM2. Para verlos:

```bash
pm2 logs smartbc
pm2 show smartbc
```

---

## Rollback (Si algo falla)

```bash
cd /home/smartbc
git revert HEAD
bash scripts/post-deploy.sh
pm2 restart smartbc
```

---

## Troubleshooting

### "Error: user_role enum no tiene valor 'admin'"
→ Las migraciones no se aplicaron. Ejecuta:
```bash
bash scripts/post-deploy.sh
```

### "Error: tabla email_config no existe"
→ Falta migración 0021. Verifica que post-deploy.sh se ejecute.

### "PM2 proceso no reinicia"
→ Verifica logs:
```bash
pm2 logs smartbc --lines 100
```

---

## Estado Actual

- ✅ Código en main listo
- ✅ Migraciones en supabase/migrations/
- ✅ Script post-deploy.sh creado
- ⏳ **Pendiente:** Actualizar cron en VPS con post-deploy.sh
