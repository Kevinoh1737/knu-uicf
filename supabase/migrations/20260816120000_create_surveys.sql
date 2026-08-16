-- 만족도 설문. 교육과정 하나에 설문지 하나다 — 같은 과정에 두 장이 생기면 어느 쪽 숫자가
-- 그 과정의 만족도인지 말할 수 없게 된다.
create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  course_session_id uuid not null unique references public.course_sessions (id) on delete cascade,
  title text not null default '교육 만족도 조사',
  intro text not null default '',
  -- [{ id, type: scale|choice|text, text, options[], required }]
  questions jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint surveys_status_check check (status in ('draft', 'open', 'closed'))
);

-- 수강생 한 사람에게 보내는 링크. 토큰이 곧 신원이라 사람마다 다르고, 같은 사람에게 두 번
-- 보내도 링크는 하나다(다시 보내기는 sent_at 만 갱신).
create table if not exists public.survey_invites (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  learner_id uuid not null references public.learners (id) on delete cascade,
  token text not null unique,
  sent_at timestamptz,
  send_error text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint survey_invites_unique unique (survey_id, learner_id)
);

-- 응답은 초대에 1:1로 붙는다. 링크 하나로 두 번 제출하는 것을 DB 가 막는다.
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  invite_id uuid not null unique references public.survey_invites (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);

create index if not exists survey_invites_survey_idx on public.survey_invites (survey_id);
create index if not exists survey_responses_survey_idx on public.survey_responses (survey_id);

-- 이 프로젝트의 기존 테이블과 같은 방식: 클라이언트 키로는 아무것도 못 읽고, 서버(service_role)
-- 만 접근한다. 설문 응답 페이지도 서버 라우트를 거친다 — 토큰이 있어도 브라우저가 테이블을
-- 직접 읽지는 못한다.
alter table public.surveys enable row level security;
alter table public.survey_invites enable row level security;
alter table public.survey_responses enable row level security;

revoke all on table public.surveys from anon, authenticated;
revoke all on table public.survey_invites from anon, authenticated;
revoke all on table public.survey_responses from anon, authenticated;

grant select, insert, update, delete on table public.surveys to service_role;
grant select, insert, update, delete on table public.survey_invites to service_role;
grant select, insert, update, delete on table public.survey_responses to service_role;

create policy "deny direct client access" on public.surveys
  for all to anon, authenticated using (false) with check (false);
create policy "deny direct client access" on public.survey_invites
  for all to anon, authenticated using (false) with check (false);
create policy "deny direct client access" on public.survey_responses
  for all to anon, authenticated using (false) with check (false);

comment on table public.surveys is
  '교육과정별 만족도 설문지. 문항은 관리자가 고치고 초안은 AI 가 만든다.';
comment on table public.survey_invites is
  '수강생별 응답 링크. token 이 신원이므로 노출되면 그 사람의 응답 자리가 열린다.';
