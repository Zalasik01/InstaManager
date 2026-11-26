-- Contador de visualizações nos posts do site.
-- metricas.visualizacoes: métrica `views` do Instagram (substitui impressions/plays).
-- listar_posts_publicos passa a devolver também visualizacoes, curtidas e comentarios, lidos da
--   coleta de métricas mais recente de cada post (null enquanto o post não tem métricas).
-- Os números são os mesmos que já aparecem publicamente no Instagram. Idempotente.

alter table public.metricas add column if not exists visualizacoes integer;

-- A assinatura de retorno muda, então a função antiga precisa ser removida antes.
drop function if exists public.listar_posts_publicos(integer, integer);

create or replace function public.listar_posts_publicos(p_limite integer default 12, p_offset integer default 0)
returns table (
  id uuid,
  legenda text,
  publicado_em timestamptz,
  permalink text,
  galeria_paths text[],
  visualizacoes integer,
  curtidas integer,
  comentarios integer
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.legenda,
         coalesce(p.agendado_para, p.atualizado_em) as publicado_em,
         p.permalink,
         p.galeria_paths,
         m.visualizacoes,
         m.curtidas,
         m.comentarios
    from public.posts p
    left join lateral (
      select x.visualizacoes, x.curtidas, x.comentarios
        from public.metricas x
       where x.post_id = p.id
       order by x.id desc
       limit 1
    ) m on true
   where p.status = 'publicado'
     and cardinality(p.galeria_paths) > 0
   order by coalesce(p.agendado_para, p.atualizado_em) desc
   limit least(greatest(p_limite, 1), 50)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.listar_posts_publicos(integer, integer) from public;
grant execute on function public.listar_posts_publicos(integer, integer) to anon, authenticated, service_role;
