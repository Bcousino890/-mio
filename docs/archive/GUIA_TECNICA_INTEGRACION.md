# Guía Técnica de Integración: Construcción de Datainmobilaria

**Audience:** Desarrolladores, arquitectos de sistemas, data engineers  
**Nivel:** Intermedio-Avanzado  
**Objetivo:** Pasos prácticos para integrar fuentes de datos inmobiliarios

---

## 🔧 PARTE 1: CONFIGURACIÓN INICIAL

### 1.1 Descarga de Datos Iniciales

#### Paso 1: Descargar Geometría (IDE Chile)

```bash
# 1. Ir a https://geoportal.cl
# 2. Categoría: "Planning and Cadastre" → "Properties (Predios)"
# 3. Descargar en formato Shapefile

# Estructura de archivos SHP
├── predios.shp        # Geometría (puntos/polígonos)
├── predios.shx        # Índice
├── predios.dbf        # Atributos
├── predios.prj        # Proyección
└── predios.cpg        # Codificación

# Convertir a PostgreSQL
ogr2ogr -f "PostgreSQL" \
  PG:"host=localhost user=gis password=gis dbname=datainmobilaria" \
  predios.shp \
  -nln properties_ide \
  -overwrite
```

#### Paso 2: Descargar Datos SII (Catastral.cl)

```bash
# 1. Ir a https://catastral.cl
# 2. Seleccionar comuna
# 3. Descargar CSV

# Estructura CSV típica
rol,direccion,destino,m2_construccion,m2_terreno,avaluo_fiscal,zona,latitud,longitud

# Cargar a Elasticsearch
python etl/load_catastral_es.py \
  --file catastral_santiago.csv \
  --index properties_sii
```

#### Paso 3: Indexar CBRS (Búsqueda Pública)

```bash
# CBRS: Búsqueda manual via https://conservador.cl/portal/consultas_en_linea
# O usar scraper ético:

python etl/scrape_cbrs_ethical.py \
  --municipalities santiago,providencia,lascondes \
  --output cbrs_index.json
```

---

### 1.2 Esquema de Base de Datos

```sql
-- PostgreSQL + PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabla principal de propiedades
CREATE TABLE properties (
  id SERIAL PRIMARY KEY,
  rol_sii VARCHAR(20),
  folio_cbrs VARCHAR(50),
  direccion VARCHAR(255),
  latitud DECIMAL(10, 8),
  longitud DECIMAL(11, 8),
  geom GEOMETRY(POINT, 4326),
  
  -- Atributos SII
  destino VARCHAR(50),
  avaluo_fiscal NUMERIC,
  m2_construccion NUMERIC,
  m2_terreno NUMERIC,
  zona VARCHAR(50),
  
  -- Atributos CBRS
  propietario_nombre VARCHAR(255),
  propietario_rut VARCHAR(20),
  
  -- Metadatos
  fuente_datos VARCHAR(50), -- 'IDE', 'SII', 'CBRS'
  fecha_actualizacion TIMESTAMP,
  
  UNIQUE(rol_sii, fuente_datos)
);

CREATE INDEX idx_properties_geom ON properties USING GIST(geom);
CREATE INDEX idx_properties_rol ON properties(rol_sii);
CREATE INDEX idx_properties_folio ON properties(folio_cbrs);
CREATE INDEX idx_properties_direccion ON properties USING BTREE(direccion);

-- Tabla de transacciones (de Archivo Nacional + CBRS)
CREATE TABLE property_transactions (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id),
  fecha_transaccion DATE,
  tipo_transaccion VARCHAR(50), -- 'compraventa', 'herencia', 'donacion'
  propietario_anterior VARCHAR(255),
  propietario_nuevo VARCHAR(255),
  monto_operacion NUMERIC,
  notaria VARCHAR(255),
  
  fuente_datos VARCHAR(50), -- 'CBRS', 'ARCHIVO_NACIONAL'
  fecha_registro TIMESTAMP,
  
  FOREIGN KEY(property_id) REFERENCES properties(id)
);

CREATE INDEX idx_transactions_property ON property_transactions(property_id);
CREATE INDEX idx_transactions_fecha ON property_transactions(fecha_transaccion);

-- Tabla de análisis (SIT Rural, suelos, etc.)
CREATE TABLE property_attributes (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id),
  
  -- Atributos rurales (SIT Rural)
  capacidad_uso VARCHAR(10), -- 'I', 'II', 'III', etc.
  tipo_suelo VARCHAR(100),
  erosion_nivel VARCHAR(50),
  
  -- Derechos de agua (DGA)
  derechos_agua BOOLEAN,
  tipo_derecho VARCHAR(50),
  caudal_autorizado NUMERIC,
  
  -- Vivienda social (MINVU)
  vivienda_social BOOLEAN,
  conjunto_nombre VARCHAR(255),
  año_construccion SMALLINT,
  
  fuente_datos VARCHAR(50),
  fecha_actualizacion TIMESTAMP,
  
  FOREIGN KEY(property_id) REFERENCES properties(id)
);

-- Tabla de búsquedas frecuentes (analytics)
CREATE TABLE search_analytics (
  id SERIAL PRIMARY KEY,
  tipo_busqueda VARCHAR(50), -- 'rol', 'direccion', 'folio'
  query VARCHAR(255),
  resultados_encontrados INTEGER,
  tiempo_respuesta_ms INTEGER,
  fecha_busqueda TIMESTAMP,
  usuario_id VARCHAR(100) -- Anonymous
);

CREATE INDEX idx_search_analytics_fecha ON search_analytics(fecha_busqueda);
```

