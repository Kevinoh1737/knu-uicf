-- 만족도 응답을 결과지 파일에서도 받는다.
--
-- 실제 운영은 이렇다: 수업이 끝나자마자 그 자리에서 수강생 휴대폰으로 링크를 보내 받고,
-- 구글폼에 쌓인 결과를 엑셀로 내려받는다. 그 파일을 올려 우리 집계로 들여온다.
--
-- 지금 표는 '보낸 사람이 답한다'를 전제로 한다 — survey_responses.invite_id 가 not null 이라
-- 초대장이 없는 응답은 들어가지 않는다. 파일에서 온 응답에는 초대장이 없다.

alter table public.survey_responses
  alter column invite_id drop not null;

-- unique 는 그대로 둔다. Postgres 의 unique 는 NULL 을 여럿 허용하므로 파일에서 온 응답이
-- 여러 건이어도 부딪히지 않고, 링크로 받은 응답은 여전히 초대장당 하나로 묶인다.

alter table public.survey_responses
  add column if not exists source text not null default 'link',
  -- 구글폼이 이름을 받았으면 채워지고, 익명으로 받았으면 빈 문자열이다.
  add column if not exists respondent_name text not null default '',
  add column if not exists respondent_note text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'survey_responses_source_check'
  ) then
    alter table public.survey_responses
      add constraint survey_responses_source_check
      check (source in ('link', 'import'));
  end if;
end $$;

-- 다시 올리기가 흔하다(빠진 사람이 나중에 답하거나, 잘못 올렸거나). 그때 파일에서 온 응답만
-- 걷어내고 다시 넣으므로, 그 묶음을 빠르게 찾을 수 있어야 한다.
create index if not exists survey_responses_survey_source_idx
  on public.survey_responses (survey_id, source);

comment on column public.survey_responses.source is
  'link = 발송한 링크로 받은 응답, import = 결과지 파일에서 들여온 응답';
comment on column public.survey_responses.respondent_name is
  '결과지에 이름 열이 있었을 때만 채워진다. 익명 조사면 빈 문자열.';
comment on column public.survey_responses.respondent_note is
  '결과지의 응답 시각처럼 원본에만 있던 참고값.';
