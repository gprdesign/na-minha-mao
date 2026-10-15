-- Permite que tarefas enviadas ao cliente para aprovação tenham uma coluna própria.
-- Executar uma vez no SQL Editor do Supabase.
begin;

alter table public.nmm_tasks
  drop constraint if exists nmm_tasks_status_check;

alter table public.nmm_tasks
  add constraint nmm_tasks_status_check
  check (status in ('active', 'waiting', 'client_review'));

commit;