---

### 1.3 ETL Pipeline (Python)

```python
# etl/main_pipeline.py
import pandas as pd
import geopandas as gpd
from sqlalchemy import create_engine, insert
from elasticsearch import Elasticsearch
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DatainmobiliariaETL:
    def __init__(self, db_url, es_url):
        self.engine = create_engine(db_url)
        self.es = Elasticsearch([es_url])
        
    def load_ide_chile(self, shapefile_path):
        """Cargar datos de IDE Chile (geometría)"""
        logger.info(f"Cargando IDE Chile desde {shapefile_path}")
        gdf = gpd.read_file(shapefile_path)
        
        # Convertir a tabla SQL
        gdf.to_postgis('properties_ide', self.engine, if_exists='replace')
        logger.info(f"Cargadas {len(gdf)} propiedades IDE")
        
    def load_catastral_csv(self, csv_path):
        """Cargar datos de Catastral.cl (atributos SII)"""
        logger.info(f"Cargando Catastral desde {csv_path}")
        df = pd.read_csv(csv_path)
        
        # Limpiar y normalizar
        df['rol'] = df['rol'].str.upper().str.strip()
        df['latitud'] = pd.to_numeric(df['latitud'], errors='coerce')
        df['longitud'] = pd.to_numeric(df['longitud'], errors='coerce')
        
        # Cargar a PostgreSQL
        df.to_sql('properties_sii', self.engine, if_exists='append', index=False)
        
        # Indexar en Elasticsearch
        for idx, row in df.iterrows():
            doc = row.to_dict()
            self.es.index(index='properties_sii', doc_type='_doc', body=doc)
        
        logger.info(f"Cargadas {len(df)} propiedades SII")
        
    def load_sit_rural(self, shapefile_path):
        """Cargar datos de SIT Rural"""
        logger.info(f"Cargando SIT Rural desde {shapefile_path}")
        gdf = gpd.read_file(shapefile_path)
        gdf['fuente'] = 'SIT_RURAL'
        
        gdf.to_postgis('properties_rural', self.engine, if_exists='append')
        logger.info(f"Cargadas {len(gdf)} propiedades rurales")
        
    def merge_all_sources(self):
        """Unificar todas las fuentes en tabla principal"""
        logger.info("Unificando fuentes de datos...")
        
        with self.engine.connect() as conn:
            # Merge IDE + SII por coordenadas
            merge_sql = """
            INSERT INTO properties (
                rol_sii, direccion, latitud, longitud, geom,
                destino, avaluo_fiscal, m2_construccion, m2_terreno,
                fuente_datos, fecha_actualizacion
            )
            SELECT 
                sii.rol,
                sii.direccion,
                sii.latitud,
                sii.longitud,
                ST_Point(sii.longitud, sii.latitud),
                sii.destino,
                sii.avaluo_fiscal,
                sii.m2_construccion,
                sii.m2_terreno,
                'IDE+SII',
                NOW()
            FROM properties_sii sii
            ON CONFLICT (rol_sii, fuente_datos) DO UPDATE SET
                fecha_actualizacion = NOW()
            """
            conn.execute(merge_sql)
            conn.commit()
            
        logger.info("Unificación completada")
        
    def run(self, config):
        """Ejecutar pipeline completo"""
        logger.info("Iniciando pipeline ETL")
        
        # Fase 1: Cargar geometría
        self.load_ide_chile(config['ide_shapefile'])
        
        # Fase 2: Cargar atributos SII
        for csv_file in config['catastral_csvs']:
            self.load_catastral_csv(csv_file)
        
        # Fase 3: Cargar propiedades rurales
        self.load_sit_rural(config['sit_rural_shapefile'])
        
        # Fase 4: Unificar
        self.merge_all_sources()
        
        logger.info("Pipeline ETL completado")

# Uso
if __name__ == '__main__':
    config = {
        'ide_shapefile': '/data/predios_ide.shp',
        'catastral_csvs': ['/data/catastral_santiago.csv', '/data/catastral_providencia.csv'],
        'sit_rural_shapefile': '/data/sit_rural_propiedades.shp'
    }
    
    etl = DatainmobiliariaETL(
        db_url='postgresql://user:pass@localhost/datainmobilaria',
        es_url='localhost:9200'
    )
    
    etl.run(config)
```

