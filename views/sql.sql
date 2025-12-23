-- =====================================================================
-- RESET CORE TABLES FOR ELITE TRAVEL & TOUR PLATFORM
-- Deep, consistent schema matching our full admin/features history:
-- users, jobs (+metadata), applications, tracking, tracking_logs,
-- appointments, notifications, services, payments, testimonials,
-- contacts, news, analytics support.
-- =====================================================================

-- ============================
-- Drop existing tables (order matters due to FKs)
-- ============================
DROP TABLE IF EXISTS public.tracking_logs CASCADE;
DROP TABLE IF EXISTS public.tracking CASCADE;
DROP TABLE IF EXISTS public.applications CASCADE;
DROP TABLE IF EXISTS public.appointments CASCADE;
DROP TABLE IF EXISTS public.followers CASCADE;
DROP TABLE IF EXISTS public.jobs CASCADE;
DROP TABLE IF EXISTS public.news CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.services CASCADE;
DROP TABLE IF EXISTS public.testimonials CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- ============================
-- Extensions (if not already enabled)
-- ============================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================
-- USERS
-- ============================
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  fullname text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'user',                -- user | admin | owner
  avatar_url text,
  status text NOT NULL DEFAULT 'active',            -- active | suspended | disabled
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_role_idx ON public.users(role);
CREATE INDEX users_status_idx ON public.users(status);

-- ============================
-- JOBS (ADVANCED + METADATA)
-- ============================
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  country text,
  city text,
  plan text,                                        -- work | express | null
  status text NOT NULL DEFAULT 'active',            -- active | draft | archived
  description text,                                 -- primary short description
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,      -- holds job_type, cover_image, logo, salary, etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_plan_idx ON public.jobs(plan);
CREATE INDEX jobs_status_idx ON public.jobs(status);
CREATE INDEX jobs_created_at_idx ON public.jobs(created_at);
CREATE INDEX jobs_metadata_gin_idx ON public.jobs USING gin(metadata);

-- Simple trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_set_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================
-- APPLICATIONS
-- ============================
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',           -- pending | processing | approved | rejected
  progress jsonb NOT NULL DEFAULT '[]'::jsonb,      -- optional per-step info
  plan text,                                       -- mirror job plan at time of apply
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX applications_user_id_idx ON public.applications(user_id);
CREATE INDEX applications_job_id_idx ON public.applications(job_id);
CREATE INDEX applications_status_idx ON public.applications(status);

CREATE TRIGGER applications_set_updated_at
BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================
-- TRACKING (PER-APPLICATION / PER-USER)
-- ============================
CREATE TABLE public.tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  public_id text UNIQUE,                            -- ET-2025-12345
  user_email text,                                  -- denormalised for convenience
  job_title text,                                   -- denormalised
  current_stage text,                               -- "Documents review"
  status text NOT NULL DEFAULT 'pending',           -- pending | active | completed | rejected
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,      -- any extra
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracking_user_id_idx ON public.tracking(user_id);
CREATE INDEX tracking_status_idx ON public.tracking(status);
CREATE INDEX tracking_public_id_idx ON public.tracking(public_id);
CREATE INDEX tracking_updated_at_idx ON public.tracking(updated_at);

CREATE TRIGGER tracking_set_updated_at
BEFORE UPDATE ON public.tracking
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Detailed logs per tracking record
CREATE TABLE public.tracking_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id uuid NOT NULL REFERENCES public.tracking(id) ON DELETE CASCADE,
  stage text,
  message text,
  admin_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tracking_logs_tracking_id_idx ON public.tracking_logs(tracking_id);
CREATE INDEX tracking_logs_created_at_idx ON public.tracking_logs(created_at);

-- ============================
-- APPOINTMENTS
-- ============================
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text,                                        -- denormalised name (optional)
  email text,                                       -- denormalised email (optional)
  type text,                                        -- consultation | visa | work | other
  status text NOT NULL DEFAULT 'pending',           -- pending | confirmed | completed | cancelled
  datetime timestamptz NOT NULL,
  notes text,                                       -- user notes
  admin_notes text,                                 -- internal admin notes
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appointments_user_id_idx ON public.appointments(user_id);
CREATE INDEX appointments_status_idx ON public.appointments(status);
CREATE INDEX appointments_datetime_idx ON public.appointments(datetime);

