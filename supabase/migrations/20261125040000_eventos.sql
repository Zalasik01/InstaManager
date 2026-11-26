-- Tabela de eventos: registra cada etapa do bot (foto recebida, baixada, legenda, erro...).
-- Serve para descobrir onde o bot parou quando algo falha em silêncio.
-- Idempotente. RLS ligado e sem políticas: só as Edge Functions (service_role) acessam.

create table if not exists public.eventos (
  id       bigint generated always as identity primary key,
  em       timestamptz not null default now(),
  chat_id  bigint,
  etapa    text not null,
  detalhe  text
);

create index if not exists eventos_em_idx on public.eventos (em desc);

alter table public.eventos enable row level security;

-- Limpeza: guarda só os últimos 14 dias, todo dia às 05:00 UTC.
select cron.unschedule('limpar-eventos') where exists (select 1 from cron.job where jobname = 'limpar-eventos');
select cron.schedule('limpar-eventos', '0 5 * * *', $$delete from public.eventos where em < now() - interval '14 days'$$);
