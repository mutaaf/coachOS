-- ============================================================================
-- The compliance checklist: recurring tasks with an owner and a due date.
--
-- Marking one done records when, notes, an evidence link and any private
-- details the task asks for (an insurance policy number, a filing number),
-- then rolls the due date forward on the task's cadence. Private details stay
-- in `ops`: nothing here is exposed to the website.
--
-- Admin and compliance staff both read and complete tasks; writes go through
-- the functions below, which write to the audit log.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE TABLE IF NOT EXISTS ops.compliance_tasks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  title          text        NOT NULL,
  description    text        NOT NULL,
  -- [{label, url}]: CoachOS pages ("/compliance?tab=coaches") or outside sources.
  links          jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
  owner          text        NOT NULL DEFAULT 'Owner' CHECK (length(owner) BETWEEN 1 AND 100),
  cadence        interval    NOT NULL CHECK (cadence >= interval '1 day'),
  next_due       date        NOT NULL,
  -- Private details recorded when it's done: [{key, label, type: text|date}].
  record_fields  jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(record_fields) = 'array'),
  -- The latest of those details (e.g. the current insurance policy).
  private_record jsonb       NOT NULL DEFAULT '{}'::jsonb,
  active         boolean     NOT NULL DEFAULT true,
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.compliance_task_completions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES ops.compliance_tasks (id) ON DELETE CASCADE,
  done_on      date        NOT NULL,
  was_due      date        NOT NULL,
  next_due     date        NOT NULL,
  notes        text        CHECK (length(notes) <= 5000),
  evidence_url text        CHECK (evidence_url IS NULL OR evidence_url ~* '^https?://[^[:space:]]+$'),
  record       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  done_by      text        NOT NULL,
  done_by_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_task_completions_task ON ops.compliance_task_completions (task_id, done_on DESC);

ALTER TABLE ops.compliance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.compliance_task_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Compliance staff read the checklist" ON ops.compliance_tasks;
CREATE POLICY "Compliance staff read the checklist" ON ops.compliance_tasks FOR SELECT TO authenticated
  USING ((SELECT ops.can_manage_compliance()));
DROP POLICY IF EXISTS "Compliance staff read checklist history" ON ops.compliance_task_completions;
CREATE POLICY "Compliance staff read checklist history" ON ops.compliance_task_completions FOR SELECT TO authenticated
  USING ((SELECT ops.can_manage_compliance()));

REVOKE ALL ON ops.compliance_tasks, ops.compliance_task_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ops.compliance_tasks, ops.compliance_task_completions TO authenticated;
GRANT ALL ON ops.compliance_tasks, ops.compliance_task_completions TO service_role;

-- When it is next due after being done on p_done_on: the next date on the
-- task's own cadence after the day it was done (so a quarterly check stays
-- quarterly), or 30 days before a recorded expiry if that is later — an
-- insurance policy or a certificate is renewed before it lapses.
CREATE OR REPLACE FUNCTION ops.compliance_next_due(p_due date, p_cadence interval, p_done_on date, p_expires_on date DEFAULT NULL)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_next date := (p_due + p_cadence)::date;
  i int := 0;
BEGIN
  WHILE v_next <= p_done_on AND i < 1000 LOOP
    v_next := (v_next + p_cadence)::date;
    i := i + 1;
  END LOOP;
  IF p_expires_on IS NOT NULL AND (p_expires_on - 30) > p_done_on THEN
    v_next := p_expires_on - 30;
  END IF;
  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION ops.complete_compliance_task(
  p_task_id      uuid,
  p_done_on      date DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_evidence_url text DEFAULT NULL,
  p_record       jsonb DEFAULT '{}'::jsonb
)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor   text := ops.staff_actor();
  v_today   date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_done_on date := coalesce(p_done_on, (now() AT TIME ZONE 'America/Chicago')::date);
  v_task    ops.compliance_tasks;
  v_field   jsonb;
  v_val     text;
  v_record  jsonb := '{}'::jsonb;
  v_expires date;
  v_next    date;
  v_url     text := nullif(btrim(coalesce(p_evidence_url, '')), '');
