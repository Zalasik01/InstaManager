-- Vídeos e Reels tocando no site.
-- posts.video_path: caminho do MP4 no bucket `galeria` (null = post sem vídeo ou vídeo grande demais).
-- O bucket `galeria` passa a aceitar video/mp4 e arquivos de até 50 MB (limite do plano free do Supabase).
-- listar_posts_publicos devolve também video_path. Idempotente.

alter table public.posts add column if not exists video_path text;

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'video/mp4']
 where id = 'galeria';

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
  comentarios integer,
  video_path text
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
         m.comentarios,
         p.video_path
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
