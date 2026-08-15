-- One combined briefing per company, rebuilt whenever the set of completed consultations changes.
-- Additive only: a new nullable-by-default jsonb column, so existing rows and queries are untouched.
alter table public.company_research
  add column if not exists consultation_briefing jsonb not null default '{}'::jsonb;

comment on column public.company_research.consultation_briefing is
  'Cross-consultation briefing built from every completed transcript for this company. Carries its own sourceIds so staleness is detectable.';
