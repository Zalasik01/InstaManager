-- Corrige recalcular_usos_hashtags: o Supabase bloqueia UPDATE sem WHERE ("UPDATE requires a WHERE
-- clause", extensão pg_safeupdate), então a função falhava ao recalcular o uso das hashtags.
-- A cláusula `where true` deixa explícito que a intenção é atualizar todas as linhas. Idempotente.

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
         )
   where true;
$$;

revoke all on function public.recalcular_usos_hashtags() from public, anon, authenticated;
grant execute on function public.recalcular_usos_hashtags() to service_role;