---

## 🔌 PARTE 2: API REST

### 2.1 Estructura de API (Node.js + Express)

```javascript
// server/api.js
const express = require('express');
const { Pool } = require('pg');
const { Client } = require('@elastic/elasticsearch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database connections
const pgPool = new Pool({
  host: 'localhost',
  user: 'gis',
  password: 'gis',
  database: 'datainmobilaria',
  port: 5432
});

const esClient = new Client({ node: 'http://localhost:9200' });

// API Endpoints

// 1. Búsqueda por dirección
app.get('/api/search/address', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    // Búsqueda en Elasticsearch
    const results = await esClient.search({
      index: 'properties_sii',
      body: {
        query: {
          multi_match: {
            query: q,
            fields: ['direccion', 'rol']
          }
        },
        size: limit
      }
    });
    
    res.json({
      total: results.hits.total.value,
      results: results.hits.hits.map(hit => hit._source)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Búsqueda por rol SII
app.get('/api/search/rol/:rol', async (req, res) => {
  try {
    const { rol } = req.params;
    
    const result = await pgPool.query(
      `SELECT p.*, st_asgeojson(p.geom) as geometry
       FROM properties p
       WHERE p.rol_sii = $1`,
      [rol.toUpperCase()]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Propiedad no encontrada' });
    }
    
    const property = result.rows[0];
    property.geometry = JSON.parse(property.geometry);
    
    res.json(property);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Búsqueda por folio CBRS
app.get('/api/search/folio/:folio', async (req, res) => {
  try {
    const { folio } = req.params;
    
    const result = await pgPool.query(
      `SELECT p.*, pa.*, st_asgeojson(p.geom) as geometry
       FROM properties p
       LEFT JOIN property_attributes pa ON p.id = pa.property_id
       WHERE p.folio_cbrs = $1`,
      [folio]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Propiedad no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Búsqueda espacial (radius)
app.get('/api/search/nearby', async (req, res) => {
  try {
    const { lat, lon, radius_km = 1 } = req.query;
    
    const result = await pgPool.query(
      `SELECT p.id, p.rol_sii, p.direccion, p.avaluo_fiscal,
              ST_Distance(p.geom, ST_Point($1, $2)::geography) as distance_m,
              st_asgeojson(p.geom) as geometry
       FROM properties p
       WHERE ST_DWithin(p.geom, ST_Point($1, $2)::geography, $3 * 1000)
       ORDER BY distance_m
       LIMIT 20`,
      [parseFloat(lon), parseFloat(lat), parseFloat(radius_km)]
    );
    
    res.json({
      total: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Obtener transacciones de propiedad
app.get('/api/property/:propertyId/transactions', async (req, res) => {
  try {
    const { propertyId } = req.params;
    
    const result = await pgPool.query(
      `SELECT pt.*
       FROM property_transactions pt
       WHERE pt.property_id = $1
       ORDER BY pt.fecha_transaccion DESC`,
      [propertyId]
    );
    
    res.json({
      total: result.rows.length,
      transactions: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Análisis territorial (agregado)
app.get('/api/analysis/zone/:zoneName', async (req, res) => {
  try {
    const { zoneName } = req.params;
    
    const result = await pgPool.query(
      `SELECT 
        COUNT(*) as total_properties,
        AVG(avaluo_fiscal) as avg_valuation,
        MIN(avaluo_fiscal) as min_valuation,
        MAX(avaluo_fiscal) as max_valuation,
        SUM(m2_terreno) as total_land_area,
        SUM(m2_construccion) as total_constructed_area,
        COUNT(DISTINCT propietario_rut) as unique_owners
       FROM properties
       WHERE zona = $1`,
      [zoneName]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. GeoJSON FeatureCollection para mapas
app.get('/api/geojson/zone/:zoneName', async (req, res) => {
  try {
    const { zoneName } = req.params;
    
    const result = await pgPool.query(
      `SELECT 
        jsonb_build_object(
          'type', 'FeatureCollection',
          'features', jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', jsonb_build_object(
                'id', id,
                'rol', rol_sii,
                'direccion', direccion,
                'avaluo', avaluo_fiscal
              )
            )
          )
        ) as geojson
       FROM properties
       WHERE zona = $1`,
      [zoneName]
    );
    
    res.json(result.rows[0].geojson);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Datainmobilaria API running on port ${PORT}`);
});

