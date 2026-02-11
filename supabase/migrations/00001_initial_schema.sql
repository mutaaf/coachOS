-- ============================================================================
-- CoachOS Initial Schema Migration
-- Youth Sports Coaching Business OS
-- ============================================================================

-- ============================================================================
-- 1. UTILITY: updated_at trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- --------------------------------------------------------------------------
-- schools
-- --------------------------------------------------------------------------
CREATE TABLE schools (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    address     text,
    contact_name    text,
    contact_email   text,
    contact_phone   text,
    whatsapp_group_id text,
    status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive', 'archived')),
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- programs
-- --------------------------------------------------------------------------
CREATE TABLE programs (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id   uuid        NOT NULL REFERENCES schools (id) ON DELETE CASCADE,
    name        text        NOT NULL,
    season      text,
    start_date  date,
    end_date    date,
    monthly_fee numeric(10,2) NOT NULL DEFAULT 120.00,
    status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'upcoming', 'completed', 'cancelled')),
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- students
-- --------------------------------------------------------------------------
CREATE TABLE students (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name      text        NOT NULL,
    last_name       text        NOT NULL,
    grade           text,
    date_of_birth   date,
    medical_notes   text,
    notes           text,
    status          text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- parents
-- --------------------------------------------------------------------------
CREATE TABLE parents (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name          text        NOT NULL,
    last_name           text        NOT NULL,
    email               text,
    phone               text        NOT NULL,
    preferred_payment   text        NOT NULL DEFAULT 'cash'
                                    CHECK (preferred_payment IN ('cash', 'zelle', 'venmo')),
    venmo_handle        text,
    zelle_identifier    text,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- student_parents (junction)
-- --------------------------------------------------------------------------
CREATE TABLE student_parents (
    student_id      uuid    NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    parent_id       uuid    NOT NULL REFERENCES parents (id) ON DELETE CASCADE,
    relationship    text    NOT NULL DEFAULT 'parent',
    PRIMARY KEY (student_id, parent_id)
);

-- --------------------------------------------------------------------------
-- enrollments
-- --------------------------------------------------------------------------
CREATE TABLE enrollments (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  uuid        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    program_id  uuid        NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    status      text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'withdrawn', 'completed')),
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (student_id, program_id)
);

-- --------------------------------------------------------------------------
-- schedule_templates
-- --------------------------------------------------------------------------
CREATE TABLE schedule_templates (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id  uuid    NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time  time    NOT NULL,
    end_time    time    NOT NULL,
    location    text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- sessions
-- --------------------------------------------------------------------------
CREATE TABLE sessions (
    id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_template_id uuid   REFERENCES schedule_templates (id) ON DELETE SET NULL,
    program_id          uuid    NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    date                date    NOT NULL,
    start_time          time    NOT NULL,
    end_time            time    NOT NULL,
    status              text    NOT NULL DEFAULT 'scheduled'
                                CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    cancel_reason       text,
    is_makeup           boolean NOT NULL DEFAULT false,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- attendance
-- --------------------------------------------------------------------------
CREATE TABLE attendance (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    student_id      uuid        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    status          text        NOT NULL DEFAULT 'present'
                                CHECK (status IN ('present', 'absent', 'late', 'excused')),
    checked_in_at   timestamptz,
    notes           text,
    UNIQUE (session_id, student_id)
);

-- --------------------------------------------------------------------------
-- invoices
-- --------------------------------------------------------------------------
CREATE TABLE invoices (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   uuid            NOT NULL REFERENCES parents (id) ON DELETE CASCADE,
    student_id  uuid            NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    program_id  uuid            NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    amount      numeric(10,2)   NOT NULL,
    month       text            NOT NULL,  -- YYYY-MM format
    due_date    date            NOT NULL,
    status      text            NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'paid', 'overdue', 'waived')),
    notes       text,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (parent_id, student_id, program_id, month)
);

