-- ─────────────────────────────────────────────────────────────────────────────
-- 0099 · La otra dirección: lo que el equipo comercial hace en su panel
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta ahora la integración iba en un solo sentido. Les mandábamos el inmueble,
-- el dueño y los contactos; lo que pasaba después —que movieran la etapa, que
-- confirmaran que el dueño quiere vender, que corrigieran un teléfono tras
-- hablar con él— se quedaba allí. Aquí seguíamos trabajando captaciones que
-- ellos ya habían rechazado.
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN captaciones_cl:
--
-- Los triggers de la 0098 marcan sucia la captación ante CUALQUIER cambio de la
-- fila. Si lo que llega del panel se escribiera en captaciones_cl, cada dato
-- importado dispararía un envío de vuelta con nuestra copia de su propio dato.
-- No sería un bucle infinito —su `updated_by_user_at` no avanza con nuestros
-- envíos, que es justo lo que SmartBC añadió para evitarlo— pero sí un viaje de
-- ida y vuelta por cada cosa que toquen, gastando cuota para devolverles lo que
-- acaban de escribir. En una tabla aparte, no se dispara nada.
--
-- Y hay una razón más de fondo: esto es un ESPEJO, no una fusión. `owner_name`
-- de aquí es el que ellos escribieron tras llamar; el nuestro es el del
-- certificado de la Tesorería. Son dos hechos distintos y los dos son ciertos.
-- Machacar el nuestro con el suyo perdería la trazabilidad documental que es
-- todo el valor de este sistema. Se guardan los dos y se muestran los dos.

CREATE TABLE IF NOT EXISTS smartbc_panel_cl (
  captacion_id uuid PRIMARY KEY REFERENCES captaciones_cl(id) ON DELETE CASCADE,

  -- Etapa en su pipeline. `stage_type` es lo que permite saber si está
  -- rechazada o ganada sin tener que interpretar el nombre de la etapa.
  stage_key    text,
  stage_label  text,
  stage_type   text,

  -- LA decisión comercial: el dueño quiere vender. Solo la puede tomar quien
  -- habló con él, y por eso nunca la enviamos nosotros (§3 de la doc). Que
  -- llegue de vuelta es exactamente para lo que sirve esta tabla.
  owner_confirmed boolean,

  -- Datos del propietario según el panel. Mejor dato que el nuestro cuando
  -- existen: salen de una llamada, no de un registro.
  owner_name   text,
  owner_phone  text,
  address_real text,

  -- Contactos que añadió o corrigió una PERSONA de su equipo (`source: panel`).
  -- Los que enviamos nosotros (`source: api`) no se guardan: ya los tenemos.
  contactos    jsonb,

  -- La marca de SmartBC: último cambio hecho por una persona en su panel. NO
  -- avanza con nuestros envíos ni con su reparto automático. Es la columna
  -- sobre la que sondeamos.
  updated_by_user_at timestamptz,

  -- Cuándo lo trajimos nosotros. Distinto de lo anterior: sirve para saber si
  -- el sondeo está vivo, no cuándo tocaron la ficha.
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- "Qué ha rechazado su equipo", "qué está confirmado": las dos preguntas que
-- justifican la tabla.
CREATE INDEX IF NOT EXISTS idx_smartbc_panel_cl_stage
  ON smartbc_panel_cl(stage_type) WHERE stage_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_smartbc_panel_cl_confirmado
  ON smartbc_panel_cl(owner_confirmed) WHERE owner_confirmed;

-- ── Estado del sondeo ────────────────────────────────────────────────────────
-- Una sola fila. El CHECK sobre una clave booleana constante es lo que lo
-- garantiza: no hay forma de insertar una segunda aunque alguien lo intente.
CREATE TABLE IF NOT EXISTS smartbc_poll_cl (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  -- Hasta dónde llegamos. El siguiente sondeo pide `updated_since` con esto, y
  -- se avanza SOLO cuando la página se aplicó entera: si algo falla a mitad, la
  -- marca no se mueve y la próxima vuelta repite. Repetir es inofensivo (el
  -- upsert es idempotente); saltarse una ficha, no.
  last_updated_by_user_at timestamptz,

  last_run_at timestamptz,
  last_error  text,
  -- Cuántas trajo la última corrida: el número que dice de un vistazo si el
  -- sondeo está haciendo algo o girando en vacío.
  last_count  int NOT NULL DEFAULT 0
);

INSERT INTO smartbc_poll_cl (id) VALUES (true) ON CONFLICT DO NOTHING;

-- El primer sondeo NO trae el histórico entero: `updated_by_user_at` es NULL en
-- todo lo anterior a que SmartBC añadiera la marca, y con `changed_by=panel`
-- esas fichas no salen. Es lo que queremos — arrancar con la foto completa
-- sería traerse cientos de fichas que nadie ha tocado a mano. Si algún día hace
-- falta esa foto inicial, se pide una vez con GET /captaciones sin el filtro.
