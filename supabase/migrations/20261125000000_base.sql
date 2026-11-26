-- Base do InstaManager: tabelas de posts, hashtags e métricas, mais o bucket público de fotos.
-- Idempotente: pode rodar mais de uma vez sem erro.
-- RLS ligado e sem políticas: só as Edge Functions (service_role) acessam os dados.

create table if not exists public.posts (
  id               uuid primary key default gen_random_uuid(),
  chat_id          bigint not null,
  media_group_id   text,
  telegram_file_ids text[] not null default '{}',
  storage_paths    text[] not null default '{}',
  drive_file_ids   text[] not null default '{}',
  dica             text,
  legenda          text,
  status           text not null default 'rascunho'
                   check (status in ('rascunho','agendado','publicando','publicado','erro','cancelado')),
  agendado_para    timestamptz,
  ig_media_id      text,
  erro_msg         text,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create index if not exists posts_status_agendado_idx on public.posts (status, agendado_para);
create index if not exists posts_media_group_idx on public.posts (chat_id, media_group_id);

create table if not exists public.hashtags (
  tag         text primary key,
  tamanho     text not null default 'nicho' check (tamanho in ('grande','media','nicho')),
  tema        text,
  nota        numeric not null default 0,
  ultimo_uso  timestamptz,
  criado_em   timestamptz not null default now()
);

create table if not exists public.metricas (
  id           bigint generated always as identity primary key,
  post_id      uuid not null references public.posts(id) on delete cascade,
  coletado_em  timestamptz not null default now(),
  alcance      integer,
  impressoes   integer,
  curtidas     integer,
  comentarios  integer,
  salvamentos  integer
);

alter table public.posts     enable row level security;
alter table public.hashtags  enable row level security;
alter table public.metricas  enable row level security;

-- Hashtags iniciais (nicho Polo / VW). Podem ser trocadas depois.
insert into public.hashtags (tag, tamanho, tema) values
  ('#volkswagen','grande','vw'),
  ('#vw','grande','vw'),
  ('#carros','grande','geral'),
  ('#carrosrebaixados','media','estilo'),
  ('#vwpolo','media','polo'),
  ('#polo','media','polo'),
  ('#vwclub','media','vw'),
  ('#carrosbrasil','media','geral'),
  ('#polo9n4','nicho','polo'),
  ('#polo2012','nicho','polo'),
  ('#polo9n3','nicho','polo'),
  ('#vwpolo9n4','nicho','polo'),
  ('#polohatch','nicho','polo'),
  ('#polosedan','nicho','polo'),
  ('#clubedopolo','nicho','polo')
on conflict (tag) do nothing;

-- Bucket público: o Instagram precisa baixar a imagem por URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 10485760, array['image/jpeg'])
on conflict (id) do nothing;
