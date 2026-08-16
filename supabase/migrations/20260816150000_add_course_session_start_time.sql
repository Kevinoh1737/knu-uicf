-- 교육은 날짜만으로는 부족하다. 4시간 특강이라 오전·오후가 갈리고, 강사와 고객사에
-- 알려 줄 때도 시각이 있어야 한다. held_on(date) 은 그대로 두고 시작 시각만 더한다 —
-- 정렬과 기존 데이터가 그대로 살아 있고, 시간을 모르는 과거 기록은 빈 값으로 남는다.
alter table public.course_sessions
  add column if not exists start_time time;

comment on column public.course_sessions.start_time is
  '시작 시각(KST). 끝나는 시각은 duration_hours 로 계산한다.';
