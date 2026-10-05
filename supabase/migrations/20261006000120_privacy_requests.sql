-- ============================================================================
-- Privacy requests: a parent asks to see, correct or erase what we hold.
--
-- The website's privacy form (contract v1.1) sends
--   submit_inquiry('privacy_request', contact, {request_type, child_first_names, message})
-- with request_type access | delete | correct | opt_out | appeal. It lands in
-- ops.inquiries like any other inquiry, with a statutory clock: 45 days to
-- answer under the Texas Data Privacy and Security Act (Bus. & Com. Code
-- §541.052), extendable once by 45 more when the parent is told why, and 60
-- days to decide an appeal (§541.053).
--
-- Workflow (privacy_status):
--   received → verifying → completed | denied (reason required)
--   denied → appealed → appeal_granted | appeal_denied
--
-- Two actions do the work, both service-role only and both audited:
--   * ops.export_family(parent)    — everything held about the family, as JSON
--   * ops.anonymize_family(parent) — erase the people, keep the money: names,
--     contacts, dates of birth, medical notes and messages are removed;
--     invoice and payment amounts and dates stay (IRS record keeping), tied to
--     a record that no longer says who it was.
-- The request row itself is kept as the record that it was honoured.
-- ============================================================================

SET search_path = ops, public, extensions;

-- Marks on the people themselves, so the UI can say "erased" and nothing
-- tries to message them.
ALTER TABLE ops.parents  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
ALTER TABLE ops.students ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
ALTER TABLE ops.registrations ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- ----------------------------------------------------------------------------
-- 1. Inquiries can be privacy requests.
-- ----------------------------------------------------------------------------

ALTER TABLE ops.inquiries DROP CONSTRAINT IF EXISTS inquiries_kind_check;
ALTER TABLE ops.inquiries ADD CONSTRAINT inquiries_kind_check
  CHECK (kind IN ('general', 'trial', 'waitlist_interest', 'program_question', 'birthday_party', 'privacy_request'));

ALTER TABLE ops.inquiries
  ADD COLUMN IF NOT EXISTS request_type          text CHECK (request_type IN ('access', 'delete', 'correct', 'opt_out', 'appeal')),
  ADD COLUMN IF NOT EXISTS child_first_names     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS privacy_status        text CHECK (privacy_status IN
                              ('received', 'verifying', 'completed', 'denied', 'appealed', 'appeal_granted', 'appeal_denied')),
  ADD COLUMN IF NOT EXISTS due_at                timestamptz,
  ADD COLUMN IF NOT EXISTS extended_at           timestamptz,
  ADD COLUMN IF NOT EXISTS extension_reason      text,
  ADD COLUMN IF NOT EXISTS verified_at           timestamptz,
  ADD COLUMN IF NOT EXISTS verification_method   text,
  ADD COLUMN IF NOT EXISTS completed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS denial_reason         text,
  ADD COLUMN IF NOT EXISTS appealed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_due_at         timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_decision       text,
  ADD COLUMN IF NOT EXISTS resolution_note       text,
  -- The family it is about, once staff (or the phone/email match) says so.
  ADD COLUMN IF NOT EXISTS parent_id             uuid REFERENCES ops.parents (id) ON DELETE SET NULL,
  -- Set when the retention job or an erasure strips the contact details.
  ADD COLUMN IF NOT EXISTS anonymized_at         timestamptz,
  -- Everything the website sent in p_details, exactly as sent (capped at 16 KB).
  ADD COLUMN IF NOT EXISTS details               jsonb,
  -- p_details.consents (contract v1.1: sms, marketing_email, policy_version,
  -- documents{…}), as sent, plus accepted_at: the server's clock. Opt-ins
  -- only: no texts or newsletters to this contact without them.
  ADD COLUMN IF NOT EXISTS consents              jsonb;

-- A privacy request always has its type and its place in the workflow; a
-- denial always says why.
ALTER TABLE ops.inquiries DROP CONSTRAINT IF EXISTS inquiries_privacy_shape;
ALTER TABLE ops.inquiries ADD CONSTRAINT inquiries_privacy_shape CHECK (
  (kind = 'privacy_request') = (request_type IS NOT NULL AND privacy_status IS NOT NULL AND due_at IS NOT NULL)
);
ALTER TABLE ops.inquiries DROP CONSTRAINT IF EXISTS inquiries_denial_reason;
ALTER TABLE ops.inquiries ADD CONSTRAINT inquiries_denial_reason CHECK (
  privacy_status IS DISTINCT FROM 'denied' OR nullif(btrim(denial_reason), '') IS NOT NULL
);

