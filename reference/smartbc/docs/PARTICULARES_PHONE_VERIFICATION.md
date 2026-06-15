# Verificación Automática de Teléfonos en Particulares

## Descripción

El sistema de particulares ahora puede verificar automáticamente si los anuncios tienen número de teléfono, incluso si no fue extraído en el scrape inicial. Esto es útil porque los propietarios pueden agregar el teléfono después de publicar el anuncio.

## Uso

### Verificación Manual (desde la UI)

En `/admin/particulares`, usa el botón "Verificar teléfonos" para disparar una verificación. Tiene tres modos:

- **all** (por defecto): Re-verifica todos los anuncios activos, ordenados por los menos verificados recientemente
- **missing**: Solo verifica anuncios sin teléfono
- **normalize**: No hace scraping, solo normaliza los teléfonos existentes al formato +34XXXXXXXXX

### Verificación por Script (Cron)

Para verificar automáticamente cada 2 días, agrega esta línea al crontab del VPS:

```bash
0 0 */2 * * /path/a/smartbc/scripts/verify-particulares-phones.sh missing 100
```

Explicación:
- `0 0 */2 * *` = cada 2 días a las 00:00 UTC
- `missing` = solo verifica los que no tienen teléfono
- `100` = máximo 100 anuncios por ejecución (evita sobrecargar)

**Requisito**: La variable `CRON_SECRET` debe estar exportada en el crontab:

```bash
CRON_SECRET=tu-secret-aqui
0 0 */2 * * /path/a/smartbc/scripts/verify-particulares-phones.sh missing 100
```

O si ya está en `.env`:

```bash
source /path/a/smartbc/.env
0 0 */2 * * /path/a/smartbc/scripts/verify-particulares-phones.sh missing 100
```

### Verificación Inicial (Una sola vez)

Para verificar TODOS los particulares existentes (buscar teléfonos que existan pero no se hayan extraído):

**Opción 1: desde el admin**
1. Ve a `/admin/particulares`
2. Haz clic en "Verificar teléfonos"
3. En el modal, selecciona "Todos" y ejecuta

**Opción 2: por script**
```bash
./scripts/verify-particulares-phones.sh all 1000
```

Esto verificará 1000 anuncios activos ordenados por antigüedad (los menos verificados primero).

## Respuesta del Endpoint

```json
{
  "ok": true,
  "mode": "missing",
  "checked": 50,
  "updated": 3,
  "withPhone": 5,
  "chatOnly": 2,
  "errors": 0
}
```

- `checked`: cuántos se verificaron
- `updated`: cuántos teléfonos nuevos se encontraron
- `withPhone`: cuántos ya tenían teléfono (no se re-verifican en mode=missing)
- `chatOnly`: cuántos tienen "chat only" (sin teléfono real)
- `errors`: fallos de scraping

## Endpoint API

```
POST /api/admin/particulares/verify-phones
```

**Autenticación**:
- Como staff: session cookie
- Como cron: `Authorization: Bearer CRON_SECRET`

**Query parameters**:
- `mode` = all | missing | normalize (default: all)
- `limit` = max 100 (default: 30)

**Respuesta**:
```json
{
  "ok": true | false,
  "mode": string,
  "checked": number,
  "updated": number,
  "withPhone": number,
  "chatOnly": number,
  "normalized": number (solo si mode=normalize),
  "errors": number
}
```

## Flujo de Scraping de Teléfonos

1. **Scraper Horario** (`/api/cron/particulares/scrape`)
   - Ejecuta cada hora
   - Extrae teléfonos del HTML de Idealista
   - Los normaliza a formato +34XXXXXXXXX
   - Almacena con confidence (high/medium/low)

2. **Verificación Cada 2 Días** (`/api/admin/particulares/verify-phones?mode=missing`)
   - Solo revisa los que NO tienen teléfono
   - Intenta extraer el teléfono nuevamente
   - Si la fuente cambió, lo captura

3. **Normalización de Existentes** (`/api/admin/particulares/verify-phones?mode=normalize`)
   - No hace scraping
   - Solo reformatea los teléfonos almacenados a +34XXXXXXXXX
   - Útil si se agregaron teléfonos con formato inconsistente

## Notas Técnicas

- Los teléfonos se validan contra el patrón español: 6-9 como primer dígito, 9 dígitos totales
- Se normaliza a `+34XXXXXXXXX`
- Se descartan referencias de Idealista (propertyCode) que podrían confundirse con teléfono
- Confidence se asigna según la calidad de la extracción (high/medium/low)
- Los anuncios retirados no se re-verifican
- El sistema degrada gracefully si la migración 0035 (address, phone_confidence) no está aplicada

## Historial de Cambios en BD

Cuando se actualiza un teléfono, se registra en `particulares_changes`:
```json
{
  "change_type": "phone_updated",
  "old_value": { "phone": null },
  "new_value": { "phone": "+34686570337" }
}
```

## Troubleshooting

### El cron no ejecuta

1. Verifica que `CRON_SECRET` esté definido:
   ```bash
   sudo crontab -l | grep verify-particulares
   sudo crontab -e  # Agregar CRON_SECRET si no está
   ```

2. Revisa los logs:
   ```bash
   tail -f /var/log/syslog | grep verify-particulares
   ```

3. Prueba el script manualmente:
   ```bash
   export CRON_SECRET="tu-secret"
   /path/a/smartbc/scripts/verify-particulares-phones.sh missing 10
   ```

### No encuentra teléfonos que existen

- Idealista cambió el HTML (es raro pero posible)
- El teléfono está en otro campo que no se escanea
- El propietario usa chat only
- El proxy/User-Agent fue bloqueado por DataDome

Revisa el log del endpoint en el admin o en los logs del VPS.

### Teléfono incorrecto se extrae

- Might be confusing reference number with phone (should be fixed by filtering propertyCode)
- Could be malformed HTML from Idealista
- Report en la UI si encuentras falsos positivos

## Recursos Relacionados

- `/app/api/admin/particulares/verify-phones/route.ts` - Endpoint de verificación
- `/app/api/cron/particulares/scrape/route.ts` - Scraper horario
- `/lib/sync/particulares/idealista-advertiser-detector.ts` - Extractor de teléfono
- `supabase/migrations/0035_particulares_address_phone_confidence.sql` - Schema
