// ─────────────────────────────────────────────────────────────────────────────
// Cliente de la API pública v1 de SmartBC (CRM de Benjamín Cousiño Propiedades).
//
// Solo transporte: autenticación, reintentos, idempotencia, dry-run y respeto
// del rate limit. No sabe nada de captaciones_cl — el mapeo vive en
// smartbc-mapper.mjs y la orquestación en smartbc-sync-cl.mjs.
//
// Qué se reintenta y qué no (regla dura del contrato de SmartBC):
//   · 429 / 500 / 503 y los fallos de red → SÍ, con espera exponencial.
//   · 400 / 401 / 403 / 404 / 409 / 413   → NO. Son errores NUESTROS (payload
//     inválido, clave revocada, Idempotency-Key reutilizada con otro cuerpo…) y
//     reintentarlos no los arregla: solo gasta cuota y retrasa el diagnóstico.
//
// El 429 respeta `Retry-After` cuando viene, en vez de aplicar el backoff a
// ciegas: si el servidor dice cuántos segundos faltan para su ventana, esperar
// menos garantiza otro 429 y esperar más regala throughput.
//
// `fetchImpl` y `sleep` son inyectables (mismo patrón que resilient-fetch.mjs)
// para poder testear reintentos, backoff e idempotencia sin red ni esperas
// reales — ver smartbc-client.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  baseUrl: 'https://portal.bcousinoprop.com',
  retries: 4,              // intentos adicionales tras el primero
  baseBackoffMs: 2000,     // 2s, 4s, 8s, 16s
  maxBackoffMs: 60_000,
  timeoutMs: 30_000,
  // Tope propio, por debajo del límite declarado por la API (120/min). El
  // margen deja hueco a las llamadas manuales (ping, catálogos) que un operador
  // pueda lanzar con la misma clave mientras corre una sincronización.
  requestsPerMinute: 100,
}

/** Errores que NO se reintentan nunca: el problema está en la petición. */
const NON_RETRYABLE_HTTP = new Set([400, 401, 403, 404, 409, 413, 422])

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms))

export class SmartbcError extends Error {
  constructor(message, { status, code, details, requestId, retryable = false } = {}) {
    super(message)
    this.name = 'SmartbcError'
    this.status = status ?? null
    this.code = code ?? null
    this.details = details ?? null
    this.requestId = requestId ?? null
    this.retryable = retryable
  }
}

/**
 * Lee `Retry-After` (segundos o fecha HTTP, ambos permitidos por el RFC).
 * Devuelve ms, o null si la cabecera no viene o no se entiende.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

/** Espera del intento `attempt` (0-based): 2s, 4s, 8s, 16s… con tope. */
export function backoffMs(attempt, { baseBackoffMs, maxBackoffMs } = DEFAULTS) {
  return Math.min(baseBackoffMs * 2 ** attempt, maxBackoffMs)
}