-- An anonymised inquiry has no way to reply, by design.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'ops.inquiries'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%phone IS NOT NULL%email IS NOT NULL%'
       AND conname <> 'inquiries_contact_or_anonymized'
  LOOP
    EXECUTE format('ALTER TABLE ops.inquiries DROP CONSTRAINT %I', c);
  END LOOP;
END;
$$;
ALTER TABLE ops.inquiries DROP CONSTRAINT IF EXISTS inquiries_contact_or_anonymized;
ALTER TABLE ops.inquiries ADD CONSTRAINT inquiries_contact_or_anonymized
  CHECK (phone IS NOT NULL OR email IS NOT NULL OR anonymized_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS inquiries_privacy_due ON ops.inquiries (due_at) WHERE kind = 'privacy_request';

-- ----------------------------------------------------------------------------
-- 2. The door, now taking privacy requests.
--
-- Identical to 20261005000200 apart from:
--   * the privacy_request branch;
--   * p_details is stored verbatim in `details` (unknown keys kept), and
--     p_details.consents in `consents`, stamped with the server's time;
--   * an opt-in given here (sms with a phone, marketing_email with an email)
--     is recorded on the matching parent, exactly as a registration's is.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_inquiry(
  p_kind        text,
  p_contact     jsonb,
  p_details     jsonb DEFAULT NULL,
  p_attribution jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact   jsonb := CASE WHEN jsonb_typeof(p_contact) = 'object' THEN p_contact ELSE '{}'::jsonb END;
  v_details   jsonb := CASE WHEN jsonb_typeof(p_details) = 'object' THEN p_details ELSE '{}'::jsonb END;
  v_first     text  := left(nullif(btrim(v_contact ->> 'first_name'), ''), 100);
  v_last      text  := left(nullif(btrim(v_contact ->> 'last_name'), ''), 100);
  v_raw_phone text  := left(nullif(btrim(v_contact ->> 'phone'), ''), 40);
  v_phone     text;
  v_email     text  := lower(left(nullif(btrim(v_contact ->> 'email'), ''), 254));
  v_message   text  := left(nullif(btrim(v_details ->> 'message'), ''), 5000);
  v_org       text  := left(nullif(btrim(v_details ->> 'organization'), ''), 200);
  v_offering  uuid;
  v_types     text[];
  v_recent    integer;
  v_id        uuid;
  v_req_type  text;
  v_children  text[];
  v_parent    uuid;
  v_consents  jsonb;
  v_match     record;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('general', 'trial', 'waitlist_interest', 'program_question', 'birthday_party',
                                      'partnership', 'privacy_request') THEN
    RAISE EXCEPTION 'Unknown inquiry kind: %', coalesce(p_kind, 'none') USING ERRCODE = '22023';
  END IF;

  v_phone := coalesce(ops.normalize_phone(v_raw_phone), v_raw_phone);
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Please check the email address.' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'Please give us a phone number or an email so we can reply.' USING ERRCODE = '22023';
  END IF;

  IF octet_length(v_details::text) > 16384 THEN
    RAISE EXCEPTION 'That message is too long.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_details -> 'consents') = 'object' THEN
    v_consents := (v_details -> 'consents') - 'accepted_at'
      || CASE WHEN (v_details -> 'consents') ? 'accepted_at'
              THEN jsonb_build_object('client_accepted_at', v_details #> '{consents,accepted_at}')
              ELSE '{}'::jsonb END
      || jsonb_build_object('accepted_at', now());
    -- A text opt-in needs a number to text.
    IF v_phone IS NULL THEN
      v_consents := v_consents - 'sms';
    END IF;
  END IF;

  IF p_kind = 'privacy_request' THEN
    v_req_type := lower(btrim(v_details ->> 'request_type'));
    IF v_req_type IS NULL OR v_req_type NOT IN ('access', 'delete', 'correct', 'opt_out', 'appeal') THEN
      RAISE EXCEPTION 'Please choose what you would like us to do with your information.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- One person sending more than five in an hour is a script, not a family;
  -- and more than thirty a minute across everyone is a flood.
  SELECT count(*) INTO v_recent
    FROM ops.inquiries i
   WHERE i.created_at > now() - interval '1 hour'
     AND ((v_phone IS NOT NULL AND ops.phone_key(i.phone) = ops.phone_key(v_phone))
       OR (v_email IS NOT NULL AND lower(i.email) = v_email));
  SELECT v_recent + count(*) INTO v_recent
    FROM ops.leads l
   WHERE l.source = 'website'
     AND l.created_at > now() - interval '1 hour'
     AND ((v_phone IS NOT NULL AND ops.phone_key(l.contact_phone) = ops.phone_key(v_phone))
       OR (v_email IS NOT NULL AND lower(l.contact_email) = v_email));
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'Too many messages from you in the last hour. Please call or text us instead.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_recent FROM ops.inquiries WHERE created_at > now() - interval '1 minute';
  SELECT v_recent + count(*) INTO v_recent FROM ops.leads WHERE source = 'website' AND created_at > now() - interval '1 minute';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'We''re getting a lot of messages right now. Please try again in a minute.' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind = 'partnership' THEN
    INSERT INTO ops.leads (school_name, contact_name, contact_email, contact_phone, notes, stage, source, attribution)
    VALUES (
      coalesce(v_org, nullif(btrim(concat_ws(' ', v_first, v_last)), ''), v_email, v_phone),
      nullif(btrim(concat_ws(' ', v_first, v_last)), ''),
      v_email,
      v_phone,
      v_message,
      'identified',
      'website',
      ops.clean_attribution(p_attribution)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF p_kind = 'privacy_request' THEN
    IF jsonb_typeof(v_details -> 'child_first_names') = 'array' THEN
      SELECT coalesce(array_agg(left(btrim(x), 100)) FILTER (WHERE btrim(x) <> ''), '{}')
        INTO v_children
        FROM (SELECT jsonb_array_elements_text(v_details -> 'child_first_names') AS x LIMIT 10) s;
    END IF;

    -- The family it is probably about: exactly one parent with this phone or
    -- email. Staff still verify the requester before acting on it.
    SELECT CASE WHEN count(*) = 1 THEN min(p.id::text)::uuid END INTO v_parent
      FROM ops.parents p
     WHERE (v_phone IS NOT NULL AND ops.phone_key(p.phone) = ops.phone_key(v_phone))
        OR (v_email IS NOT NULL AND lower(p.email) = v_email);

    INSERT INTO ops.inquiries (
      kind, first_name, last_name, phone, email, message, attribution,
      request_type, child_first_names, privacy_status, due_at, parent_id, details, consents
    ) VALUES (
      p_kind, v_first, v_last, v_phone, v_email, v_message, ops.clean_attribution(p_attribution),
      v_req_type, coalesce(v_children, '{}'), 'received',
      -- 45 days to answer (§541.052(b)); an appeal is decided within 60 (§541.053(b)).
      now() + CASE WHEN v_req_type = 'appeal' THEN interval '60 days' ELSE interval '45 days' END,
      v_parent, v_details, v_consents
    )
    RETURNING id INTO v_id;

    PERFORM ops.audit('website', 'privacy.received', 'inquiry', v_id,
                      jsonb_build_object('request_type', v_req_type, 'matched_family', v_parent IS NOT NULL));
    RETURN v_id;
  END IF;

  -- Only a session that exists; a stale id from a cached page is dropped, not an error.
  IF (v_details ->> 'offering_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT o.id INTO v_offering FROM ops.programs o WHERE o.id = (v_details ->> 'offering_id')::uuid;
  END IF;

  IF jsonb_typeof(v_details -> 'inquiry_types') = 'array' THEN
    SELECT coalesce(array_agg(left(btrim(x), 50)) FILTER (WHERE btrim(x) <> ''), '{}')
      INTO v_types
      FROM (SELECT jsonb_array_elements_text(v_details -> 'inquiry_types') AS x LIMIT 10) s;
  END IF;

  INSERT INTO ops.inquiries (
    kind, first_name, last_name, phone, email, message, child_ages, offering_id,
    sport, inquiry_types, preferred_date, organization, attribution, details, consents
  ) VALUES (
    p_kind, v_first, v_last, v_phone, v_email, v_message,
    left(nullif(btrim(v_details ->> 'child_ages'), ''), 200),
    v_offering,
    left(nullif(btrim(v_details ->> 'sport'), ''), 50),
    coalesce(v_types, '{}'),
    left(nullif(btrim(v_details ->> 'preferred_date'), ''), 50),
    v_org,
    ops.clean_attribution(p_attribution),
    v_details,
    v_consents
  )
  RETURNING id INTO v_id;

  -- An opt-in here counts for the family on file with this number or address.
  IF v_consents IS NOT NULL THEN
    IF v_consents -> 'sms' = 'true'::jsonb THEN
      FOR v_match IN SELECT p.id FROM ops.parents p WHERE ops.phone_key(p.phone) = ops.phone_key(v_phone) LOOP
        PERFORM ops.record_consent('sms', true, 'website_inquiry', v_match.id, NULL, NULL, now(),
                                   v_consents ->> 'policy_version',
                                   CASE WHEN jsonb_typeof(v_consents -> 'documents') = 'object' THEN v_consents -> 'documents' END);
      END LOOP;
    END IF;
    IF v_consents -> 'marketing_email' = 'true'::jsonb AND v_email IS NOT NULL THEN
      FOR v_match IN SELECT p.id FROM ops.parents p WHERE lower(p.email) = v_email LOOP
        PERFORM ops.record_consent('marketing_email', true, 'website_inquiry', v_match.id, NULL, NULL, now(),
                                   v_consents ->> 'policy_version',
                                   CASE WHEN jsonb_typeof(v_consents -> 'documents') = 'object' THEN v_consents -> 'documents' END);
      END LOOP;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_inquiry(text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_inquiry(text, jsonb, jsonb, jsonb) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Who "the family" is, for export and erasure.
--
-- The parent who asked and every child linked to them. A co-parent is a
-- separate person with their own rights: their record is neither exported
-- to nor erased by someone else's request.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.family_children(p_parent_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT sp.student_id), '{}') FROM ops.student_parents sp WHERE sp.parent_id = p_parent_id
$$;

REVOKE ALL ON FUNCTION ops.family_children(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.family_children(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Export: everything held about the family, as one JSON document.
--
-- Leaves out only what would let someone act as the family rather than
-- describe it: the private payment-page token and saved-payment ids.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.export_family(p_parent_id uuid, p_actor text DEFAULT 'admin', p_actor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent   ops.parents%ROWTYPE;
  v_kids     uuid[];
  v_phonekey text;
  v_email    text;
  v_invoices uuid[];
  v_out      jsonb;
BEGIN
  SELECT * INTO v_parent FROM ops.parents WHERE id = p_parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That family no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_kids     := ops.family_children(p_parent_id);
  v_phonekey := ops.phone_key(v_parent.phone);
  v_email    := lower(v_parent.email);

  SELECT coalesce(array_agg(id), '{}') INTO v_invoices
    FROM ops.invoices WHERE parent_id = p_parent_id OR student_id = ANY (v_kids);

  v_out := jsonb_build_object(
    'format', 'coachos-family-export/1',
    'generated_at', now(),
    'parent', to_jsonb(v_parent) - ARRAY['pay_token', 'autopay_payment_method_id', 'autopay_verify_url', 'stripe_customer_id'],
    'children', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.first_name), '[]') FROM ops.students s WHERE s.id = ANY (v_kids)),
    'guardian_links', (SELECT coalesce(jsonb_agg(jsonb_build_object('student_id', sp.student_id, 'parent_id', sp.parent_id, 'relationship', sp.relationship)), '[]')
                         FROM ops.student_parents sp WHERE sp.student_id = ANY (v_kids)),
    'enrollments', (SELECT coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('program_name', p.name) ORDER BY e.enrolled_at), '[]')
                      FROM ops.enrollments e JOIN ops.programs p ON p.id = e.program_id WHERE e.student_id = ANY (v_kids)),
    'attendance', (SELECT coalesce(jsonb_agg(jsonb_build_object('student_id', a.student_id, 'date', se.date, 'status', a.status,
                                                                'checked_in_at', a.checked_in_at, 'notes', a.notes) ORDER BY se.date), '[]')
                     FROM ops.attendance a JOIN ops.sessions se ON se.id = a.session_id WHERE a.student_id = ANY (v_kids)),
    'invoices', (SELECT coalesce(jsonb_agg(to_jsonb(i) - ARRAY['autopay_payment_intent_id', 'stripe_invoice_id', 'stripe_hosted_invoice_url'] ORDER BY i.month), '[]')
                   FROM ops.invoices i WHERE i.id = ANY (v_invoices)),
    'payments', (SELECT coalesce(jsonb_agg(to_jsonb(pm) - ARRAY['external_id', 'client_key'] ORDER BY pm.received_at), '[]')
                   FROM ops.payments pm WHERE pm.invoice_id = ANY (v_invoices)),
    'credits', (SELECT coalesce(jsonb_agg(to_jsonb(fc) - ARRAY['client_key'] ORDER BY fc.created_at), '[]')
                  FROM ops.family_credits fc WHERE fc.parent_id = p_parent_id),
    'registrations', (SELECT coalesce(jsonb_agg(to_jsonb(r) - ARRAY['stripe_checkout_session_id', 'idempotency_key'] ORDER BY r.created_at), '[]')
                        FROM ops.registrations r
                       WHERE r.parent_id = p_parent_id OR r.student_id = ANY (v_kids)
                          OR (v_phonekey IS NOT NULL AND ops.phone_key(r.parent_phone) = v_phonekey)),
    'inquiries', (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at), '[]')
                    FROM ops.inquiries q
                   WHERE q.parent_id = p_parent_id
                      OR (v_phonekey IS NOT NULL AND ops.phone_key(q.phone) = v_phonekey)
                      OR (v_email IS NOT NULL AND lower(q.email) = v_email)),
    'messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('created_at', m.created_at, 'to', m.recipient_phone, 'message', m.message,
                                                              'status', m.status, 'sent_via', m.sent_via) ORDER BY m.created_at), '[]')
                   FROM ops.message_queue m
                  WHERE m.parent_id = p_parent_id OR (v_phonekey IS NOT NULL AND ops.phone_key(m.recipient_phone) = v_phonekey)),
    'emails', (SELECT coalesce(jsonb_agg(jsonb_build_object('created_at', em.created_at, 'kind', em.kind, 'to', em.to_address,
                                                            'subject', em.subject, 'body', em.body_text, 'status', em.status) ORDER BY em.created_at), '[]')
                 FROM ops.emails em WHERE em.parent_id = p_parent_id),
    'zelle_payments_received', (SELECT coalesce(jsonb_agg(jsonb_build_object('received_at', z.received_at, 'sender_name', z.sender_name,
                                                                             'amount', z.amount, 'memo', z.memo) ORDER BY z.received_at), '[]')
                                  FROM ops.zelle_receipts z WHERE z.parent_id = p_parent_id),
    'consent_history', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', cl.kind, 'granted', cl.granted, 'source', cl.source,
                                                                     'policy_version', cl.policy_version, 'documents', cl.documents,
                                                                     'recorded_at', cl.recorded_at, 'student_id', cl.student_id) ORDER BY cl.recorded_at), '[]')
                          FROM ops.consent_log cl WHERE cl.parent_id = p_parent_id OR cl.student_id = ANY (v_kids))
  );

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION ops.export_family(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.export_family(uuid, text, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Erasure: remove who they were, keep what was paid.
--
-- Refuses while a child is still on a roster: withdraw them first, so a child
-- never turns up at practice as "Deleted".
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.anonymize_family(
  p_parent_id  uuid,
  p_request_id uuid DEFAULT NULL,
  p_actor      text DEFAULT 'admin',
  p_actor_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent   ops.parents%ROWTYPE;
  v_kids     uuid[];
  v_phonekey text;
  v_email    text;
  v_invoices uuid[];
  v_others   integer;
  n          integer;
  v_counts   jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_parent FROM ops.parents WHERE id = p_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That family no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_parent.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'This family has already been erased.' USING ERRCODE = 'P0001';
  END IF;

  v_kids     := ops.family_children(p_parent_id);
  v_phonekey := ops.phone_key(v_parent.phone);
  v_email    := lower(v_parent.email);

  IF EXISTS (SELECT 1 FROM ops.enrollments e WHERE e.student_id = ANY (v_kids) AND e.status = 'active') THEN
    RAISE EXCEPTION 'A child in this family is still enrolled. Withdraw them first, then erase the family.' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_invoices
    FROM ops.invoices WHERE parent_id = p_parent_id OR student_id = ANY (v_kids);

  -- The children. Attendance and enrollments stay, pointing at a nameless record.
  UPDATE ops.students
     SET first_name = 'Deleted', last_name = 'child', grade = NULL, date_of_birth = NULL,
         medical_notes = NULL, notes = NULL, status = 'inactive', photo_release = NULL,
         photo_release_at = NULL, anonymized_at = now()
   WHERE id = ANY (v_kids);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('children', n);

  UPDATE ops.attendance SET notes = NULL WHERE student_id = ANY (v_kids) AND notes IS NOT NULL;
  UPDATE ops.enrollments SET notes = NULL WHERE student_id = ANY (v_kids) AND notes IS NOT NULL;

  -- The parent. The payment link stops working; saved payment methods are forgotten.
  UPDATE ops.parents
     SET first_name = 'Deleted', last_name = 'family', email = NULL, phone = 'deleted',
         venmo_handle = NULL, zelle_identifier = NULL, notes = NULL,
         pay_token = encode(extensions.gen_random_bytes(24), 'hex'),
         autopay_status = 'off', autopay_method = NULL, autopay_payment_method_id = NULL,
         autopay_label = NULL, autopay_verify_url = NULL,
         sms_consent_at = NULL, marketing_email_consent_at = NULL,
         sms_opt_out_at = now(), marketing_email_opt_out_at = now(),
         anonymized_at = now()
   WHERE id = p_parent_id;

  -- Money: amounts and dates stay for the books, free text goes.
  UPDATE ops.invoices SET notes = NULL WHERE id = ANY (v_invoices) AND notes IS NOT NULL;
  UPDATE ops.payments SET notes = NULL WHERE invoice_id = ANY (v_invoices) AND notes IS NOT NULL;
  UPDATE ops.family_credits SET note = NULL WHERE parent_id = p_parent_id AND note IS NOT NULL;
  UPDATE ops.zelle_receipts
     SET sender_name = NULL, memo = NULL, subject = NULL, body = NULL, note = NULL
   WHERE parent_id = p_parent_id
      OR id IN (SELECT pm.zelle_receipt_id FROM ops.payments pm WHERE pm.invoice_id = ANY (v_invoices));
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('zelle_receipts', n);
  DELETE FROM ops.zelle_senders WHERE parent_id = p_parent_id;

  -- What the parent typed into the website.
  UPDATE ops.registrations
     SET child_first_name = 'Deleted', child_last_name = 'child', child_grade = NULL, child_date_of_birth = NULL,
         parent_first_name = 'Deleted', parent_last_name = 'family', parent_phone = 'deleted', parent_email = NULL,
         medical_notes = NULL, how_heard = NULL, notes = NULL, attribution = NULL, anonymized_at = now()
   WHERE parent_id = p_parent_id OR student_id = ANY (v_kids)
      OR (v_phonekey IS NOT NULL AND ops.phone_key(parent_phone) = v_phonekey);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('registrations', n);

  -- Their other questions. The privacy request itself is kept: it is the
  -- record that this was done.
  UPDATE ops.inquiries
     SET first_name = NULL, last_name = NULL, phone = NULL, email = NULL, message = NULL,
         child_ages = NULL, notes = NULL, attribution = NULL, organization = NULL, details = NULL, anonymized_at = now()
   WHERE kind <> 'privacy_request'
     AND ((v_phonekey IS NOT NULL AND ops.phone_key(phone) = v_phonekey)
       OR (v_email IS NOT NULL AND lower(email) = v_email));
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('inquiries', n);

  -- Messages and emails sent to them.
  UPDATE ops.message_queue
     SET recipient_phone = 'deleted', recipient_name = NULL, message = '[erased at the family''s request]'
   WHERE parent_id = p_parent_id OR (v_phonekey IS NOT NULL AND ops.phone_key(recipient_phone) = v_phonekey);
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('messages', n);
  UPDATE ops.message_log
     SET recipient_phone = 'deleted', recipient_name = NULL, message = '[erased at the family''s request]'
   WHERE v_phonekey IS NOT NULL AND ops.phone_key(recipient_phone) = v_phonekey;
  UPDATE ops.emails
     SET to_address = 'deleted', subject = '[erased]', body_text = '[erased at the family''s request]'
   WHERE parent_id = p_parent_id;
  GET DIAGNOSTICS n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('emails', n);

  -- Co-parents keep their own record; staff are told so they can ask them.
  SELECT count(DISTINCT sp.parent_id) INTO v_others
    FROM ops.student_parents sp WHERE sp.student_id = ANY (v_kids) AND sp.parent_id <> p_parent_id;
  v_counts := v_counts || jsonb_build_object('invoices_kept', cardinality(v_invoices), 'other_guardians', v_others);

  PERFORM ops.audit(p_actor, 'privacy.anonymize', 'parent', p_parent_id,
                    v_counts || jsonb_build_object('request_id', p_request_id, 'children_ids', to_jsonb(v_kids)), p_actor_id);

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION ops.anonymize_family(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.anonymize_family(uuid, uuid, text, uuid) TO service_role;
