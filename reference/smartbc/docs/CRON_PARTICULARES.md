# Cron de Particulares (Scraper)

El scraper de particulares se ejecuta **cada hora** desde el VPS, no desde Vercel.

## Configuración

### 1. En el VPS, agregar a crontab:

```bash
sudo crontab -e
```

Agregar esta línea (ejecuta cada hora a los :00 minutos):

```cron
0 * * * * API_URL=http://localhost:3000 CRON_SECRET=<tu_cron_secret> /home/smartbc/scripts/cron-particulares.sh >> /var/log/smartbc-particulares.log 2>&1
```

### 2. Reemplazar `<tu_cron_secret>`

Obtén el valor de `CRON_SECRET` desde tu archivo `.env` del VPS:

```bash
grep CRON_SECRET /home/smartbc/.env
```

### 3. Crear directorio de logs (opcional pero recomendado)

```bash
sudo touch /var/log/smartbc-particulares.log
sudo chown www-data:www-data /var/log/smartbc-particulares.log
```

### 4. Hacer el script ejecutable

```bash
chmod +x /home/smartbc/scripts/cron-particulares.sh
```

## Verificación

Ver los logs de ejecución:

```bash
tail -f /var/log/smartbc-particulares.log
```

## Qué hace

- Scrapea Idealista Madrid (particulares) cada hora
- Detecta nuevos anuncios, bajas (404) y reactivaciones
- Preserva todos los datos aunque el anuncio se retire
- Trackea cambios (precio, retirada, etc.)
- Marca inactivos los que devuelven 404

## Coste

- ~$0.50/GB con Smartproxy residencial
- ~20-30 fichas por hora ≈ 50-100 KB/hora
- ≈ 30-50 MB/mes
- ≈ $0.015-0.025/mes en proxies

## Alternativas

Si prefieres ejecutar cada X minutos en lugar de cada hora, cambiar el cron:

- `*/30 * * * *` = cada 30 minutos
- `*/15 * * * *` = cada 15 minutos
- `*/5 * * * *` = cada 5 minutos

Pero ten en cuenta que aumenta el consumo de proxies.
