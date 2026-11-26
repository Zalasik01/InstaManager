-- Hashtags medidas: o bot passa a contar o uso de cada tag e a registrar as tags novas que o dono escrever.
-- hashtags.usos: quantas vezes a tag foi publicada. hashtags.ativa: false tira a tag do sorteio.
-- hashtags.origem: 'semente' (lista inicial), 'manual' (apareceu numa legenda escrita pelo dono) ou 'ia'.
-- registrar_usos_hashtags: lê as hashtags da legenda final de um post publicado e atualiza usos e ultimo_uso.
--   Tags que ainda não existem entram com origem 'manual' para também serem medidas.
-- A nota (alcance relativo médio) continua sendo atualizada pela função coletar-metricas.
-- Idempotente.

alter table public.hashtags add column if not exists usos integer not null default 0;
alter table public.hashtags add column if not exists ativa boolean not null default true;
alter table public.hashtags add column if not exists origem text not null default 'semente';

create or replace function public.registrar_usos_hashtags(p_post_id uuid)
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

  -- Cada hashtag única da legenda, em minúsculas.
  for v_tag in
    select distinct lower(m[1])
    from regexp_matches(v_legenda, '(#[[:alnum:]_]+)', 'g') as m
  loop
    insert into public.hashtags (tag, tamanho, origem)
    values (v_tag, 'nicho', 'manual')
    on conflict (tag) do nothing;

    update public.hashtags
       set usos = usos + 1,
           ultimo_uso = now()
     where tag = v_tag;

    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.registrar_usos_hashtags(uuid) from public, anon, authenticated;
grant execute on function public.registrar_usos_hashtags(uuid) to service_role;
