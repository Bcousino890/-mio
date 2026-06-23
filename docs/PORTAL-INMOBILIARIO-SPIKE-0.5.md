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

### Opción A: Script de orquestación (recomendado)

```bash
ssh vps
cd /app/casafari-mio
git checkout claude/laughing-tesla-8nqqc9
git pull

# Ejecuta los 4 spikes automáticamente con IDs default
node scraper/spike-rate-limit-vps.mjs
```

Esto ejecuta 4 spikes secuenciales:
1. **Concurrencia 1** + delay 1500ms (baseline sin proxy)
2. **Concurrencia 2** + delay 1000ms
3. **Concurrencia 3** + delay 500ms
4. **Concurrencia 5** + delay 0ms (stress test)

Cada spike usa 20 fichas reales (IDs default de Vitacura).

**Output:** `./spike-results/spike-N-concX/_summary.json` (métricas por spike)

### Opción B: IDs personalizados

Si quieres probar contra fichas específicas (ej. otra comuna o mix de tipos):

```bash
node scraper/spike-rate-limit-vps.mjs --ids MLC-1847000513,MLC-1847000514,MLC-1847000515,...
```

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
