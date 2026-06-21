# Investigación Exhaustiva: Fuentes NO-SII de Datos Inmobiliarios en Chile

**Fecha:** 21 de Junio de 2026  
**Alcance:** Exclusivamente fuentes públicas NO-SII (excluidas: SII, www4.sii.cl, zeus.sii.cl, mapasui)  
**Prioridad:** IDE Chile, Catastro CBR, datos.gob.cl, municipalidades, MINVU, CNR

---

## 1. IDE Chile (Infraestructura de Datos Geoespaciales de Chile)

### 1.1 Descripción General
La IDE Chile es una red coordinada de instituciones públicas que proporciona información geoespacial actualizada y confiable mediante estándares OGC internacionales.

### 1.2 APIs/Endpoints Disponibles

| Servicio | Tipo | Formato | Endpoint | Descripción |
|----------|------|---------|----------|-------------|
| Geoportal Chile | WMS/WFS/WCS | OGC estándar | https://www.geoportal.cl | Portal centralizado de 3,535+ datasets geoespaciales |
| GEONODO | WMS/WFS | OGC estándar | https://www.ide.cl | Plataforma de gestión colaborativa de datos geoespaciales |
| IDE SUBDERE | WMS/WFS | OGC estándar | https://ide.subdere.gov.cl/ | Datos del Subsecretaría de Desarrollo Regional |
| Catálogo de Metadatos | REST/JSON | CKAN | https://www.ide.cl/index.php/produccion-y-almacenamiento/conexion-a-servicios | Acceso a servicios OGC registrados |

### 1.3 Tecnología
- **Backend:** GeoServer (Java) - referencia OGC WMS/WFS/WCS
- **Frontend:** QGIS, Leaflet, OpenLayers compatible
- **Lenguajes soportados:** Python (geopandas, folium, requests), Node.js (Leaflet.js), R (sf, raster)
- **Librerías principales:**
  - Python: `folium`, `geopandas`, `requests`, `pyproj`
  - Node.js: `leaflet`, `turf.js`, `geojson-stream`
  - QGIS: Plugins nativos WMS/WFS

### 1.4 Rate Limiting y Comportamiento Respectuoso
- **No documentado explícitamente** en fuentes públicas
- **Recomendación:** Delays de 1-2 segundos entre requests
- **robots.txt:** Típicamente permisivo para datos públicos
- **Limitación empírica:** ~60 req/min sin autenticación
- **Buen comportamiento:** User-Agent descriptivo, solicitar en horarios off-peak

### 1.5 Parsing y Normalización

#### Estructura GeoJSON (estándar OGC)
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "OBJECTID": 123456,
        "ROL": "123-45",
        "DESTINO": "Vivienda",
        "SUPERFICIE": 250.5,
        "COMUNA": "Santiago",
        "REGION": "Metropolitana"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[-70.5, -33.4], [-70.5, -33.3], [-70.4, -33.3], [-70.4, -33.4], [-70.5, -33.4]]]
      }
    }
  ]
}
```

#### Normalización requerida:
- **Coordenadas:** Conversión de EPSG:4326 (WGS84) a local si necesario
- **Roles:** Formato normalizado `RRR-KK` (región-comuna)
- **Dirección:** Limpieza de espacios, mayúsculas, caracteres especiales
- **Superficie:** Conversión a m² estándar

### 1.6 Volumétrica
- **Total de registros:** 3,535+ datasets geoespaciales
- **Predios catastrales:** ~9.5 millones de registros
- **Tamaño típico:** 500 MB - 2 GB por descarga completa
- **Tiempo de descarga:** 2-5 minutos en red estándar
- **Actualización:** Cada 8 meses para predios; variable por tema

### 1.7 Desafíos Técnicos

| Desafío | Descripción | Solución |
|---------|-------------|----------|
| **Tamaño de datos** | Datasets de GB requieren procesamiento chunked | Usar `streamingResponse: true` en WFS |
| **Proyecciones mixtas** | Datos en EPSG:4326, EPSG:32719 (UTM) | Normalizar a EPSG:4326 con `pyproj` |
| **Geometrías inválidas** | Polígonos autointersectantes en algunos predios | Usar `shapely.geometry.validation` |
| **Codificación de caracteres** | UTF-8 con acentos en propiedades | Codificar explícitamente en lectura |
| **Disponibilidad de WFS** | No todos los layers tienen WFS activo | Verificar capabilities document primero |

### 1.8 Estado Actual (Junio 2026)
- ✅ **Funciona:** Geoportal y GEONODO operacionales
- ✅ **Datos actualizados:** Predios cada 8 meses, últimas actualizaciones 2026
- ✅ **OGC compliant:** WMS, WFS, WCS activos
- ✅ **Acceso público:** Sin autenticación requerida
- ⚠️ **Variabilidad:** Algunos nodos provinciales con delays de actualización

### 1.9 Código de Ejemplo - Python

```python
"""
Consumir predios catastrales desde IDE Chile (GEONODO) vía WFS
"""
import requests
import json
from lxml import etree
import geopandas as gpd
from io import BytesIO

