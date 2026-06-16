# Dominio gratuito e independiente — casafari-mio

Tres formas **100% gratis** de tener una URL pública, ordenadas de más rápida a más bonita.

---

## Opción 1 — nip.io ⚡ (funciona YA, cero registro)

`nip.io` es un servicio de DNS comodín: cualquier `IP-con-guiones.nip.io` resuelve a esa IP.
No hay que crear cuenta ni esperar propagación.

**Tu URL ya funciona:**

```
http://204-168-174-0.nip.io
```

Solo tienes que:
1. Instalar el server block de nginx (ya incluye este nombre).
2. `bash infra/deploy.sh`

TLS gratis opcional:
```bash
certbot --nginx -d 204-168-174-0.nip.io
```
→ `https://204-168-174-0.nip.io`

> Ventaja: instantáneo. Inconveniente: el nombre lleva la IP, si cambias de servidor cambia.

---

## Opción 2 — DuckDNS 🦆 (nombre bonito, gratis, editable)

Da un subdominio tipo `casafari-mio.duckdns.org` que apunta a tu IP y la puedes cambiar cuando quieras.

### Registro (30 segundos)
1. Entra en **https://www.duckdns.org** → login con Google/GitHub.
2. Escribe el subdominio: `casafari-mio` → **add domain**.
3. En la tabla, pon **current ip** = `204.168.174.0` → **update**.
4. Copia tu **token** (arriba de la página).

### Auto-actualización de IP (opcional pero recomendado)
Si la IP del VPS cambiara, este cron la mantiene al día:

```bash
# En el VPS:
echo 'DUCKDNS_DOMAIN=casafari-mio' >> /opt/casafari/.env
echo 'DUCKDNS_TOKEN=tu-token-aqui'  >> /opt/casafari/.env

# Probar una vez:
bash /opt/casafari/infra/duckdns-update.sh

# Programar cada 5 min:
( crontab -l 2>/dev/null; echo '*/5 * * * * bash /opt/casafari/infra/duckdns-update.sh >/dev/null 2>&1' ) | crontab -
```

### TLS gratis
```bash
certbot --nginx -d casafari-mio.duckdns.org
```
→ `https://casafari-mio.duckdns.org`

---

## Opción 3 — sslip.io (alternativa a nip.io)

Idéntico a nip.io por si nip.io estuviera caído:
```
http://204-168-174-0.sslip.io
```
(añade el nombre a `server_name` en el nginx config si lo usas.)

---

## ¿Cuál elijo?

| Necesidad | Opción |
|---|---|
| Verlo funcionando **ahora mismo** | **nip.io** |
| Nombre presentable para enseñar a alguien | **DuckDNS** |
| Marca propia definitiva | comprar dominio (~10 €/año) → `mio.zinto.app` |

Las tres están en el `server_name` del nginx, así que **funcionan a la vez**.
