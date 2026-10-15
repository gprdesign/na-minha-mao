-- Na Minha Mão — checklist de subtarefas por tarefa.
-- A coluna é aditiva e tarefas existentes recebem uma lista vazia.
alter table public.nmm_tasks
  add column if not exists subtasks jsonb not null default '[]'::jsonb;
