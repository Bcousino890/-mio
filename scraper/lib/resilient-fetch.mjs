// ─────────────────────────────────────────────────────────────────────────────
// Resiliencia de red compartida (plan Anuncios CL · H16): reintentos con
// backoff exponencial + circuit-breaker por dominio, agnóstico de qué función
// de fetch envuelve (fetchHtml de fetch.mjs, curlJson de ml-api-client.mjs, o
// cualquier otra que devuelva { ok, ... }).
//
// Por qué un módulo aparte y no code metido en fetch.mjs directamente: H1
// (discovery) prefiere la API de Mercado Libre (ml-api-client.mjs) y solo cae
// a HTML (fetch.mjs) si la API falla — ambos caminos necesitan la MISMA
// protección (un dominio que empieza a bloquear no debe seguir recibiendo
// reintentos a ciegas), así que la lógica vive una sola vez aquí y ambos
// clientes la envuelven, en vez de duplicarla o forzar que uno dependa del
// otro.
//
// España (scrape-zone.mjs) ya tiene SU PROPIO fetchWithRetry con backoff
// local — deliberadamente NO se toca ni se migra en este cambio (funciona en
// producción; migrarlo es un refactor aparte, fuera de alcance de H16).
//
// Circuit breaker: por dominio (hostname de la URL), en memoria del proceso
// — coherente con que worker-cl.mjs (H2) es un proceso Node persistente, no
// serverless. Cuenta OUTCOMES DE LLAMADA COMPLETA (tras agotar sus reintentos
// internos), no cada intento individual: la idea es "¿las últimas N llamadas
// lógicas a este dominio fallaron todas?", no penalizar doble por reintentar.
// ─────────────────────────────────────────────────────────────────────────────

export const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

const DEFAULTS = {
  retries: 4,
  baseBackoffMs: 2000,      // 2s, 4s, 8s, 16s...
  failureThreshold: 5,      // llamadas consecutivas fallidas para abrir el circuito
  cooldownMs: 60_000,       // tiempo con el circuito abierto antes de permitir un trial
  maxCooldownMs: 10 * 60_000, // tope si el circuito se reabre varias veces seguidas
}

// Estado por dominio: { failures, openUntil, cooldownMs (el actual, crece si reabre) }
const circuits = new Map()

function domainOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

function getCircuit(domain) {
  let c = circuits.get(domain)
  if (!c) {
    c = { failures: 0, openUntil: null, cooldownMs: DEFAULTS.cooldownMs }
    circuits.set(domain, c)
  }
  return c
}

/**
 * ¿Se permite intentar una llamada a este dominio ahora mismo?
 * @returns {{ allowed: boolean, retryAfterMs?: number }}
 */
function checkCircuit(domain) {
  const c = getCircuit(domain)
  if (c.openUntil == null) return { allowed: true }
  const now = Date.now()
  if (now >= c.openUntil) {
    // Cooldown cumplido: se permite UNA llamada de prueba (half-open). No se
    // cierra el circuito todavía — eso lo decide el resultado de esta llamada
    // (recordSuccess/recordFailure más abajo).
    return { allowed: true }
  }
  return { allowed: false, retryAfterMs: c.openUntil - now }
}

function recordSuccess(domain) {
  const c = getCircuit(domain)
  c.failures = 0
  c.openUntil = null
  c.cooldownMs = DEFAULTS.cooldownMs // el próximo cooldown vuelve al base si vuelve a fallar
}

function recordFailure(domain, { failureThreshold, cooldownMs } = {}) {
  const c = getCircuit(domain)
  const threshold = failureThreshold ?? DEFAULTS.failureThreshold
  c.failures += 1

  const wasOpen = c.openUntil != null && Date.now() < c.openUntil
  const wasHalfOpenTrial = c.openUntil != null && !wasOpen // cooldown ya había pasado, esta llamada era el trial

  if (wasHalfOpenTrial) {
    // El trial post-cooldown también falló: reabrir con cooldown creciente
    // (backoff del propio circuito), acotado a maxCooldownMs.
    c.cooldownMs = Math.min(c.cooldownMs * 2, DEFAULTS.maxCooldownMs)
    c.openUntil = Date.now() + c.cooldownMs
  } else if (!wasOpen && c.failures >= threshold) {
    // Cruza el umbral por primera vez: abre el circuito.
    c.cooldownMs = cooldownMs ?? DEFAULTS.cooldownMs
    c.openUntil = Date.now() + c.cooldownMs
  }
}

/**
 * Introspección (usado por tests y potencialmente por un panel de salud
 * futuro, H17) — nunca lanza, siempre devuelve un objeto plano.
 */
export function getCircuitState(domain) {
  const c = circuits.get(domain)
  if (!c) return { domain, status: 'closed', failures: 0 }
  const now = Date.now()
  const status = c.openUntil == null ? 'closed' : (now < c.openUntil ? 'open' : 'half-open')
  return { domain, status, failures: c.failures, openUntil: c.openUntil }
}

/** Solo para tests: vuelve todos los circuitos a su estado inicial. */
export function _resetAllCircuits() {
  circuits.clear()
}

/**
 * Envuelve cualquier función de fetch con forma `(url, opts) => Promise<{ok,...}>`
 * en reintentos con backoff exponencial + circuit-breaker por dominio.
 *
 * @param {(url: string, opts?: object) => Promise<{ok: boolean, [k: string]: any}>} fetchImpl
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.retries]
 * @param {number} [options.baseBackoffMs]
 * @param {number} [options.failureThreshold]
 * @param {number} [options.cooldownMs]
 * @param {object} [options.fetchOpts] - se pasan tal cual a fetchImpl
 * @returns {Promise<{ok: boolean, [k: string]: any}>}
 */
export async function withResilience(fetchImpl, url, options = {}) {
  const {
    retries = DEFAULTS.retries,
    baseBackoffMs = DEFAULTS.baseBackoffMs,
    failureThreshold = DEFAULTS.failureThreshold,
    cooldownMs = DEFAULTS.cooldownMs,
    fetchOpts = {},
  } = options

  const domain = domainOf(url)
  const gate = checkCircuit(domain)
  if (!gate.allowed) {
    return {
      ok: false,
      status: 0,
      reason: `circuit_open:${domain} (reintentar en ${Math.ceil(gate.retryAfterMs / 1000)}s)`,
    }
  }

  let lastResult = { ok: false, status: 0, reason: 'sin intentos' }
  for (let attempt = 1; attempt <= retries; attempt++) {
    lastResult = await fetchImpl(url, fetchOpts)
    if (lastResult.ok) break
    if (attempt < retries) await SLEEP(baseBackoffMs * 2 ** (attempt - 1))
  }

  if (lastResult.ok) recordSuccess(domain)
  else recordFailure(domain, { failureThreshold, cooldownMs })

  return lastResult
}
