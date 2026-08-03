-- ─────────────────────────────────────────────────────────────────────────────
-- 0098 · Propagación en vivo al CRM comercial: bandeja de salida
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta ahora los cambios llegaban a SmartBC cuando pasaba el sincronizador.
-- Entre "quito un contacto que no era" y "el CRM lo refleja" cabía una noche
-- entera, y quien llamaba en ese hueco llamaba con la ficha vieja.
--
-- El disparador no puede ser la aplicación. Una captación se toca desde la
-- ficha, desde el pipeline de captar-url, desde el worker de anuncios, desde
-- el backfill y desde psql a mano; poner el aviso en cada uno de esos sitios
-- es garantizar que el próximo camino se olvide. Se pone donde el dato cambia
-- de verdad: en la tabla.
--
-- Por qué una TABLA y no solo NOTIFY: un NOTIFY que se emite mientras el
-- worker está caído no lo recibe nadie nunca más. La fila queda. El worker
-- escucha para despertar en el acto, pero lo que garantiza que el cambio
-- llegue es esto, no el aviso.
--
-- Numerada 0098 y no 0094: ese número (y el 0095) ya los usó, en paralelo,
-- otro trabajo sobre scrape_targets_fallos_cl y verificación de WhatsApp.

CREATE TABLE IF NOT EXISTS smartbc_outbox_cl (
  captacion_id uuid PRIMARY KEY REFERENCES captaciones_cl(id) ON DELETE CASCADE,

  -- Cuándo se ensució. No se acumulan filas por captación: diez ediciones
  -- seguidas son UNA pendiente, y lo que se manda al final es el estado final
  -- —no diez envíos con estados intermedios que nadie llegó a ver.
  dirty_at    timestamptz NOT NULL DEFAULT now(),

  -- Reintentos. `next_try_at` en el futuro = esperando su turno; es lo que
  -- impide que una captación con un dato inválido consuma la cuota de todas
  -- las demás reintentando en bucle.
  attempts    int         NOT NULL DEFAULT 0,
  next_try_at timestamptz NOT NULL DEFAULT now(),
  last_error  text
);

-- La consulta del worker: "qué toca ahora". Parcial sobre next_try_at porque
-- la tabla está vacía el 99% del tiempo y así el índice también.
CREATE INDEX IF NOT EXISTS idx_smartbc_outbox_cl_turno
  ON smartbc_outbox_cl(next_try_at, dirty_at);

-- ── Marcar sucia ─────────────────────────────────────────────────────────────
-- ON CONFLICT: si ya estaba pendiente, se refresca `dirty_at` y se devuelve al
-- turno inmediato. Un cambio nuevo cancela la espera de un reintento anterior
-- a propósito — el dato cambió, y puede que sea justo lo que arreglaba el
-- error que la tenía en penitencia.
CREATE OR REPLACE FUNCTION smartbc_marcar_sucia_cl(p_captacion_id uuid)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO smartbc_outbox_cl (captacion_id, dirty_at, next_try_at)
  VALUES (p_captacion_id, now(), now())
  ON CONFLICT (captacion_id) DO UPDATE
    SET dirty_at = now(), next_try_at = now(), attempts = 0, last_error = NULL;
$$;

