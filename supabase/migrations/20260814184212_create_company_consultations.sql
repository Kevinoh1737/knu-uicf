create table public.company_consultations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_research(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'completed', 'failed')),
  transcript jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index company_consultations_company_created_idx
  on public.company_consultations (company_id, created_at desc);

alter table public.company_consultations enable row level security;

revoke all on table public.company_consultations from anon, authenticated;
grant select, insert, update, delete on table public.company_consultations to service_role;

create policy "deny direct client access"
on public.company_consultations
for all
to anon, authenticated
using (false)
with check (false);

comment on table public.company_consultations is
  'Server-only consultation audio processing records, full transcripts, and education-focused summaries.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consultation-audio',
  'consultation-audio',
  false,
  52428800,
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'video/mp4'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
