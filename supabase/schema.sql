-- Na Minha Mão — schema inicial para sincronização privada via Supabase.
-- Todas as tabelas são protegidas por RLS e isoladas por owner_id.

create table if not exists public.nmm_tasks (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  details text not null default '',
  subtasks jsonb not null default '[]'::jsonb,
  status text not null check (status in ('active', 'waiting', 'client_review')),
  release_date date,
  due_date date,
  estimate_minutes integer not null default 60 check (estimate_minutes >= 5),
  reward text not null default '',
  blocker text not null default '',
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_date date
);

create table if not exists public.nmm_task_comments (
  id text primary key,
  task_id text not null references public.nmm_tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  source text not null default 'Manual' check (source in ('Manual', 'WhatsApp', 'Radar')),
  created_at timestamptz not null default now()
);

create table if not exists public.nmm_task_links (
  id text primary key,
  task_id text not null references public.nmm_tasks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '',
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.nmm_notes (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists nmm_tasks_owner_status_idx on public.nmm_tasks(owner_id, status);
create index if not exists nmm_notes_owner_updated_idx on public.nmm_notes(owner_id, updated_at desc);
create index if not exists nmm_comments_task_created_idx on public.nmm_task_comments(task_id, created_at);
create index if not exists nmm_links_task_created_idx on public.nmm_task_links(task_id, created_at);

alter table public.nmm_tasks enable row level security;
alter table public.nmm_task_comments enable row level security;
alter table public.nmm_task_links enable row level security;
alter table public.nmm_notes enable row level security;

grant select, insert, update, delete on public.nmm_tasks to authenticated;
grant select, insert on public.nmm_task_comments to authenticated;
grant select, insert, delete on public.nmm_task_links to authenticated;
grant select, insert, update on public.nmm_notes to authenticated;

create policy nmm_notes_owner_all on public.nmm_notes
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy nmm_tasks_owner_all on public.nmm_tasks
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy nmm_comments_owner_select on public.nmm_task_comments
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy nmm_comments_owner_insert on public.nmm_task_comments
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.nmm_tasks t
      where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );

create policy nmm_links_owner_select on public.nmm_task_links
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy nmm_links_owner_insert on public.nmm_task_links
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.nmm_tasks t
      where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );

create policy nmm_links_owner_delete on public.nmm_task_links
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.nmm_tasks t
      where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );
