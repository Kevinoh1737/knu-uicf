-- 기업 담당자. 상담 일정을 잡고 브리프를 보내고 계약을 진행할 상대다.
-- 명함 한 장 분량만 담는다 — 주소·생년월일 같은 것은 교육 운영에 필요 없다.
alter table public.company_research
  add column if not exists contact jsonb not null default '{}'::jsonb;

comment on column public.company_research.contact is
  '담당자 { name, position, department, email, phone }. 명함 이미지나 리멤버 텍스트에서 추출한다.';
