-- Notificação de post novo no site (Web Push, item 28).
-- push_inscricoes: uma linha por navegador inscrito (endpoint do serviço de push + chaves públicas dele).
--   Não guarda nada que identifique a pessoa. Quem envia é _shared/push.ts (notificarNovoPost), com a
--   chave de serviço; inscrições que o serviço de push dá como mortas (404/410) são apagadas lá.
-- inscrever_push / cancelar_push: as únicas portas que o site (chave anon) tem para a tabela.
--   Validam formato (endpoint https, tamanhos) e limitam o total a 5000 inscrições contra abuso.
-- RLS ligado e sem política: o anon não lê nem escreve a tabela diretamente. Idempotente.

create table if not exists public.push_inscricoes (
  endpoint     text primary key,
  p256dh       text not null,
  auth         text not null,
  criado_em    timestamptz not null default now(),
  ultimo_envio timestamptz,
  falhas       integer not null default 0
);

alter table public.push_inscricoes enable row level security;

create or replace function public.inscrever_push(p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- Formato: endpoint https de até 1000 caracteres; chaves em base64url (p256dh = 65 bytes, auth = 16 bytes).
  if p_endpoint is null or length(p_endpoint) > 1000 or p_endpoint !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/' then
    raise exception 'endpoint inválido' using errcode = '22023';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{80,100}={0,2}$' then
    raise exception 'chave p256dh inválida' using errcode = '22023';
  end if;
  if p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{16,32}={0,2}$' then
    raise exception 'chave auth inválida' using errcode = '22023';
  end if;

  -- Reinscrição do mesmo navegador: só atualiza as chaves (não conta no limite).
  update public.push_inscricoes
     set p256dh = p_p256dh, auth = p_auth, falhas = 0
   where endpoint = p_endpoint;
  if found then
    return true;
  end if;

  -- Limite simples contra abuso: no máximo 5000 inscrições no total.
  if (select count(*) from public.push_inscricoes) >= 5000 then
    raise exception 'limite de inscrições atingido' using errcode = '54000';
  end if;

  insert into public.push_inscricoes (endpoint, p256dh, auth)
  values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, falhas = 0;
  return true;
end;
$$;

create or replace function public.cancelar_push(p_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_endpoint is null or length(p_endpoint) > 1000 then
    return false;
  end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  return found;
end;
$$;

revoke all on function public.inscrever_push(text, text, text) from public;
revoke all on function public.cancelar_push(text) from public;
grant execute on function public.inscrever_push(text, text, text) to anon, authenticated, service_role;
grant execute on function public.cancelar_push(text) to anon, authenticated, service_role;
