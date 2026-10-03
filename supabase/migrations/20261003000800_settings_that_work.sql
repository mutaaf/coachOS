-- ============================================================================
-- Settings show only what the app does.
--
-- Settings said "in effect now" for ten values nothing read. Payment Due Day
-- and Default Monthly Fee are now used (lib/invoices.ts, the Add Program and
-- roster-import forms); the rest are taken off the Settings page. None of them
-- was read by any code, before or after this change, so the old code is
-- unaffected.
--
-- They are moved to 'internal' — kept by the app, never shown for editing —
-- rather than deleted, so this stays additive; a later release can drop them.
-- ============================================================================

SET search_path = ops, public, extensions;

UPDATE config SET category = 'internal' WHERE key IN (
    'coach_name',
    'coach_phone',
    'day_before_reminder_time',
    'morning_reminder_time',
    'welcome_message_enabled',
    'message_rate_limit_seconds',
    'default_session_duration_minutes',
    'auto_generate_sessions_weeks'
);

UPDATE config
   SET label = 'Payment Due Day',
       description = 'Day of the month (1 to 28) invoices fall due. A child who joins mid-month still gets a week to pay.'
 WHERE key = 'payment_due_day';

-- A due day no month has would be read as the 1st; make the stored value say so.
UPDATE config SET value = '1'
 WHERE key = 'payment_due_day'
   AND NOT (value ~ '^\s*([1-9]|1[0-9]|2[0-8])\s*$');

UPDATE config
   SET description = 'The fee filled in for you when you add a program or import a roster into a new one.'
 WHERE key = 'default_monthly_fee';

UPDATE config
   SET description = 'The sender parents see: a name, then an address at risingstars.training, like Rising Stars <payments@risingstars.training>.'
 WHERE key = 'email_from';
