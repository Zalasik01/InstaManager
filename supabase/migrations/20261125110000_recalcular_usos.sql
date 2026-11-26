-- Recalcula hashtags.usos e ultimo_uso a partir dos posts publicados que existem no banco.
-- Usada pela sincronização com o Instagram: depois de apagar ou importar posts, o contador
-- de uso de cada tag precisa refletir só os posts que sobraram. Idempotente.

create or replace function public.recalcular_usos_hashtags()
returns void
language sql
security definer
set search_path = public
as $$
  update public.hashtags h
     set usos = coalesce((
           select count(*)
             from public.posts p
            where p.status = 'publicado'
              and lower(p.legenda) ~ ('(^|[^[:alnum:]_])' || h.tag || '($|[^[:alnum:]_])')
         ), 0),
         ultimo_uso = (
           select max(coalesce(p.agendado_para, p.atualizado_em))
             from public.posts p
            where p.status = 'publicado'
              and lower(p.legenda) ~ ('(^|[^[:alnum:]_])' || h.tag || '($|[^[:alnum:]_])')
         );
$$;

revoke all on function public.recalcular_usos_hashtags() from public, anon, authenticated;
grant execute on function public.recalcular_usos_hashtags() to service_role;
