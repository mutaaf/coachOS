-- Families can Zelle to more than one place — the owner's phone number and her
-- email. The payment page now shows each separately, with its own copy button.
SET search_path = ops, public, extensions;

UPDATE config
   SET label = 'Zelle Numbers or Emails',
       description = 'Where parents send Zelle payments, shown on each family''s payment page. Separate several with commas.'
 WHERE key = 'zelle_recipient';