BEGIN
  IF NOT ops.can_manage_compliance() THEN
    RAISE EXCEPTION 'Only CoachOS staff can update the checklist.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_task FROM ops.compliance_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That checklist item doesn''t exist.' USING ERRCODE = '22023';
  END IF;
  IF v_done_on > v_today THEN
    RAISE EXCEPTION 'It can''t be done in the future.' USING ERRCODE = '22023';
  END IF;
  IF v_url IS NOT NULL AND v_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'The evidence link must be a web address starting with http:// or https://.' USING ERRCODE = '22023';
  END IF;

  -- Keep only the details this task asks for.
  FOR v_field IN SELECT * FROM jsonb_array_elements(v_task.record_fields) LOOP
    v_val := nullif(btrim(coalesce(p_record ->> (v_field ->> 'key'), '')), '');
    CONTINUE WHEN v_val IS NULL;
    IF length(v_val) > 200 THEN
      RAISE EXCEPTION '% is too long.', v_field ->> 'label' USING ERRCODE = '22023';
    END IF;
    IF v_field ->> 'type' = 'date' THEN
      BEGIN
        v_val := v_val::date::text;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '% must be a date.', v_field ->> 'label' USING ERRCODE = '22023';
      END;
    END IF;
    v_record := v_record || jsonb_build_object(v_field ->> 'key', v_val);
  END LOOP;

  v_expires := (v_record ->> 'expires_on')::date;
  v_next := ops.compliance_next_due(v_task.next_due, v_task.cadence, v_done_on, v_expires);

  INSERT INTO ops.compliance_task_completions (task_id, done_on, was_due, next_due, notes, evidence_url, record, done_by, done_by_id)
  VALUES (p_task_id, v_done_on, v_task.next_due, v_next, nullif(btrim(coalesce(p_notes, '')), ''), v_url, v_record, v_actor, auth.uid());

  UPDATE ops.compliance_tasks
     SET next_due = v_next, private_record = private_record || v_record, updated_at = now()
   WHERE id = p_task_id;

  -- The details themselves stay on the task; the log says which were recorded.
  PERFORM ops.audit(v_actor, 'checklist.complete', 'compliance_tasks', p_task_id,
    jsonb_build_object('task', v_task.slug, 'done_on', v_done_on, 'old_due', v_task.next_due, 'new_due', v_next,
                       'evidence', v_url IS NOT NULL, 'recorded', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(v_record) k)),
    auth.uid());
  RETURN v_next;
END;
$$;

