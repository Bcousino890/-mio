# Fase 0.5: Spike de Rate-Limit en VPS

**Objetivo:** Validar si Portal Inmobiliario rate-limita bajo concurrencia, sin proxy, en VPS real. Esto determina si necesitamos proxy y qué concurrencia máxima es segura para la Fase 2 (barrido de 51.585 anuncios).

**Bloqueante para:** Fase 2 (orquestación a escala) — sin este dato, no podemos decidir si hace falta proxy o qué infraestructura armar.

---

## Setup

Requiere:
- VPS Hetzner CX33 (o similar) con conexión a internet sin restricciones a Portal Inmobiliario
- Node.js 18+ instalado
- Código de `claude/laughing-tesla-8nqqc9` pusheado
- ~15 min de tiempo de ejecución (4 spikes secuenciales, ~3-4 min cada uno)

---

## Ejecución

### Opción A: Script de orquestación SIN PROXY (recomendado para baseline)

```bash
ssh vps
cd /app/casafari-mio
git checkout claude/laughing-tesla-8nqqc9
git pull

# Ejecuta los 4 spikes automáticamente SIN PROXY
node scraper/spike-rate-limit-vps.mjs
```

Esto ejecuta 4 spikes secuenciales con IDs default de Vitacura:
1. **Concurrencia 1** + delay 1500ms (baseline sin proxy)
2. **Concurrencia 2** + delay 1000ms
3. **Concurrencia 3** + delay 500ms
4. **Concurrencia 5** + delay 0ms (stress test)

**Output:** `./spike-results/spike-N-concX/_summary.json` (métricas por spike)

### Opción B: CON SMARTPROXY (para validar si proxy mejora)

Si quieres comparar sin proxy vs con proxy, usa Smartproxy (ya tienes 46.24 GB):

```bash
ssh vps
cd /app/casafari-mio

# Copia la URL de API de Smartproxy desde el dashboard
# (Configuración de proxy → Enlace API generado)
# Ej: https://api.smartproxy.com/web_v1/get-v3?app_key=9cf847... (completar con tu key)

export SMARTPROXY_URL="https://tu-smartproxy-api-url-aqui"

# Ejecuta los 4 spikes CON PROXY
node scraper/spike-rate-limit-vps.mjs
```

El script detectará automáticamente que hay `SMARTPROXY_URL` y usará proxy en todos los spikes.

**Output:** `./spike-results/spike-N-concX/_summary.json` (ahora con proxy)

---

## Análisis de resultados

Después de que el script termine, analiza los JSONs generados:

```bash
# Ver métricas de cada spike
for dir in spike-results/spike-*/; do
  echo "=== $(basename $dir) ==="
  grep -E "OK:|Fallidos:|Status codes" "$dir/_summary.json"
done
```

**Métrica clave:** % de respuestas HTTP 429 (rate-limit) por concurrencia.

### Tabla de decisión

| Resultado | Decisión | Impacto |
|-----------|----------|---------|
| **Conc 5 sin proxy: 0% × 429** | No necesita proxy | Costo $0, ahorrar dinero |
| **Conc 5 sin proxy: 20–50% × 429** | Posible rate-limit bajo | Usar conc ≤3 en Fase 2 |
| **Conc 5 sin proxy: >50% × 429** | Necesita proxy | Activar Geonode (~$13–47/mes) |
| **HTTP 403 persistente en cualquier conc** | Posible WAF | Investigar → posible Capsolver (bajo costo) |

### Ejemplo de análisis