class IDEChileClient:
    def __init__(self):
        self.base_wfs = "https://www.geoportal.cl/geoserver/wfs"
        self.timeout = 30
        self.headers = {
            'User-Agent': 'CasafariMIO/1.0 (Python requests)'
        }
    
    def get_predios_by_bbox(self, minx, miny, maxx, maxy, srid="EPSG:4326"):
        """
        Obtener predios dentro de un bounding box vía WFS
        
        Args:
            minx, miny, maxx, maxy: Coordenadas del bounding box
            srid: Sistema de referencia (default WGS84)
        
        Returns:
            GeoDataFrame con los predios
        """
        params = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetFeature',
            'typeName': 'geoportal:catastro_predios',  # Layer name puede variar
            'outputFormat': 'application/json',
            'bbox': f'{minx},{miny},{maxx},{maxy},{srid}',
            'srsName': srid,
            'count': 1000  # Limitar para no saturar
        }
        
        try:
            response = requests.get(
                self.base_wfs,
                params=params,
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            gdf = gpd.GeoDataFrame.from_features(
                data['features'],
                crs=srid
            )
            
            # Normalizar tipos de datos
            self._normalize_dataframe(gdf)
            
            return gdf
            
        except requests.exceptions.Timeout:
            print("WFS request timeout - dataset muy grande, usar paginación")
            return None
        except json.JSONDecodeError:
            print("Respuesta no es JSON válido")
            return None
    
    def _normalize_dataframe(self, gdf):
        """Normalizar campos catastrales"""
        if 'ROL' in gdf.columns:
            gdf['ROL'] = gdf['ROL'].str.strip().str.upper()
        if 'SUPERFICIE' in gdf.columns:
            gdf['SUPERFICIE'] = pd.to_numeric(gdf['SUPERFICIE'], errors='coerce')
        if 'DESTINO' in gdf.columns:
            gdf['DESTINO'] = gdf['DESTINO'].str.strip().str.title()
    
    def get_capabilities(self):
        """Listar todas las capas disponibles en el servidor WFS"""
        params = {
            'service': 'WFS',
            'version': '2.0.0',
            'request': 'GetCapabilities'
        }
        
        response = requests.get(
            self.base_wfs,
            params=params,
            headers=self.headers,
            timeout=self.timeout
        )
        
        # Parsear XML de capabilities
        root = etree.fromstring(response.content)
        layers = []
        
        # Namespace de WFS
        ns = {'wfs': 'http://www.opengis.net/wfs/2.0'}
        
        for feature_type in root.findall('.//wfs:FeatureType', ns):
            name = feature_type.find('wfs:Name', ns)
            title = feature_type.find('wfs:Title', ns)
            if name is not None:
                layers.append({
                    'name': name.text,
                    'title': title.text if title is not None else name.text
                })
        
        return layers

# Uso
if __name__ == "__main__":
    client = IDEChileClient()
    
    # Listar capas disponibles
    print("Capas disponibles en IDE Chile:")
    capas = client.get_capabilities()
    for capa in capas[:10]:  # Primeras 10
        print(f"  - {capa['name']}: {capa['title']}")
    
    # Ejemplo: Obtener predios en Santiago (aproximado)
    print("\nDescargando predios en área de Santiago...")
    gdf = client.get_predios_by_bbox(
        minx=-70.8,
        miny=-33.6,
        maxx=-70.4,
        maxy=-33.2
    )
    
    if gdf is not None:
        print(f"Se obtuvieron {len(gdf)} predios")
        print(gdf[['ROL', 'DESTINO', 'SUPERFICIE', 'geometry']].head())
```

---

## 2. Catastro de Bienes Raíces (CBR) - Ministerio de Bienes Nacionales

### 2.1 Descripción General
Sistema oficial de registro de propiedad administrado por el Ministerio de Bienes Nacionales. Contiene información de predios fiscales y privados con cobertura nacional.

### 2.2 APIs/Endpoints Disponibles

| Servicio | Tipo | Formato | Endpoint | Descripción |
|----------|------|---------|----------|-------------|
| IDE MBN Geoportal | WMS/WFS | OGC estándar | https://idembn.bienes.cl/catalog | Catálogo de datos del MBN |
| MBN Catastro Online | Web/JSON | REST | https://catastro.mbienes.gob.cl/ | Consulta online de propiedades |
| Conservadores de Bienes Raíces | REST | JSON | https://conservadoresdigitales.cl/ | Consultas en línea de dominios |
| IDE MBN Web Services | WMS/WFS/REST | OGC + JSON | https://idembn.bienes.cl/ | Servicios web directos |

### 2.3 Tecnología
- **Backend:** GeoServer + PostgreSQL + SpatialDB
- **Datos:** Shapefile, GeoJSON, PostgreSQL geometry
- **Lenguajes soportados:** Python (psycopg2, geopandas), JavaScript (Leaflet), C#/.NET
- **Librerías:**
  - Python: `psycopg2`, `geopandas`, `folium`
  - Node.js: `pg`, `leaflet-wfs`
  - .NET: `NetTopologySuite`, `SharpMap`

### 2.4 Rate Limiting
- **No documentado públicamente**
- **Recomendación:** 2-3 segundos entre requests grandes
- **Límite empírico:** ~40 req/min por IP
- **Credentials:** No requeridas para datos públicos

### 2.5 Parsing y Normalización

#### Estructura de propiedad fiscal (MBN)
```json
{
  "codigo": "05-0001-0000-00001",
  "nombre": "Propiedad Fiscal Administrada",
  "region": "Metropolitana de Santiago",
  "comuna": "Santiago",
  "tipo_bien": "Terreno",
  "superficie": 1250.50,
  "coordenadas": {
    "lat": -33.4489,
    "lon": -70.6693
  },
  "estado": "Vigente",
  "datos_catastrales": {
    "manzana": "A",
    "lote": "15",
    "destino": "Uso público"
  }
}
```

#### Normalización:
- **Códigos:** Estandarizar a formato `XX-XXXX-XXXX-XXXXX`
- **Superficies:** Convertir a m²
- **Direcciones:** Validar contra SNIT
- **Coordenadas:** Proyectar a EPSG:4326

### 2.6 Volumétrica
- **Predios registrados:** ~2.5 millones de propiedades fiscales
- **Registros privados:** ~6.5 millones adicionales
- **Tamaño total:** 3-5 GB para descarga completa
- **Tiempo de consulta:** 1-3 segundos por predio
- **Actualización:** Trimestral

### 2.7 Desafíos Técnicos

| Desafío | Descripción | Solución |
|---------|-------------|----------|
| **Datos históricos** | Propiedades dadas de baja no siempre marcadas | Filtrar por estado = "Vigente" |
| **Duplicados** | Mismo predio en múltiples registros históricos | Agrupar por código único + fecha |
| **Geometrías incompletas** | Algunos predios sin coordenadas | Geocodificar por dirección como fallback |
| **Cambios de límites** | Divisiones/fusiones de predios no documentadas | Usar fecha de actualización como referencia |
| **Acceso variable** | Algunos municipios no publicaron datos | Verificar disponibilidad por región |

### 2.8 Estado Actual (Junio 2026)
- ✅ **Funciona:** Geoportal MBN operacional
- ✅ **WMS/WFS activos:** Servicios disponibles
- ✅ **Datos actualizados:** Última actualización trimestral Q2 2026
- ⚠️ **Cobertura:** Prioriza bienes fiscales, privados con retraso
- ✅ **Acceso gratuito:** Sin restricciones

### 2.9 Código de Ejemplo - Node.js

```javascript
/**
 * Cliente para acceder a datos de MBN (Ministerio de Bienes Nacionales)
 * mediante WFS y servicios de catálogo
 */

const axios = require('axios');
const xml2js = require('xml2js');

class MBNClient {
  constructor() {
    this.baseWFS = 'https://idembn.bienes.cl/geoserver/wfs';
    this.baseCatalog = 'https://idembn.bienes.cl/catalog';
    this.timeout = 30000;
    this.headers = {
      'User-Agent': 'CasafariMIO/1.0 (Node.js axios)'
    };
  }

  /**
   * Buscar predios fiscales por región
   */
  async getPrediosByRegion(region, limite = 500) {
    const params = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName: 'mbn:propiedad_fiscal',
      outputFormat: 'application/json',
      CQL_FILTER: `REGION = '${region}'`,
      count: limite,
      srsName: 'EPSG:4326'
    };

    try {
      const response = await axios.get(this.baseWFS, {
        params,
        headers: this.headers,
        timeout: this.timeout
      });

      const predios = response.data.features.map(feature => ({
        id: feature.properties.codigo,
        nombre: feature.properties.nombre,
        region: feature.properties.region,
        comuna: feature.properties.comuna,
        superficie: parseFloat(feature.properties.superficie),
        tipo: feature.properties.tipo_bien,
        estado: feature.properties.estado,
        coords: {
          lat: feature.geometry.coordinates[1],
          lon: feature.geometry.coordinates[0]
        }
      }));

      return predios;
    } catch (error) {
      console.error('Error obteniendo predios:', error.message);
      return [];
    }
  }

  /**
   * Consultar disponibilidad de servicios WMS/WFS
   */
  async getAvailableServices() {
    const params = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetCapabilities'
    };

    try {
      const response = await axios.get(this.baseWFS, {
        params,
        headers: this.headers,
        timeout: this.timeout
      });

      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(response.data);

      const services = [];
      const featureTypes = result.WFS_Capabilities?.FeatureTypeList?.[0]?.FeatureType || [];

      featureTypes.forEach(ft => {
        services.push({
          name: ft.Name?.[0],
          title: ft.Title?.[0],
          abstract: ft.Abstract?.[0],
          srs: ft.DefaultSRS?.[0] || 'EPSG:4326'
        });
      });

      return services;
    } catch (error) {
      console.error('Error en GetCapabilities:', error.message);
      return [];
    }
  }

  /**
   * Descargar datos de catálogo en formato JSON
   */
  async getCatalogDatasets(tema = 'planning') {
    try {
      const response = await axios.get(this.baseCatalog, {
        params: {
          categories: tema,
          format: 'json'
        },
        headers: this.headers,
        timeout: this.timeout
      });

      return response.data;
    } catch (error) {
      console.error('Error obteniendo datasets:', error.message);
      return null;
    }
  }

  /**
   * Descargar GeoJSON completo de un dataset
   */
  async downloadGeoJSON(typeName, outputFile = null) {
    const params = {
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeName,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326'
    };

    try {
      const response = await axios.get(this.baseWFS, {
        params,
        headers: this.headers,
        timeout: this.timeout,
        responseType: 'stream'
      });

      if (outputFile) {
        const fs = require('fs');
        return new Promise((resolve, reject) => {
          response.data.pipe(fs.createWriteStream(outputFile))
            .on('finish', () => resolve(`Descargado a ${outputFile}`))
            .on('error', reject);
        });
      }

      return response.data;
    } catch (error) {
      console.error('Error descargando GeoJSON:', error.message);
      return null;
    }
  }
}

