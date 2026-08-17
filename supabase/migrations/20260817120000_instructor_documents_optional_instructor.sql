-- 강의 구성·자료를 강사 배정 전에도 받는다.
--
-- instructor_documents.instructor_id 는 not null 이었다. 자료가 '누가 낸 것인가'와 함께
-- 남아야 강사별 이력이 되기 때문인데, 실제 순서는 그렇지 않다 — 고객사와 일정을 잡고
-- 자료부터 받아 두는 일이 흔하고, 강사 배정은 그 뒤에 온다. 순서를 강제하니 새로 만든
-- 교육에 자료를 올리면 그대로 막혔다.
--
-- 그래서 세션에 붙는 자료(outline·materials)는 강사 없이도 받고, 강사가 배정되는 순간
-- 그 세션의 빈 instructor_id 를 채운다(app/api/course-sessions/[id]/assign). 반대로
-- 프로필과 서명 계약서는 강사 자체에 붙는 문서라 강사 없이는 존재할 수 없다 — 그건
-- check 로 계속 막는다.
alter table public.instructor_documents
  alter column instructor_id drop not null;

alter table public.instructor_documents
  drop constraint if exists instructor_documents_instructor_required;

alter table public.instructor_documents
  add constraint instructor_documents_instructor_required
  check (kind not in ('profile', 'signed_contract') or instructor_id is not null);
