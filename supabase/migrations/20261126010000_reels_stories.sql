-- Reels e Stories pelo bot do Telegram.
-- posts.tipo: como o post vai para o Instagram. FEED = foto ou carrossel (como sempre foi), REELS = vídeo MP4,
--   STORIES = Story de foto ou de vídeo (sem legenda). Posts antigos ficam como FEED.
-- posts.capa_file_id: file_id da miniatura (capa) que o Telegram manda junto com o vídeo. Serve para a IA
--   gerar (e regerar) a legenda do Reel a partir da imagem, sem baixar o vídeo de novo.
-- Bucket `fotos`: passa a aceitar video/mp4 e arquivos de até 50 MB (limite do plano free do Supabase).
--   Na prática o bot recebe vídeo de até 20 MB, que é o máximo que o Telegram deixa um bot baixar.
-- Idempotente: pode rodar mais de uma vez sem erro.

alter table public.posts add column if not exists tipo text not null default 'FEED';
alter table public.posts add column if not exists capa_file_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'posts_tipo_check' and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_tipo_check check (tipo in ('FEED', 'REELS', 'STORIES'));
  end if;
end;
$$;

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'video/mp4']
 where id = 'fotos';
