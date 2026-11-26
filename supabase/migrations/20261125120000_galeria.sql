-- Galeria pública para o site polo9n.com.br.
-- Bucket `galeria` (público): cópia das imagens dos posts publicados. O Drive é privado e as URLs
--   de imagem do Instagram expiram, por isso o site lê desta cópia.
-- posts.galeria_paths: caminhos das imagens do post dentro do bucket `galeria`.
-- listar_posts_publicos / contar_posts_publicos: as ÚNICAS portas que o site (chave anon) tem para os
--   dados. Devolvem só legenda, data, link e imagens de posts publicados (que já são públicos no
--   Instagram). As tabelas continuam com RLS e sem política: o anon não lê nada diretamente.
-- Idempotente.

alter table public.posts add column if not exists galeria_paths text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('galeria', 'galeria', true, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function public.listar_posts_publicos(p_limite integer default 12, p_offset integer default 0)
returns table (
  id uuid,
  legenda text,
  publicado_em timestamptz,
  permalink text,
  galeria_paths text[]
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
         p.galeria_paths
    from public.posts p
   where p.status = 'publicado'
     and cardinality(p.galeria_paths) > 0
   order by coalesce(p.agendado_para, p.atualizado_em) desc
   limit least(greatest(p_limite, 1), 50)
  offset greatest(p_offset, 0);
$$;

create or replace function public.contar_posts_publicos()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.posts p
   where p.status = 'publicado'
     and cardinality(p.galeria_paths) > 0;
$$;

revoke all on function public.listar_posts_publicos(integer, integer) from public;
revoke all on function public.contar_posts_publicos() from public;
grant execute on function public.listar_posts_publicos(integer, integer) to anon, authenticated, service_role;
grant execute on function public.contar_posts_publicos() to anon, authenticated, service_role;