export class SmartbcClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey    clave sbc_live_… (NUNCA hardcodeada: variable de entorno)
   * @param {string} [opts.baseUrl]
   * @param {boolean} [opts.dryRun] añade X-SmartBC-Dry-Run: 1 a toda escritura
   * @param {Function} [opts.fetchImpl] inyectable para tests
   * @param {Function} [opts.sleep]     inyectable para tests
   * @param {Function} [opts.onRequest] callback de observabilidad por llamada
   */
  constructor({ apiKey, baseUrl, dryRun = false, fetchImpl, sleep, now, onRequest, ...rest } = {}) {
    if (!apiKey) throw new Error('SmartbcClient: falta apiKey (SMARTBC_API_KEY)')
    this.apiKey = apiKey
    this.baseUrl = (baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, '')
    this.dryRun = dryRun
    this.opts = { ...DEFAULTS, ...rest }
    this.fetchImpl = fetchImpl ?? globalThis.fetch
    this.sleep = sleep ?? sleepReal
    // Reloj inyectable junto a `sleep`: el pacing compara marcas de tiempo, así
    // que un test con sleep simulado necesita poder avanzar también el reloj —
    // si no, la ventana nunca se vacía y el bucle gira contra el tiempo real.
    this.now = now ?? (() => Date.now())
    this.onRequest = onRequest ?? null
    // Marcas de tiempo de las peticiones del último minuto, para el pacing
    // proactivo: es mejor esperar 1s de más que comerse un 429 y su Retry-After.
    this._recent = []
    this.rateLimit = { limit: null, remaining: null, reset: null }
  }

  /** Espera a tener hueco en nuestra propia ventana de peticiones/minuto. */
  async _pace() {
    const windowMs = 60_000
    // Tope de vueltas: con `sleep` real una basta, pero si el reloj inyectado no
    // avanza (test mal montado) esto falla rápido en vez de girar en vacío.
    for (let vuelta = 0; vuelta < 10; vuelta++) {
      const now = this.now()
      this._recent = this._recent.filter((t) => now - t < windowMs)
      if (this._recent.length < this.opts.requestsPerMinute) {
        this._recent.push(now)
        return
      }
      await this.sleep(windowMs - (now - this._recent[0]) + 50)
    }
    throw new Error('SmartbcClient: el pacing no consigue hueco (¿el reloj no avanza?)')
  }

  /**
   * Petición con reintentos. Devuelve `{ data, meta, requestId, status,
   * idempotentReplay, rateLimit }`. Lanza SmartbcError si agota reintentos o si
   * el error no es reintentable.
   */
  async request(method, path, { body, idempotencyKey, dryRun, query, headers = {} } = {}) {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v != null) url.searchParams.set(k, String(v))
    }

    const isWrite = method !== 'GET'
    const effectiveDryRun = dryRun ?? this.dryRun
    const finalHeaders = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      // La Idempotency-Key va en TODA escritura automática: un timeout de red
      // no puede acabar creando la captación dos veces.
      ...(isWrite && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(isWrite && effectiveDryRun ? { 'X-SmartBC-Dry-Run': '1' } : {}),
      ...headers,
    }
    const payload = body != null ? JSON.stringify(body) : undefined

    let lastError = null
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      await this._pace()
      const startedAt = Date.now()
      let res = null
      let parsed = null
      let networkError = null

      try {
        res = await this.fetchImpl(url.toString(), {
          method,
          headers: finalHeaders,
          body: payload,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        })
        const text = await res.text()
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          // Un cuerpo no-JSON en un 5xx suele ser el HTML de un balanceador
          // durante un despliegue: se trata como error reintentable, no como
          // un fallo de parseo que aborte la corrida.
          parsed = { error: { code: 'invalid_response', message: text.slice(0, 300) } }
        }
      } catch (err) {
        networkError = err
      }

      if (res) this._readRateLimit(res)

      if (this.onRequest) {
        this.onRequest({
          method, path, attempt,
          status: res?.status ?? null,
          ms: Date.now() - startedAt,
          requestId: parsed?.request_id ?? parsed?.error?.request_id ?? null,
          dryRun: isWrite && effectiveDryRun,
          error: networkError?.message ?? null,
        })
      }

      // ── Fallo de red / timeout: reintentable ──────────────────────────────
      if (networkError) {
        lastError = new SmartbcError(`Fallo de red: ${networkError.message}`, { retryable: true })
        if (attempt < this.opts.retries) {
          await this.sleep(backoffMs(attempt, this.opts))
          continue
        }
        throw lastError
      }

      const requestId = parsed?.request_id ?? parsed?.error?.request_id ?? null

      if (res.ok) {
        return {
          status: res.status,
          data: parsed?.data ?? null,
          meta: parsed?.meta ?? null,
          requestId,
          // Cabecera que SmartBC pone cuando devuelve la respuesta guardada de
          // una Idempotency-Key ya usada: la escritura NO se repitió.
          idempotentReplay: res.headers?.get?.('X-Idempotent-Replay') === 'true',
          rateLimit: { ...this.rateLimit },
        }
      }

      const code = parsed?.error?.code ?? `http_${res.status}`
      const message = parsed?.error?.message ?? `HTTP ${res.status}`
      const retryable = !NON_RETRYABLE_HTTP.has(res.status)
      lastError = new SmartbcError(message, {
        status: res.status,
        code,
        details: parsed?.error?.details ?? null,
        requestId,
        retryable,
      })

      if (!retryable || attempt >= this.opts.retries) throw lastError

      // 429: el servidor sabe mejor que nosotros cuánto falta para su ventana.
      const retryAfter = res.status === 429
        ? parseRetryAfter(res.headers?.get?.('Retry-After'))
        : null
      await this.sleep(retryAfter ?? backoffMs(attempt, this.opts))
    }

    throw lastError ?? new SmartbcError('Petición agotada sin respuesta')
  }

  _readRateLimit(res) {
    const num = (h) => {
      const v = res.headers?.get?.(h)
      const n = v == null ? NaN : Number(v)
      return Number.isFinite(n) ? n : null
    }
    const limit = num('X-RateLimit-Limit')
    const remaining = num('X-RateLimit-Remaining')
    const reset = num('X-RateLimit-Reset')
    if (limit != null) this.rateLimit.limit = limit
    if (remaining != null) this.rateLimit.remaining = remaining
    if (reset != null) this.rateLimit.reset = reset
  }

  // ── Endpoints usados por el sincronizador ─────────────────────────────────

  /** Comprobación de credenciales. Si esto no da 200, no tiene sentido seguir. */
  ping() {
    return this.request('GET', '/api/v1/ping')
  }

  /** Especificación OpenAPI 3.1 generada por el propio servidor. */
  openapi() {
    return this.request('GET', '/api/v1/openapi')
  }

  /** Catálogos: enums, pipelines, regiones, comunas, zonas, usuarios. */
  catalogo(tipo, query = {}) {
    return this.request('GET', '/api/v1/catalogos', { query: { tipo, ...query } })
  }

  /** Alta o actualización de una captación completa. 201 crea, 200 actualiza. */
  upsertCaptacion(payload, { idempotencyKey, dryRun } = {}) {
    return this.request('POST', '/api/v1/captaciones', { body: payload, idempotencyKey, dryRun })
  }

  /** Actualización parcial: solo los campos que cambiaron. */
  patchCaptacion(externalId, patch, { idempotencyKey, dryRun } = {}) {
    return this.request('PATCH', `/api/v1/captaciones/${encodeURIComponent(externalId)}`, {
      body: patch, idempotencyKey, dryRun,
    })
  }

  /**
   * Lote de hasta 100. Siempre responde 200: cada elemento trae su propio
   * resultado o su propio error, y uno malo no aborta los buenos.
   */
  batch(items, { idempotencyKey, dryRun } = {}) {
    if (items.length > 100) throw new Error(`Lote de ${items.length}: el máximo de SmartBC es 100`)
    return this.request('POST', '/api/v1/captaciones/batch', { body: { items }, idempotencyKey, dryRun })
  }

  getCaptacion(externalId) {
    return this.request('GET', `/api/v1/captaciones/${encodeURIComponent(externalId)}`)
  }
}

/** Construye el cliente desde el entorno. La clave NUNCA vive en el repo. */
export function clientFromEnv(overrides = {}) {
  return new SmartbcClient({
    apiKey: process.env.SMARTBC_API_KEY,
    baseUrl: process.env.SMARTBC_BASE_URL || DEFAULTS.baseUrl,
    ...overrides,
  })
}
