-- Legenda manual e limpeza do chat ao cancelar.
-- posts.mensagens: ids das mensagens do Telegram ligadas ao post (do dono e do bot),
--   para o bot apagá-las ao cancelar.
-- posts.aguardando_legenda: o próximo texto do dono vira a legenda deste post.
-- registrar_mensagens: anexa ids de mensagens ao post (ou a todo o álbum), de forma atômica.
-- Idempotente.

alter table public.posts add column if not exists mensagens bigint[] not null default '{}';
alter table public.posts add column if not exists aguardando_legenda boolean not null default false;

create or replace function public.registrar_mensagens(
  p_post_id uuid,
  p_chat_id bigint,
  p_media_group_id text,
  p_ids bigint[]
) returns void
language sql
security definer
set search_path = public
as $$
  update public.posts
     set mensagens = mensagens || p_ids
   where id = p_post_id
      or (p_post_id is null and p_media_group_id is not null
          and chat_id = p_chat_id
          and media_group_id = p_media_group_id
          and status = 'rascunho');
$$;

revoke all on function public.registrar_mensagens(uuid, bigint, text, bigint[]) from public, anon, authenticated;
grant execute on function public.registrar_mensagens(uuid, bigint, text, bigint[]) to service_role;
