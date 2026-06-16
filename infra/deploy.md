# Despliegue — casafari-mio

**Servidor:** Hetzner **CX33** · IP **204.168.174.0** · host `zinto.leads`  
**URL temporal:** `http://204.168.174.0` (sin dominio aún)  
**Stack existente:** nginx en :80/:443, otros proyectos en sus propios puertos — casafari-mio lo respeta.

---

## Primera vez en el VPS

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
# Rellenar al menos: POSTGRES_PASSWORD (invéntate una segura)
```

### 3. Levantar Postgres + Redis (primero, sin la app)

```bash
cd infra
docker compose -p casafari --env-file ../.env up -d postgres redis

# Verificar que Postgres responde:
docker compose -p casafari exec postgres pg_isready -U casafari
```

### 4. Aplicar migraciones

```bash
docker compose -p casafari exec postgres sh -c \
  'for f in $(ls /migrations/*.sql | sort); do
     echo ">> $f"
     psql -U casafari -d casafari -f "$f" || exit 1
   done'
```

### 5. Registrar el server block en nginx

```bash
cp /opt/casafari/infra/nginx-casafari.conf /etc/nginx/conf.d/casafari.conf

# Si quieres usar el dominio real, edita server_name:
nano /etc/nginx/conf.d/casafari.conf

nginx -t && systemctl reload nginx
```

### 6. Build y arrancar la app

```bash
cd /opt/casafari
bash infra/deploy.sh
```

Accede en: **http://204.168.174.0**

---

## Deploys sucesivos (actualizar código)

```bash
ssh root@204.168.174.0
cd /opt/casafari && bash infra/deploy.sh
```

El script hace: `git pull` → `docker build` → `docker compose up -d --no-deps app` → health check.

---

## Comandos útiles

```bash
# Logs de la app en tiempo real
docker compose -p casafari -f /opt/casafari/infra/docker-compose.yml logs -f app

# Estado de los contenedores
docker compose -p casafari -f /opt/casafari/infra/docker-compose.yml ps

# Reiniciar solo la app (sin rebuild)
docker compose -p casafari -f /opt/casafari/infra/docker-compose.yml restart app

# Abrir psql
docker compose -p casafari -f /opt/casafari/infra/docker-compose.yml exec postgres \
  psql -U casafari -d casafari
```

---

## Con dominio propio (cuando lo tengas)

1. Editar `/etc/nginx/conf.d/casafari.conf` → cambiar `server_name` a `mio.tudominio.com`
2. Instalar Certbot si no está: `apt install -y certbot python3-certbot-nginx`
3. `certbot --nginx -d mio.tudominio.com`
4. Nginx queda con HTTPS automático.

---

## Notas de convivencia con otros stacks

| Recurso | Puerto en host | Solo accesible desde |
|---|---|---|
| Postgres | 5433 | localhost |
| Redis | 6380 | localhost |
| Next.js app | 3000 | localhost (nginx hace proxy) |
| nginx | 80 / 443 | público |

Los puertos 5432 y 6379 los usan los otros stacks — casafari-mio no los toca.
