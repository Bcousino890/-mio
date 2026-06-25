#!/usr/bin/env node

/**
 * load-prc-zonas.mjs
 *
 * Cargar zonificación (PRC) de comunas chilenas desde:
 * 1. ArcGIS services (si existen públicos)
 * 2. MINVU WFS Limites_Urbanos
 * 3. Data manual/hardcoded
 *
 * Uso:
 *   node scraper/load-prc-zonas.mjs --comuna vitacura
 *   node scraper/load-prc-zonas.mjs --all
 *   node scraper/load-prc-zonas.mjs --comuna colina --source manual
 */

import pg from 'pg'
import { queryArcGISByPoint, queryArcGISByBbox } from './lib/arcgis-query.mjs'
import { program } from 'commander'

const { Client } = pg

// ─── Configuración de comunas target ─────────────────────────────────────────
const COMUNAS_TARGET = {
  vitacura: {
    sii_code: '13132',
    nombre: 'Vitacura',
    arcgis_service: 'https://services9.arcgis.com/kKJR3Qt68ohAWuet/arcgis/rest/services/PRC_Vitacura/FeatureServer/0',
    zonas: [
      {
        zona_nombre: 'Zona 1 - Residencial Unifamiliar',
        zona_codigo: 'R1',
        descripcion: 'Zona residencial unifamiliar',
        altura_maxima_m: 12,
        numero_pisos_maximo: 3,
        densidad_viviendas_ha: 100,
        fos_maximo: 0.4,
        far_maximo: 0.8,
        usos_permitidos: ['H', 'D', 'Q'],
        usos_prohibidos: ['I', 'M', 'T']
      },
      {
        zona_nombre: 'Zona 2 - Condominios Cerrados',
        zona_codigo: 'C2',
        descripcion: 'Zona de condominios y conjuntos',
        altura_maxima_m: 45,
        numero_pisos_maximo: 12,
        densidad_viviendas_ha: 350,
        fos_maximo: 0.65,
        far_maximo: 2.1,
        usos_permitidos: ['H', 'C', 'D', 'O'],
        usos_prohibidos: ['I', 'M', 'A']
      },
      {
        zona_nombre: 'Zona 3 - Mixta',
        zona_codigo: 'M3',
        descripcion: 'Zona mixta residencial-comercial',
        altura_maxima_m: 65,
        numero_pisos_maximo: 18,
        densidad_viviendas_ha: 500,
        fos_maximo: 0.8,
        far_maximo: 3.0,
        usos_permitidos: ['H', 'C', 'O', 'E', 'S'],
        usos_prohibidos: ['I', 'M']
      }
    ]
  },

  lascondes: {
    sii_code: '13114',
    nombre: 'Las Condes',
    arcgis_service: null,  // TODO: buscar si existe
    zonas: [
      {
        zona_nombre: 'Zona Residencial Unifamiliar',
        zona_codigo: 'R1',
        descripcion: 'Residencial de baja densidad',
        altura_maxima_m: 12,
        numero_pisos_maximo: 3,
        densidad_viviendas_ha: 120,
        fos_maximo: 0.4,
        far_maximo: 0.8,
        usos_permitidos: ['H', 'D'],
        usos_prohibidos: ['I', 'M']
      },
      {
        zona_nombre: 'Zona Comercial',
        zona_codigo: 'C1',
        descripcion: 'Comercio y negocios',
        altura_maxima_m: 45,
        numero_pisos_maximo: 12,
        densidad_viviendas_ha: 300,
        fos_maximo: 0.7,
        far_maximo: 2.5,
        usos_permitidos: ['C', 'O', 'H'],
        usos_prohibidos: ['I', 'M']
      }
    ]
  },

  lobarnechea: {
    sii_code: '13115',
    nombre: 'Lo Barnechea',
    arcgis_service: null,
    zonas: [
      {
        zona_nombre: 'Zona Residencial Rural',
        zona_codigo: 'R-R1',
        descripcion: 'Residencial disperso',
        altura_maxima_m: 8,
        numero_pisos_maximo: 2,
        densidad_viviendas_ha: 30,
        fos_maximo: 0.25,
        far_maximo: 0.4,
        usos_permitidos: ['H', 'A', 'F'],
        usos_prohibidos: ['I', 'M', 'C']
      },
      {
        zona_nombre: 'Zona Urbana Extensiva',
        zona_codigo: 'U1',
        descripcion: 'Residencial de media densidad',
        altura_maxima_m: 20,
        numero_pisos_maximo: 5,
        densidad_viviendas_ha: 200,
        fos_maximo: 0.5,
        far_maximo: 1.2,
        usos_permitidos: ['H', 'C', 'D'],
        usos_prohibidos: ['I', 'M']
      }
    ]
  },

  colina: {
    sii_code: '13301',
    nombre: 'Colina',
    arcgis_service: null,
    zonas: [
      {
        zona_nombre: 'Zona Urbana Central',
        zona_codigo: 'U1',
        descripcion: 'Centro urbano de Colina',
        altura_maxima_m: 35,
        numero_pisos_maximo: 8,
        densidad_viviendas_ha: 250,
        fos_maximo: 0.6,
        far_maximo: 1.8,
        usos_permitidos: ['H', 'C', 'O'],
        usos_prohibidos: ['I', 'M']
      },
      {
        zona_nombre: 'Zona Industrial',
        zona_codigo: 'I1',
        descripcion: 'Zona industrial y manufactura',
        altura_maxima_m: 25,
        numero_pisos_maximo: 6,
        densidad_viviendas_ha: 100,
        fos_maximo: 0.8,
        far_maximo: 2.0,
        usos_permitidos: ['I', 'L', 'T'],
        usos_prohibidos: ['H', 'E']
      }
    ]
  },

  providencia: {
    sii_code: '13123',
    nombre: 'Providencia',
    arcgis_service: null,
    zonas: [
      {
        zona_nombre: 'Zona Residencial Intensiva',
        zona_codigo: 'R1',
        descripcion: 'Apartamentos y alta densidad',
        altura_maxima_m: 55,
        numero_pisos_maximo: 15,
        densidad_viviendas_ha: 600,
        fos_maximo: 0.7,
        far_maximo: 3.5,
        usos_permitidos: ['H', 'C', 'O', 'S'],
        usos_prohibidos: ['I', 'M']
      },
      {
        zona_nombre: 'Zona Comercial Intensiva',
        zona_codigo: 'C1',
        descripcion: 'Comercio de altura',
        altura_maxima_m: 60,
        numero_pisos_maximo: 16,
        densidad_viviendas_ha: 400,
        fos_maximo: 0.8,
        far_maximo: 4.0,
        usos_permitidos: ['C', 'O', 'H', 'E'],
        usos_prohibidos: ['I', 'M']
      }
    ]
  }
}

