-- ============================================================================
-- An audit trail for the things that have to be provable later.
--
-- Who looked at a child's medical note, when a family's data was exported or
-- erased, what the retention job removed, who recorded an incident. Each row
-- names the actor, the action and the record it touched by id — never the
-- personal details themselves, so the trail survives a family being
-- anonymised without keeping what was erased.
--
-- Append-only: rows can be added, never changed or removed, by anyone using
-- the API (a trigger refuses UPDATE and DELETE outright, whatever the role).
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE IF NOT EXISTS ops.audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  at          timestamptz NOT NULL DEFAULT now(),
  -- The staff member's auth id, when a signed-in person did it.
  actor_id    uuid,
  -- Who, in words: 'admin:<email>', 'coach_link:<link id>', 'system:retention'.
  actor       text        NOT NULL,
  -- e.g. medical.view, privacy.export, privacy.anonymize, retention.run, incident.create
  action      text        NOT NULL,
  entity      text,
  entity_id   uuid,
  -- Ids, counts and reasons. Never names, contacts or notes.
  detail      jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_at ON ops.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity ON ops.audit_log (entity, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action ON ops.audit_log (action, at DESC);

CREATE OR REPLACE FUNCTION ops.audit_log_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'The audit log can be added to, not changed.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON ops.audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION ops.audit_log_is_append_only();

ALTER TABLE ops.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read the audit log" ON ops.audit_log FOR SELECT TO authenticated
  USING ((SELECT ops.is_admin()));
CREATE POLICY "Admins add to the audit log" ON ops.audit_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT ops.is_admin()));
REVOKE ALL ON ops.audit_log FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON ops.audit_log FROM authenticated, service_role;
GRANT SELECT, INSERT ON ops.audit_log TO authenticated, service_role;

-- For database functions to write to it.
CREATE OR REPLACE FUNCTION ops.audit(
  p_actor     text,
  p_action    text,
  p_entity    text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_detail    jsonb DEFAULT NULL,
  p_actor_id  uuid DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO ops.audit_log (actor, action, entity, entity_id, detail, actor_id)
  VALUES (left(coalesce(p_actor, 'unknown'), 200), left(p_action, 100), left(p_entity, 100), p_entity_id, p_detail, p_actor_id);
$$;

REVOKE ALL ON FUNCTION ops.audit(text, text, text, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.audit(text, text, text, uuid, jsonb, uuid) TO service_role;
