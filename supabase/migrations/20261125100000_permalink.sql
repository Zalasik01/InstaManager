-- Guarda o link público (permalink) de cada post publicado no Instagram.
-- Usado pelo resumo pós-publicação (link, QR code e código de embed). Idempotente.
alter table public.posts add column if not exists permalink text;
