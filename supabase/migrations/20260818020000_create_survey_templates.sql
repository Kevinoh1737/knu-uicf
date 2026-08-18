-- 만족도 질문지를 교육과정에서 떼어 낸다.
--
-- 설문지는 과정마다 처음부터 만드는 것이 아니라, 표준 질문지 몇 장을 계속 돌려 쓴다.
-- 같은 문항 id 로 물어야 과정끼리 견줄 수 있기 때문이다(문구만 같고 id 가 다르면 집계가
-- 갈린다). 회사마다 따로 묻고 싶은 것은 그 과정 설문지에만 문항을 더해 해결한다.
create table if not exists public.survey_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  intro text not null default '',
  questions jsonb not null default '[]'::jsonb,
  -- 새 과정에서 아무것도 고르지 않았을 때 쓰는 한 장. 부분 유일 인덱스로 하나만 둔다.
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists survey_templates_single_default
  on public.survey_templates (is_default) where is_default;

-- 어느 질문지에서 나왔는지. 과정끼리 견줄 때 같은 질문지를 쓴 것끼리 묶는 근거다.
alter table public.surveys
  add column if not exists template_id uuid references public.survey_templates (id) on delete set null;

alter table public.survey_templates enable row level security;

drop policy if exists survey_templates_no_direct_access on public.survey_templates;
create policy survey_templates_no_direct_access on public.survey_templates
  for all to anon, authenticated using (false) with check (false);

revoke all on table public.survey_templates from anon, authenticated;
grant select, insert, update, delete on table public.survey_templates to service_role;

-- 표준 한 장을 심는다. 문항 id 는 lib/surveys.ts 의 DEFAULT_QUESTIONS 와 같아야 한다 —
-- 이미 만들어 둔 설문지들과 같은 축으로 집계된다.
insert into public.survey_templates (name, intro, questions, is_default)
select
  '표준 교육 만족도',
  '',
  '[{"id":"content_useful","type":"scale","text":"교육 내용이 실제 업무에 도움이 되었다","options":[],"required":true,"source":"standard"},{"id":"level_fit","type":"scale","text":"교육의 난이도와 진행 속도가 적절했다","options":[],"required":true,"source":"standard"},{"id":"delivery","type":"scale","text":"강사의 설명이 이해하기 쉬웠다","options":[],"required":true,"source":"standard"},{"id":"relevance","type":"scale","text":"실습과 사례가 우리 회사 업무와 관련이 있었다","options":[],"required":true,"source":"standard"},{"id":"duration","type":"scale","text":"교육 시간과 분량이 적절했다","options":[],"required":true,"source":"standard"},{"id":"recommend","type":"scale","text":"이 교육을 동료에게 추천하고 싶다","options":[],"required":true,"source":"standard"},{"id":"best_part","type":"text","text":"가장 도움이 된 내용은 무엇이었습니까?","options":[],"required":false,"source":"standard"},{"id":"improve","type":"text","text":"더 다뤘으면 하는 내용이나 개선점이 있다면 적어 주세요.","options":[],"required":false,"source":"standard"}]'::jsonb,
  true
where not exists (select 1 from public.survey_templates);
