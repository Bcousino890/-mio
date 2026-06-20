# Despliegue — casafari-mio

**Servidor:** Hetzner **CX33** · IP **204.168.174.0** · host `zinto.leads`  
**URL gratis (funciona ya):** `http://204-168-174-0.nip.io` — ver [`dominio-gratis.md`](dominio-gratis.md)  
**Convivencia:** zintoleads y otros stacks siguen intactos — casafari-mio usa puertos aislados.

| Servicio | Puerto en host | Visible desde |
|---|---|---|
| Postgres (casafari) | `5433` | solo localhost |
| Redis (casafari) | `6380` | solo localhost |
| Next.js app | `3000` | solo localhost |
| nginx | `80` / `443` | público — sirve `mio.zinto.app` |

---

## 🚀 Instalación automática (recomendada)

Un solo script hace todo de forma **aislada de zintoleads** (DB → migraciones →
app → nginx → TLS), con backup de nginx y rollback si algo falla:

```bash
ssh root@204.168.174.0
git clone https://github.com/Bcousino890/casafari-mio.git /opt/casafari
cd /opt/casafari
cp .env.example .env && nano .env      # pon POSTGRES_PASSWORD
bash infra/bootstrap.sh
```

→ Web pública en **https://204-168-174-0.nip.io**

> **Garantía de aislamiento:** `bootstrap.sh` solo crea `casafari.conf` y su snippet.
> Antes de recargar nginx hace `nginx -t`; si falla, **restaura el backup** y aborta.
> `certbot --nginx -d 204-168-174-0.nip.io` solo edita el server block con ese
> `server_name` — el de zintoleads tiene otro nombre, así que **ni lo toca**.

---

## Instalación manual (paso a paso)

### 1. Clonar el repo

```bash
ssh root@204.168.174.0
git clone https://github.com/Bcousino890/casafari-mio.git /opt/casafari
cd /opt/casafari
```

### 2. Configurar `.env`

```bash
cp .env.example .env
nano .env
# Mínimo obligatorio: POSTGRES_PASSWORD=<una_contraseña_segura>
```

### 3. Registrar en nginx (sin tocar la config de zintoleads)

```bash
# Snippet de proxy (reutilizable por HTTP y HTTPS)
cp /opt/casafari/infra/nginx-casafari-proxy.conf /etc/nginx/snippets/casafari-proxy.conf

# Server block para mio.zinto.app
cp /opt/casafari/infra/nginx-casafari.conf /etc/nginx/conf.d/casafari.conf

# Verificar que no rompe nada
nginx -t && systemctl reload nginx
```

> Si usas un subdominio distinto, edita `server_name` en `/etc/nginx/conf.d/casafari.conf`.

### 4. TLS gratis con Certbot

```bash
# Solo si certbot no está instalado:
apt install -y certbot python3-certbot-nginx

certbot --nginx -d mio.zinto.app
# Certbot añade el redirect HTTP→HTTPS y renueva automáticamente
```

### 5. Arrancar Postgres + Redis

```bash
cd /opt/casafari/infra
docker compose -p casafari --env-file ../.env up -d postgres redis

# Verificar Postgres:
docker compose -p casafari --env-file ../.env exec postgres pg_isready -U casafari
```

### 6. Aplicar migraciones

```bash
docker compose -p casafari --env-file ../.env exec postgres sh -c \
  'for f in $(ls /migrations/*.sql | sort); do
     echo ">> $f"
     psql -U casafari -d casafari -f "$f" || exit 1
   done'
```

### 7. Build y arrancar la app

```bash
cd /opt/casafari
bash infra/deploy.sh
```

✅ App disponible en **https://mio.zinto.app**

---

## Deploys sucesivos (actualizar código)

```bash
ssh root@204.168.174.0 "cd /opt/casafari && bash infra/deploy.sh"
```

El script hace: `git pull` → `docker build` → `docker compose up -d --no-deps app` → health check.

---

## Comandos de operación

```bash
COMPOSE="docker compose -p casafari --env-file /opt/casafari/.env -f /opt/casafari/infra/docker-compose.yml"

# Logs en tiempo real
$COMPOSE logs -f app

# Estado de contenedores
$COMPOSE ps

# Reiniciar solo la app (sin rebuild)
$COMPOSE restart app

# Abrir psql
$COMPOSE exec postgres psql -U casafari -d casafari

# Parar todo
$COMPOSE down
```

---

## DNS (entrada A en tu proveedor)

| Nombre | Tipo | Valor |
|---|---|---|
| `mio` | A | `204.168.174.0` |

---

## Aislamiento con zintoleads

- Los contenedores corren en la red Docker `casafari_default` (aislada).
- Postgres en `5433`, Redis en `6380` — no colisionan con los puertos de zintoleads.
- En nginx, el `server_name mio.zinto.app` solo afecta las peticiones a ese dominio.
- Los logs van a `/var/log/nginx/casafari-*.log` — separados de los demás.

---

## Sitio público `web-cousino` (independiente, sin DB)

Proyecto aparte dentro del mismo repo (`../web-cousino`) — la web de cara al
cliente de Benjamín Cousiño Propiedades. No comparte código ni base de datos
con la app anterior; usa solo datos mock.

| Servicio | Puerto en host | Dominio |
|---|---|---|
| Next.js (web-cousino) | `3001` | `cousino.204-168-174-0.nip.io` |

Mismo patrón aditivo de instalación, en scripts separados para no arriesgar
el deploy de `crm.cremme.es`:

```bash
bash infra/bootstrap-cousino.sh   # primera vez (app + nginx + TLS)
bash infra/deploy-cousino.sh      # deploys sucesivos
```

El CI (`.github/workflows/deploy.yml`) ya detecta cuál de los dos ejecutar
según si el contenedor `casafari-cousino-app` existe.
