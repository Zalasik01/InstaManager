-- Carrossel (fase 6): um álbum do Telegram (várias fotos com o mesmo media_group_id) vira UM post.
-- Cria um índice único parcial (decide quem cria o post numa corrida) e a função anexar_foto_post,
-- que anexa a foto de forma atômica (até 10 fotos por post).
-- Idempotente: pode rodar mais de uma vez sem erro.

alter table public.posts add column if not exists fotos_excedentes integer not null default 0;

-- Só um post por álbum de cada chat. Quem perder a corrida no insert vira anexo.
create unique index if not exists posts_media_group_unico_idx
  on public.posts (chat_id, media_group_id)
  where media_group_id is not null;

-- Anexa uma foto ao rascunho do álbum.
-- Retorna: N (>= 2) = nova quantidade de fotos; -1 = post já está cheio (10), extra ignorada e contada;
--          0 = não existe rascunho desse álbum (o chamador deve criar o post).
create or replace function public.anexar_foto_post(
  p_chat_id bigint,
  p_media_group_id text,
  p_file_id text,
  p_path text,
  p_dica text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd integer;
  v_id uuid;
begin
  -- UPDATE com array_append é atômico: a linha fica travada, então updates simultâneos se enfileiram.
  update public.posts
     set telegram_file_ids = array_append(telegram_file_ids, p_file_id),
         storage_paths     = array_append(storage_paths, p_path),
         dica              = coalesce(dica, p_dica),
         atualizado_em     = now()
   where chat_id = p_chat_id
     and media_group_id = p_media_group_id
     and status = 'rascunho'
     and cardinality(storage_paths) < 10
  returning cardinality(storage_paths) into v_qtd;

  if v_qtd is not null then
    return v_qtd;
  end if;

  -- Não anexou: ou está cheio, ou não existe rascunho.
  update public.posts
     set fotos_excedentes = fotos_excedentes + 1
   where chat_id = p_chat_id
     and media_group_id = p_media_group_id
     and status = 'rascunho'
  returning id into v_id;

  if v_id is not null then
    return -1;
  end if;
  return 0;
end;
$$;

revoke all on function public.anexar_foto_post(bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.anexar_foto_post(bigint, text, text, text, text) to service_role;
