-- 상담 기록을 녹취 말고도 남길 수 있게 한다.
--
-- 현장에서 녹음을 못 하는 상담이 있다(고객사가 꺼리거나, 서서 하는 짧은 이야기이거나).
-- 그때 담당자는 수첩에 적는다. 그 두 가지를 받는다: 화면에서 직접 입력, 적어 둔 메모 올리기.
--
-- 지금 표는 오디오 파일을 전제로 만들어져 있다 — storage_path·mime_type·file_size 가 모두
-- not null 이라 파일 없는 기록이 아예 들어가지 않는다. 그 셋을 nullable 로 푼다.
-- 값을 지우거나 형을 줄이지 않으므로 기존 행과 기존 코드에는 영향이 없다.

alter table public.company_consultations
  alter column storage_path drop not null,
  alter column mime_type drop not null,
  alter column file_size drop not null;

-- storage_path 의 unique 는 그대로 둔다. Postgres 의 unique 는 NULL 을 여럿 허용하므로
-- 파일 없는 기록이 여러 건이어도 부딪히지 않는다.

alter table public.company_consultations
  add column if not exists source text not null default 'audio',
  -- 직접 입력한 글, 또는 메모 사진·PDF 에서 읽어 낸 글. 녹취에는 transcript 가 있으므로 비어 있다.
  add column if not exists note text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_consultations_source_check'
  ) then
    alter table public.company_consultations
      add constraint company_consultations_source_check
      check (source in ('audio', 'text', 'memo'));
  end if;
end $$;

comment on column public.company_consultations.source is
  'audio = 녹취 파일, text = 화면에서 직접 입력, memo = 적어 둔 메모 파일에서 읽음';
comment on column public.company_consultations.note is
  '직접 입력하거나 메모에서 읽어 낸 상담 내용 원문. source=audio 이면 비어 있다.';

-- 메모 원본을 보관할 자리. 원본은 근거라서 읽어 낸 글만 남기고 버리지 않는다.
-- 손글씨 사진과 PDF 가 대부분이고, 한글(hwp)·워드는 모델이 직접 읽지 못해 받지 않는다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consultation-notes',
  'consultation-notes',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'text/plain'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
