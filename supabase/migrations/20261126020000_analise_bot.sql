-- Análise no bot: histórico de seguidores, melhor horário e alerta de post em alta.
-- Efeito:
--   1) seguidores_historico: uma linha por dia (fuso America/Sao_Paulo) copiada de perfil_ig.
--      Job pg_cron 'seguidores-historico' todo dia às 07:00 UTC (depois da coleta das 06:00). Só SQL, sem HTTP.
--      Já grava a linha de hoje ao aplicar, para o /stats ter ponto de partida.
--   2) estatisticas_horarios(): dia da semana e faixa de 2 h com melhor alcance relativo (alcance / mediana),
--      no fuso America/Sao_Paulo, a partir da data real de publicação. Só grupos com 2 posts ou mais.
--   3) mediana_alcance(p_excluir): mediana do alcance (última coleta de cada post publicado), sem os posts dados.
--   4) posts.alerta_alta_em: quando o alerta de "post em alta" já foi mandado (não repete).
--      Job pg_cron 'alerta-alta' de hora em hora (minuto 15) chamando a função alerta-alta.
-- O segredo vem do Vault (nome: cron_secret), nunca fica escrito aqui.
-- Funções security definer: só service_role executa. RLS ligado e sem política na tabela nova.
-- Idempotente: pode rodar mais de uma vez.

-- 1) Histórico diário de seguidores ------------------------------------------------------------

create table if not exists public.seguidores_historico (
  dia           date primary key,
  seguidores    integer,
  seguindo      integer,
  midias        integer,
  registrado_em timestamptz default now()
);

alter table public.seguidores_historico enable row level security;

insert into public.seguidores_historico (dia, seguidores, seguindo, midias, registrado_em)
select (now() at time zone 'America/Sao_Paulo')::date, p.seguidores, p.seguindo, p.midias, now()
  from public.perfil_ig p
 where p.id = 1 and p.seguidores is not null
on conflict (dia) do update
   set seguidores = excluded.seguidores,
       seguindo = excluded.seguindo,
       midias = excluded.midias,
       registrado_em = excluded.registrado_em;

-- 2) Melhor horário ------------------------------------------------------------------------------

create or replace function public.estatisticas_horarios()
returns table (dia integer, hora integer, pontuacao numeric, amostras integer)
language sql
stable
security definer
set search_path = public
as $$
  with ult as (
    select (coalesce(p.agendado_para, p.atualizado_em) at time zone 'America/Sao_Paulo') as local,
           m.alcance::numeric as alcance
      from public.posts p
      join lateral (
        select x.alcance
          from public.metricas x
         where x.post_id = p.id and x.alcance is not null
         order by x.coletado_em desc
         limit 1
      ) m on true
     where p.status = 'publicado'
  ),
  med as (
    select percentile_cont(0.5) within group (order by alcance)::numeric as valor from ult
  )
  select extract(dow from u.local)::integer as dia,
         ((extract(hour from u.local)::integer / 2) * 2) as hora,
         round(avg(u.alcance / med.valor), 3) as pontuacao,
         count(*)::integer as amostras
    from ult u
   cross join med
   where med.valor > 0
   group by 1, 2
  having count(*) >= 2
   order by pontuacao desc, amostras desc;
$$;

revoke all on function public.estatisticas_horarios() from public, anon, authenticated;
grant execute on function public.estatisticas_horarios() to service_role;

-- 3) Mediana de alcance (para o alerta) ---------------------------------------------------------

create or replace function public.mediana_alcance(p_excluir uuid[] default '{}')
returns table (mediana numeric, amostras integer)
language sql
stable
security definer
set search_path = public
as $$
  with ult as (
    select m.alcance::numeric as alcance
      from public.posts p
      join lateral (
        select x.alcance
          from public.metricas x
         where x.post_id = p.id and x.alcance is not null
         order by x.coletado_em desc
         limit 1
      ) m on true
     where p.status = 'publicado'
       and not (p.id = any (coalesce(p_excluir, '{}')))
  )
  select percentile_cont(0.5) within group (order by alcance)::numeric, count(*)::integer from ult;
$$;

revoke all on function public.mediana_alcance(uuid[]) from public, anon, authenticated;
grant execute on function public.mediana_alcance(uuid[]) to service_role;

-- 4) Alerta de post em alta ---------------------------------------------------------------------

alter table public.posts add column if not exists alerta_alta_em timestamptz;

-- Agendamentos ----------------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamentos antigos com o mesmo nome antes de recriar.
select cron.unschedule(jobid) from cron.job where jobname in ('seguidores-historico', 'alerta-alta');

select cron.schedule(
  'seguidores-historico',
  '0 7 * * *',
  $$
  insert into public.seguidores_historico (dia, seguidores, seguindo, midias, registrado_em)
  select (now() at time zone 'America/Sao_Paulo')::date, p.seguidores, p.seguindo, p.midias, now()
    from public.perfil_ig p
   where p.id = 1 and p.seguidores is not null
  on conflict (dia) do update
     set seguidores = excluded.seguidores,
         seguindo = excluded.seguindo,
         midias = excluded.midias,
         registrado_em = excluded.registrado_em;
  $$
);

select cron.schedule(
  'alerta-alta',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://crzmyemggpgjcrwwuwka.supabase.co/functions/v1/alerta-alta',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
