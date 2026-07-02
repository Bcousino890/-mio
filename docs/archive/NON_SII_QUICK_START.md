# Guía Rápida: Integración NO-SII - Casafari MIO

**Versión:** 1.0  
**Fecha:** 21 de Junio 2026  
**Última actualización:** Q2 2026

---

## Resumen Ejecutivo

Este documento proporciona un **quick start** para integrar datos inmobiliarios catastrales desde fuentes públicas NO-SII en Chile. Se excluyen completamente SII, www4.sii.cl y mapasui.

### Fuentes Recomendadas (por prioridad)

1. **IDE Chile** ⭐⭐⭐ - 3,500+ datasets geoespaciales
2. **datos.gob.cl** ⭐⭐⭐ - API CKAN unificada
3. **MBN (Bienes Nacionales)** ⭐⭐ - 2.5M propiedades fiscales
4. **MINVU** ⭐⭐ - Vivienda social y urbanismo
5. **CNR** ⭐⭐ - Recursos naturales

---

## Inicio Rápido - 5 Minutos

### Opción A: Python (Recomendado)

```python
# 1. Instalar dependencias
pip install geopandas folium requests

# 2. Descarga de predios desde IDE Chile
import geopandas as gpd
import requests

# Bbox de Santiago (lon_min, lat_min, lon_max, lat_max)
bbox = "-70.8,-33.6,-70.4,-33.2,EPSG:4326"

params = {
    'service': 'WFS',
    'version': '2.0.0',
    'request': 'GetFeature',
    'typeName': 'geoportal:predios_catastro',
    'outputFormat': 'application/json',
    'bbox': bbox,
    'count': 1000
}

response = requests.get(
    'https://www.geoportal.cl/geoserver/wfs',
    params=params,
    timeout=60
)

gdf = gpd.GeoDataFrame.from_features(response.json()['features'])
print(f"Predios obtenidos: {len(gdf)}")
print(gdf[['ROL', 'DESTINO', 'SUPERFICIE']].head())

# Guardar
gdf.to_file('predios.geojson', driver='GeoJSON')
```

### Opción B: Node.js

```javascript
// 1. Instalar dependencias
npm install axios

// 2. Descarga de predios
const axios = require('axios');

const params = {
  service: 'WFS',
  version: '2.0.0',
  request: 'GetFeature',
  typeName: 'geoportal:predios_catastro',
  outputFormat: 'application/json',
  bbox: '-70.8,-33.6,-70.4,-33.2,EPSG:4326',
  count: 1000
};

axios.get('https://www.geoportal.cl/geoserver/wfs', { params })
  .then(res => {
    console.log(`Predios obtenidos: ${res.data.features.length}`);
    console.log(res.data.features[0].properties);
  })
  .catch(err => console.error(err.message));
```

### Opción C: cURL (Testing)

```bash
# Descarga de predios en área de Santiago
curl -s "https://www.geoportal.cl/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=geoportal:predios_catastro&outputFormat=application/json&bbox=-70.8,-33.6,-70.4,-33.2,EPSG:4326&count=100" | jq '.' > predios.geojson

# Contar registros
jq '.features | length' predios.geojson
```

---

## URLs Esenciales

| Recurso | URL | Tipo |
|---------|-----|------|
| **IDE Chile Geoportal** | https://www.geoportal.cl | WMS/WFS |
| **GEONODO** | https://www.ide.cl | Gestor colaborativo |
| **IDE Subdere** | https://ide.subdere.gov.cl/ | WMS/WFS regional |
| **datos.gob.cl API** | https://datos.gob.cl/api/action | CKAN REST |
| **MBN Catastro** | https://catastro.mbienes.gob.cl/ | REST |
| **IDE MBN** | https://idembn.bienes.cl/ | WMS/WFS MBN |
| **IDE MINVU** | https://ide.minvu.cl/ | WMS/WFS MINVU |
| **CNR Geoportal** | https://geoportal-catastronacional.hub.arcgis.com/ | ArcGIS REST |
| **INE Geodatos** | https://www.ine.gob.cl/herramientas/portal-de-mapas/geodatos-abiertos | WMS/WFS |

---

## Operaciones Comunes

### 1. Búsqueda de predios por dirección

```python
# Python - Buscar en IDE Chile
import requests
import geopandas as gpd

# Usar CQL_FILTER para búsqueda por dirección
cql = "DIRECCION ILIKE '%Providencia%' AND COMUNA = 'Santiago'"

params = {
    'service': 'WFS',
    'version': '2.0.0',
    'request': 'GetFeature',
    'typeName': 'geoportal:predios_catastro',
    'outputFormat': 'application/json',
    'CQL_FILTER': cql,
    'count': 100
}

resp = requests.get('https://www.geoportal.cl/geoserver/wfs', params=params)
gdf = gpd.GeoDataFrame.from_features(resp.json()['features'])
```

### 2. Obtener datos de datos.gob.cl (SQL)

