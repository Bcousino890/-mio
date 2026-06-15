-- Referencia interna de particular en formato PART-YYYY-NNNN (año + secuencial).
-- Única en todo el catálogo de particulares. Generada automáticamente en INSERT.

-- 1. Sequence for generating sequential IDs
CREATE SEQUENCE IF NOT EXISTS particulares_reference_seq START 1;

-- 2. Column on particulares table
ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS particular_reference TEXT UNIQUE;

-- 3. Function to generate the reference
CREATE OR REPLACE FUNCTION generate_particular_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.particular_reference IS NULL THEN
    NEW.particular_reference :=
      'PART-' ||
      TO_CHAR(CURRENT_DATE, 'YYYY') ||
      '-' ||
      LPAD(nextval('particulares_reference_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- 4. BEFORE INSERT trigger (idempotente: drop antes de crear)
DROP TRIGGER IF EXISTS trg_particulares_reference ON particulares;
CREATE TRIGGER trg_particulares_reference
  BEFORE INSERT ON particulares
  FOR EACH ROW
  EXECUTE FUNCTION generate_particular_reference();

-- 5. Backfill de registros existentes. (UPDATE no admite ORDER BY en Postgres.)
-- nextval por fila garantiza referencias únicas; solo toca las que aún no tienen
-- referencia, así que es idempotente.
UPDATE particulares
SET particular_reference =
  'PART-' ||
  TO_CHAR(created_at, 'YYYY') ||
  '-' ||
  LPAD(nextval('particulares_reference_seq')::TEXT, 4, '0')
WHERE particular_reference IS NULL;

-- 6. Expand change_type CHECK constraint on particulares_changes
ALTER TABLE particulares_changes
  DROP CONSTRAINT IF EXISTS particulares_changes_change_type_check;

ALTER TABLE particulares_changes
  ADD CONSTRAINT particulares_changes_change_type_check
  CHECK (change_type IN (
    'price_change',
    'photo_added',
    'description_updated',
    'deleted',
    'reactivated',
    'price_up',
    'price_down',
    'photo_count_change',
    'phone_added',
    'new_listing'
  ));

-- 7. Index on particular_reference
CREATE INDEX IF NOT EXISTS idx_particulares_reference ON particulares (particular_reference);
