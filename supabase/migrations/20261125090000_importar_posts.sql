-- Importação de posts que já existiam no Instagram (publicados à mão).
-- posts.origem: 'bot' (criado pelo bot) ou 'importado' (lido da API do Instagram).
-- registrar_usos_hashtags ganha p_quando: a data real do post, para o ultimo_uso das tags
--   não ficar como "agora" quando o post é antigo. Idempotente.

alter table public.posts add column if not exists origem text not null default 'bot';

-- Troca a assinatura antiga (só post_id) pela nova (post_id + data opcional).
drop function if exists public.registrar_usos_hashtags(uuid);

create or replace function public.registrar_usos_hashtags(p_post_id uuid, p_quando timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_legenda text;
  v_tag text;
  v_total integer := 0;
begin
  select legenda into v_legenda from public.posts where id = p_post_id;
  if v_legenda is null then
    return 0;
  end if;

  for v_tag in
    select distinct lower(m[1])
    from regexp_matches(v_legenda, '(#[[:alnum:]_]+)', 'g') as m
  loop
    insert into public.hashtags (tag, tamanho, origem)
    values (v_tag, 'nicho', 'manual')
    on conflict (tag) do nothing;

    update public.hashtags
       set usos = usos + 1,
           ultimo_uso = greatest(coalesce(ultimo_uso, p_quando), p_quando)
     where tag = v_tag;

    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.registrar_usos_hashtags(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_usos_hashtags(uuid, timestamptz) to service_role;