```python
# Python - Query SQL en datos.gob.cl
import requests
import pandas as pd

sql = '''
SELECT COUNT(*) as total
FROM "resource-id-here"
WHERE comuna = 'Santiago'
LIMIT 100
'''

resp = requests.get(
    'https://datos.gob.cl/api/action/datastore_search_sql',
    params={'sql': sql}
)

df = pd.DataFrame(resp.json()['result']['records'])
print(df)
```

### 3. Descargar dataset completo

```python
# Python - Descargar CSV desde datos.gob.cl
import pandas as pd

# Obtener recurso
resource_url = "https://datos.gob.cl/api/3/action/resource_show?id=resource-id"
resource = requests.get(resource_url).json()['result']

# Descargar CSV
csv_url = resource['url']
df = pd.read_csv(csv_url)
```

### 4. Búsqueda espacial (puntos cercanos)

```python
# Python - Predios cercanos a una ubicación
from shapely.geometry import Point
import geopandas as gpd

# Punto de interés (lat, lon)
poi = Point(-70.6693, -33.4489)  # Plaza de Armas, Santiago

# Buffer de búsqueda (0.01° ≈ 1km)
bbox = poi.buffer(0.01).bounds  # minx, miny, maxx, maxy

params = {
    'service': 'WFS',
    'version': '2.0.0',
    'request': 'GetFeature',
    'typeName': 'geoportal:predios_catastro',
    'outputFormat': 'application/json',
    'bbox': f'{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},EPSG:4326',
    'count': 1000
}

resp = requests.get('https://www.geoportal.cl/geoserver/wfs', params=params)
gdf = gpd.GeoDataFrame.from_features(resp.json()['features'], crs='EPSG:4326')

# Calcular distancia
gdf['distancia_m'] = gdf.geometry.centroid.distance(Point(70.6693, -33.4489)) * 111000
print(gdf.nsmallest(10, 'distancia_m')[['ROL', 'DESTINO', 'distancia_m']])
```

---

## Campos Catastrales Principales

| Campo | Descripción | Tipo | Ejemplo |
|-------|-------------|------|---------|
| **ROL** | Rol catastral único (región-comuna) | String | `05-001-1234` |
| **DESTINO** | Uso de la propiedad | String | `Vivienda` `Comercio` |
| **SUPERFICIE** | Área total en m² | Float | `250.5` |
| **COMUNA** | Comuna donde se ubica | String | `Santiago` |
| **REGION** | Región administrativa | String | `Metropolitana` |
| **DIRECCION** | Dirección completa | String | `Av. Providencia 1000` |
| **VALOR** | Valor catastral (si disponible) | Float | `95000000` |
| **geometry** | Geometría GeoJSON (Polygon/Point) | GeoJSON | Coordenadas |

---

## Rate Limiting y Buenas Prácticas

### Delays recomendados
- **IDE Chile:** 1-2 segundos entre requests grandes
- **datos.gob.cl:** 0.5 segundos entre requests
- **MBN:** 2-3 segundos entre requests
- **MINVU:** 1 segundo entre requests
- **CNR:** 0.5-1 segundo entre requests

### Headers recomendados
```python
headers = {
    'User-Agent': 'MiAplicacion/1.0 (Python requests)',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate'
}
```

### Manejo de timeouts
```python
import time
import requests

def fetch_with_retry(url, params, max_retries=3):
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, timeout=60)
            resp.raise_for_status()
            return resp
        except requests.exceptions.Timeout:
            if attempt < max_retries - 1:
                print(f"Timeout, reintentando en {2**attempt}s...")
                time.sleep(2 ** attempt)
            else:
                raise
```

---

## Problemas Comunes y Soluciones

### Problema 1: "WFS request timeout"
**Causa:** Dataset muy grande (>50,000 registros)  
**Solución:** Usar `count` más pequeño, paginación con `startIndex`

```python
# Paginación
for page in range(0, 100000, 1000):
    params['startIndex'] = page
    params['count'] = 1000
    # fetch data...
```

### Problema 2: "No features found"
**Causa:** Bbox inválido o capa no tiene datos en la región  
**Solución:** Verificar bbox y usar `listAvailableLayers()` primero

```python
# Verificar capas disponibles
capabilities_url = 'https://www.geoportal.cl/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities'
# Parsear XML para ver capas disponibles
```

### Problema 3: "Character encoding errors (UTF-8)"
**Causa:** Acentos o caracteres especiales  
**Solución:** Especificar encoding explícitamente

```python
df = pd.read_csv(url, encoding='utf-8')
# o
response.encoding = 'utf-8'
```

### Problema 4: "Resource ID con guiones en SQL"
**Causa:** PostgreSQL interpreta guiones como operadores  
**Solución:** Envolver resource ID entre comillas dobles

```python
# ❌ Incorrecto
sql = "SELECT * FROM resource-id-with-dashes"

# ✅ Correcto
sql = 'SELECT * FROM "resource-id-with-dashes"'
```

---

## Ejemplos Avanzados

### Consolidación de múltiples fuentes