```
SPIKE 1/4: baseline (conc 1, delay 1500)
OK: 20/20  ·  Fallidos: 0/20
(sin errores esperado: cero rate-limit con conc 1)

SPIKE 2/4: moderate (conc 2, delay 1000)
OK: 20/20  ·  Fallidos: 0/20
(sin errores esperado: conc 2 casi siempre pasa)

SPIKE 3/4: elevated (conc 3, delay 500)
OK: 20/20  ·  Fallidos: 0/20
(sin errores: conc 3 probablemente seguro)

SPIKE 4/4: stress test (conc 5, delay 0)
OK: 16/20  ·  Fallidos: 4/20
Status codes de fallos: 429, 429, 429, 429
(20% × 429: posible rate-limit incipiente, pero manejable)

→ CONCLUSIÓN: Sin proxy, conc ≤3–4 es seguro. Considerar proxy solo si necesitas >5.
```

---

## Cómo obtener tu URL de API de Smartproxy

**Tienes 46.24 GB disponibles en Smartproxy.** Para usarla en el spike:

1. Entra al dashboard: https://www.smartproxy.com/ (login)
2. Selecciona **Proxies** → **Residential Proxy** (panel izquierdo)
3. Ve a **Configuración de proxy** → **Extracción API**
4. Verás el **Enlace API generado** (copy the entire URL)
5. Ejemplo:
   ```
   https://api.smartproxy.com/web_v1/get-v3?app_key=9cf8476185ea51d90a811dfed197546pi&cc=CL&city=Santiago
   ```
6. Úsalo en el VPS:
   ```bash
   export SMARTPROXY_URL="https://api.smartproxy.com/web_v1/get-v3?app_key=9cf8476185ea51d90a811dfed197546pi&cc=CL"
   node scraper/spike-rate-limit-vps.mjs
   ```

**Efecto:** Smartproxy te dará una **IP diferente en cada request** (rotación residencial), lo que distribuye la carga y evita rate-limit por concentración en una sola IP.

**Para comparación lado-a-lado:**
```bash
# Spike 1: sin proxy (baseline)
node scraper/spike-rate-limit-vps.mjs --ids MLC-1847000513,...

# Spike 2: con proxy (comparación)
export SMARTPROXY_URL="..."
node scraper/spike-rate-limit-vps.mjs --ids MLC-1847000513,...
# Luego compara el % de 429 en ambos spikes
```

---

## Documentar hallazgos

Una vez tengas resultados, haz un commit:

```bash
# Guardar JSONs en git
git add spike-results/
git commit -m "spike(fase-0.5): resultados rate-limit sin proxy, conc 1–5"
git push origin claude/laughing-tesla-8nqqc9
```

Luego comenta en PR #52 con:
- % de 429 por concurrencia
- Recomendación (proxy sí/no, conc máxima)
- Próxima fase (Fase 2) puede comenzar

---

## Troubleshooting

### "403 en todas las spikes"

Significa:
- El portal bloqueó tu IP (WAF perimetral)
- O el User-Agent fue detectado como bot

**Solución:**
- Espera 5–10 min y reintenta
- O corre desde otra IP (proxy fallback)
- O investiga si el portal cambió su detectión

### "Timeout en muchas spikes"

Significa:
- Congestión de red (poco probable en Hetzner)
- O timeout muy corto en `fetch.mjs` (por defecto 25s)

**Solución:**
- Aumenta timeout en `fetch.mjs`: `TIMEOUT_S = 50`
- Reintenta

### "429 en conc 1, delay 1500"

Inesperado: el portal rate-limita incluso con una request cada 1.5 segundos.

**Probable causa:**
- Tu IP fue bloqueada por un barrido previo
- O el portal es muy agresivo

**Solución:**
- Espera varias horas
- Reintenta desde otra IP

---

## Paso siguiente

Una vez tengas resultados confirma:

✅ **Sin proxy, conc segura:** Proceder a Fase 2 directamente (ahorrar dinero)

✅ **Sin proxy, conc limitada a 1–3:** Proceder a Fase 2 con `--concurrency 3` máximo

⚠️ **Necesita proxy:** Siguiente spike con `PROXY_PROVIDER=geonode` antes de Fase 2

---

**Más contexto:** Ver `/root/.claude/plans/hola-stateless-toast.md` sección "Fase 0.5"
