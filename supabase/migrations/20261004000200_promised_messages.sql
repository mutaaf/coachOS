-- ============================================================================
-- Only promise the messages the app sends.
--
-- Cancelling a practice told nobody, and /join said "we'll message you" when a
-- place opened while nothing did. Those now put a message in the Outbox (and,
-- for a seat, an email). Settings offered reminder times the once-a-day cron
-- never read, and two templates were protected as "sent automatically" that
-- nothing sent; they go.
--
-- A queued message can carry a key naming the event it is about
-- ("cancelled:<session>:<parent>"), so the same event asked twice — a double
-- tap, the website's ping and the daily sweep — queues it once.
-- ============================================================================

SET search_path = ops, public, extensions;

ALTER TABLE message_queue ADD COLUMN dedupe_key text UNIQUE;

COMMENT ON COLUMN message_queue.dedupe_key IS
  'The event this message is about, e.g. cancelled:<session id>:<parent id>. Queued at most once per key.';

ALTER TABLE emails DROP CONSTRAINT emails_kind_check;
ALTER TABLE emails ADD CONSTRAINT emails_kind_check
    CHECK (kind IN ('receipt', 'payment_failed', 'invite', 'reminder', 'registration', 'welcome', 'seat'));

DELETE FROM config
 WHERE key IN ('day_before_reminder_time', 'morning_reminder_time', 'message_rate_limit_seconds');

-- Welcome Messages was hidden because nothing read it; adding a child to the
-- roster now reads it, so it is back on the Settings page.
UPDATE config
   SET category = 'messaging',
       description = 'Put a welcome message in the Outbox when you add a child who signed up to the roster'
 WHERE key = 'welcome_message_enabled';

UPDATE config
   SET description = 'Once a day, around 1 pm, put a reminder in the Outbox for every family with practice the next day'
 WHERE key = 'practice_reminders_enabled';

DELETE FROM message_templates WHERE name IN ('practice_reminder_morning', 'payment_received');

-- Reworded templates are kept: only added where missing.
INSERT INTO message_templates (name, category, body, variables)
SELECT v.name, v.category, v.body, v.variables
  FROM (VALUES
    (
        'registration_received',
        'welcome',
        E'Hi {{parent_name}}! {{student_name}} is signed up for {{program_name}} at {{school_name}}. We''ll be in touch before the first practice. Welcome!',
        ARRAY['parent_name', 'student_name', 'program_name', 'school_name']
    ),
    (
        'waitlist_joined',
        'welcome',
        E'Hi {{parent_name}}, {{program_name}} is full right now, so {{student_name}} is #{{position}} on the waitlist. We''ll message you the moment a spot opens.',
        ARRAY['parent_name', 'program_name', 'student_name', 'position']
    ),
    (
        'waitlist_seat',
        'welcome',
        E'Good news, {{parent_name}}! A spot opened in {{program_name}} at {{school_name}} and it''s {{student_name}}''s. We''ll be in touch before the first practice.',
        ARRAY['parent_name', 'program_name', 'school_name', 'student_name']
    )
  ) AS v(name, category, body, variables)
 WHERE NOT EXISTS (SELECT 1 FROM message_templates t WHERE t.name = v.name);
