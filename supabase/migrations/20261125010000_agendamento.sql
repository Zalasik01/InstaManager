-- Agendamento de posts (fase 5).
-- Efeito:
--   1) posts.aguardando_horario: marca o post que espera o dono digitar o horário (o bot não guarda estado em memória).
--   2) liga pg_cron e pg_net e agenda, a cada minuto, uma chamada à Edge Function publicar-agendados.
-- O segredo da chamada NÃO fica neste arquivo: vem do Supabase Vault (nome 'cron_secret').
-- Antes de aplicar, crie o secret no Vault (SQL Editor):
--   select vault.create_secret('<mesmo valor do secret CRON_SECRET da função>', 'cron_secret');
-- Idempotente: pode rodar mais de uma vez sem erro.

alter table public.posts add column if not exists aguardando_horario boolean not null default false;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Remove o agendamento anterior (se existir) para recriar sem duplicar.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'publicar-agendados') then
    perform cron.unschedule('publicar-agendados');
  end if;
end $$;

select cron.schedule(
  'publicar-agendados',
  '* * * * *',
  $cmd$
  select net.http_post(
    url := 'https://crzmyemggpgjcrwwuwka.supabase.co/functions/v1/publicar-agendados',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cmd$
);
