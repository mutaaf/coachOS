-- ============================================================================
-- A message knows which family it went to.
--
-- The Outbox held a phone number and a name and nothing else, so a family's
-- page could not show what she had sent them (issue #36). Every message now
-- carries the parent it is for. Rather than trust each of the places that
-- queue a message to remember, the database fills it in from the number —
-- old code that never sets it keeps working — and earlier messages are linked
-- the same way.
--
-- Only a number that belongs to exactly one parent is linked: guessing between
-- two would put one family's messages on another's page.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE message_queue
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES parents (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS message_queue_parent ON message_queue (parent_id, created_at DESC);

-- The last ten digits: "+12145550101", "(214) 555-0101" and "214.555.0101" agree.
CREATE OR REPLACE FUNCTION ops.phone_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '')
$$;

CREATE OR REPLACE FUNCTION ops.message_parent_from_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public, extensions
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NEW.parent_id IS NULL AND ops.phone_key(NEW.recipient_phone) IS NOT NULL THEN
    SELECT array_agg(id) INTO v_ids
      FROM ops.parents
     WHERE ops.phone_key(phone) = ops.phone_key(NEW.recipient_phone);
    IF array_length(v_ids, 1) = 1 THEN
      NEW.parent_id := v_ids[1];
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_queue_parent ON message_queue;
CREATE TRIGGER message_queue_parent
  BEFORE INSERT ON message_queue
  FOR EACH ROW EXECUTE FUNCTION ops.message_parent_from_phone();

-- Messages already sent.
UPDATE message_queue m
   SET parent_id = p.id
  FROM (
    SELECT ops.phone_key(phone) AS k, (array_agg(id))[1] AS id
      FROM parents
     GROUP BY 1
    HAVING count(*) = 1
  ) p
 WHERE m.parent_id IS NULL
   AND ops.phone_key(m.recipient_phone) = p.k;

REVOKE EXECUTE ON FUNCTION ops.phone_key(text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION ops.message_parent_from_phone() FROM public, anon;
