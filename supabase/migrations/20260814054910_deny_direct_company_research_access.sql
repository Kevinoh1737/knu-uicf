create policy "deny direct client access"
on public.company_research
for all
to anon, authenticated
using (false)
with check (false);
