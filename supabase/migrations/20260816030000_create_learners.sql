-- 수강생. 사람 단위로 쌓고(learners) 강의에 연결한다(session_learners).
--
-- 개인정보: 이 테이블은 이 시스템에서 개인정보를 담는 첫 자리다. 교육 운영과 만족도 조사
-- 발송에 필요한 최소 항목만 둔다 — 이름·부서·직급·이메일. 주민등록번호·생년월일·집주소·
-- 휴대전화는 담지 않는다(강사와 같은 방침, docs/instructor-asset-loop.md 11.1).
-- 수집·이용 동의는 고객사와의 교육 계약에서 정리해야 하며 시스템 밖의 일이다.

create extension if not exists pgcrypto;

create table if not exists public.learners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_research (id) on delete cascade,
  name text not null,
  department text not null default '',
  job_title text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 회사 안에서 이메일이 같으면 같은 사람으로 본다. 명단을 다시 올려도 사람이 늘지 않는다.
-- 이메일이 없는 행은 이 규칙 밖이라 이름·부서로 화면에서 확인한다.
create unique index if not exists learners_company_email_idx
  on public.learners (company_id, lower(email))
  where email <> '';

create index if not exists learners_company_idx on public.learners (company_id, name);

comment on table public.learners is
  '수강생. 교육 운영에 필요한 최소 항목만 담는다 — 주민등록번호·생년월일·주소는 의도적으로 없다.';

-- ─── 수강 연결 ────────────────────────────────────────────────────────────────

create table if not exists public.session_learners (
  id uuid primary key default gen_random_uuid(),
  course_session_id uuid not null references public.course_sessions (id) on delete cascade,
  learner_id uuid not null references public.learners (id) on delete cascade,
  status text not null default 'registered',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_learners_status_check
    check (status in ('registered', 'attended', 'absent', 'cancelled')),
  -- 한 강의에 같은 사람이 두 번 들어가지 않는다.
  constraint session_learners_unique unique (course_session_id, learner_id)
);

create index if not exists session_learners_session_idx
  on public.session_learners (course_session_id);
create index if not exists session_learners_learner_idx
  on public.session_learners (learner_id);

-- ─── 접근 통제 ────────────────────────────────────────────────────────────────

alter table public.learners enable row level security;
alter table public.session_learners enable row level security;

revoke all on table public.learners from anon, authenticated;
revoke all on table public.session_learners from anon, authenticated;

grant select, insert, update, delete on table public.learners to service_role;
grant select, insert, update, delete on table public.session_learners to service_role;
