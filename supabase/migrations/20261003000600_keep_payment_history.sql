-- ============================================================================
-- Deleting a child or a parent never takes their payment history with it.
--
-- Deleting a withdrawn child removed a paid $100 invoice and its cash payment
-- through ON DELETE CASCADE, and an unlinked parent's invoices went the same
-- way. The app now refuses and offers Archive; these constraints make sure
-- nothing else can cascade the history away either. An invoice with payments
-- already could not be deleted from the app until its payments were.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE invoices
  DROP CONSTRAINT invoices_student_id_fkey,
  ADD CONSTRAINT invoices_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE RESTRICT;

ALTER TABLE invoices
  DROP CONSTRAINT invoices_parent_id_fkey,
  ADD CONSTRAINT invoices_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES parents (id) ON DELETE RESTRICT;

ALTER TABLE payments
  DROP CONSTRAINT payments_invoice_id_fkey,
  ADD CONSTRAINT payments_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT;
