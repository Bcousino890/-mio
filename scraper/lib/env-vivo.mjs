// ─────────────────────────────────────────────────────────────────────────────
// Lectura EN CALIENTE del `.env` del VPS.
//
// El problema que resuelve: las credenciales de proxy se guardan desde la UI del
// CRM (Configuración → "Configuración de Proxy (Evomi CL)"), que reescribe el
// `.env` del VPS y actualiza su propio `process.env` en el acto. Pero el worker
// 24/7 es OTRO contenedor: docker-compose le pasa el `.env` con `env_file`, que
// se resuelve UNA sola vez, al crear el contenedor. Resultado: guardar unas
// credenciales nuevas en la UI decía "Guardadas y activas" y el worker seguía
// usando indefinidamente las viejas — el barrido no se recuperaba aunque el
// usuario corrigiera el proxy, hasta el siguiente deploy que recreara el
// contenedor.
//
// Con este módulo, las variables sensibles a cambios en caliente (las del proxy)
// se leen del archivo montado en cada uso, con caché por mtime para no tocar
// disco en cada petición. Si el archivo no existe (desarrollo local, tests) se
// cae a `process.env` y todo se comporta como antes.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ENV_PATH = process.env.ENV_FILE_PATH || join(process.cwd(), '.env')

let cache = { mtimeMs: null, values: null }

/** Parseo mínimo de un .env: `CLAVE=valor` por línea. */
function parseEnv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i <= 0) continue
    const key = s.slice(0, i).trim()
    let value = s.slice(i + 1).trim()
    // Solo se quitan comillas si envuelven TODO el valor. Nada de recortar por
    // un '#': una contraseña puede contenerlo perfectamente.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** Contenido actual del .env montado, releído solo si cambió su mtime. */
function leerEnvArchivo() {
  try {
    const { mtimeMs } = statSync(ENV_PATH)
    if (cache.mtimeMs === mtimeMs && cache.values) return cache.values
    const values = parseEnv(readFileSync(ENV_PATH, 'utf8'))
    cache = { mtimeMs, values }
    return values
  } catch {
    // Sin archivo (dev/tests) o sin permisos: se trabaja solo con process.env.
    return null
  }
}

/**
 * Valor de una variable, priorizando el `.env` del disco (que la UI reescribe en
 * caliente) sobre el `process.env` congelado al arrancar el contenedor.
 * Devuelve `undefined` si no está en ninguno de los dos.
 */
export function envVivo(key) {
  const archivo = leerEnvArchivo()
  const v = archivo?.[key]
  if (v != null && v !== '') return v
  const p = process.env[key]
  return p != null && p !== '' ? p : undefined
}

/** Varias de golpe, con la misma precedencia. */
export function envVivoVarias(...keys) {
  const out = {}
  for (const k of keys) out[k] = envVivo(k)
  return out
}

/** Solo para tests: olvida el contenido cacheado del .env. */
export function _resetEnvVivoCache() {
  cache = { mtimeMs: null, values: null }
}
