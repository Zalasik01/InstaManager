-- Logs do bot: tabela de registros (info, aviso, erro) para achar falhas depois.
-- Também cria status_cron(), que informa a última execução de cada job do pg_cron
-- (usada pelo comando de status), e agenda a limpeza diária de logs com mais de 60 dias.
-- Idempotente. RLS ligado e sem políticas: só as Edge Functions (service_role) acessam.

create table if not exists public.logs (
  id        bigint generated always as identity primary key,
  em        timestamptz not null default now(),
  nivel     text not null default 'info' check (nivel in ('info','aviso','erro')),
  origem    text not null,
  mensagem  text not null,
  detalhe   jsonb
);

create index if not exists logs_em_idx on public.logs (em desc);

alter table public.logs enable row level security;

-- Última execução de cada job do pg_cron.
create or replace function public.status_cron()
returns table (jobname text, ultima_execucao timestamptz, status text)
language sql
security definer
set search_path = public, cron
as $$
  select j.jobname::text,
         d.ultima_execucao,
         d.status::text
  from cron.job j
  left join lateral (
    select coalesce(r.end_time, r.start_time) as ultima_execucao, r.status
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
$$;

revoke all on function public.status_cron() from public, anon, authenticated;
grant execute on function public.status_cron() to service_role;

-- Limpeza: guarda só os últimos 60 dias, todo dia às 05:10 UTC.
select cron.unschedule('limpar-logs') where exists (select 1 from cron.job where jobname = 'limpar-logs');
select cron.schedule('limpar-logs', '10 5 * * *', $$delete from public.logs where em < now() - interval '60 days'$$);
