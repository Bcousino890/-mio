# Matriz Técnica Comparativa: Fuentes NO-SII Chile

**Documento:** Análisis técnico comparativo de integraciones NO-SII  
**Fecha:** 21 de Junio 2026  
**Versión:** 1.0

---

## 1. MATRIZ COMPARATIVA COMPLETA

### 1.1 Disponibilidad y Accesibilidad

| Criterio | IDE Chile | MBN | datos.gob.cl | MINVU | CNR | Municipios |
|----------|-----------|-----|-------------|-------|-----|-----------|
| **Cobertura Nacional** | ✅✅✅ | ✅✅ | ✅✅✅ | ✅✅ | ✅✅ | ⚠️ Variable |
| **Acceso Público** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Autenticación Requerida** | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Algunas |
| **Uptime SLA** | ~99% | ~99% | ~95% | ~95% | ~95% | ⚠️ ~85% |
| **Disponibilidad 24/7** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ Variable |
| **Datos Históricos** | ✅ | ✅ | ⚠️ Limitado | ⚠️ Limitado | ✅ | ⚠️ Raro |

### 1.2 Calidad y Actualización de Datos

| Criterio | IDE Chile | MBN | datos.gob.cl | MINVU | CNR | Municipios |
|----------|-----------|-----|-------------|-------|-----|-----------|
| **Actualización** | 8 meses | Trimestral | Variable | Trimestral | Trimestral | Anual |
| **Completes (%)** | ~98% | ~99% | ~90% | ~95% | ~95% | ~70% |
| **Precisión Geométrica** | Catastral | Catastral | Catastral | Geográfica | Geográfica | ⚠️ Variable |
| **Campos Estandarizados** | ✅ | ✅ | ⚠️ Variable | ✅ | ✅ | ❌ |
| **Metadata Disponible** | ✅✅ | ✅✅ | ✅✅ | ✅ | ✅ | ⚠️ |
| **Documentación Técnica** | ✅✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |

### 1.3 Tipos de API y Protocolos

| Criterio | IDE Chile | MBN | datos.gob.cl | MINVU | CNR | Municipios |
|----------|-----------|-----|-------------|-------|-----|-----------|
| **WFS (Vector)** | ✅ v2.0 | ✅ v2.0 | ❌ | ✅ v2.0 | ✅ v2.0 | ⚠️ Variable |
| **WMS (Raster)** | ✅ v1.3 | ✅ v1.3 | ❌ | ✅ v1.3 | ✅ v1.3 | ⚠️ Variable |
| **WCS (Coverage)** | ✅ | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| **REST API** | ✅ GeoServer | ✅ | ✅ CKAN | ✅ | ✅ ArcGIS | ⚠️ Variable |
| **GeoJSON Directo** | ✅ | ✅ | ⚠️ CSV | ✅ | ✅ | ⚠️ |
| **Shapefile** | ✅ Descarga | ✅ Descarga | ✅ Descarga | ✅ Descarga | ✅ Descarga | ⚠️ |
| **CSV/Excel** | ✅ | ✅ | ✅✅ | ✅ | ⚠️ | ✅ |
| **PostGIS Directo** | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ | ❌ |

### 1.4 Rendimiento y Escalabilidad

| Criterio | IDE Chile | MBN | datos.gob.cl | MINVU | CNR | Municipios |
|----------|-----------|-----|-------------|-------|-----|-----------|
| **Velocidad WFS** | 1-5s | 2-8s | N/A | 1-5s | 1-3s | Variable |
| **Velocidad SQL** | N/A | N/A | 2-15s | N/A | N/A | N/A |
| **Max records/req** | 50,000 | 10,000 | 100,000 | 50,000 | 50,000 | Variable |
| **Paginación** | startIndex | Offset | SQL cursor | Offset | Offset | ⚠️ |
| **Compresión gzip** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Cache HTTP** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Paralelización** | ✅ (cuidado) | ✅ (cuidado) | ⚠️ Limitada | ✅ (cuidado) | ✅ (cuidado) | ⚠️ |

### 1.5 Limitaciones y Rate Limiting

