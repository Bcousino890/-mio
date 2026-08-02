import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// El .env de prueba se fija ANTES de importar el módulo: la ruta se resuelve una
// sola vez, al cargarlo (igual que en el worker, donde es el .env montado).
const dir = mkdtempSync(join(tmpdir(), 'env-vivo-'))
const ENV_PATH = join(dir, '.env')
process.env.ENV_FILE_PATH = ENV_PATH

const { envVivo, _resetEnvVivoCache } = await import('./env-vivo.mjs')

function escribirEnv(texto) {
  writeFileSync(ENV_PATH, texto, 'utf8')
  _resetEnvVivoCache() // el caché es por mtime y dos escrituras seguidas pueden compartirlo
}

test('lee el valor del .env del disco', () => {
  escribirEnv('EVOMI_PROXY_USER=portales3\nEVOMI_PROXY_PASS=secreto\n')
  assert.equal(envVivo('EVOMI_PROXY_USER'), 'portales3')
  assert.equal(envVivo('EVOMI_PROXY_PASS'), 'secreto')
})

test('el .env manda sobre el process.env congelado al arrancar el contenedor', () => {
  // Este ES el fallo que se arregla: docker-compose resuelve `env_file` UNA vez,
  // al crear el contenedor, así que el worker se quedaba con las credenciales
  // viejas para siempre aunque la UI hubiera guardado unas nuevas.
  process.env.EVOMI_PROXY_USER = 'credencial-vieja'
  escribirEnv('EVOMI_PROXY_USER=credencial-nueva\n')
  assert.equal(envVivo('EVOMI_PROXY_USER'), 'credencial-nueva')
})

test('cae a process.env si la variable no está en el .env', () => {
  process.env.SOLO_EN_ENTORNO = 'valor'
  escribirEnv('OTRA=cosa\n')
  assert.equal(envVivo('SOLO_EN_ENTORNO'), 'valor')
})

test('un valor vacío en el .env no tapa el de process.env', () => {
  process.env.CON_VACIO = 'del-entorno'
  escribirEnv('CON_VACIO=\n')
  assert.equal(envVivo('CON_VACIO'), 'del-entorno')
})

test('ignora comentarios y respeta un # dentro de una contraseña', () => {
  escribirEnv('# comentario\nEVOMI_PROXY_PASS=abc#123\n')
  assert.equal(envVivo('EVOMI_PROXY_PASS'), 'abc#123')
})

test('quita las comillas que envuelven todo el valor', () => {
  escribirEnv('EVOMI_PROXY_HOST="core-residential.evomi.com"\n')
  assert.equal(envVivo('EVOMI_PROXY_HOST'), 'core-residential.evomi.com')
})

test('relee el archivo cuando cambia (no se queda con el primer valor cacheado)', () => {
  escribirEnv('EVOMI_PROXY_PORT=1000\n')
  assert.equal(envVivo('EVOMI_PROXY_PORT'), '1000')
  escribirEnv('EVOMI_PROXY_PORT=2000\n')
  assert.equal(envVivo('EVOMI_PROXY_PORT'), '2000')
})

test('sin archivo funciona igual, solo con process.env', async () => {
  process.env.ENV_FILE_PATH = join(dir, 'no-existe.env')
  const mod = await import(`./env-vivo.mjs?sin-archivo=${Date.now()}`)
  process.env.SOLO_ENTORNO_2 = 'ok'
  assert.equal(mod.envVivo('SOLO_ENTORNO_2'), 'ok')
  assert.equal(mod.envVivo('NO_EXISTE_EN_NINGUN_LADO'), undefined)
  process.env.ENV_FILE_PATH = ENV_PATH
})
