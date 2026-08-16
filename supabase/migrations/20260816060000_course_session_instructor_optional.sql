-- 실제 순서는 교육과정을 먼저 만들고 그 과정에 강사를 배정하는 것이다.
-- instructor_id 가 필수면 강사를 정하기 전에는 과정을 만들 수 없어 순서가 뒤집힌다.
alter table public.course_sessions alter column instructor_id drop not null;

comment on column public.course_sessions.instructor_id is
  '배정 전에는 null. 교육과정 생성 → 강사 배정 순서라 필수가 아니다.';