| Criterio | IDE Chile | MBN | datos.gob.cl | MINVU | CNR | Municipios |
|----------|-----------|-----|-------------|-------|-----|-----------|
| **Rate Limit Documentado** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Rate Limit Empírico** | ~60/min | ~40/min | ~100/min | ~60/min | ~100/min | Variable |
| **IP Blocking** | ⚠️ Posible | ⚠️ Posible | ⚠️ Posible | ⚠️ Posible | ⚠️ Posible | ❓ |
| **Tamaño max descarga** | ~2GB | ~500MB | ~500MB | ~2GB | ~1GB | Variable |
| **Timeout típico** | 60s | 60s | 120s | 60s | 30s | Variable |
| **Requiere API Key** | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Algunas |

### 1.6 Soporte y Mantenimiento

| Criterio | IDE Chile | MBN | datos.gob.cl | MINVU | CNR | Municipios |
|----------|-----------|-----|-------------|-------|-----|-----------|
| **Soporte Oficial** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| **Email Contacto** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Documentación Viva** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| **Versioning API** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| **Breaking Changes Notice** | ✅ | ⚠️ | ✅ | ⚠️ | ❌ | ❌ |
| **Depreciación Path** | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ |

---

## 2. ANÁLISIS POR TIPO DE USO

### 2.1 Búsqueda Simple de Predio por Dirección

**Mejor opción:** IDE Chile  
**Alternativa:** MBN

```
IDE Chile:
  - Ventaja: CQL_FILTER con ILIKE permite búsqueda fuzzy
  - Desventaja: Requiere conocer estructura de datos
  - Tiempo: 1-3 segundos
  - Costo: Gratuito
```

### 2.2 Descarga Masiva (>100K registros)

**Mejor opción:** datos.gob.cl (CSV bulk download)  
**Alternativa:** IDE Chile (con paginación)

```
datos.gob.cl:
  - Ventaja: Bulk downloads de datasets completos
  - Desventaja: Requiere encontrar dataset correcto
  - Tiempo: 5-30 minutos
  - Costo: Gratuito
  
IDE Chile con paginación:
  - Ventaja: Control fino, tiempo real
  - Desventaja: Lento (requiere múltiples requests)
  - Tiempo: 30-120 minutos
```

### 2.3 Análisis Espacial en Tiempo Real

**Mejor opción:** IDE Chile (WFS)  
**Alternativa:** MINVU (WFS)

```
IDE Chile:
  - Ventaja: Geometrías precisas, rápido
  - Desventaja: Rate limiting en búsquedas complejas
  - Tiempo: 1-5 segundos
  - Ideal para: Búsquedas por proximidad, intersecciones
```

### 2.4 Vivienda Social y Subsidios

**Mejor opción:** MINVU (IDE MINVU)  
**Alternativa:** datos.gob.cl

```
MINVU:
  - Ventaja: Datos específicos de vivienda social
  - Desventaja: Cobertura solo Chile
  - Datos: ~600K propiedades
  - Actualización: Trimestral
```

### 2.5 Propiedades Fiscales

**Mejor opción:** MBN (Bienes Nacionales)  
**Alternativa:** IDE MBN

```
MBN:
  - Ventaja: Autoridad oficial para bienes fiscales
  - Desventaja: Más lento que IDE
  - Datos: ~2.5M propiedades
  - Actualización: Trimestral
```

### 2.6 Recursos Naturales y Gestión Territorial

**Mejor opción:** CNR (Geoportal CNR)  
**Alternativa:** IDE Chile (capas específicas)

```
CNR:
  - Ventaja: Datos de recursos naturales
  - Desventaja: Documentación limitada
  - Datos: Cobertura nacional
  - Actualización: Trimestral
```

---

## 3. MATRIZ DE COMPATIBILIDAD DE TECNOLOGÍAS

### 3.1 Lenguajes de Programación

| Lenguaje | IDE Chile | MBN | datos.gob.cl | MINVU | CNR |
|----------|-----------|-----|-------------|-------|-----|
| **Python** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **JavaScript/Node** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **R** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ |
| **Java** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **C#/.NET** | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ |
| **PHP** | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ |
| **Go** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Rust** | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ |

### 3.2 Librerías Principales Recomendadas

#### Python
```python
# Web
requests>=2.28.0
httpx>=0.23.0  # Async HTTP

# Geoespacial
geopandas>=0.12.0
folium>=0.14.0
pyproj>=3.4.0
shapely>=2.0.0
fiona>=1.9.0

# Data Processing
pandas>=1.5.0
numpy>=1.23.0

# CKAN Client
ckanapi>=4.7

# Database
psycopg2-binary>=2.9.0
sqlalchemy>=1.4.0

# Utilities
python-dotenv>=0.20.0
pydantic>=1.10.0
```