// ─── Función: Insertar zonas en BD ───────────────────────────────────────────
async function insertPRCZonas(client, comunaKey, dataZonas) {
  const comunaConfig = COMUNAS_TARGET[comunaKey]
  if (!comunaConfig) {
    console.error(`❌ Comuna desconocida: ${comunaKey}`)
    return
  }

  const siiCode = comunaConfig.sii_code
  const zonas = dataZonas || comunaConfig.zonas

  console.log(`\n📍 Insertando ${zonas.length} zonas para ${comunaConfig.nombre} (${siiCode})`)

  let insertedCount = 0
  for (const zona of zonas) {
    try {
      const result = await client.query(
        `INSERT INTO prc_zonas (
          sii_comuna_code,
          zona_nombre,
          zona_codigo,
          descripcion,
          altura_maxima_m,
          numero_pisos_maximo,
          densidad_viviendas_ha,
          fos_maximo,
          far_maximo,
          usos_permitidos,
          usos_prohibidos,
          source,
          source_url,
          confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (sii_comuna_code, zona_nombre) DO UPDATE
        SET
          altura_maxima_m = $5,
          densidad_viviendas_ha = $7,
          updated_at = now()
        RETURNING id;`,
        [
          siiCode,
          zona.zona_nombre,
          zona.zona_codigo,
          zona.descripcion,
          zona.altura_maxima_m,
          zona.numero_pisos_maximo,
          zona.densidad_viviendas_ha,
          zona.fos_maximo,
          zona.far_maximo,
          zona.usos_permitidos,
          zona.usos_prohibidos,
          'manual',  // source
          null,      // source_url
          'medium'   // confidence
        ]
      )

      console.log(`  ✅ ${zona.zona_nombre}`)
      insertedCount++
    } catch (err) {
      console.error(`  ❌ Error inserting ${zona.zona_nombre}:`, err.message)
    }
  }

  console.log(`\n✨ Insertadas ${insertedCount}/${zonas.length} zonas`)
  return insertedCount
}

// ─── Función: Poblar sii_roles_cl con zona asignada ─────────────────────────
async function populateSiiRolesWithZonas(client, siiCode) {
  console.log(`\n🔄 Asignando zonas a roles de ${siiCode}...`)

  try {
    const result = await client.query(
      `SELECT populate_prc_zonas_for_comuna($1);`,
      [siiCode]
    )

    const rowsAffected = result.rowCount || 0
    console.log(`✅ Actualizados ${rowsAffected} roles con zonas`)
    return rowsAffected
  } catch (err) {
    console.error(`❌ Error populating roles:`, err.message)
    return 0
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const options = program
    .option('--comuna <name>', 'Comuna específica (vitacura, lascondes, etc.)')
    .option('--all', 'Cargar todas las comunas')
    .option('--populate', 'Después de insertar, popular roles SII con zonas')
    .parse(process.argv).opts()

  const client = new Client({
    connectionString: process.env.DATABASE_URL
  })

  await client.connect()

  try {
    if (options.all) {
      console.log(`\n🚀 Cargando TODAS las comunas targets...`)
      let totalInserted = 0

      for (const [key, config] of Object.entries(COMUNAS_TARGET)) {
        const inserted = await insertPRCZonas(client, key, null)
        totalInserted += inserted

        if (options.populate) {
          await populateSiiRolesWithZonas(client, config.sii_code)
        }
      }

      console.log(`\n🎉 Total insertadas: ${totalInserted} zonas`)
    } else if (options.comuna) {
      const comunaKey = options.comuna.toLowerCase()
      await insertPRCZonas(client, comunaKey, null)

      if (options.populate) {
        const config = COMUNAS_TARGET[comunaKey]
        if (config) {
          await populateSiiRolesWithZonas(client, config.sii_code)
        }
      }
    } else {
      console.log(`
Uso:
  node scraper/load-prc-zonas.mjs --all                      # Cargar todas
  node scraper/load-prc-zonas.mjs --comuna vitacura          # Una comuna
  node scraper/load-prc-zonas.mjs --all --populate           # + actualizar roles

Comunas disponibles:
${Object.keys(COMUNAS_TARGET).map(k => `  - ${k}`).join('\n')}
      `)
    }
  } finally {
    await client.end()
  }
}

main().catch(console.error)
