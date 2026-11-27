-- Banco de fotos, posts fixados no site e novas opções do bot.
-- Efeito:
--   1) posts.status ganha a situação 'banco': post guardado pelo dono (arquivos no Storage `fotos`), sem publicar.
--      O /limpar e o cancelamento de rascunhos só mexem em status = 'rascunho', então nada do banco é apagado.
--   2) posts.fixado_ordem (1 a 3, null = não fixado): posts fixados aparecem primeiro no site, nessa ordem.
--   3) listar_posts_publicos devolve as mesmas colunas de antes MAIS `fixado` (true quando fixado_ordem não é
--      nulo) e ordena primeiro os fixados (fixado_ordem asc) e depois por data (mais novo primeiro).
--   4) config: 'story_automatico' e 'marca_dagua' começam desligadas ('off'), sem sobrescrever o que já existe.
-- Idempotente: pode rodar mais de uma vez sem erro.

-- 1) Situação 'banco'. Remove a restrição antiga de status (nome padrão posts_status_check, mas por
--    garantia apaga qualquer CHECK da tabela que liste as situações) e cria a nova.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.posts'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%rascunho%'
  loop
    execute format('alter table public.posts drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table public.posts
  add constraint posts_status_check
  check (status in ('rascunho','agendado','publicando','publicado','erro','cancelado','banco'));

create index if not exists posts_banco_idx on public.posts (chat_id, criado_em) where status = 'banco';

-- 2) Posts fixados.
alter table public.posts add column if not exists fixado_ordem smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'posts_fixado_ordem_check' and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_fixado_ordem_check check (fixado_ordem is null or fixado_ordem between 1 and 3);
  end if;
end;
$$;

-- 3) A assinatura de retorno muda (coluna nova), então a função antiga precisa ser removida antes.
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
  video_path text,
  fixado boolean
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
         p.video_path,
         (p.fixado_ordem is not null) as fixado
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
   order by p.fixado_ordem asc nulls last,
            coalesce(p.agendado_para, p.atualizado_em) desc
   limit least(greatest(p_limite, 1), 50)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.listar_posts_publicos(integer, integer) from public;
grant execute on function public.listar_posts_publicos(integer, integer) to anon, authenticated, service_role;

-- 4) Opções do bot (o dono alterna pelo /menu).
insert into public.config (chave, valor) values
  ('story_automatico', 'off'),
  ('marca_dagua', 'off')
on conflict (chave) do nothing;