#### JavaScript/Node.js
```json
{
  "dependencies": {
    "axios": "^1.4.0",
    "leaflet": "^1.9.0",
    "turf": "^6.5.0",
    "geojson-stream": "^1.0.0",
    "pg": "^8.10.0",
    "xml2js": "^0.6.0",
    "lodash": "^4.17.21",
    "moment": "^2.29.0"
  }
}
```

### 3.3 Herramientas SIG Compatibles

| Herramienta | IDE Chile | MBN | datos.gob.cl | MINVU | CNR |
|-------------|-----------|-----|-------------|-------|-----|
| **QGIS** | ✅ Nativo | ✅ Nativo | ✅ CSV | ✅ Nativo | ✅ Nativo |
| **ArcGIS** | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| **PostGIS** | ⚠️ Importar | ⚠️ Importar | ✅ | ⚠️ Importar | ⚠️ Importar |
| **Mapbox GL** | ✅ Tiles | ✅ Tiles | ✅ GeoJSON | ✅ Tiles | ✅ Tiles |
| **Leaflet** | ✅ WMS | ✅ WMS | ✅ GeoJSON | ✅ WMS | ✅ WMS |
| **Folium** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **OpenLayers** | ✅ WFS | ✅ WFS | ✅ GeoJSON | ✅ WFS | ✅ WFS |

---

## 4. ARQUITECTURA RECOMENDADA

### 4.1 Arquitectura Microservicios Propuesta

```
┌─────────────────────────────────────────────────────┐
│           Frontend Layer (Web/Mobile)               │
│  - Búsqueda de predios                              │
│  - Visualización en mapa interactivo                │
│  - Reportes y exportación                           │
└────────────────────┬────────────────────────────────┘
                     │
┌─────────────────────────────────────────────────────┐
│           API Gateway (Rate Limiting)               │
│  - Throttling por usuario                           │
│  - Caching de resultados frecuentes                 │
│  - Circuit breaker para fuentes                     │
└────────────┬────────────┬────────────┬──────────────┘
             │            │            │
    ┌────────▼──┐  ┌──────▼───┐  ┌───▼──────┐
    │IDE Chile  │  │datos.gob  │  │  MBN    │
    │ Adapter   │  │  Adapter  │  │ Adapter │
    │(WFS)      │  │ (CKAN)    │  │ (REST)  │
    └────┬──────┘  └────┬──────┘  └───┬─────┘
         │               │             │
    ┌────▼───────────────▼─────────────▼────────┐
    │    Data Normalization & Deduplication    │
    │  - Unified ROL format                    │
    │  - Standard geometry projection          │
    │  - Conflict resolution                   │
    └────┬─────────────────────────────────────┘
         │
    ┌────▼───────────────────────────────────────┐
    │      Unified Datastore (PostgreSQL+PostGIS)
    │  - 9.5M predios catastrales normalizados   │
    │  - Spatial indexes                        │
    │  - Historical audit trail                 │
    └─────────────────────────────────────────────┘
```

### 4.2 Strategy Pattern: Selección Automática de Fuente

```python
class CatastroSourceSelector:
    """Seleccionar mejor fuente según criterio"""
    
    STRATEGIES = {
        'speed': IDEChileWFS,           # Más rápido
        'completeness': DatosGobClCKAN, # Más completo
        'freshness': MBNRest,           # Más fresco
        'accuracy': IDEChileWFS,        # Más preciso
    }
    
    def select(self, criteria: str, query_type: str):
        """Elegir fuente basado en criterios"""
        if query_type == 'bulk_download':
            return DatosGobClCKAN()
        elif query_type == 'spatial_search':
            return IDEChileWFS()
        elif query_type == 'fiscal_property':
            return MBNRest()
        elif criteria == 'speed':
            return IDEChileWFS()
        return self.STRATEGIES.get(criteria, IDEChileWFS)()
```

### 4.3 Pipeline de Actualización Recomendado

```
Weekly:
├─ IDE Chile (8 meses: descargar cuando hay cambios)
├─ MBN (Trimestral: descargar cada miércoles Q+1)
├─ MINVU (Trimestral: descargar cada jueves Q+1)
├─ datos.gob.cl (Variable: monitorear cambios)
└─ Municipios (Anual: inicios de año)

Daily:
├─ Verificar nuevos datasets publicados
├─ Validar integridad de datos importados
└─ Alertas de anomalías

Hourly:
├─ Health check de APIs
├─ Monitorear availability
└─ Log errors para debugging
```