-- Change who owns a task or when it's next due.
CREATE OR REPLACE FUNCTION ops.update_compliance_task(p_task_id uuid, p_owner text, p_next_due date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := ops.staff_actor();
  v_task  ops.compliance_tasks;
  v_owner text := btrim(coalesce(p_owner, ''));
BEGIN
  IF NOT ops.can_manage_compliance() THEN
    RAISE EXCEPTION 'Only CoachOS staff can update the checklist.' USING ERRCODE = '42501';
  END IF;
  IF v_owner = '' OR length(v_owner) > 100 THEN
    RAISE EXCEPTION 'Say who owns it.' USING ERRCODE = '22023';
  END IF;
  IF p_next_due IS NULL THEN
    RAISE EXCEPTION 'Give it a due date.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_task FROM ops.compliance_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That checklist item doesn''t exist.' USING ERRCODE = '22023';
  END IF;
  UPDATE ops.compliance_tasks SET owner = v_owner, next_due = p_next_due, updated_at = now() WHERE id = p_task_id;
  PERFORM ops.audit(v_actor, 'checklist.update', 'compliance_tasks', p_task_id,
    jsonb_build_object('task', v_task.slug, 'old_owner', v_task.owner, 'new_owner', v_owner,
                       'old_due', v_task.next_due, 'new_due', p_next_due),
    auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION ops.compliance_next_due(date, interval, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.complete_compliance_task(uuid, date, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ops.update_compliance_task(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ops.compliance_next_due(date, interval, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.complete_compliance_task(uuid, date, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION ops.update_compliance_task(uuid, text, date) TO authenticated, service_role;

-- ------------------------------------------------------------------- seed

INSERT INTO ops.compliance_tasks (slug, title, description, links, owner, cadence, next_due, record_fields, sort_order) VALUES
  ('attorney-review',
   'Attorney review of the policies',
   'Once a year, a Texas-licensed attorney reads every policy page (Privacy, Terms, Registration Terms, Child Safety, Accessibility, Privacy Choices) and the consent wording, and confirms the published policy facts. Record who reviewed and attach their sign-off letter or email.',
   '[{"label": "Policy facts tab", "url": "/compliance?tab=facts"}, {"label": "State Bar of Texas — find a lawyer", "url": "https://www.texasbar.com/"}]',
   'Owner', interval '1 year', (current_date + 30), '[{"key": "reviewer", "label": "Attorney / firm", "type": "text"}]', 10),
  ('insurance-renewal',
   'Insurance renewal',
   'Renew general liability (and participant accident cover, if any) before it lapses, and send the new certificate to every host school that asks. Record the carrier, policy number and expiry here — they stay private in CoachOS and never appear on the website. The next reminder is set 30 days before the expiry you record.',
   '[{"label": "Texas Department of Insurance", "url": "https://www.tdi.texas.gov/"}]',
   'Owner', interval '1 year', (current_date + 30),
   '[{"key": "carrier", "label": "Carrier", "type": "text"}, {"key": "policy_number", "label": "Policy number", "type": "text"}, {"key": "expires_on", "label": "Expires on", "type": "date"}]', 20),
  ('ga4-settings',
   'Google Analytics settings check',
   'In GA4 (Admin → Data collection and modification): Google signals OFF, ads personalization OFF, and Data retention set to 14 months — the privacy policy promises all three. Take a screenshot of each setting as evidence.',
   '[{"label": "Google — GA4 data retention", "url": "https://support.google.com/analytics/answer/7667196"}, {"label": "Google — Google signals", "url": "https://support.google.com/analytics/answer/9445345"}]',
   'Assistant', interval '3 months', (current_date + 14), '[]', 30),
  ('texas-no-call',
   'Texas No-Call list check',
   'Before any promotional text goes out this quarter, download the current Texas No-Call list (updated quarterly) and the National Do Not Call registry, and confirm promotional texts only go to parents who opted in to promotional texts (sms_promotional). Rising Stars is not registered as a telephone solicitor under ch. 302, so consent is what makes promotions lawful.',
   '[{"label": "Texas No-Call list (PUC)", "url": "https://www.texasnocall.com/"}, {"label": "National Do Not Call Registry — telemarketers", "url": "https://telemarketing.donotcall.gov/"}, {"label": "Tex. Bus. & Com. Code ch. 304 (Texas no-call list)", "url": "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.304.htm"}]',
   'Assistant', interval '3 months', (current_date + 14), '[]', 40),
  ('assumed-name-certificate',
   'Assumed-name (d/b/a) certificate on file',
   'Rising Stars LLC trades as "Rising Stars Youth Academy", so an assumed-name certificate (SOS Form 503) must be on file with the Texas Secretary of State (Tex. Bus. & Com. Code ch. 71). Check it in SOSDirect, keep a copy, and note when it expires (they last up to 10 years).',
   '[{"label": "Texas SOS — SOSDirect", "url": "https://www.sos.state.tx.us/corp/sosda/index.shtml"}, {"label": "SOS Form 503 (assumed name certificate)", "url": "https://www.sos.state.tx.us/corp/forms/503_boc.pdf"}, {"label": "Tex. Bus. & Com. Code ch. 71", "url": "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.71.htm"}]',
   'Assistant', interval '1 year', (current_date + 14),
   '[{"key": "filing_number", "label": "SOS document / file number", "type": "text"}, {"key": "expires_on", "label": "Expires on", "type": "date"}]', 50),
  ('coach-clearance-review',
   'Coach clearance review',
   'Go through Coach clearance: every active coach has a current background check, abuse-prevention training and CPR/first aid, and nobody uncleared is on the schedule. Chase anything expiring in the next 30 days.',
   '[{"label": "Coach clearance", "url": "/compliance?tab=coaches"}, {"label": "Coaches page", "url": "/coaches"}]',
   'Owner', interval '1 month', (current_date + 7), '[]', 60),
  ('privacy-requests-due',
   'Privacy requests due',
   'Check Privacy requests for anything open: Texas gives 45 days to answer (once extendable by 45, telling the parent why) and 60 days to decide an appeal.',
   '[{"label": "Privacy requests", "url": "/compliance?tab=privacy"}]',
   'Owner', interval '7 days', (current_date + 7), '[]', 70),
  ('breach-drill',
   'Breach runbook drill',
   'Once a year, walk through the data-breach runbook as a table-top exercise: who decides, how families are told (within 60 days), when the Texas Attorney General must be told (within 30 days if 250+ Texans), and where the template letters are. Note what you changed.',
   '[{"label": "Texas AG — data breach reporting", "url": "https://www.texasattorneygeneral.gov/consumer-protection/data-breach-reporting"}, {"label": "Tex. Bus. & Com. Code ch. 521", "url": "https://statutes.capitol.texas.gov/Docs/BC/htm/BC.521.htm"}]',
   'Owner', interval '1 year', (current_date + 60), '[]', 80)
ON CONFLICT (slug) DO NOTHING;