module.exports = app;
```

---

## 🎨 PARTE 3: FRONTEND (React + Leaflet)

### 3.1 Componente de Búsqueda y Mapa

```jsx
// frontend/components/PropertySearch.jsx
import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import './PropertySearch.css';

const PropertySearch = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';
  
  // Búsqueda por dirección
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/search/address`, {
        params: { q: searchQuery, limit: 20 }
      });
      setResults(response.data.results);
    } catch (error) {
      console.error('Error en búsqueda:', error);
      alert('Error en la búsqueda');
    } finally {
      setLoading(false);
    }
  };
  
  // Seleccionar propiedad
  const handleSelectProperty = async (property) => {
    setSelectedProperty(property);
    
    // Obtener detalles completos
    try {
      const response = await axios.get(
        `${API_BASE}/search/rol/${property.rol}`
      );
      setSelectedProperty(response.data);
      
      // Cargar transacciones
      const transResponse = await axios.get(
        `${API_BASE}/property/${response.data.id}/transactions`
      );
      response.data.transactions = transResponse.data.transactions;
    } catch (error) {
      console.error('Error obteniendo detalles:', error);
    }
  };
  
  return (
    <div className="property-search-container">
      <div className="search-panel">
        <h1>Datainmobilaria Chile</h1>
        
        {/* Formulario de búsqueda */}
        <form onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Buscar por dirección, rol SII o folio..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button type="submit" className="search-button">
            Buscar {loading && '...'}
          </button>
        </form>
        
        {/* Resultados */}
        <div className="results-list">
          {results.map((result, idx) => (
            <div
              key={idx}
              className="result-item"
              onClick={() => handleSelectProperty(result)}
            >
              <h4>{result.direccion}</h4>
              <p>Rol: {result.rol}</p>
              <p>Avalúo: ${result.avaluo_fiscal?.toLocaleString()}</p>
            </div>
          ))}
        </div>
        
        {/* Detalles de propiedad seleccionada */}
        {selectedProperty && (
          <div className="property-details">
            <h3>{selectedProperty.direccion}</h3>
            
            <div className="details-grid">
              <div className="detail-item">
                <label>Rol SII:</label>
                <span>{selectedProperty.rol_sii}</span>
              </div>
              
              <div className="detail-item">
                <label>Folio CBRS:</label>
                <span>{selectedProperty.folio_cbrs || 'No disponible'}</span>
              </div>
              
              <div className="detail-item">
                <label>Avalúo Fiscal:</label>
                <span>${selectedProperty.avaluo_fiscal?.toLocaleString()}</span>
              </div>
              
              <div className="detail-item">
                <label>M² Construcción:</label>
                <span>{selectedProperty.m2_construccion?.toLocaleString()}</span>
              </div>
              
              <div className="detail-item">
                <label>M² Terreno:</label>
                <span>{selectedProperty.m2_terreno?.toLocaleString()}</span>
              </div>
              
              <div className="detail-item">
                <label>Propietario:</label>
                <span>{selectedProperty.propietario_nombre || 'Información privada'}</span>
              </div>
            </div>
            
            {/* Historial de transacciones */}
            {selectedProperty.transactions && selectedProperty.transactions.length > 0 && (
              <div className="transactions-section">
                <h4>Historial de Transacciones</h4>
                <ul className="transactions-list">
                  {selectedProperty.transactions.map((tx, idx) => (
                    <li key={idx}>
                      <span className="tx-date">{tx.fecha_transaccion}</span>
                      <span className="tx-type">{tx.tipo_transaccion}</span>
                      <span className="tx-owner">{tx.propietario_nuevo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Mapa */}
      <div className="map-container">
        <MapContainer
          center={[-33.8688, -151.2093]}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
          
          {selectedProperty && selectedProperty.geometry && (
            <Marker
              position={[selectedProperty.geometry.coordinates[1], selectedProperty.geometry.coordinates[0]]}
            >
              <Popup>
                <div>
                  <h4>{selectedProperty.direccion}</h4>
                  <p>Rol: {selectedProperty.rol_sii}</p>
                  <p>Avalúo: ${selectedProperty.avaluo_fiscal?.toLocaleString()}</p>
                </div>
              </Popup>
            </Marker>
          )}
          
          {/* Mostrar resultados como puntos */}
          {results.map((result, idx) => (
            result.latitud && result.longitud && (
              <Marker
                key={idx}
                position={[result.latitud, result.longitud]}
                onClick={() => handleSelectProperty(result)}
              >
                <Popup>{result.direccion}</Popup>
              </Marker>
            )
          ))}
        </MapContainer>
      </div>
    </div>
  );
};

export default PropertySearch;
```

