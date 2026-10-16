-- TNM — notas independentes, privadas e sincronizadas por conta.
-- Executar uma vez no SQL Editor do Supabase.
begin;

create table if not exists public.nmm_notes (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists nmm_notes_owner_updated_idx
  on public.nmm_notes(owner_id, updated_at desc);

alter table public.nmm_notes enable row level security;
grant select, insert, update on public.nmm_notes to authenticated;

drop policy if exists nmm_notes_owner_all on public.nmm_notes;
create policy nmm_notes_owner_all on public.nmm_notes
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

commit;
