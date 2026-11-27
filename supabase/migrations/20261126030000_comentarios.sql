-- Comentários do Instagram no visualizador do site (item 26).
-- comentarios: cópia dos comentários dos posts publicados, preenchida pela função coletar-comentarios
--   (a cada 3 horas, via pg_cron + pg_net). Comentários que somem do Instagram são apagados aqui também.
--   `oculto` permite esconder um comentário do site sem apagá-lo (a coleta nunca mexe nessa coluna).
-- listar_comentarios_publicos: a única porta que o site (chave anon) tem para os comentários:
--   só não ocultos, só de posts publicados, mais recentes primeiro.
-- RLS ligado e sem política: o anon não lê a tabela diretamente.
-- O segredo do cron vem do Vault (nome: cron_secret), nunca fica escrito aqui. Idempotente.

create table if not exists public.comentarios (
  id          text primary key,
  post_id     uuid not null references public.posts (id) on delete cascade,
  usuario     text,
  texto       text,
  curtidas    integer,
  criado_em   timestamptz,
  coletado_em timestamptz not null default now(),
  oculto      boolean not null default false
);

create index if not exists comentarios_post_criado_idx on public.comentarios (post_id, criado_em desc);

alter table public.comentarios enable row level security;

create or replace function public.listar_comentarios_publicos(p_post_id uuid, p_limite integer default 20)
returns table (usuario text, texto text, curtidas integer, criado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.usuario, c.texto, c.curtidas, c.criado_em
    from public.comentarios c
    join public.posts p on p.id = c.post_id
   where c.post_id = p_post_id
     and not c.oculto
     and p.status = 'publicado'
   order by c.criado_em desc nulls last
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;

revoke all on function public.listar_comentarios_publicos(uuid, integer) from public;
grant execute on function public.listar_comentarios_publicos(uuid, integer) to anon, authenticated, service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove o agendamento antigo com o mesmo nome antes de recriar.
select cron.unschedule(jobid) from cron.job where jobname = 'coletar-comentarios';

-- A cada 3 horas, no minuto 20 (fora do horário cheio das outras rotinas).
select cron.schedule(
  'coletar-comentarios',
  '20 */3 * * *',
  $$
  select net.http_post(
    url := 'https://crzmyemggpgjcrwwuwka.supabase.co/functions/v1/coletar-comentarios',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
