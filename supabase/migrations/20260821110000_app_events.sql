-- 베타 사용 기록.
--
-- 교육사업팀이 직접 쓰기 시작했다. 무엇을 눌렀는지, 결과가 멀쩡했는지, 실패한 요청은
-- 없었는지를 우리가 알아야 다음에 무엇을 고칠지 정할 수 있다.
--
-- 왜 서버 로그로 부족한가: 실제로 겪었다. 아이폰 음성 메모(.m4a)를 못 올리던 버그는
-- 브라우저가 업로드 단계에서 거절당해 **서버에 닿지도 않았다**. 그래서 어느 로그에도
-- 흔적이 없었고, 사장님이 오류 문구를 그대로 옮겨 주시기 전까지 아무도 몰랐다.
-- 그런 실패까지 남기려면 화면 쪽에서도 보내야 한다.

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- api = 화면이 부른 요청, error = 화면에서 터진 오류, server = 서버가 남긴 것,
  -- quality = 결과가 얼마나 멀쩡했는지(품질 신호)
  kind text not null default 'api',
  -- 경로에서 id 를 걷어낸 이름. /api/companies/:id/consultations 처럼 모아 세기 위한 것.
  name text not null,
  method text not null default '',
  status integer,
  ok boolean not null default true,
  duration_ms integer,
  -- 실패 사유. 우리가 쓴 한국어 안내가 그대로 들어온다.
  message text not null default '',
  detail jsonb not null default '{}'::jsonb,
  -- 브라우저를 구분하는 익명 값. 계정이 아직 하나뿐이라 '몇 사람이 쓰는지'는 이걸로만 안다.
  session_key text not null default '',
  source text not null default 'client'
);

-- 보는 방식이 셋이다: 최근순 훑기, 실패만 보기, 기능별로 세기.
create index if not exists app_events_at_idx on public.app_events (at desc);
create index if not exists app_events_failures_idx on public.app_events (ok, at desc);
create index if not exists app_events_name_idx on public.app_events (name, at desc);

alter table public.app_events enable row level security;
revoke all on table public.app_events from anon, authenticated;
grant select, insert, delete on table public.app_events to service_role;

create policy "deny direct client access"
on public.app_events
for all
to anon, authenticated
using (false)
with check (false);

comment on table public.app_events is
  '베타 사용·실패 기록. 개인정보나 문서 내용은 넣지 않는다 — 경로·상태·소요시간·우리가 쓴 안내 문구만.';
