-- Cliques nos links da aba "Links" do site (item 22).
-- cliques_links: um contador por link e por dia (fuso America/Sao_Paulo). Não guarda nada de quem clicou:
--   nem IP, nem navegador, nem horário exato; só "o link X teve N cliques no dia D".
-- registrar_clique: a única porta que o site (chave anon, via POST /api/clique do Worker) tem para a tabela.
--   Valida o formato (link_id curto em [a-z0-9-], url https de até 500 caracteres, título até 150) e soma 1
--   no contador do dia (upsert). Título e url são atualizados para o valor mais recente do link.
-- RLS ligado e sem política: o anon não lê nem escreve a tabela diretamente. Idempotente.

create table if not exists public.cliques_links (
  link_id text not null,
  url     text not null,
  titulo  text not null default '',
  dia     date not null,
  cliques integer not null default 0,
  primary key (link_id, dia)
);

alter table public.cliques_links enable row level security;

create or replace function public.registrar_clique(p_link_id text, p_url text, p_titulo text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_titulo text := coalesce(p_titulo, '');
begin
  if p_link_id is null or p_link_id !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'link_id inválido' using errcode = '22023';
  end if;
  if p_url is null or length(p_url) > 500 or p_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/|$|\?|#)' then
    raise exception 'url inválida' using errcode = '22023';
  end if;
  if length(v_titulo) > 150 then
    raise exception 'título grande demais' using errcode = '22023';
  end if;

  insert into public.cliques_links (link_id, url, titulo, dia, cliques)
  values (p_link_id, p_url, v_titulo, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (link_id, dia) do update
    set cliques = public.cliques_links.cliques + 1,
        url     = excluded.url,
        titulo  = excluded.titulo;
end;
$$;

revoke all on function public.registrar_clique(text, text, text) from public;
grant execute on function public.registrar_clique(text, text, text) to anon, authenticated, service_role;