### 3.2 Estilos (CSS)

```css
/* frontend/components/PropertySearch.css */

.property-search-container {
  display: flex;
  height: 100vh;
  width: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}

.search-panel {
  width: 35%;
  background: white;
  overflow-y: auto;
  padding: 20px;
  border-right: 1px solid #ddd;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.search-panel h1 {
  color: #2c3e50;
  margin: 0 0 20px 0;
  font-size: 24px;
}

.search-input {
  width: 100%;
  padding: 12px;
  font-size: 14px;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  box-sizing: border-box;
  margin-bottom: 10px;
}

.search-button {
  width: 100%;
  padding: 12px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  font-weight: bold;
}

.search-button:hover {
  background: #2980b9;
}

.results-list {
  margin-top: 20px;
  max-height: 300px;
  overflow-y: auto;
}

.result-item {
  padding: 12px;
  border: 1px solid #ecf0f1;
  border-radius: 4px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.result-item:hover {
  background: #ecf0f1;
  border-color: #3498db;
}

.result-item h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 14px;
}

.result-item p {
  margin: 0;
  font-size: 12px;
  color: #7f8c8d;
}

.property-details {
  margin-top: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 4px;
  border-left: 4px solid #3498db;
}

.property-details h3 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 16px;
}

.details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 15px;
}

.detail-item {
  display: flex;
  flex-direction: column;
}

.detail-item label {
  font-size: 11px;
  color: #7f8c8d;
  font-weight: bold;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.detail-item span {
  font-size: 13px;
  color: #2c3e50;
  font-weight: 500;
}

.transactions-section {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #ddd;
}

.transactions-section h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #2c3e50;
}

.transactions-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.transactions-list li {
  padding: 8px 0;
  border-bottom: 1px solid #ecf0f1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  font-size: 12px;
}

.tx-date {
  color: #3498db;
  font-weight: bold;
}

.tx-type {
  color: #7f8c8d;
}

.tx-owner {
  color: #2c3e50;
}

.map-container {
  flex: 1;
  background: #ecf0f1;
}

@media (max-width: 1024px) {
  .property-search-container {
    flex-direction: column;
  }
  
  .search-panel {
    width: 100%;
    height: 40%;
    border-right: none;
    border-bottom: 1px solid #ddd;
  }
  
  .map-container {
    height: 60%;
  }
}
```