CREATE TRIGGER appointments_set_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================
-- NOTIFICATIONS
-- ============================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  user_email text,                                  -- optional denormalised
  title text,
  category text,                                    -- application | payment | tracking | system | general
  message text NOT NULL,
  link text,                                        -- e.g. /views/pages/tracking.html?id=...
  importance text NOT NULL DEFAULT 'normal',        -- normal | high
  email_ready boolean NOT NULL DEFAULT false,       -- for external email system
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_id_idx ON public.notifications(user_id);
CREATE INDEX notifications_read_idx ON public.notifications(read);
CREATE INDEX notifications_created_at_idx ON public.notifications(created_at);

-- ============================
-- SERVICES (ADVANCED)
-- ============================
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text,                                    -- visa | flights | tours | work | express | etc
  tags text[] DEFAULT '{}',
  price numeric,                                    -- optional
  short_desc text,
  full_desc text,
  icon text,
  banner text,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX services_category_idx ON public.services(category);
CREATE INDEX services_is_active_idx ON public.services(is_active);
CREATE INDEX services_priority_idx ON public.services(priority);

CREATE TRIGGER services_set_updated_at
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================
-- PAYMENTS
-- ============================
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ref text NOT NULL UNIQUE,
  status text NOT NULL,                             -- success | failed | pending | cancelled
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'GHS',
  channel text DEFAULT 'paystack',                  -- paystack | momo | etc
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_user_id_idx ON public.payments(user_id);
CREATE INDEX payments_status_idx ON public.payments(status);
CREATE INDEX payments_created_at_idx ON public.payments(created_at);

-- ============================
-- TESTIMONIALS
-- ============================
CREATE TABLE public.testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text,                                        -- if not linked to a real user
  location text,
  program text,                                     -- e.g. "Canada Work & Pay"
  rating integer CHECK (rating BETWEEN 1 AND 5),
  avatar text,
  tag text,
  quote text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX testimonials_is_active_idx ON public.testimonials(is_active);
CREATE INDEX testimonials_priority_idx ON public.testimonials(priority);

CREATE TRIGGER testimonials_set_updated_at
BEFORE UPDATE ON public.testimonials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================
-- CONTACTS (CONTACT FORM)
-- ============================
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  subject text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',               -- new | opened | resolved
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_status_idx ON public.contacts(status);
CREATE INDEX contacts_created_at_idx ON public.contacts(created_at);

-- ============================
-- NEWS (OPTIONAL)
-- ============================
CREATE TABLE public.news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================
-- FOLLOWERS (OPTIONAL SOCIAL)
-- ============================
CREATE TABLE public.followers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id)
);

CREATE INDEX followers_follower_idx ON public.followers(follower_id);
CREATE INDEX followers_following_idx ON public.followers(following_id);

-- =====================================================================
-- RLS (ROW LEVEL SECURITY)
-- =====================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followers ENABLE ROW LEVEL SECURITY;

-- Helper expression: check if current auth user is admin/owner
-- (relies on auth.uid() mapping to users.id)
-- We'll inline EXISTS subqueries in policies instead of a function
-- to avoid function-security complexity in Supabase.

-- ============================
-- USERS POLICIES
-- ============================

-- Users can read their own profile
CREATE POLICY "Users can read self"
ON public.users FOR SELECT
USING (id = auth.uid());

-- Users can update their own profile (non-role fields enforced at app level)
CREATE POLICY "Users can update self"
ON public.users FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Admins (role admin/owner) can manage all users
CREATE POLICY "Admins manage users"
ON public.users FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- JOBS POLICIES
-- ============================

-- Anyone (including anon) can read active jobs
CREATE POLICY "Anyone can read jobs"
ON public.jobs FOR SELECT
USING (status = 'active');

-- Admins manage all jobs (insert/update/delete/select)
CREATE POLICY "Admins manage jobs"
ON public.jobs FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- APPLICATIONS POLICIES
-- ============================

-- Users manage own applications
CREATE POLICY "Users manage own applications"
ON public.applications FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admins manage all applications
CREATE POLICY "Admins manage applications"
ON public.applications FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- TRACKING POLICIES
-- ============================

-- Users can read their own tracking records
CREATE POLICY "Users read own tracking"
ON public.tracking FOR SELECT
USING (user_id = auth.uid());

