-- 계약번호는 앱에서 세면 동시 생성 시 겹친다. 시퀀스로 발급해 UNIQUE 충돌을 원천 차단한다.
create or replace function public.next_contract_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'KNU-' || to_char(now() at time zone 'Asia/Seoul', 'YYYY') || '-'
         || lpad(nextval('public.contract_no_seq')::text, 4, '0');
$$;

revoke all on function public.next_contract_no() from public, anon, authenticated;
grant execute on function public.next_contract_no() to service_role;
