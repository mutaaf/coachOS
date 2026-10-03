-- ============================================================================
-- A family's credit: money received that nothing was owed for yet.
--
-- More than was owed went into a note on the Zelle receipt, and a paid-up
-- family's payment couldn't be recorded at all, so the cash in hand didn't
-- match the books (issue #28). Now each is a row here, and every invoice run
-- spends a family's credit on what they owe, oldest first.
--
-- One ledger, per parent: a positive row is money in (with where it came
-- from), a negative row is credit spent (with the payment it made). The
-- balance is the sum. Deleting a payment made from credit deletes its row, so
-- the credit comes back by itself.
-- ============================================================================

SET search_path = ops, public, extensions;

-- A payment made from credit, so an invoice paid that way balances.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('cash', 'zelle', 'venmo', 'stripe', 'credit'));

CREATE TABLE family_credits (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Money is never lost with a family: archive them instead (see 20261003000600).
  parent_id        uuid          NOT NULL REFERENCES parents (id) ON DELETE RESTRICT,
  amount           numeric(10,2) NOT NULL CHECK (amount <> 0),
  -- Money in: how it came, and the Zelle email it came in, if any.
  method           text          CHECK (method IN ('cash', 'zelle', 'venmo')),
  zelle_receipt_id uuid          REFERENCES zelle_receipts (id) ON DELETE RESTRICT,
  -- Credit spent: the payment it made.
  payment_id       uuid          UNIQUE REFERENCES payments (id) ON DELETE CASCADE,
  -- Made by the form that recorded it, so sending it twice credits once.
  client_key       text,
  note             text,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CHECK ((amount > 0) = (payment_id IS NULL))
);

CREATE INDEX family_credits_parent ON family_credits (parent_id);
-- One Zelle email is credited once, however many times it is matched at once.
CREATE UNIQUE INDEX family_credits_receipt ON family_credits (zelle_receipt_id) WHERE zelle_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX family_credits_client_key ON family_credits (client_key) WHERE client_key IS NOT NULL;

ALTER TABLE family_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage family credits"
  ON family_credits FOR ALL TO authenticated USING (ops.is_admin()) WITH CHECK (ops.is_admin());
GRANT ALL ON family_credits TO authenticated, service_role;
REVOKE ALL ON family_credits FROM anon;

-- ----------------------------------------------------------------------------
-- Spend a family's credit on what they owe, oldest first.
--
-- In the database so two runs at once (the cron and the button) can't both
-- spend the same dollars: the parent's row is locked while it works. Returns
-- the invoices it paid toward; the app works out their status.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.apply_family_credit(p_parent uuid)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ops, public
AS $$
DECLARE
  v_left    bigint;
  v_take    bigint;
  v_inv     record;
  v_payment uuid;
  v_touched uuid[] := '{}';
BEGIN
  PERFORM 1 FROM parents WHERE id = p_parent FOR UPDATE;

  SELECT coalesce(round(sum(amount) * 100), 0) INTO v_left
    FROM family_credits WHERE parent_id = p_parent;
  IF v_left <= 0 THEN RETURN v_touched; END IF;

  -- Every child linked to this parent, whichever parent the invoice went to;
  -- nothing with a bank debit in flight.
  FOR v_inv IN
    SELECT i.id,
           round(i.amount * 100)
             - coalesce((SELECT round(sum(p.amount) * 100) FROM payments p WHERE p.invoice_id = i.id), 0) AS owed
      FROM invoices i
     WHERE i.student_id IN (SELECT student_id FROM student_parents WHERE parent_id = p_parent)
       AND i.status IN ('pending', 'overdue')
     ORDER BY i.due_date, i.created_at
     FOR UPDATE OF i
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN v_inv.owed <= 0;
    v_take := least(v_left, v_inv.owed);

    INSERT INTO payments (invoice_id, amount, method, notes)
    VALUES (v_inv.id, v_take / 100.0, 'credit', 'Paid from credit on file')
    RETURNING id INTO v_payment;

    INSERT INTO family_credits (parent_id, amount, payment_id)
    VALUES (p_parent, -v_take / 100.0, v_payment);

    v_left := v_left - v_take;
    v_touched := v_touched || v_inv.id;
  END LOOP;

  RETURN v_touched;
END;
$$;

REVOKE ALL ON FUNCTION ops.apply_family_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ops.apply_family_credit(uuid) TO service_role;

COMMENT ON TABLE family_credits IS
  'Money a family paid ahead or over what was owed (positive), and credit spent on invoices (negative). The sum is their credit.';
