create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'admin', 'manager', 'viewer');
create type public.company_stage as enum ('research', 'diagnosis', 'design', 'assignment', 'delivery', 'completed', 'paused');
create type public.course_status as enum ('draft', 'approved', 'scheduled', 'in_progress', 'completed', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null,
  created_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null default 'manager', created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create table public.companies (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
  name text not null, website_url text, industry text, description text, registration_number text, address text,
  stage public.company_stage not null default 'research', owner_id uuid references auth.users,
  contact jsonb not null default '{}'::jsonb, research_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.company_files (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  storage_path text not null, file_name text not null, mime_type text, extracted_text text,
  extraction_status text not null default 'pending', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.questionnaires (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  title text not null, status text not null default 'draft', version integer not null default 1,
  approved_by uuid references auth.users, approved_at timestamptz, created_at timestamptz not null default now()
);
create table public.questions (
  id uuid primary key default gen_random_uuid(), questionnaire_id uuid not null references public.questionnaires on delete cascade,
  position integer not null, question_text text not null, rationale text,
  source_refs jsonb not null default '[]'::jsonb, is_required boolean not null default true
);
create table public.consultations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  questionnaire_id uuid references public.questionnaires, held_at timestamptz, audio_storage_path text, transcript text,
  speaker_segments jsonb not null default '[]'::jsonb, analysis jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending', created_at timestamptz not null default now()
);
create table public.instructors (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations on delete cascade,
  name text not null, email text, phone text, bio text, specialties text[] not null default '{}',
  profile jsonb not null default '{}'::jsonb, status text not null default 'active', created_at timestamptz not null default now()
);
create table public.programs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  consultation_id uuid references public.consultations, title text not null, objectives text[] not null default '{}',
  status public.course_status not null default 'draft', created_at timestamptz not null default now()
);
create table public.classes (
  id uuid primary key default gen_random_uuid(), program_id uuid not null references public.programs on delete cascade,
  instructor_id uuid references public.instructors, title text not null, description text,
  duration_minutes integer not null default 240 check (duration_minutes > 0), starts_at timestamptz,
  capacity integer, actual_attendance integer, status public.course_status not null default 'draft',
  curriculum jsonb not null default '[]'::jsonb
);
create table public.learners (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  name text not null, email text, phone text, department text, job_title text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.enrollments (
  class_id uuid not null references public.classes on delete cascade, learner_id uuid not null references public.learners on delete cascade,
  attendance_status text not null default 'registered', attended_minutes integer, primary key (class_id, learner_id)
);
create table public.surveys (
  id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes on delete cascade,
  title text not null, status text not null default 'draft', questions jsonb not null default '[]'::jsonb,
  approved_by uuid references auth.users, scheduled_for timestamptz, created_at timestamptz not null default now()
);
create table public.survey_invitations (
  id uuid primary key default gen_random_uuid(), survey_id uuid not null references public.surveys on delete cascade,
  learner_id uuid not null references public.learners on delete cascade, token_hash text not null unique,
  sent_at timestamptz, expires_at timestamptz, submitted_at timestamptz
);
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(), invitation_id uuid not null unique references public.survey_invitations on delete cascade,
  answers jsonb not null, submitted_at timestamptz not null default now()
);

create index companies_org_idx on public.companies (organization_id, stage);
create index classes_start_idx on public.classes (starts_at);
create index learners_company_idx on public.learners (company_id);

create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.organization_members m where m.organization_id = org_id and m.user_id = (select auth.uid()));
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.companies enable row level security;
alter table public.company_files enable row level security;
alter table public.questionnaires enable row level security;
alter table public.questions enable row level security;
alter table public.consultations enable row level security;
alter table public.instructors enable row level security;
alter table public.programs enable row level security;
alter table public.classes enable row level security;
alter table public.learners enable row level security;
alter table public.enrollments enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_invitations enable row level security;
alter table public.survey_responses enable row level security;

create policy "members read organizations" on public.organizations for select to authenticated using (public.is_org_member(id));
create policy "members read membership" on public.organization_members for select to authenticated using (user_id = (select auth.uid()));
create policy "members manage companies" on public.companies for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage instructors" on public.instructors for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create policy "members manage company files" on public.company_files for all to authenticated using (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id)));
create policy "members manage questionnaires" on public.questionnaires for all to authenticated using (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id)));
create policy "members manage questions" on public.questions for all to authenticated using (exists(select 1 from public.questionnaires q join public.companies c on c.id=q.company_id where q.id=questionnaire_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.questionnaires q join public.companies c on c.id=q.company_id where q.id=questionnaire_id and public.is_org_member(c.organization_id)));
create policy "members manage consultations" on public.consultations for all to authenticated using (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id)));
create policy "members manage programs" on public.programs for all to authenticated using (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id)));
create policy "members manage classes" on public.classes for all to authenticated using (exists(select 1 from public.programs p join public.companies c on c.id=p.company_id where p.id=program_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.programs p join public.companies c on c.id=p.company_id where p.id=program_id and public.is_org_member(c.organization_id)));
create policy "members manage learners" on public.learners for all to authenticated using (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.companies c where c.id=company_id and public.is_org_member(c.organization_id)));
create policy "members manage enrollments" on public.enrollments for all to authenticated using (exists(select 1 from public.classes cl join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where cl.id=class_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.classes cl join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where cl.id=class_id and public.is_org_member(c.organization_id)));
create policy "members manage surveys" on public.surveys for all to authenticated using (exists(select 1 from public.classes cl join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where cl.id=class_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.classes cl join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where cl.id=class_id and public.is_org_member(c.organization_id)));
create policy "members manage invitations" on public.survey_invitations for all to authenticated using (exists(select 1 from public.surveys s join public.classes cl on cl.id=s.class_id join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where s.id=survey_id and public.is_org_member(c.organization_id))) with check (exists(select 1 from public.surveys s join public.classes cl on cl.id=s.class_id join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where s.id=survey_id and public.is_org_member(c.organization_id)));
create policy "members read responses" on public.survey_responses for select to authenticated using (exists(select 1 from public.survey_invitations i join public.surveys s on s.id=i.survey_id join public.classes cl on cl.id=s.class_id join public.programs p on p.id=cl.program_id join public.companies c on c.id=p.company_id where i.id=invitation_id and public.is_org_member(c.organization_id)));

-- Anonymous survey submission must use a server route that validates the
-- invitation token and writes with a server-only service role client.
