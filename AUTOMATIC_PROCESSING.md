# Procesamiento Automático de Archivos

El sistema puede procesar archivos automáticamente usando dos métodos:

## Opción 1: Cron Job (Recomendado)

Ejecuta el procesamiento cada 5 minutos automáticamente.

### Setup en el servidor:

```bash
# Editar crontab
crontab -e

# Añadir esta línea:
*/5 * * * * curl -X POST http://localhost:3000/api/admin/process-uploads-worker -H "Authorization: Bearer YOUR_SECRET" 2>&1 | logger

# O si el servidor está en HTTPS:
*/5 * * * * curl -X POST https://crm.cremme.es/api/admin/process-uploads-worker -H "Authorization: Bearer YOUR_SECRET" 2>&1 | logger
```

### Variables de entorno requeridas:

En `docker-compose.yml` o `.env`:
```env
UPLOAD_DIR=/data/uploads
DATABASE_URL=postgresql://user:password@db:5432/casafari
PROCESSING_SECRET=your-secure-secret
```

## Opción 2: Script Manual

```bash
# Ejecutar una vez:
node scraper/process-uploads.mjs

# O via HTTP:
curl -X POST http://localhost:3000/api/admin/process-uploads
```

## Endpoints

### `/api/admin/process-uploads` (Síncrono)
- Procesa TODOS los archivos pendientes
- Bloquea hasta completar
- Máximo 5 minutos
- Bueno para procesamiento manual

### `/api/admin/process-uploads-worker` (Asíncrono optimizado)
- Procesa archivos sin bloquear
- Ideal para cron jobs
- Más eficiente para múltiples archivos
- Máximo 5 minutos por ejecución

## Flujo Completo

1. Usuario sube archivo → `/api/admin/upload-raw` (respuesta inmediata)
2. Archivo se guarda en `UPLOAD_DIR`
3. Cron job ejecuta `/api/admin/process-uploads-worker` cada 5 minutos
4. Sistema detecta tipo y procesa automáticamente
5. Archivo se mueve a `processed/` o `failed/`

## Monitoreo

Ver archivos pendientes:
```bash
ls -lh /tmp/casafari-uploads/
```

Ver archivos procesados:
```bash
ls -lh /tmp/casafari-uploads/processed/
ls -lh /tmp/casafari-uploads/failed/
```

Ver logs de cron:
```bash
tail -f /var/log/syslog | grep "process-uploads-worker"
```
