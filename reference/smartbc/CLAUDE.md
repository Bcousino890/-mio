# smartbc — Notas de infraestructura

## Stack real (IMPORTANTE — leer siempre antes de tocar infra)
- **Todo en VPS propio (Hetzner). NADA en la nube de terceros.**
- **NO usamos Supabase Cloud** ni su panel/MCP. La base de datos (PostgreSQL)
  corre en el VPS dentro del contenedor Docker `supabase-db`.
- **NO usamos Vercel.** El servidor Next.js corre en el VPS con PM2.
- ⚠️ Aclaración: el código sí importa las librerías `@supabase/supabase-js` y
  `@supabase/ssr`, pero apuntan al **stack self-hosted del VPS** (GoTrue +
  PostgreSQL propios), NO a supabase.com. Por eso:
  - NO sugerir herramientas/MCP de Supabase Cloud ni de Vercel.
  - `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL` apuntan al VPS.
  - Las migraciones se aplican con psql dentro del contenedor `supabase-db`
    (ver `scripts/post-deploy.sh` y el botón en `/admin/configuracion`).
- Deploy: push a `main` → VPS hace `git pull && npm run build && pm2 restart`
  (cron cada ~5 min). No tengo acceso SSH al VPS desde aquí.

## Ramas
- Desarrollo: `claude/adoring-pasteur-3OgFB`
- Producción: `main`

## Upload de archivos (Vídeos, Planos)
- **Límites en la app:** vídeos ≤500MB, planos ≤100MB
- **Almacenamiento:** bucket Supabase `properties-photos` (self-hosted en VPS)
- ⚠️ **Si uploads fallan por tamaño:** el contenedor `storage` del VPS tiene un
  límite `FILE_SIZE_LIMIT` (default ~50MB). Para aumentar:
  1. SSH al VPS → `docker-compose.yml` de Supabase
  2. Localiza el servicio `storage` y agrega/edita:
     ```yaml
     environment:
       FILE_SIZE_LIMIT: 536870912   # 512MB en bytes
     ```
  3. `docker compose up -d storage` (reinicia el contenedor)
  4. O usa YouTube/Vimeo + enlace (que ya funciona en SmartLinks)
