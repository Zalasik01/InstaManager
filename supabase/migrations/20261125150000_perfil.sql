-- Números públicos do perfil do Instagram (seguidores, seguindo, posts) para o site.
-- perfil_ig: uma única linha (id = 1), atualizada pela função coletar-metricas todo dia
--   (e sempre que a sincronização do bot roda). O site NÃO chama o Instagram a cada visita.
-- obter_perfil_publico: a única porta que o site (chave anon) tem para esses números.
-- RLS ligado e sem política: o anon não lê a tabela diretamente. Idempotente.

create table if not exists public.perfil_ig (
  id            integer primary key default 1 check (id = 1),
  seguidores    integer,
  seguindo      integer,
  midias        integer,
  atualizado_em timestamptz not null default now()
);

alter table public.perfil_ig enable row level security;

create or replace function public.obter_perfil_publico()
returns table (seguidores integer, seguindo integer, midias integer, atualizado_em timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.seguidores, p.seguindo, p.midias, p.atualizado_em
    from public.perfil_ig p
   where p.id = 1;
$$;

revoke all on function public.obter_perfil_publico() from public;
grant execute on function public.obter_perfil_publico() to anon, authenticated, service_role;