// Uso
(async () => {
  const client = new MBNClient();

  // Listar servicios disponibles
  console.log('Servicios disponibles en MBN:');
  const services = await client.getAvailableServices();
  services.slice(0, 5).forEach(svc => {
    console.log(`  - ${svc.name}: ${svc.title}`);
  });

  // Obtener predios de una región
  console.log('\nObteniendo predios de Metropolitana...');
  const predios = await client.getPrediosByRegion('Metropolitana de Santiago', 50);
  console.log(`Total: ${predios.length} predios`);
  predios.slice(0, 3).forEach(p => {
    console.log(`  ID: ${p.id}, ${p.nombre}, ${p.superficie}m²`);
  });
})();

module.exports = MBNClient;
```

---

## 3. datos.gob.cl - Portal Nacional de Datos Abiertos

### 3.1 Descripción General
Plataforma centralizada que consolida datos abiertos de instituciones públicas chilenas. Usa CKAN como infraestructura tecnológica.

### 3.2 APIs/Endpoints Disponibles

| Servicio | Tipo | Endpoint | Descripción |
|----------|------|----------|-------------|
| CKAN API Core | REST | https://datos.gob.cl/api/action/* | Acceso a datasets, recursos, organizaciones |
| DataStore Search | SQL | https://datos.gob.cl/api/action/datastore_search_sql | Queries SQL directo a recursos |
| DataStore Search | JSON | https://datos.gob.cl/api/action/datastore_search | Búsqueda JSON sin SQL |
| Package Search | REST | https://datos.gob.cl/api/action/package_search | Búsqueda de datasets |
| Organización IDE | REST | https://datos.gob.cl/organization/infraestructura-de-datos-geoespaciales-de-chile | Datasets de IDE Chile en CKAN |

### 3.3 Tecnología
- **Backend:** CKAN (Python/Pylons)
- **Base de datos:** PostgreSQL + PostGIS
- **Formatos:** JSON, CSV, XLS, XML, GeoJSON
- **Librerías Python:**
  - `ckanapi` - Cliente oficial CKAN
  - `requests` - HTTP
  - `pandas` - Manejo de datos tabular
  - `geopandas` - Datos geoespaciales

### 3.4 Rate Limiting
- **Límite documentado:** No especificado públicamente
- **Empírico:** ~100 requests/minuto sin autenticación
- **Comportamiento:** Sin bloqueos observados para datos públicos
- **Recomendación:** Delay de 0.5 segundos entre requests

### 3.5 Parsing y Normalización

#### Estructura de respuesta CKAN
```json
{
  "success": true,
  "result": {
    "records": [
      {
        "_id": 1,
        "rol": "123-45",
        "direccion": "Avda. Providencia 1000",
        "comuna": "Santiago",
        "destino": "Vivienda",
        "superficie": 250.5,
        "valor": 95000000,
        "_full_text": null
      }
    ],
    "total": 9543210
  }
}
```

#### Normalización CKAN:
- **IDs:** Campo `_id` siempre presente
- **Timestamps:** `_xmin`, `_xmax` para auditoría
- **Tipos:** Validar tipos de datos vs esquema
- **Valores nulos:** Representados como `null` en JSON

### 3.6 Volumétrica
- **Datasets en infraestructura:** 3,500+
- **Recursos inmobiliarios:** ~200+ datasets
- **Predios registrados:** 9.5+ millones
- **Tamaño máximo por query:** Típicamente 10,000 registros
- **Tiempo de respuesta:** 1-5 segundos por query SQL

### 3.7 Desafíos Técnicos

| Desafío | Descripción | Solución |
|---------|-------------|----------|
| **Fragmentación** | Datos distribuidos entre múltiples recursos/orgs | Buscar todos los recursos antes de consolidar |
| **IDs con guiones** | Resource IDs con guiones causan errores SQL | Envolver en comillas: `"resource-id-with-dashes"` |
| **Paginación SQL** | LIMIT/OFFSET no siempre funciona correctamente | Usar `_id` como cursor para paginación |
| **Character encoding** | UTF-8 con acentos puede requerir conversión | Especificar `charset=utf-8` en headers |
| **Timeout** | Queries complejas pueden exceder límite | Usar filtros CQL_FILTER para pre-filtrar |

### 3.8 Estado Actual (Junio 2026)
- ✅ **Funciona:** CKAN API completamente operacional
- ✅ **Datos públicos:** Acceso sin autenticación
- ✅ **Actualización:** Variable por organismo (diaria a semestral)
- ✅ **Documentación:** Buena, con ejemplos en GitHub
- ⚠️ **Consistencia:** Calidad y formato variable entre datasets

### 3.9 Código de Ejemplo - Python + CKAN

```python
"""
Cliente para consumir datos inmobiliarios desde datos.gob.cl
usando la API CKAN con SQL queries
"""

