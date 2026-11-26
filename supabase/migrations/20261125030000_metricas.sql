-- Métricas e aprendizado de hashtags (fase 6b).
-- Efeito: novas colunas em metricas e dois agendamentos (pg_cron + pg_net):
--   coletar-metricas  todo dia às 06:00 UTC
--   relatorio-semanal domingo às 21:00 UTC (18h de Brasília)
-- O segredo vem do Vault (nome: cron_secret), nunca fica escrito aqui.
-- Antes de aplicar, crie o segredo uma vez (SQL Editor):
--   select vault.create_secret('<mesmo valor do secret CRON_SECRET>', 'cron_secret');
-- Idempotente: pode rodar mais de uma vez.

alter table public.metricas add column if not exists compartilhamentos integer;
alter table public.metricas add column if not exists interacoes_total integer;
create index if not exists metricas_post_coletado_idx on public.metricas (post_id, coletado_em desc);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamentos antigos com o mesmo nome antes de recriar.
select cron.unschedule(jobid) from cron.job where jobname in ('coletar-metricas', 'relatorio-semanal');

select cron.schedule(
  'coletar-metricas',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://crzmyemggpgjcrwwuwka.supabase.co/functions/v1/coletar-metricas',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'relatorio-semanal',
  '0 21 * * 0',
  $$
  select net.http_post(
    url := 'https://crzmyemggpgjcrwwuwka.supabase.co/functions/v1/relatorio-semanal',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
