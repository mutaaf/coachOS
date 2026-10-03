-- ============================================================================
-- Phone numbers on file become one number, not what was typed.
--
-- Parents, coaches and registrations were saved exactly as typed, so
-- "214.555.1000" became the WhatsApp link wa.me/2145551000 — no 1, which
-- WhatsApp reads as a number in another country. The app now saves
-- +1XXXXXXXXXX (lib/roster.ts normalizePhone); this brings the numbers
-- already on file into line. A number that doesn't resolve is left exactly as
-- it was, for the Boss to fix — nothing is thrown away.
--
-- ops.normalize_phone matches normalizePhone, which a test checks input by
-- input.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE OR REPLACE FUNCTION ops.normalize_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ops, public, extensions
AS $$
DECLARE
  -- An extension is not part of the number: "214-555-0101 x12".
  t text := btrim(regexp_replace(coalesce(raw, ''), '\s*(x|ext\.?|extension)\s*\d+\s*$', '', 'i'));
  d text := regexp_replace(t, '\D', '', 'g');
BEGIN
  IF length(d) = 10 THEN RETURN '+1' || d; END IF;
  IF length(d) = 11 AND left(d, 1) = '1' THEN RETURN '+' || d; END IF;
  -- Longer only when written as international ("+44 ..."); otherwise a typo.
  IF length(d) BETWEEN 12 AND 15 AND left(t, 1) = '+' THEN RETURN '+' || d; END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.normalize_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.normalize_phone(text) TO service_role;

UPDATE parents
   SET phone = normalize_phone(phone)
 WHERE normalize_phone(phone) IS NOT NULL
   AND phone IS DISTINCT FROM normalize_phone(phone);

UPDATE coaches
   SET phone = normalize_phone(phone)
 WHERE normalize_phone(phone) IS NOT NULL
   AND phone IS DISTINCT FROM normalize_phone(phone);

UPDATE registrations
   SET parent_phone = normalize_phone(parent_phone)
 WHERE normalize_phone(parent_phone) IS NOT NULL
   AND parent_phone IS DISTINCT FROM normalize_phone(parent_phone);
