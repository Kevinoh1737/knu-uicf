-- 강사 풀과 강의 자산 — 설계는 docs/instructor-asset-loop.md
--
-- 개인정보 방침: 주민등록번호·계좌번호·상세주소·가족관계는 이 스키마 어디에도 담지 않는다.
-- 강사료 원천징수에 필요하더라도 산학협력단 회계 시스템에서 처리한다. 저장하는 순간
-- 암호화·접근통제·접속기록·파기 절차가 법적 의무로 따라온다 (개인정보보호법 제24조의2).

create extension if not exists pgcrypto;

-- ─── 강사 ────────────────────────────────────────────────────────────────────

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  affiliation text not null default '',
  job_title text not null default '',
  email text not null default '',
  phone text not null default '',
  -- { industries[], topics[], tools[], audienceLevels[] } — 매칭 신호의 원천
  expertise jsonb not null default '{}'::jsonb,
  career jsonb not null default '[]'::jsonb,
  education jsonb not null default '[]'::jsonb,
  -- 프로필 문서에 적혀 온 외부 강의 이력. 우리 시스템의 course_sessions 와는 별개다.
  teaching_history jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  preferred_style text not null default '',
  notes text not null default '',
  -- 계약서에서 합의한 결과만 기록한다. 강사는 이 시스템의 사용자가 아니므로
  -- 화면에서 동의를 받지 않는다. 두 범위는 서로 독립이라 단계가 아니라 플래그다.
  reuse_aggregate boolean not null default false,
  reuse_share_original boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructors_status_check check (status in ('active', 'inactive')),
  constraint instructors_expertise_object check (jsonb_typeof(expertise) = 'object'),
  constraint instructors_career_array check (jsonb_typeof(career) = 'array'),
  constraint instructors_education_array check (jsonb_typeof(education) = 'array'),
  constraint instructors_teaching_history_array check (jsonb_typeof(teaching_history) = 'array'),
  constraint instructors_certifications_array check (jsonb_typeof(certifications) = 'array')
);

create index if not exists instructors_name_idx on public.instructors (name);
create index if not exists instructors_updated_at_idx on public.instructors (updated_at desc);

comment on table public.instructors is
  '강사 프로필. 주민등록번호·계좌번호는 의도적으로 없다 — docs/instructor-asset-loop.md 11.1.';

-- ─── 강의 실적 ────────────────────────────────────────────────────────────────

create table if not exists public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_research (id) on delete cascade,
  -- 강의 이력이 남은 강사는 지울 수 없어야 한다. 자산이 강사에 매달려 있다.
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  title text not null,
  held_on date,
  location text not null default '',
  headcount integer,
  duration_hours numeric(4, 1) not null default 4,
  status text not null default 'planned',
  -- { objective, modules[], prerequisites, deliverables } — 고객사 제출 아웃라인에서 추출
  outline jsonb not null default '{}'::jsonb,
  -- { toolsUsed[], practiceTasks[], caseExamples[], practiceRatio, slideCount } — 강의자료에서 추출
  materials jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_sessions_status_check
    check (status in ('planned', 'contracted', 'delivered', 'cancelled')),
  constraint course_sessions_headcount_check check (headcount is null or headcount >= 0)
);

create index if not exists course_sessions_instructor_idx
  on public.course_sessions (instructor_id, held_on desc);
create index if not exists course_sessions_company_idx
  on public.course_sessions (company_id, held_on desc);

comment on table public.course_sessions is
  '어떤 강사가 어떤 회사에 어떤 수업을 언제 했는지. 강사 페이지와 기업 페이지가 같은 행을 본다.';

-- ─── 문서 ────────────────────────────────────────────────────────────────────

create table if not exists public.instructor_documents (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete cascade,
  course_session_id uuid references public.course_sessions (id) on delete cascade,
  kind text not null,
  file_name text not null,
  -- 새 업로드는 항상 새 uuid 경로라 충돌하지 않는다. 재파싱은 이 행을 갱신하는
  -- 방식이어야 한다 — 같은 파일로 INSERT 를 다시 시도하면 막힌다 (TODO.md 6번의 교훈).
  storage_path text not null unique,
  mime_type text not null default '',
  file_size bigint not null default 0,
  parse_status text not null default 'pending',
  parse_error text not null default '',
  parsed jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_documents_kind_check
    check (kind in ('profile', 'outline', 'materials', 'signed_contract')),
  constraint instructor_documents_parse_status_check
    check (parse_status in ('pending', 'parsing', 'completed', 'failed', 'skipped')),
  -- 아웃라인과 강의자료는 반드시 어느 강의의 것인지 붙어 있어야 자산이 된다.
  constraint instructor_documents_session_required
    check (kind in ('profile', 'signed_contract') or course_session_id is not null)
);