---

## 5. RECOMENDACIONES POR CASO DE USO

### 5.1 Inmobiliaria (Casafari)

**Stack Recomendado:**
```
Fuentes Principales:
  1. IDE Chile (predios catastrales)
  2. MINVU (vivienda social)
  3. datos.gob.cl (datasets adicionales)

Tecnología Backend:
  - Python 3.10+ con FastAPI
  - PostgreSQL 14+ con PostGIS 3.2+
  - Redis para caching
  - Elasticsearch para búsqueda full-text

Actualización:
  - Semanal: IDE Chile
  - Trimestral: MBN + MINVU
  - Mensual: Validación cruzada
  - Diario: Monitoreo de cambios

Caching:
  - Búsquedas frecuentes: 24h
  - Geometrías: 7 días
  - Metadatos: 30 días
```

### 5.2 Análisis de Riesgo/Valuación

**Stack Recomendado:**
```
Fuentes Principales:
  1. IDE Chile (geometrías y ubicación)
  2. CNR (riesgos naturales)
  3. MINVU (planificación urbana)

Tecnología Backend:
  - Python con geopandas + scipy
  - PostGIS para consultas espaciales
  - R para análisis estadístico

Procesamiento:
  - Batch semanal de análisis
  - Risk scoring por predio
  - Cambios detectados en tiempo real
```

### 5.3 Plataforma de Gestión Territorial

**Stack Recomendado:**
```
Fuentes Principales:
  1. IDE Chile (todas las capas)
  2. datos.gob.cl (metadatos)
  3. MINVU (planificación)
  4. CNR (recursos naturales)

Tecnología Backend:
  - Node.js/TypeScript para APIs
  - GeoServer para WMS/WFS
  - MongoDB para catalogo flexible
  - Elasticsearch para búsqueda

Interfaz:
  - React + Mapbox GL
  - Leaflet para compatibilidad
```

### 5.4 Sistema de Información Catastral

**Stack Recomendado:**
```
Fuentes Principales:
  1. IDE Chile (central)
  2. MBN (bienes fiscales)
  3. Conservadores (dominios)

Tecnología Backend:
  - Java/Spring Boot para estabilidad
  - Oracle GeoDatabase o PostGIS
  - OGC WFS/WMS providers

API:
  - REST JSON
  - OGC Web Services (WFS/WMS)
  - GraphQL para consultas flexibles

Características:
  - Histórico completo
  - Auditoría detallada
  - Sincronización multi-fuente
```

---

## 6. TABLA DE DECISIONES

### "¿Cuál fuente debería usar?"

```
FLUJOGRAMA DE DECISIÓN:

¿Necesitas propiedades fiscales?
├─ SÍ → MBN (Autoridad oficial)
├─ NO → Continúa...

¿Necesitas análisis espacial complejo?
├─ SÍ → IDE Chile (Geometrías precisas)
├─ NO → Continúa...

¿Necesitas descarga masiva de datos?
├─ SÍ → datos.gob.cl (CSV bulk)
├─ NO → Continúa...

¿Necesitas vivienda social?
├─ SÍ → MINVU
├─ NO → Continúa...

¿Necesitas datos en tiempo real?
├─ SÍ → IDE Chile (WFS paginado)
├─ NO → datos.gob.cl (datasets)

┌─────────────────────────────┐
│ RECOMENDACIÓN: IDE Chile    │
│ (opción más versátil)       │
└─────────────────────────────┘
```

---

## 7. MONITOREO Y ALERTAS

### 7.1 Métricas Críticas a Monitorear

```python
# Checklist de monitoreo
monitoring_metrics = {
    'availability': {
        'target': '99%',
        'alert': '<95%',
        'source': 'IDE Chile, MBN, MINVU'
    },
    'response_time': {
        'target': '<3s',
        'alert': '>10s',
        'source': 'WFS requests'
    },
    'data_freshness': {
        'target': '<2 meses',
        'alert': '>6 meses',
        'source': 'Dataset metadata'
    },
    'completeness': {
        'target': '>98%',
        'alert': '<90%',
        'source': 'NULL count analysis'
    },
    'deduplication_rate': {
        'target': '<1%',
        'alert': '>5%',
        'source': 'Unified datastore'
    }
}
```

### 7.2 Alertas Automáticas Sugeridas