-- --------------------------------------------------------------------------
-- payments
-- --------------------------------------------------------------------------
CREATE TABLE payments (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  uuid            NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    amount      numeric(10,2)   NOT NULL,
    method      text            NOT NULL
                                CHECK (method IN ('cash', 'zelle', 'venmo')),
    reference   text,
    received_at timestamptz     NOT NULL DEFAULT now(),
    notes       text,
    created_at  timestamptz     NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- message_templates
-- --------------------------------------------------------------------------
CREATE TABLE message_templates (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    category    text        NOT NULL
                            CHECK (category IN ('reminder', 'payment', 'welcome', 'cancellation', 'general')),
    body        text        NOT NULL,
    variables   text[]      NOT NULL DEFAULT '{}',
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- message_queue
-- --------------------------------------------------------------------------
CREATE TABLE message_queue (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_phone text        NOT NULL,
    recipient_name  text,
    message         text        NOT NULL,
    template_id     uuid        REFERENCES message_templates (id) ON DELETE SET NULL,
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts        integer     NOT NULL DEFAULT 0,
    max_attempts    integer     NOT NULL DEFAULT 3,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- message_log
-- --------------------------------------------------------------------------
CREATE TABLE message_log (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id            uuid        REFERENCES message_queue (id) ON DELETE SET NULL,
    recipient_phone     text        NOT NULL,
    recipient_name      text,
    message             text        NOT NULL,
    status              text        NOT NULL DEFAULT 'sent'
                                    CHECK (status IN ('sent', 'failed', 'delivered', 'read')),
    sent_at             timestamptz NOT NULL DEFAULT now(),
    whatsapp_message_id text,
    error               text
);

-- --------------------------------------------------------------------------
-- leads
-- --------------------------------------------------------------------------
CREATE TABLE leads (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_name         text        NOT NULL,
    contact_name        text,
    contact_email       text,
    contact_phone       text,
    address             text,
    stage               text        NOT NULL DEFAULT 'identified'
                                    CHECK (stage IN ('identified', 'contacted', 'meeting', 'proposal', 'signed', 'lost')),
    estimated_students  integer,
    notes               text,
    next_follow_up      date,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- lead_activities
-- --------------------------------------------------------------------------
CREATE TABLE lead_activities (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id     uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    type        text        NOT NULL
                            CHECK (type IN ('note', 'call', 'email', 'meeting', 'stage_change')),
    description text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- config
-- --------------------------------------------------------------------------
CREATE TABLE config (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    category    text    NOT NULL,
    key         text    NOT NULL UNIQUE,
    value       text    NOT NULL,
    label       text    NOT NULL,
    description text,
    field_type  text    NOT NULL
                        CHECK (field_type IN ('toggle', 'number', 'text', 'time', 'select', 'textarea')),
    options     jsonb,
    sort_order  integer NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------------------
-- whatsapp_state
-- --------------------------------------------------------------------------
CREATE TABLE whatsapp_state (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    status            text        NOT NULL DEFAULT 'disconnected'
                                  CHECK (status IN ('disconnected', 'connecting', 'qr_ready', 'connected')),
    qr_code           text,
    phone_number      text,
    last_connected_at timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- 3. TRIGGERS: auto-update updated_at
-- ============================================================================

CREATE TRIGGER set_updated_at_schools
    BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_programs
    BEFORE UPDATE ON programs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_students
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_parents
    BEFORE UPDATE ON parents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_invoices
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_message_templates
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_message_queue
    BEFORE UPDATE ON message_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_leads
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_whatsapp_state
    BEFORE UPDATE ON whatsapp_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- 4. INDEXES
-- ============================================================================

-- schools
CREATE INDEX idx_schools_status ON schools (status);

-- programs
CREATE INDEX idx_programs_school_id ON programs (school_id);
CREATE INDEX idx_programs_status ON programs (status);
CREATE INDEX idx_programs_start_date ON programs (start_date);
CREATE INDEX idx_programs_end_date ON programs (end_date);

-- students
CREATE INDEX idx_students_status ON students (status);
CREATE INDEX idx_students_last_name ON students (last_name);

-- parents
CREATE INDEX idx_parents_phone ON parents (phone);
CREATE INDEX idx_parents_email ON parents (email);

-- student_parents
CREATE INDEX idx_student_parents_parent_id ON student_parents (parent_id);

-- enrollments
CREATE INDEX idx_enrollments_student_id ON enrollments (student_id);
CREATE INDEX idx_enrollments_program_id ON enrollments (program_id);
CREATE INDEX idx_enrollments_status ON enrollments (status);

-- schedule_templates
CREATE INDEX idx_schedule_templates_program_id ON schedule_templates (program_id);
CREATE INDEX idx_schedule_templates_day_of_week ON schedule_templates (day_of_week);

-- sessions
CREATE INDEX idx_sessions_program_id ON sessions (program_id);
CREATE INDEX idx_sessions_schedule_template_id ON sessions (schedule_template_id);
CREATE INDEX idx_sessions_date ON sessions (date);
CREATE INDEX idx_sessions_status ON sessions (status);
CREATE INDEX idx_sessions_program_date ON sessions (program_id, date);

-- attendance
CREATE INDEX idx_attendance_session_id ON attendance (session_id);
CREATE INDEX idx_attendance_student_id ON attendance (student_id);
CREATE INDEX idx_attendance_status ON attendance (status);

-- invoices
CREATE INDEX idx_invoices_parent_id ON invoices (parent_id);
CREATE INDEX idx_invoices_student_id ON invoices (student_id);
CREATE INDEX idx_invoices_program_id ON invoices (program_id);
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_month ON invoices (month);
CREATE INDEX idx_invoices_due_date ON invoices (due_date);

-- payments
CREATE INDEX idx_payments_invoice_id ON payments (invoice_id);
CREATE INDEX idx_payments_method ON payments (method);
CREATE INDEX idx_payments_received_at ON payments (received_at);

-- message_templates
CREATE INDEX idx_message_templates_category ON message_templates (category);
CREATE INDEX idx_message_templates_is_active ON message_templates (is_active);

-- message_queue
CREATE INDEX idx_message_queue_status ON message_queue (status);
CREATE INDEX idx_message_queue_next_attempt_at ON message_queue (next_attempt_at);
CREATE INDEX idx_message_queue_template_id ON message_queue (template_id);

-- message_log
CREATE INDEX idx_message_log_queue_id ON message_log (queue_id);
CREATE INDEX idx_message_log_status ON message_log (status);
CREATE INDEX idx_message_log_sent_at ON message_log (sent_at);

-- leads
CREATE INDEX idx_leads_stage ON leads (stage);
CREATE INDEX idx_leads_next_follow_up ON leads (next_follow_up);

-- lead_activities
CREATE INDEX idx_lead_activities_lead_id ON lead_activities (lead_id);
CREATE INDEX idx_lead_activities_type ON lead_activities (type);
CREATE INDEX idx_lead_activities_created_at ON lead_activities (created_at);

-- config
CREATE INDEX idx_config_category ON config (category);


-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE schools            ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE students           ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_state     ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users have full access (single-coach application)

-- schools
CREATE POLICY "Authenticated users can select schools"
    ON schools FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert schools"
    ON schools FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update schools"
    ON schools FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete schools"
    ON schools FOR DELETE TO authenticated USING (true);

-- programs
CREATE POLICY "Authenticated users can select programs"
    ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert programs"
    ON programs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update programs"
    ON programs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete programs"
    ON programs FOR DELETE TO authenticated USING (true);

-- students
CREATE POLICY "Authenticated users can select students"
    ON students FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert students"
    ON students FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update students"
    ON students FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete students"
    ON students FOR DELETE TO authenticated USING (true);

-- parents
CREATE POLICY "Authenticated users can select parents"
    ON parents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert parents"
    ON parents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update parents"
    ON parents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete parents"
    ON parents FOR DELETE TO authenticated USING (true);

-- student_parents
CREATE POLICY "Authenticated users can select student_parents"
    ON student_parents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert student_parents"
    ON student_parents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update student_parents"
    ON student_parents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete student_parents"
    ON student_parents FOR DELETE TO authenticated USING (true);

-- enrollments
CREATE POLICY "Authenticated users can select enrollments"
    ON enrollments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert enrollments"
    ON enrollments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update enrollments"
    ON enrollments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete enrollments"
    ON enrollments FOR DELETE TO authenticated USING (true);

-- schedule_templates
CREATE POLICY "Authenticated users can select schedule_templates"
    ON schedule_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert schedule_templates"
    ON schedule_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update schedule_templates"
    ON schedule_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete schedule_templates"
    ON schedule_templates FOR DELETE TO authenticated USING (true);

-- sessions
CREATE POLICY "Authenticated users can select sessions"
    ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert sessions"
    ON sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update sessions"
    ON sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete sessions"
    ON sessions FOR DELETE TO authenticated USING (true);

-- attendance
CREATE POLICY "Authenticated users can select attendance"
    ON attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert attendance"
    ON attendance FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update attendance"
    ON attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete attendance"
    ON attendance FOR DELETE TO authenticated USING (true);

-- invoices
CREATE POLICY "Authenticated users can select invoices"
    ON invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert invoices"
    ON invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update invoices"
    ON invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete invoices"
    ON invoices FOR DELETE TO authenticated USING (true);

-- payments
CREATE POLICY "Authenticated users can select payments"
    ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert payments"
    ON payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update payments"
    ON payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete payments"
    ON payments FOR DELETE TO authenticated USING (true);

-- message_templates
CREATE POLICY "Authenticated users can select message_templates"
    ON message_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert message_templates"
    ON message_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update message_templates"
    ON message_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete message_templates"
    ON message_templates FOR DELETE TO authenticated USING (true);

-- message_queue
CREATE POLICY "Authenticated users can select message_queue"
    ON message_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert message_queue"
    ON message_queue FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update message_queue"
    ON message_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete message_queue"
    ON message_queue FOR DELETE TO authenticated USING (true);

-- message_log
CREATE POLICY "Authenticated users can select message_log"
    ON message_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert message_log"
    ON message_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update message_log"
    ON message_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete message_log"
    ON message_log FOR DELETE TO authenticated USING (true);

-- leads
CREATE POLICY "Authenticated users can select leads"
    ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert leads"
    ON leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update leads"
    ON leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete leads"
    ON leads FOR DELETE TO authenticated USING (true);

-- lead_activities
CREATE POLICY "Authenticated users can select lead_activities"
    ON lead_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert lead_activities"
    ON lead_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update lead_activities"
    ON lead_activities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete lead_activities"
    ON lead_activities FOR DELETE TO authenticated USING (true);

-- config
CREATE POLICY "Authenticated users can select config"
    ON config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert config"
    ON config FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update config"
    ON config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete config"
    ON config FOR DELETE TO authenticated USING (true);

-- whatsapp_state
CREATE POLICY "Authenticated users can select whatsapp_state"
    ON whatsapp_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert whatsapp_state"
    ON whatsapp_state FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update whatsapp_state"
    ON whatsapp_state FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete whatsapp_state"
    ON whatsapp_state FOR DELETE TO authenticated USING (true);

-- Also allow service_role full access (needed for background jobs / server-side)
-- service_role bypasses RLS by default in Supabase, so no explicit policies needed.


-- ============================================================================
-- 6. SEED DATA: config
-- ============================================================================

INSERT INTO config (category, key, value, label, description, field_type, sort_order) VALUES
    -- General
    ('general', 'business_name', 'CoachOS', 'Business Name', 'The name of your coaching business', 'text', 1),
    ('general', 'coach_name', '', 'Coach Name', 'Your full name', 'text', 2),
    ('general', 'coach_phone', '', 'Coach Phone', 'Your phone number for WhatsApp', 'text', 3),

    -- Messaging
    ('messaging', 'practice_reminders_enabled', 'true', 'Practice Reminders', 'Send automated practice reminders to parents', 'toggle', 1),
    ('messaging', 'day_before_reminder_time', '18:00', 'Day-Before Reminder Time', 'Time to send the evening-before practice reminder', 'time', 2),
    ('messaging', 'morning_reminder_time', '07:00', 'Morning Reminder Time', 'Time to send the morning-of practice reminder', 'time', 3),
    ('messaging', 'payment_reminders_enabled', 'true', 'Payment Reminders', 'Send automated payment reminders to parents', 'toggle', 4),
    ('messaging', 'payment_reminder_days_after_due', '3', 'Payment Reminder Delay (days)', 'Number of days after due date to send payment reminder', 'number', 5),
    ('messaging', 'welcome_message_enabled', 'true', 'Welcome Messages', 'Send automated welcome messages to new enrollments', 'toggle', 6),
    ('messaging', 'message_rate_limit_seconds', '3', 'Message Rate Limit (seconds)', 'Minimum seconds between outgoing WhatsApp messages', 'number', 7),

    -- Payments
    ('payments', 'default_monthly_fee', '120', 'Default Monthly Fee', 'Default monthly fee for new programs', 'number', 1),
    ('payments', 'payment_due_day', '1', 'Payment Due Day', 'Day of the month payments are due', 'number', 2),
    ('payments', 'auto_generate_invoices', 'true', 'Auto-Generate Invoices', 'Automatically generate monthly invoices for active enrollments', 'toggle', 3),

    -- Scheduling
    ('scheduling', 'default_session_duration_minutes', '60', 'Default Session Duration (min)', 'Default duration for new sessions in minutes', 'number', 1),
    ('scheduling', 'auto_generate_sessions_weeks', '4', 'Auto-Generate Sessions (weeks)', 'Number of weeks ahead to auto-generate sessions', 'number', 2);


-- ============================================================================
-- 7. SEED DATA: message_templates
-- ============================================================================

INSERT INTO message_templates (name, category, body, variables) VALUES
    (
        'practice_reminder_day_before',
        'reminder',
        E'Hi {{parent_name}}! Reminder: {{student_name}} has {{program_name}} practice tomorrow at {{time}} at {{school_name}}. See you there!',
        ARRAY['parent_name', 'student_name', 'program_name', 'time', 'school_name']
    ),
    (
        'practice_reminder_morning',
        'reminder',
        E'Good morning {{parent_name}}! {{student_name}} has {{program_name}} today at {{time}}. Don''t forget!',
        ARRAY['parent_name', 'student_name', 'program_name', 'time']
    ),
    (
        'payment_reminder',
        'payment',
        E'Hi {{parent_name}}, this is a friendly reminder that the {{month}} payment of {{amount}} for {{student_name}}''s {{program_name}} is due. Please send via {{payment_method}}. Thank you!',
        ARRAY['parent_name', 'month', 'amount', 'student_name', 'program_name', 'payment_method']
    ),
    (
        'welcome_message',
        'welcome',
        E'Welcome to {{program_name}} at {{school_name}}! We''re excited to have {{student_name}} join us. Sessions are {{schedule}}. Please reach out if you have any questions!',
        ARRAY['program_name', 'school_name', 'student_name', 'schedule']
    ),
    (
        'session_cancelled',
        'cancellation',
        E'Hi {{parent_name}}, unfortunately {{program_name}} practice on {{date}} has been cancelled{{reason}}. We apologize for the inconvenience.',
        ARRAY['parent_name', 'program_name', 'date', 'reason']
    ),
    (
        'payment_received',
        'payment',
        E'Hi {{parent_name}}, we''ve received your payment of {{amount}} for {{student_name}}''s {{program_name}}. Thank you!',
        ARRAY['parent_name', 'amount', 'student_name', 'program_name']
    );


-- ============================================================================
-- 8. SEED DATA: whatsapp_state
-- ============================================================================

INSERT INTO whatsapp_state (status)
VALUES ('disconnected');
