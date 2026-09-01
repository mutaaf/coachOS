-- ============================================================================
-- Baseline: the marketing CMS tables, as Lovable created them.
--
-- These were built through the Supabase dashboard, so they exist in production
-- but in no migration — which made a fresh database unbuildable, since the
-- migration adding `ops_program_id` had no `public.programs` to alter.
--
-- This reproduces them faithfully, INCLUDING the over-permissive RLS policies
-- they shipped with. The later fix_cms_public_write_policies migration is what
-- closes those. Reproducing the flaw rather than quietly correcting it here is
-- deliberate: it means a throwaway test database exercises the fix instead of
-- skipping past it.
--
-- Recorded as already applied in production, where these objects predate the
-- migration history. Do not re-run it there — the guards would reinstate the
-- permissive policies that were deliberately dropped.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.content_forms (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    form_type              text NOT NULL,
    title                  text NOT NULL,
    subtitle               text,
    fields                 jsonb NOT NULL,
    submit_button          jsonb NOT NULL,
    success_message        text NOT NULL,
    error_message          text NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_forms_pkey PRIMARY KEY (id),
    CONSTRAINT content_forms_form_type_key UNIQUE (form_type)
);

CREATE TABLE IF NOT EXISTS public.content_hero (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    headline               text NOT NULL,
    subheadline            text NOT NULL,
    primary_cta            jsonb NOT NULL,
    secondary_cta          jsonb NOT NULL,
    slides                 jsonb NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_hero_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.content_levels (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    name                   text NOT NULL,
    icon                   text NOT NULL,
    class_range            text NOT NULL,
    description            text NOT NULL,
    focus_areas            text[] NOT NULL,
    position               integer NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_levels_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.content_programs_static (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    program_id             text NOT NULL,
    title                  text NOT NULL,
    description            text NOT NULL,
    image                  text NOT NULL,
    icon                   text NOT NULL,
    features               text[] NOT NULL,
    age_groups             text[] NOT NULL,
    position               integer NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_programs_static_pkey PRIMARY KEY (id),
    CONSTRAINT content_programs_static_program_id_key UNIQUE (program_id)
);

CREATE TABLE IF NOT EXISTS public.partnerships (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    type                   text NOT NULL,
    icon                   text NOT NULL,
    description            text NOT NULL,
    benefits               text[] NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partnerships_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.programs (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    title                  text NOT NULL,
    description            text NOT NULL,
    date_range             text NOT NULL,
    location               text NOT NULL,
    image                  text NOT NULL,
    slots                  text NOT NULL,
    price                  text NOT NULL,
    age_groups             text[] NOT NULL,
    registration_date      text,
    formspree_url          text,
    start_date             date,
    end_date               date,
    type                   text NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programs_type_check CHECK ((type = ANY (ARRAY['current'::text, 'upcoming'::text]))),
    CONSTRAINT programs_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.testimonials (
    id                     uuid DEFAULT gen_random_uuid() NOT NULL,
    name                   text NOT NULL,
    relationship           text NOT NULL,
    avatar                 text,
    quote                  text NOT NULL,
    stars                  integer NOT NULL,
    created_at             timestamp with time zone DEFAULT now() NOT NULL,
    updated_at             timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT testimonials_stars_check CHECK (((stars >= 1) AND (stars <= 5))),
    CONSTRAINT testimonials_pkey PRIMARY KEY (id)
);


CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Any signed-in user counts as an admin; there is only one login today.
  RETURN auth.role() = 'authenticated';
END;
$$;

ALTER TABLE public.content_forms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow public read access" ON public.content_forms FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow full access for admins" ON public.content_forms FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.content_hero ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow public read access" ON public.content_hero FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow full access for admins" ON public.content_hero FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.content_levels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow public read access" ON public.content_levels FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow full access for admins" ON public.content_levels FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.content_programs_static ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow public read access" ON public.content_programs_static FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow full access for admins" ON public.content_programs_static FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow full access to authenticated users" ON public.partnerships FOR ALL USING ((auth.role() = 'authenticated'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Enable all operations for authenticated users" ON public.partnerships FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow public read access to programs" ON public.programs FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow full access to authenticated users" ON public.programs FOR ALL USING ((auth.role() = 'authenticated'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Enable all operations for authenticated users" ON public.programs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    CREATE POLICY "Allow anyone to view testimonials" ON public.testimonials FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow full access to authenticated users" ON public.testimonials FOR ALL USING ((auth.role() = 'authenticated'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    CREATE POLICY "Allow anonymous operations on testimonials" ON public.testimonials FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