-- Admins manage all tracking
CREATE POLICY "Admins manage tracking"
ON public.tracking FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- Tracking logs: users can read logs that belong to their tracking records
CREATE POLICY "Users read own tracking logs"
ON public.tracking_logs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tracking t
    WHERE t.id = tracking_id AND t.user_id = auth.uid()
  )
);

-- Admins manage all tracking logs
CREATE POLICY "Admins manage tracking logs"
ON public.tracking_logs FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- APPOINTMENTS POLICIES
-- ============================

-- Users manage own appointments
CREATE POLICY "Users manage own appointments"
ON public.appointments FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admins manage all appointments
CREATE POLICY "Admins manage appointments"
ON public.appointments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- FOLLOWERS POLICIES
-- ============================

-- Users manage own follow actions
CREATE POLICY "Users manage own followers"
ON public.followers FOR ALL
USING (follower_id = auth.uid())
WITH CHECK (follower_id = auth.uid());

-- Admins manage all followers
CREATE POLICY "Admins manage followers"
ON public.followers FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- NEWS POLICIES
-- ============================

-- Anyone can read news
CREATE POLICY "Anyone can read news"
ON public.news FOR SELECT
USING (true);

-- Admins manage news
CREATE POLICY "Admins manage news"
ON public.news FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- NOTIFICATIONS POLICIES
-- ============================

-- Users read own notifications
CREATE POLICY "Users read own notifications"
ON public.notifications FOR SELECT
USING (user_id = auth.uid());

-- Admins manage notifications
CREATE POLICY "Admins manage notifications"
ON public.notifications FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- PAYMENTS POLICIES
-- ============================

-- Users manage own payments
CREATE POLICY "Users manage own payments"
ON public.payments FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admins manage all payments
CREATE POLICY "Admins manage payments"
ON public.payments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- SERVICES POLICIES
-- ============================

-- Anyone can read active services
CREATE POLICY "Anyone can read services"
ON public.services FOR SELECT
USING (is_active = true);

-- Admins manage services
CREATE POLICY "Admins manage services"
ON public.services FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- TESTIMONIALS POLICIES
-- ============================

-- Anyone can read active testimonials
CREATE POLICY "Anyone can read testimonials"
ON public.testimonials FOR SELECT
USING (is_active = true);

-- Users insert their own testimonial (linked to their user_id)
CREATE POLICY "Users insert own testimonials"
ON public.testimonials FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Admins manage all testimonials
CREATE POLICY "Admins manage testimonials"
ON public.testimonials FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);

-- ============================
-- CONTACTS POLICIES
-- ============================

-- No public insert from client here unless you want it; you can relax later.
-- For now: admins manage all contacts.
CREATE POLICY "Admins manage contacts"
ON public.contacts FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','owner')
  )
);


































<button id="bellBtn" class="btn outline">
  <i class="fa-regular fa-bell"></i>
  <span id="bellCount" class="count hidden">0</span>
</button>

<div id="notifFeed" class="feed hidden">
  <div class="feed-toolbar">
    <span class="muted small-text">Notifications</span>
    <div style="display:flex;gap:.25rem;">
      <button id="markAllReadBtn"><i class="fa fa-check-double"></i> Read</button>
      <button id="clearAllNotifBtn"><i class="fa fa-trash"></i> Clear</button>
    </div>
  </div>
  <div id="notifList" class="list"></div>
</div>