---

## 📊 PARTE 4: MONITOREO Y ANÁLISIS

### 4.1 Dashboard de Métricas

```python
# server/analytics/metrics.py
from datetime import datetime, timedelta
from sqlalchemy import func
from models import Properties, SearchAnalytics, PropertyTransactions

class MetricsCalculator:
    def __init__(self, db_session):
        self.session = db_session
    
    def get_dashboard_metrics(self):
        """Obtener métricas de dashboard"""
        
        # Propiedades totales
        total_properties = self.session.query(func.count(Properties.id)).scalar()
        
        # Propiedades por tipo (destino)
        by_type = self.session.query(
            Properties.destino,
            func.count(Properties.id).label('count')
        ).group_by(Properties.destino).all()
        
        # Valuación promedio
        avg_valuation = self.session.query(
            func.avg(Properties.avaluo_fiscal)
        ).scalar()
        
        # Búsquedas más frecuentes (últimas 24h)
        today = datetime.now() - timedelta(days=1)
        top_searches = self.session.query(
            SearchAnalytics.query,
            func.count(SearchAnalytics.id).label('count')
        ).filter(
            SearchAnalytics.fecha_busqueda >= today
        ).group_by(
            SearchAnalytics.query
        ).order_by(
            func.count(SearchAnalytics.id).desc()
        ).limit(10).all()
        
        # Transacciones recientes
        recent_transactions = self.session.query(
            PropertyTransactions.fecha_transaccion,
            func.count(PropertyTransactions.id).label('count')
        ).filter(
            PropertyTransactions.fecha_transaccion >= today
        ).group_by(
            PropertyTransactions.fecha_transaccion
        ).order_by(
            PropertyTransactions.fecha_transaccion.desc()
        ).all()
        
        return {
            'total_properties': total_properties,
            'by_type': [{'type': t[0], 'count': t[1]} for t in by_type],
            'avg_valuation': float(avg_valuation) if avg_valuation else 0,
            'top_searches': [{'query': t[0], 'count': t[1]} for t in top_searches],
            'recent_transactions': [{'date': t[0], 'count': t[1]} for t in recent_transactions],
            'timestamp': datetime.now()
        }
```

