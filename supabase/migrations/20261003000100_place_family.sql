-- ============================================================================
-- Put a family where a payment says they belong, all at once.
--
-- A Zelle payment (or cash) arrives from someone CoachOS doesn't know. The
-- owner says who it is: maybe a new parent, a new child, even a school or
-- program not set up yet. Everything that needs creating is created here in
-- one transaction, so a mistake halfway leaves nothing behind — no parent
-- without a child, no child without a program.
--
-- Each level is either an existing id or the details of a new one. Names that
-- already exist are reused rather than duplicated: a "new" school called
-- "lakehill elementary" is Lakehill Elementary.
--
-- The caller (lib/payment-assign.ts) has already normalised the phone and
-- matched the parent by it; this function trusts the ids it is given.
-- ============================================================================

SET search_path = ops, public, extensions;

CREATE OR REPLACE FUNCTION ops.place_family(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ops, public, extensions
AS $$
DECLARE
  v_school_id   uuid := nullif(p #>> '{school,id}', '')::uuid;
  v_program_id  uuid := nullif(p #>> '{program,id}', '')::uuid;
  v_parent_id   uuid := nullif(p #>> '{parent,id}', '')::uuid;
  v_student_id  uuid := nullif(p #>> '{student,id}', '')::uuid;
  v_month       text := p ->> 'month';
  v_fee         numeric;
  v_invoice_id  uuid;
  created       text[] := '{}';
BEGIN
  IF v_month IS NULL OR v_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'month must be YYYY-MM';
  END IF;

  -- School ------------------------------------------------------------------
  IF v_program_id IS NULL AND v_school_id IS NULL THEN
    IF coalesce(btrim(p #>> '{school,name}'), '') = '' THEN
      RAISE EXCEPTION 'Pick a school, or name the new one';
    END IF;
    SELECT id INTO v_school_id FROM schools
     WHERE lower(btrim(name)) = lower(btrim(p #>> '{school,name}')) AND status <> 'archived'
     LIMIT 1;
    IF v_school_id IS NULL THEN
      INSERT INTO schools (name) VALUES (btrim(p #>> '{school,name}')) RETURNING id INTO v_school_id;
      created := array_append(created, 'school');
    END IF;
  END IF;

  -- Program -----------------------------------------------------------------
  IF v_program_id IS NULL THEN
    IF coalesce(btrim(p #>> '{program,name}'), '') = '' THEN
      RAISE EXCEPTION 'Pick a program, or name the new one';
    END IF;
    SELECT id INTO v_program_id FROM programs
     WHERE school_id = v_school_id
       AND lower(btrim(name)) = lower(btrim(p #>> '{program,name}'))
       AND status IN ('active', 'upcoming')
     LIMIT 1;
    IF v_program_id IS NULL THEN
      v_fee := nullif(p #>> '{program,monthly_fee}', '')::numeric;
      IF v_fee IS NULL OR v_fee <= 0 THEN
        RAISE EXCEPTION 'A new program needs its monthly fee';
      END IF;
      INSERT INTO programs (school_id, name, monthly_fee)
      VALUES (v_school_id, btrim(p #>> '{program,name}'), v_fee)
      RETURNING id INTO v_program_id;
      created := array_append(created, 'program');
    END IF;
  END IF;
  SELECT monthly_fee INTO v_fee FROM programs WHERE id = v_program_id;
  IF v_fee IS NULL THEN RAISE EXCEPTION 'That program no longer exists'; END IF;

  -- Parent ------------------------------------------------------------------
  IF v_parent_id IS NULL THEN
    IF coalesce(btrim(p #>> '{parent,first_name}'), '') = '' OR coalesce(btrim(p #>> '{parent,phone}'), '') = '' THEN
      RAISE EXCEPTION 'A new family needs the parent''s name and phone';
    END IF;
    INSERT INTO parents (first_name, last_name, phone, email, preferred_payment, zelle_identifier)
    VALUES (
      btrim(p #>> '{parent,first_name}'),
      coalesce(nullif(btrim(p #>> '{parent,last_name}'), ''), btrim(p #>> '{student,last_name}'), ''),
      btrim(p #>> '{parent,phone}'),
      nullif(btrim(p #>> '{parent,email}'), ''),
      coalesce(nullif(p #>> '{parent,preferred_payment}', ''), 'zelle'),
      nullif(btrim(p #>> '{parent,zelle_identifier}'), '')
    )
    RETURNING id INTO v_parent_id;
    created := array_append(created, 'parent');
  END IF;

  -- Child -------------------------------------------------------------------
  IF v_student_id IS NULL THEN
    IF coalesce(btrim(p #>> '{student,first_name}'), '') = '' THEN
      RAISE EXCEPTION 'Pick the child, or enter the new child''s name';
    END IF;
    INSERT INTO students (first_name, last_name, grade)
    VALUES (
      btrim(p #>> '{student,first_name}'),
      coalesce(nullif(btrim(p #>> '{student,last_name}'), ''), (SELECT last_name FROM parents WHERE id = v_parent_id)),
      nullif(btrim(p #>> '{student,grade}'), '')
    )
    RETURNING id INTO v_student_id;
    created := array_append(created, 'student');
  END IF;

  INSERT INTO student_parents (student_id, parent_id, relationship)
  VALUES (v_student_id, v_parent_id, 'parent')
  ON CONFLICT DO NOTHING;

  -- Enrollment --------------------------------------------------------------
  INSERT INTO enrollments (student_id, program_id, status)
  VALUES (v_student_id, v_program_id, 'active')
  ON CONFLICT (student_id, program_id) DO UPDATE SET status = 'active'
  WHERE enrollments.status <> 'active';

  -- This month's invoice: one per child per program, whoever is billed ------
  SELECT id INTO v_invoice_id FROM invoices
   WHERE student_id = v_student_id AND program_id = v_program_id AND month = v_month
   LIMIT 1;
  IF v_invoice_id IS NULL THEN
    INSERT INTO invoices (parent_id, student_id, program_id, amount, month, due_date, status)
    VALUES (v_parent_id, v_student_id, v_program_id, v_fee, v_month, (v_month || '-01')::date, 'pending')
    RETURNING id INTO v_invoice_id;
    created := array_append(created, 'invoice');
  END IF;

  RETURN jsonb_build_object(
    'school_id', (SELECT school_id FROM programs WHERE id = v_program_id),
    'program_id', v_program_id,
    'parent_id', v_parent_id,
    'student_id', v_student_id,
    'invoice_id', v_invoice_id,
    'created', to_jsonb(created)
  );
END;
$$;

-- Only the server, holding the service role, may call it. Supabase grants
-- EXECUTE on new functions to anon and authenticated directly, so revoking
-- from PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION ops.place_family(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.place_family(jsonb) TO service_role;