create index if not exists instructor_documents_instructor_idx
  on public.instructor_documents (instructor_id, created_at desc);
create index if not exists instructor_documents_session_idx
  on public.instructor_documents (course_session_id);

-- ─── 계약 ────────────────────────────────────────────────────────────────────

create sequence if not exists public.contract_no_seq;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  course_session_id uuid not null references public.course_sessions (id) on delete cascade,
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  contract_no text not null unique,
  status text not null default 'draft',
  -- { fee, feeNote, paymentTerms, specialTerms[], copyrightClause, reuseAggregate, reuseShareOriginal }
  -- 금액과 조건만. 지급에 필요한 주민등록번호·계좌번호는 여기에 담지 않는다.
  terms jsonb not null default '{}'::jsonb,
  pdf_path text not null default '',
  sent_to text not null default '',
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  closed_reason text not null default '',
  signed_document_id uuid references public.instructor_documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_status_check
    check (status in ('draft', 'ready', 'sent', 'viewed', 'signed', 'rejected', 'expired', 'withdrawn')),
  constraint contracts_terms_object check (jsonb_typeof(terms) = 'object'),
  -- 한 강의에 유효한 계약은 하나다. 철회·반려된 건은 이력으로 남는다.
  constraint contracts_session_unique unique (course_session_id, contract_no)
);

create index if not exists contracts_instructor_idx
  on public.contracts (instructor_id, created_at desc);
create index if not exists contracts_status_idx on public.contracts (status);

comment on table public.contracts is
  '강의 계약. 주민등록번호·계좌번호를 담지 않는 것이 방침이다 — docs/instructor-asset-loop.md 11.1.';

-- 발송은 되돌릴 수 없는 외부 행동이다. 상태 전이를 전부 남겨야 감사에 답할 수 있다.
create table if not exists public.contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  from_status text not null default '',
  to_status text not null,
  actor text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists contract_events_contract_idx
  on public.contract_events (contract_id, created_at desc);

-- ─── 접근 통제 ────────────────────────────────────────────────────────────────
-- 기존 테이블과 같은 방침: 서버(service_role)만 접근한다. anon 키로는 아무것도 못 읽는다.

alter table public.instructors enable row level security;
alter table public.course_sessions enable row level security;
alter table public.instructor_documents enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_events enable row level security;

revoke all on table public.instructors from anon, authenticated;
revoke all on table public.course_sessions from anon, authenticated;
revoke all on table public.instructor_documents from anon, authenticated;
revoke all on table public.contracts from anon, authenticated;
revoke all on table public.contract_events from anon, authenticated;

grant select, insert, update, delete on table public.instructors to service_role;
grant select, insert, update, delete on table public.course_sessions to service_role;
grant select, insert, update, delete on table public.instructor_documents to service_role;
grant select, insert, update, delete on table public.contracts to service_role;
grant select, insert, update, delete on table public.contract_events to service_role;
grant usage, select on sequence public.contract_no_seq to service_role;

-- ─── 저장소 ──────────────────────────────────────────────────────────────────
-- 파싱은 PDF 로 하지만 원본도 보관한다. PDF 만 남기면 편집이 불가능해 교육 콘텐츠
-- 자산이 되지 못한다. 한글·워드·파워포인트를 브라우저가 application/octet-stream 으로
-- 올리는 경우가 흔해 허용 목록에 포함한다 — 확장자·크기 검증은 서명 URL 발급 라우트가 한다.
-- 50MB 는 Supabase 요금제의 전역 상한이라 더 올릴 수 없다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'instructor-documents',
  'instructor-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/octet-stream',
    'application/haansofthwp',
    'application/vnd.hancom.hwp',
    'application/vnd.hancom.hwpx',
    'application/x-hwp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