-- El aviso para despertar al worker en el acto. Va en un trigger aparte,
-- DESPUÉS de la inserción en la bandeja, y pg_notify no falla si no hay nadie
-- escuchando: si el worker está caído, esto no hace nada y la fila espera.
CREATE OR REPLACE FUNCTION smartbc_outbox_notificar_cl()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('smartbc_dirty_cl', NEW.captacion_id::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_smartbc_outbox_notificar ON smartbc_outbox_cl;
CREATE TRIGGER trg_smartbc_outbox_notificar
  AFTER INSERT OR UPDATE ON smartbc_outbox_cl
  FOR EACH ROW EXECUTE FUNCTION smartbc_outbox_notificar_cl();

-- ── Qué cambios ensucian una captación ───────────────────────────────────────
-- La ficha que viaja al CRM se arma con cuatro tablas, así que las cuatro
-- avisan (no incluye whatsapp_verificaciones_cl: la verificación en vivo del
-- teléfono sigue propagándose solo en la corrida nocturna, no en vivo — es
-- una extensión razonable pero fuera de esta primera pasada).

-- 1. La captación en sí: dueño, teléfonos, selección de contactos, rol, etapa.
CREATE OR REPLACE FUNCTION smartbc_captacion_sucia_cl()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM smartbc_marcar_sucia_cl(NEW.id);
  RETURN NULL;
END;
$$;

-- INSERT y UPDATE van en triggers SEPARADOS y no en uno con
-- `WHEN (OLD IS NULL OR OLD IS DISTINCT FROM NEW)`: en un trigger de INSERT no
-- existe OLD, y PostgreSQL rechaza la condición al CREARLO ("INSERT trigger's
-- WHEN condition cannot reference OLD values"). No es un detalle de estilo —
-- es la diferencia entre que la migración aplique o aborte (comprobado contra
-- un Postgres real antes de escribir esto).
DROP TRIGGER IF EXISTS trg_smartbc_captacion_sucia ON captaciones_cl;
CREATE TRIGGER trg_smartbc_captacion_sucia
  AFTER INSERT ON captaciones_cl
  FOR EACH ROW EXECUTE FUNCTION smartbc_captacion_sucia_cl();

-- En UPDATE sí se filtra: varios caminos hacen `SET ..., updated_at = now()`
-- sin cambiar nada más, y cada uno de esos sería una pasada por la bandeja.
DROP TRIGGER IF EXISTS trg_smartbc_captacion_sucia_upd ON captaciones_cl;
CREATE TRIGGER trg_smartbc_captacion_sucia_upd
  AFTER UPDATE ON captaciones_cl
  FOR EACH ROW
  WHEN (OLD IS DISTINCT FROM NEW)
  EXECUTE FUNCTION smartbc_captacion_sucia_cl();

-- 2. Los anuncios: precio, fotos, descripción, corredora. Un cambio de precio
--    en una corredora es EL caso de uso — es lo que hay que ver al llamar.
--    En DELETE manda OLD: el aviso que desaparece también cambia la ficha.
CREATE OR REPLACE FUNCTION smartbc_listing_sucia_cl()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fila record;
  v_listing_id uuid;
  v_property_id uuid;
BEGIN
  -- En un trigger de DELETE, NEW no está asignado: tocarlo (aunque sea dentro
  -- de un COALESCE) revienta con "record new is not assigned yet". Hay que
  -- preguntar por la operación antes de leer el registro, no después.
  IF TG_OP = 'DELETE' THEN
    v_listing_id  := OLD.id;
    v_property_id := OLD.property_cl_id;
  ELSE
    v_listing_id  := NEW.id;
    v_property_id := NEW.property_cl_id;
  END IF;
  FOR fila IN
    SELECT id FROM captaciones_cl
     WHERE (v_property_id IS NOT NULL AND property_cl_id = v_property_id)
        OR listing_cl_id = v_listing_id
  LOOP
    PERFORM smartbc_marcar_sucia_cl(fila.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_smartbc_listing_sucia ON listings_cl;
CREATE TRIGGER trg_smartbc_listing_sucia
  AFTER INSERT OR UPDATE OR DELETE ON listings_cl
  FOR EACH ROW EXECUTE FUNCTION smartbc_listing_sucia_cl();

-- 3. La propiedad canónica: `localidad` viaja como `zone`, y el pin corregido
--    a mano (manual_latitude/longitude) manda sobre la coordenada del aviso
--    en `latitude`/`longitude` (ver mapper.mjs) — corregir el pin también
--    tiene que llegar en vivo, no solo en la corrida nocturna.
CREATE OR REPLACE FUNCTION smartbc_property_sucia_cl()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fila record;
BEGIN
  FOR fila IN SELECT id FROM captaciones_cl WHERE property_cl_id = NEW.id LOOP
    PERFORM smartbc_marcar_sucia_cl(fila.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_smartbc_property_sucia ON property_cl;
CREATE TRIGGER trg_smartbc_property_sucia
  AFTER UPDATE ON property_cl
  FOR EACH ROW
  WHEN (OLD.localidad IS DISTINCT FROM NEW.localidad
        OR OLD.manual_latitude IS DISTINCT FROM NEW.manual_latitude
        OR OLD.manual_longitude IS DISTINCT FROM NEW.manual_longitude)
  EXECUTE FUNCTION smartbc_property_sucia_cl();

-- ── Arranque ─────────────────────────────────────────────────────────────────
-- La bandeja empieza VACÍA a propósito. Sembrarla con todo lo ya sincronizado
-- convertiría el despliegue de esta migración en un reenvío masivo sin que
-- nadie lo haya pedido. Para eso está `sync-smartbc-cl.mjs --force`, que se
-- lanza a mano, en dry-run primero, cuando se quiere propagar un cambio de
-- mapeo.
