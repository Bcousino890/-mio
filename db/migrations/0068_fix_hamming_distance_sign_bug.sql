-- ─────────────────────────────────────────────────────────────────────────────
-- 0068 · Corrige bug de signo en hamming_distance() (0014_dedup_scoring.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG ENCONTRADO al testear scraper/lib/media-sync-cl.mjs (H7, plan Anuncios
-- CL) contra Postgres real: la implementación original castea el XOR de los
-- dos pHash a `bigint` CON SIGNO (`::bit(64)::bigint`) y cuenta bits con
-- `WHILE v_xor > 0 LOOP ... v_xor := v_xor >> 1`. Cuando el XOR tiene el bit
-- más significativo (bit 63) encendido, el valor con signo es NEGATIVO — la
-- condición `v_xor > 0` es falsa de entrada y el loop no corre ni una vez,
-- devolviendo 0 en vez de la distancia real.
--
-- Reproducible con cualquier par de pHash cuyo XOR tenga el bit 63 activo
-- (aprox. la MITAD de pares de hashes al azar difieren en ese bit):
--   SELECT hamming_distance('0000000000000000', 'ffffffffffffffff');
--   -- ANTES: 0 (incorrecto, debería ser 64 — todos los bits distintos)
--   -- DESPUÉS de este fix: 64
--
-- IMPACTO: hamming_distance() la usa calculate_match_signals() (0014) para
-- 'phash_distance', señal que YA está en producción alimentando el matching
-- de propiedades en España (listing_match.signals). Este bug hace que, para
-- ~50% de los pares de fotos, el sistema reporte "0 bits de diferencia"
-- (fotos idénticas) cuando en realidad podían ser muy distintas — un sesgo
-- hacia FALSOS POSITIVOS de "misma foto" que pudo estar inflando scores de
-- match incorrectamente. No se reprocesan los `listing_match.signals` ya
-- guardados (jsonb histórico, fuera de alcance de esta migración) — el fix
-- aplica a partir de aquí para toda evaluación nueva.
--
-- FIX: evita aritmética con signo por completo. Se hace el XOR directamente
-- sobre los valores `bit(64)` (el tipo bit no tiene noción de signo) y se
-- cuentan los '1' de su representación en texto — sin bigint, sin loop, sin
-- shifts, sin posibilidad de que el signo rompa el conteo.

CREATE OR REPLACE FUNCTION hamming_distance(
  phash_a text,
  phash_b text
)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_a bit(64);
  v_b bit(64);
  v_xor_text text;
BEGIN
  IF phash_a IS NULL OR phash_b IS NULL OR length(phash_a) <> length(phash_b) THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_a := ('x' || phash_a)::bit(64);
    v_b := ('x' || phash_b)::bit(64);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  -- XOR sobre bit(64) (sin signo) → texto de 64 caracteres '0'/'1' → cuenta
  -- de '1' por diferencia de longitud tras remover todos los '1' (idioma SQL
  -- estándar para contar ocurrencias de un caracter).
  v_xor_text := (v_a # v_b)::text;
  RETURN length(v_xor_text) - length(replace(v_xor_text, '1', ''));
END $$;