---

## 🚀 PARTE 5: DEPLOYMENT

### 5.1 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  # PostgreSQL + PostGIS
  postgres:
    image: postgis/postgis:15-3.3
    environment:
      POSTGRES_DB: datainmobilaria
      POSTGRES_USER: gis
      POSTGRES_PASSWORD: gis
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/01-init.sql
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gis"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Elasticsearch
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.8.0
    environment:
      - discovery.type=single-node
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
      - xpack.security.enabled=false
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"
    healthcheck:
      test: curl -s http://localhost:9200 >/dev/null || exit 1
      interval: 30s
      timeout: 10s
      retries: 5

  # Backend API
  api:
    build:
      context: ./server
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgresql://gis:gis@postgres:5432/datainmobilaria
      ELASTICSEARCH_URL: http://elasticsearch:9200
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      elasticsearch:
        condition: service_healthy
    volumes:
      - ./server:/app
    command: npm start

  # Frontend
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    environment:
      REACT_APP_API_URL: http://localhost:3000/api
    ports:
      - "3001:3000"
    depends_on:
      - api
    volumes:
      - ./frontend:/app

  # Nginx (reverse proxy)
  nginx:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - api
      - frontend

volumes:
  postgres_data:
  elasticsearch_data:
```

### 5.2 GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy Datainmobilaria

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgis/postgis:15-3.3
        env:
          POSTGRES_DB: test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      elasticsearch:
        image: docker.elastic.co/elasticsearch/elasticsearch:8.8.0
        env:
          discovery.type: single-node
          xpack.security.enabled: false
        options: >-
          --health-cmd "curl localhost:9200"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 9200:9200
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: |
          cd server && npm ci
          cd ../frontend && npm ci
      
      - name: Run backend tests
        run: cd server && npm test
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/test
      
      - name: Run frontend tests
        run: cd frontend && npm test -- --coverage --watchAll=false
      
      - name: Build Docker images
        run: docker-compose build
      
      - name: Deploy to production
        if: github.ref == 'refs/heads/main'
        run: |
          docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

### Fase 1: Prototipo (Semanas 1-4)
- [ ] Configurar PostgreSQL + PostGIS
- [ ] Descargar datos IDE Chile
- [ ] Crear esquema de BD
- [ ] Cargar geometría
- [ ] Setup Elasticsearch
- [ ] API básica (búsqueda por rol)
- [ ] Validar 9.4M registros

### Fase 2: MVP (Semanas 5-12)
- [ ] Descargar Catastral.csv
- [ ] Integrar datos SII
- [ ] Frontend con mapa Leaflet
- [ ] Búsqueda por dirección
- [ ] CBRS integración (búsqueda)
- [ ] Deploy inicial
- [ ] Testing y QA

### Fase 3: Extensiones (Semanas 13-24)
- [ ] SIT Rural integración
- [ ] Archivo Nacional (histórico)
- [ ] Dashboard de análisis
- [ ] ML valuación
- [ ] APIs públicas documentadas
- [ ] Open source release

---

## 📖 REFERENCIAS TÉCNICAS

**Librerías principales:**
- PostGIS: https://postgis.net/documentation/
- Elasticsearch: https://www.elastic.co/guide/en/elasticsearch/reference/
- Leaflet: https://leafletjs.com/reference/
- Express.js: https://expressjs.com/
- React: https://react.dev/

**Estándares:**
- OGC Web Services (WMS/WFS): https://www.ogc.org/
- GeoJSON: https://geojson.org/
- Shapefile spec: https://www.esri.com/content/dam/esrisites/sitecore/Home/Microsites/gis-dictionary/gis-dictionary.pdf

---

**Documento:** Guía Técnica de Integración  
**Versión:** 1.0  
**Estado:** Listo para implementación  
**Última actualización:** Junio 2026