```python
import geopandas as gpd
import pandas as pd

# 1. Obtener de IDE Chile
ide_gdf = gpd.read_file(
    'https://www.geoportal.cl/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=geoportal:predios_catastro&outputFormat=application/json&bbox=-70.8,-33.6,-70.4,-33.2,EPSG:4326&count=500',
    driver='GeoJSON'
)
ide_gdf['fuente'] = 'IDE-Chile'

# 2. Obtener de MBN
# (Usando endpoint específico de MBN)
mbn_gdf = gpd.GeoDataFrame()  # Implementar según MBN API

# 3. Consolidar
consolidated = pd.concat([ide_gdf, mbn_gdf], ignore_index=True)

# 4. Deduplicar por ROL
consolidated_dedup = consolidated.drop_duplicates(
    subset=['ROL'],
    keep='first'
)

print(f"Total antes: {len(consolidated)}")
print(f"Total después: {len(consolidated_dedup)}")
```

### Visualización interactiva

```python
import folium
import geopandas as gpd

# Obtener datos
gdf = gpd.read_file('predios.geojson')

# Crear mapa
m = folium.Map(
    location=[-33.45, -70.65],
    zoom_start=12,
    tiles='OpenStreetMap'
)

# Agregar puntos
for idx, row in gdf.head(100).iterrows():
    folium.CircleMarker(
        location=[row.geometry.y, row.geometry.x],
        radius=3,
        popup=f"{row['ROL']}<br>{row['DESTINO']}",
        tooltip=f"{row['SUPERFICIE']}m²",
        color='blue',
        fill=True,
        fillOpacity=0.7
    ).add_to(m)

m.save('mapa_predios.html')
```

### Análisis estadístico

```python
import geopandas as gpd
import pandas as pd

gdf = gpd.read_file('predios.geojson')

# Estadísticas por destino
print(gdf.groupby('DESTINO').agg({
    'SUPERFICIE': ['count', 'mean', 'median', 'sum'],
    'VALOR': ['mean', 'max', 'min']
}).round(2))

# Predios por comuna
print(gdf['COMUNA'].value_counts())

# Área promedio por destino
print(gdf.groupby('DESTINO')['SUPERFICIE'].mean().sort_values(ascending=False))
```

---

## Código Completo - Integración Completa

Ver archivos incluidos:
- **`NON_SII_INTEGRATION_EXAMPLES.py`** - Ejemplos completos en Python
- **`NON_SII_INTEGRATION_EXAMPLES.js`** - Ejemplos completos en Node.js
- **`NON_SII_SOURCES_INVESTIGATION.md`** - Investigación exhaustiva

---

## Testing y Validación

### Pruebas básicas

```bash
# 1. Verificar conectividad
curl -I https://www.geoportal.cl/geoserver/wfs

# 2. Obtener capabilities
curl "https://www.geoportal.cl/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities" | head -100

# 3. Obtener un predio de prueba
curl "https://www.geoportal.cl/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=geoportal:predios_catastro&outputFormat=application/json&count=1" | jq '.'
```

### Validación de datos

```python
import geopandas as gpd

gdf = gpd.read_file('predios.geojson')

# Verificar integridad
print(f"Total de registros: {len(gdf)}")
print(f"Registros con geometría: {gdf.geometry.is_empty.sum()}")
print(f"Campos: {list(gdf.columns)}")

# Validar datos específicos
assert gdf['SUPERFICIE'].dtype in ['float64', 'int64'], "SUPERFICIE debe ser numérico"
assert gdf['ROL'].dtype == 'object', "ROL debe ser string"
assert not gdf.geometry.is_empty.any(), "No hay geometrías vacías"
```

---

## Escalabilidad

### Para millones de registros

```python
# Usar chunking
def process_large_dataset(bbox, chunk_size=1000):
    total_records = 0
    output_file = 'predios_grandes.geojson'
    
    for start_index in range(0, 1000000, chunk_size):
        params = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetFeature',
            'typeName': 'geoportal:predios_catastro',
            'outputFormat': 'application/json',
            'bbox': bbox,
            'startIndex': start_index,
            'count': chunk_size
        }
        
        resp = requests.get('https://www.geoportal.cl/geoserver/wfs', params=params)
        features = resp.json()['features']
        
        if not features:
            break
        
        gdf = gpd.GeoDataFrame.from_features(features)
        gdf.to_file(output_file, driver='GeoJSON', mode='a')
        
        total_records += len(features)
        print(f"Procesados {total_records} registros...")
        
        time.sleep(1)  # Rate limiting

process_large_dataset('-70.8,-33.6,-70.4,-33.2,EPSG:4326')
```

---

## Recursos Adicionales

- 📚 [Documentación IDE Chile](https://www.ide.cl)
- 📚 [CKAN API Documentation](https://docs.ckan.org/en/latest/api/)
- 📚 [OGC WFS Standard](https://www.ogc.org/standards/wfs/)
- 🗺️ [Geoportal Chile](https://www.geoportal.cl)
- 🔗 [datos.gob.cl](https://datos.gob.cl)

---

## Contacto y Soporte

Para preguntas sobre integración:
- **Email:** contacto@casafari.com
- **Issues:** [GitHub Issues](https://github.com/casafari/mio)
- **Documentation:** Esta guía + `NON_SII_SOURCES_INVESTIGATION.md`

---

**Última actualización:** 21 de Junio 2026  
**Versión:** 1.0  
**Estado:** Producción