| Alerta | Condición | Acción |
|--------|-----------|--------|
| **API Caída** | Timeout > 3 fallidos | Failover a fuente alternativa |
| **Datos Stale** | Última actualización > 3 meses | Revisar proceso de sync |
| **Tasa Error Alta** | Error rate > 1% | Analizar logs, notificar |
| **Rate Limit Hit** | 429 response | Implementar backoff exponencial |
| **Geometría Inválida** | > 0.1% de registros | Quarantine y revisión manual |
| **Duplicados Detectados** | > 1% después dedup | Verificar lógica de deduplicación |

---

## 8. COSTOS Y LICENCIAS

### 8.1 Costos Directos (Junio 2026)

| Fuente | Costo | Licencia | Comercialización |
|--------|-------|---------|-----------------|
| **IDE Chile** | Gratuito | CC0 | ✅ Permitida |
| **MBN** | Gratuito | CC0 | ✅ Permitida |
| **datos.gob.cl** | Gratuito | CC0/CC-BY | ✅ Permitida |
| **MINVU** | Gratuito | CC0 | ✅ Permitida |
| **CNR** | Gratuito | CC0 | ✅ Permitida |
| **Municipios** | Gratuito | Variable | ⚠️ Verificar |

### 8.2 Costos de Infraestructura (Estimado)

```
Small Scale (< 1M predios/mes):
  - Servidor PostgreSQL: $50-100/mes
  - Redis Cache: $15-30/mes
  - Ancho de banda: $10-20/mes
  - Total: ~$75-150/mes

Medium Scale (1-10M predios/mes):
  - Cluster PostgreSQL: $200-500/mes
  - Redis + Replicación: $50-100/mes
  - Load Balancer: $20-50/mes
  - Ancho de banda: $50-100/mes
  - Monitoreo: $30-50/mes
  - Total: ~$350-800/mes

Large Scale (> 10M predios/mes):
  - AWS/Azure GeoDB: $500-1500/mes
  - Elasticsearch: $100-300/mes
  - Distributed caching: $100-200/mes
  - Networking: $200-500/mes
  - Monitoring/Backup: $100-200/mes
  - Total: ~$1000-2700/mes
```

---

## 9. CHECKLIST DE IMPLEMENTACIÓN

### Fase 1: Evaluación (Semana 1)

- [ ] Revisar documentación técnica de cada fuente
- [ ] Hacer pruebas de conectividad a cada API
- [ ] Validar rate limits empíricos
- [ ] Probar parseo de respuestas en todos los formatos
- [ ] Estimar volumen de datos necesario

### Fase 2: Prototipo (Semana 2-3)

- [ ] Crear adaptadores para cada fuente
- [ ] Implementar normalización básica
- [ ] Probar búsqueda por dirección en IDE Chile
- [ ] Probar descarga de datasets en datos.gob.cl
- [ ] Implementar deduplicación simple

### Fase 3: Integración (Semana 4-6)

- [ ] Crear pipeline de ingesta de datos
- [ ] Implementar DB unificada (PostgreSQL+PostGIS)
- [ ] Crear API REST unificada
- [ ] Implementar caching
- [ ] Pruebas de carga y estrés

### Fase 4: Producción (Semana 7-8)

- [ ] Setup de monitoreo y alertas
- [ ] Documentación técnica final
- [ ] Training del equipo
- [ ] Deployment en producción
- [ ] Validación post-go-live

---

## 10. REFERENCIAS Y RECURSOS

### Especificaciones Técnicas
- OGC WFS 2.0: https://www.ogc.org/standards/wfs/
- OGC WMS 1.3: https://www.ogc.org/standards/wms/
- GeoJSON RFC 7946: https://tools.ietf.org/html/rfc7946
- CKAN API: https://docs.ckan.org/en/latest/api/

### Herramientas Útiles
- QGIS Desktop: Validación local de datos
- PostGIS: Base de datos geoespacial
- GeoServer: Publicación de WMS/WFS
- Leaflet: Visualización web

### Documentación Oficial
- [IDE Chile](https://www.ide.cl)
- [Geoportal Chile](https://www.geoportal.cl)
- [datos.gob.cl](https://datos.gob.cl)
- [IDE MINVU](https://ide.minvu.cl)

---

**Documento:** Matriz Técnica Comparativa NO-SII  
**Versión:** 1.0  
**Actualización:** 21 de Junio 2026  
**Estado:** Producción