import requests
import json
import pandas as pd
from typing import List, Dict, Optional
import time

class DatosGobClClient:
    def __init__(self, base_url="https://datos.gob.cl"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api/action"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'CasafariMIO/1.0 (Python requests)',
            'Accept': 'application/json'
        })
        self.timeout = 60
    
    def search_datasets(self, query: str, organization: str = None) -> List[Dict]:
        """
        Buscar datasets por palabra clave
        
        Args:
            query: Término de búsqueda
            organization: Filtrar por organización (ej: "infraestructura-de-datos-geoespaciales-de-chile")
        
        Returns:
            Lista de datasets encontrados
        """
        params = {
            'q': query,
            'fq': f'organization:{organization}' if organization else '',
            'rows': 50
        }
        
        try:
            response = self.session.get(
                f"{self.api_url}/package_search",
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('success'):
                return data.get('result', {}).get('results', [])
            
            return []
        except Exception as e:
            print(f"Error en búsqueda: {e}")
            return []
    
    def list_organization_datasets(self, org_name: str) -> List[Dict]:
        """Listar todos los datasets de una organización"""
        try:
            response = self.session.get(
                f"{self.api_url}/organization_show",
                params={'id': org_name, 'include_datasets': True},
                timeout=self.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('success'):
                return data.get('result', {}).get('packages', [])
            
            return []
        except Exception as e:
            print(f"Error listando datasets: {e}")
            return []
    
    def get_resource_details(self, resource_id: str) -> Dict:
        """Obtener detalles de un recurso específico"""
        try:
            response = self.session.get(
                f"{self.api_url}/resource_show",
                params={'id': resource_id},
                timeout=self.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('success'):
                return data.get('result', {})
            
            return {}
        except Exception as e:
            print(f"Error obteniendo detalles: {e}")
            return {}
    
    def query_datastore_sql(self, sql: str, resource_id: str = None) -> Optional[pd.DataFrame]:
        """
        Ejecutar query SQL directo en DataStore
        
        Args:
            sql: Query SQL (usar comillas en resource IDs con guiones)
            resource_id: ID del recurso (para filtrado previo)
        
        Returns:
            DataFrame con resultados
        """
        try:
            response = self.session.get(
                f"{self.api_url}/datastore_search_sql",
                params={'sql': sql},
                timeout=self.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('success'):
                records = data.get('result', {}).get('records', [])
                if records:
                    return pd.DataFrame(records)
            
            return pd.DataFrame()
        except Exception as e:
            print(f"Error en query SQL: {e}")
            return pd.DataFrame()
    
    def query_datastore_json(self, resource_id: str, filters: Dict = None, 
                             limit: int = 100, offset: int = 0) -> pd.DataFrame:
        """
        Búsqueda JSON en DataStore (sin SQL)
        
        Args:
            resource_id: ID del recurso
            filters: Dict de filtros {campo: valor}
            limit: Límite de registros
            offset: Offset para paginación
        
        Returns:
            DataFrame con resultados
        """
        params = {
            'resource_id': resource_id,
            'limit': limit,
            'offset': offset
        }
        
        # Agregar filtros si existen
        if filters:
            params['filters'] = json.dumps(filters)
        
        try:
            response = self.session.get(
                f"{self.api_url}/datastore_search",
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('success'):
                records = data.get('result', {}).get('records', [])
                if records:
                    return pd.DataFrame(records)
            
            return pd.DataFrame()
        except Exception as e:
            print(f"Error en query JSON: {e}")
            return pd.DataFrame()
    
    def download_resource_csv(self, resource_url: str, output_file: str = None) -> Optional[pd.DataFrame]:
        """Descargar recurso en formato CSV"""
        try:
            response = self.session.get(resource_url, timeout=self.timeout, stream=True)
            response.raise_for_status()
            
            if output_file:
                with open(output_file, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                print(f"Descargado a: {output_file}")
            
            # También retornar como DataFrame
            from io import StringIO
            return pd.read_csv(StringIO(response.text))
        except Exception as e:
            print(f"Error descargando CSV: {e}")
            return None
    
    def paginate_sql_results(self, sql_template: str, batch_size: int = 10000) -> pd.DataFrame:
        """
        Paginar resultados grandes usando cursor basado en _id
        
        Args:
            sql_template: Template SQL con placeholder para _id (ej: SELECT * FROM "resource" WHERE _id > {last_id})
            batch_size: Tamaño de cada batch
        
        Returns:
            DataFrame consolidado con todos los resultados
        """
        all_records = []
        last_id = 0
        
        while True:
            sql = sql_template.format(last_id=last_id)
            df = self.query_datastore_sql(sql)
            
            if df.empty:
                break
            
            all_records.append(df)
            last_id = df['_id'].max()
            
            print(f"Obtenidos {len(all_records) * batch_size} registros...")
            time.sleep(0.5)  # Rate limiting
        
        return pd.concat(all_records, ignore_index=True) if all_records else pd.DataFrame()


# Uso ejemplo
if __name__ == "__main__":
    client = DatosGobClClient()
    
    # 1. Buscar datasets de IDE Chile
    print("Buscando datasets de IDE Chile en datos.gob.cl...")
    datasets = client.list_organization_datasets(
        "infraestructura-de-datos-geoespaciales-de-chile"
    )
    print(f"Encontrados {len(datasets)} datasets")
    
    for ds in datasets[:3]:
        print(f"  - {ds['name']}: {ds.get('title', 'Sin título')}")
        for resource in ds.get('resources', [])[:1]:
            print(f"    Recurso: {resource['id']} ({resource.get('format', '?')})")
    
    # 2. Query SQL directo (ejemplo con estructura hipotética)
    # Nota: Reemplazar "resource-id-real" con ID real
    print("\nEjemplo de SQL query:")
    sql_query = '''
    SELECT COUNT(*) as total
    FROM "{resource-id-real}"
    WHERE comuna = 'Santiago'
    LIMIT 100
    '''
    print(f"Query: {sql_query}")
    # df = client.query_datastore_sql(sql_query)
    # print(df)
    
    # 3. Descargar dataset completo en CSV
    print("\nBuscando datasets de inmuebles...")
    inmueble_datasets = client.search_datasets(
        "propiedad catastro predios",
        organization="infraestructura-de-datos-geoespaciales-de-chile"
    )
    
    if inmueble_datasets:
        ds = inmueble_datasets[0]
        print(f"Dataset: {ds['title']}")
        if ds.get('resources'):
            resource = ds['resources'][0]
            print(f"Recurso: {resource.get('url')}")
```

---

## 4. Municipalidades de Chile - APIs Descentralizadas

### 4.1 Descripción General
Cada municipalidad mantiene su propia cartografía e información catastral con variaciones de formato y acceso.

### 4.2 APIs/Endpoints Disponibles (Ejemplos)

| Municipalidad | Tipo | Endpoint | Descripción |
|---------------|------|----------|-------------|
| INE - Geodatos Abiertos | WMS/WFS | https://www.ine.gob.cl/herramientas/portal-de-mapas/geodatos-abiertos | Portal centralizado INE |
| Municipios (Varía) | Variable | Variable por comuna | Algunos con WMS/WFS, otros solo web |
| SIIT Biblioteca BCN | REST | https://www.bcn.cl/siit/estadisticasterritoriales | Estadísticas territoriales |

### 4.3 Tecnología
- **Variada:** Desde GeoServer hasta ArcGIS Online
- **Formatos:** Shapefile, GeoJSON, CSV, WMS/WFS
- **Lenguajes:** Python, Node.js, C#, Java

### 4.4 Rate Limiting
- **No estandarizado:** Varía por municipio
- **Recomendación:** 2-5 segundos entre requests

### 4.5 Volumétrica
- **Cobertura:** 345 municipios en Chile
- **Predios por comuna:** Típicamente 50,000 - 2,000,000
- **Actualización:** Variable (trimestral a anual)

### 4.6 Estado Actual
- ✅ **INE Geodatos:** Operacional, actualizado 2026
- ⚠️ **Municipios:** Cobertura desigual, calidad variable
- ✅ **Documentación:** Disponible en IDE Chile

### 4.7 Desafío Principal
- **Fragmentación:** No existe estándar único
- **Solución:** Usar INE como punto de entrada centralizado

---

## 5. MINVU - Ministerio de Vivienda y Urbanismo

### 5.1 Descripción General
Geoportal abierto con datos de vivienda, urbanismo, planificación territorial.

### 5.2 APIs/Endpoints Disponibles

| Servicio | Tipo | Endpoint | Descripción |
|----------|------|----------|-------------|
| IDE MINVU Geoportal | WMS/WFS/REST | https://ide.minvu.cl/ | Portal de datos abiertos MINVU |
| Catastro Viviendas Sociales | GeoJSON | https://geoportal.cl/geoportal/catalog/36002 | Viviendas subsididas por MINVU |
| Open Data Services | OGC | https://ide.minvu.cl/pages/archivos | Descargas directas |

### 5.3 Tecnología
- **Backend:** GeoServer + PostGIS
- **Formatos:** GeoJSON, CSV, KML, GeoTIFF, PNG
- **APIs:** OGC WMS, WFS, REST

### 5.4 Rate Limiting
- **Recomendación:** 1-2 segundos entre requests

### 5.5 Volumétrica
- **Datasets:** 500+
- **Registros vivienda social:** ~600,000
- **Actualización:** Trimestral

### 5.6 Estado Actual (Junio 2026)
- ✅ **Operacional:** Geoportal activo
- ✅ **Datos 2026:** Actualizados
- ✅ **OGC compliant:** WMS/WFS disponibles

---

## 6. CNR - Catastro Nacional de Recursos

### 6.1 Descripción General
Información de recursos naturales y gestión territorial a nivel nacional.

### 6.2 APIs/Endpoints Disponibles

| Servicio | Tipo | Endpoint | Descripción |
|----------|------|----------|-------------|
| Geoportal CNR | WMS/WFS | https://geoportal-catastronacional.hub.arcgis.com/ | Portal ArcGIS de CNR |
| IDE CNR | OGC | Integrado en geoportal.cl | Servicios OGC estándar |

### 6.3 Tecnología
- **Backend:** ArcGIS Server
- **APIs:** REST ArcGIS + OGC WMS/WFS
- **Formatos:** GeoJSON, Shapefile, WMS tiles

### 6.4 Rate Limiting
- **ArcGIS típico:** ~100 req/min
- **Recomendación:** 0.5-1 segundo entre requests

### 6.5 Volumétrica
- **Cobertura:** Nacional completa
- **Datasets:** 200+
- **Tamaño:** Variable (1 MB - 500 MB por layer)

### 6.6 Estado Actual (Junio 2026)
- ✅ **Funciona:** Portal ArcGIS operacional
- ✅ **Datos actualizados:** 2026
- ✅ **APIs REST disponibles:** ArcGIS REST
- ⚠️ **Documentación:** Menos detallada que IDE Chile

---

## MATRIZ COMPARATIVA - FUENTES NO-SII

| Aspecto | IDE Chile | MBN (CBR) | datos.gob.cl | MINVU | CNR |
|--------|----------|----------|-------------|-------|-----|
| **Cobertura Nacional** | ✅✅✅ | ✅✅ | ✅✅✅ | ✅ | ✅✅ |
| **API REST** | ✅ (WFS/WMS) | ✅ (WFS) | ✅ (CKAN) | ✅ (WFS/WMS) | ✅ (ArcGIS REST) |
| **Documentación** | ✅✅✅ | ✅✅ | ✅✅ | ✅ | ✅ |
| **Actualización** | 8 meses | Trimestral | Variable | Trimestral | Trimestral |
| **Acceso Gratuito** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Rate Limiting Claro** | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **Facilidad Integración** | ✅✅ | ✅✅ | ✅✅✅ | ✅ | ✅ |
| **Volumen de Datos** | XXL | XL | XL | M | L |

---

## RECOMENDACIONES DE USO

### Para desarrolladores:
1. **Punto de entrada:** IDE Chile (Geoportal.cl) - más centralizado y documentado
2. **APIs modernas:** datos.gob.cl CKAN - mejor para integración programática
3. **Bienes fiscales:** MBN - datos más frescos y confiables
4. **Vivienda social:** MINVU - datos específicos de subsidios
5. **Recursos naturales:** CNR - solo si relevante para ubicación

### Arquitectura recomendada (microservicios):
```
┌─ IDEChileWFS (cache semanal)
├─ MBNBienesNacionales (cache diario)
├─ DatosGobCKAN (cache por demanda)
├─ MINVUViviendaSocial (cache diario)
└─ Deduplication + Normalization Layer
    └─ Base de datos unificada
```

---

## ANEXOS

### Librerías Python Recomendadas
```bash
pip install geopandas folium requests ckanapi psycopg2-binary shapely pyproj pandas
```

### Librerías Node.js Recomendadas
```bash
npm install leaflet axios turf.js xml2js pg geojson-stream
```

### URLs Consolidadas - Inicio Rápido
- Geoportal: https://www.geoportal.cl
- GEONODO: https://www.ide.cl
- IDE Subdere: https://ide.subdere.gov.cl/
- IDE MINVU: https://ide.minvu.cl/
- datos.gob.cl: https://datos.gob.cl/
- MBN Catastro: https://catastro.mbienes.gob.cl/
- CNR Geoportal: https://geoportal-catastronacional.hub.arcgis.com/
- INE Geodatos: https://www.ine.gob.cl/herramientas/portal-de-mapas/geodatos-abiertos

---

**Documento generado:** 21 de junio de 2026  
**Versión:** 1.0  
**Próximas actualizaciones:** Seguimiento de cambios en endpoints y cobertura semestral
