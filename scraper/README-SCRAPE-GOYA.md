# 🚀 Scraping Goya Completo

Scraping automatizado de todos los anuncios de la zona Goya (Alquiler + Venta) desde Idealista.

## 📊 Datos objetivo

- **Alquiler**: 596 anuncios
- **Venta**: 691 anuncios
- **Total**: ~1.287 anuncios (después deduplicación)

## 🏃 Ejecución rápida

### En tu VPS:

```bash
cd /path/to/casafari-mio

# Dale permisos de ejecución
chmod +x scraper/scrape-goya-complete.sh

# Ejecuta (tarda ~1 hora total)
./scraper/scrape-goya-complete.sh
```

El script:
1. Configura proxy automáticamente (SmartProxy Madrid)
2. Scrappea alquiler (596) → `output/goya-rent-TIMESTAMP.json`
3. Scrappea venta (691) → `output/goya-sale-TIMESTAMP.json`
4. Consolida + deduplica → `output/goya-complete-TIMESTAMP.json`

### Después del scraping:

```bash
# Copia el dataset completo a la web
cp scraper/output/goya-complete-*.json web/lib/listings-goya-full.json

# Commit y push
git add web/lib/listings-goya-full.json scraper/output/
git commit -m "Add complete Goya dataset: 1287 listings (596 rent + 691 sale)"
git push -u origin main
```

---

## 🔧 Configuración manual (si necesitas)

El script usa estas credenciales de proxy automáticamente:

```bash
export PROXY_PROVIDER=smartproxy
export SMARTPROXY_PROXY_HOST=eu.smartproxy.net
export SMARTPROXY_PROXY_PORT=3120
export SMARTPROXY_PROXY_USER=smart-b04nrjtamr8a_area-ES_city-MADRID
export SMARTPROXY_PROXY_PASS=ZLOutsGkCC5kgmwS
```

Si quieres ejecutar manualmente:

```bash
source /dev/stdin << 'EOF'
export PROXY_PROVIDER=smartproxy
export SMARTPROXY_PROXY_HOST=eu.smartproxy.net
export SMARTPROXY_PROXY_PORT=3120
export SMARTPROXY_PROXY_USER=smart-b04nrjtamr8a_area-ES_city-MADRID
export SMARTPROXY_PROXY_PASS=ZLOutsGkCC5kgmwS
EOF

# Alquiler
node scraper/scrape-zone.mjs \
  --zone madrid/barrio-de-salamanca/goya \
  --op rent \
  --max-pages 60 \
  --emit-app goya-rent.json

# Venta
node scraper/scrape-zone.mjs \
  --zone madrid/barrio-de-salamanca/goya \
  --op sale \
  --max-pages 60 \
  --emit-app goya-sale.json
```

---

## 📈 Tiempo estimado

- **Alquiler (596)**: ~25-30 minutos (10 anuncios/min con delays anti-bot)
- **Venta (691)**: ~25-30 minutos
- **Total**: ~1 hora
- **Delays**: 900-2000ms entre requests para respetar rate-limits

---

## 🛠️ Troubleshooting

### "HTTP 403 Forbidden"
- Proxy no está pasando correctamente
- Verifica que las credenciales sean las correctas
- Prueba: `curl -x http://user:pass@host:port https://www.idealista.com/`

### "Connection timeout"
- El proxy se está colgando
- Intenta de nuevo, a veces SmartProxy necesita reconectar

### "HTML vacío/corto"
- Idealista está devolviendo JS-heavy page
- El scraper espera HTML con contenido
- Puede ser un IP-ban temporal del proxy

---

## 📦 Output

Cada ejecución genera:

```
scraper/output/
├── goya-rent-TIMESTAMP.json      # Alquiler sin procesar
├── goya-rent-TIMESTAMP.log       # Log de scraping
├── goya-sale-TIMESTAMP.json      # Venta sin procesar
├── goya-sale-TIMESTAMP.log       # Log de scraping
└── goya-complete-TIMESTAMP.json  # Combinado + deduplicado ← USAR ESTE
```

El JSON final está listo para usar en `web/lib/listings-goya-full.json`.

---

## ✅ Checklist

- [ ] Ejecuté `./scraper/scrape-goya-complete.sh` en la VPS
- [ ] Los 4 logs muestran "✓ Compiled successfully" sin errores
- [ ] Tengo `goya-complete-TIMESTAMP.json` con ~1287 anuncios
- [ ] Copié el archivo a `web/lib/listings-goya-full.json`
- [ ] Hice `git add + commit + push`
- [ ] Ahora Claude actualiza la ficha detail y testea

---

**Tiempo de ejecución total**: ~1 hora  
**Próximo paso**: Esperar a que termines el scraping y pushees a GitHub
