insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-source-documents',
  'company-source-documents',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
