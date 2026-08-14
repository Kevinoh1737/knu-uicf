create extension if not exists pgcrypto;

create table public.company_research (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website_url text not null unique,
  industry text not null default '',
  stage text not null default 'research_complete',
  research jsonb not null default '{}'::jsonb,
  intelligence jsonb not null default '{}'::jsonb,
  crawl jsonb not null default '{}'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_research_questions_array check (jsonb_typeof(questions) = 'array')
);

create index company_research_updated_at_idx
  on public.company_research (updated_at desc);

alter table public.company_research enable row level security;

revoke all on table public.company_research from anon, authenticated;
grant select, insert, update, delete on table public.company_research to service_role;

comment on table public.company_research is
  'Server-only MVP persistence for verified company research and editable questionnaires.';
