-- Mantém o dia planejado separado do prazo de entrega.
-- Coluna nullable: registros existentes permanecem sem Dia de execução.
alter table public.nmm_tasks
  add column if not exists execution_date date;