[
  {
    "id": "dd7de0f9-93c3-42b8-bc7d-8b2c4ccaf210",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "2.5mm cables RR ",
    "qty": "6",
    "meter": "1.00",
    "price": "400.00",
    "amount": "2400.00"
  },
  {
    "id": "b9309c82-d3f1-496b-93bb-5eb0d9c60223",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "1.5mm cables RR ",
    "qty": "10",
    "meter": "1.00",
    "price": "300.00",
    "amount": "3000.00"
  },
  {
    "id": "c721c234-dae8-466d-8ac9-0e53dc68098d",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "TV 📺 cables ",
    "qty": "1",
    "meter": "1.00",
    "price": "200.00",
    "amount": "200.00"
  },
  {
    "id": "26cb8d58-cec2-42fa-8577-51ae5fff2565",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "16mm cable RR ",
    "qty": "50",
    "meter": "1.00",
    "price": "28.00",
    "amount": "1400.00"
  },
  {
    "id": "ef1f3e15-aa3a-4227-b022-d587fc413c10",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "4mm cables ",
    "qty": "6",
    "meter": "1.00",
    "price": "700.00",
    "amount": "4200.00"
  },
  {
    "id": "eaf85ad1-a666-4871-8a84-25e0745b78e8",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Double socket  ",
    "qty": "24",
    "meter": "1.00",
    "price": "35.00",
    "amount": "840.00"
  },
  {
    "id": "c6032918-40b3-4c93-8917-14e174931eb0",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Pvc pipes focus ",
    "qty": "50",
    "meter": "1.00",
    "price": "10.00",
    "amount": "500.00"
  },
  {
    "id": "3f5ce6b6-f77b-47cc-bf21-83ccada18866",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "TV socket ",
    "qty": "3",
    "meter": "1.00",
    "price": "30.00",
    "amount": "90.00"
  },
  {
    "id": "3c8ab405-0dd4-44c0-9277-1f3da8736b38",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "3x6 conduit box ",
    "qty": "5",
    "meter": "1.00",
    "price": "10.00",
    "amount": "50.00"
  },
  {
    "id": "993e8277-9a3f-4e9e-9561-f7d7c3bcfd6c",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "3x3 conduits box ",
    "qty": "7",
    "meter": "1.00",
    "price": "8.00",
    "amount": "56.00"
  },
  {
    "id": "f23fd344-19c1-488f-9201-2216288f47bf",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Fence wall mounted light ",
    "qty": "10",
    "meter": "1.00",
    "price": "135.00",
    "amount": "1350.00"
  },
  {
    "id": "a1f7c421-3e77-41a8-9a7e-aa478267ae59",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Gate light top mounted ",
    "qty": "2",
    "meter": "1.00",
    "price": "300.00",
    "amount": "600.00"
  },
  {
    "id": "ce2dc96b-6d6a-4812-93b5-2c57353c7946",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Network cable ",
    "qty": "1",
    "meter": "1.00",
    "price": "700.00",
    "amount": "700.00"
  },
  {
    "id": "e397ab06-5444-4368-a11e-1a6307ae7576",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Outside lights ",
    "qty": "5",
    "meter": "1.00",
    "price": "300.00",
    "amount": "1500.00"
  },
  {
    "id": "3da8aca3-cbc3-4edf-9c6b-1527e7e7f452",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "1gang 2ways ",
    "qty": "10",
    "meter": "1.00",
    "price": "15.00",
    "amount": "150.00"
  },
  {
    "id": "322ad661-21c3-4a24-8f6c-c74f3f5d166e",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "2gangs switch ",
    "qty": "5",
    "meter": "1.00",
    "price": "18.00",
    "amount": "90.00"
  },
  {
    "id": "137dbaff-96e0-4373-a9a4-cb7e282db0ad",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "3 gangs switch ",
    "qty": "3",
    "meter": "1.00",
    "price": "25.00",
    "amount": "75.00"
  },
  {
    "id": "7244fa12-59a4-4232-9ea8-f65462aa49ea",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "6watt conduits ",
    "qty": "6",
    "meter": "1.00",
    "price": "45.00",
    "amount": "270.00"
  },
  {
    "id": "c25caf68-3d8a-444f-beee-0963307d60d7",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "12watts ",
    "qty": "12",
    "meter": "1.00",
    "price": "70.00",
    "amount": "840.00"
  },
  {
    "id": "55a331a3-293d-49fa-b60e-9ea560c1eff3",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "18watts ",
    "qty": "6",
    "meter": "1.00",
    "price": "120.00",
    "amount": "720.00"
  },
  {
    "id": "35aad846-0569-4a69-a552-aa96a2dfc814",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Ceiling fan ",
    "qty": "6",
    "meter": "1.00",
    "price": "470.00",
    "amount": "2820.00"
  },
  {
    "id": "3288fc39-d9d9-4f55-83bc-6467cf2ce227",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Changeover 100A ",
    "qty": "1",
    "meter": "1.00",
    "price": "1000.00",
    "amount": "1000.00"
  },
  {
    "id": "e39175de-2230-4571-9c34-6fafd3cc7319",
    "invoice_id": "e87e90bd-d4a0-416e-b4bd-db83ef11960c",
    "item": "Single poles breakers ",
    "qty": "16",
    "meter": "1.00",
    "price": "40.00",
    "amount": "640.00"
  }
]

