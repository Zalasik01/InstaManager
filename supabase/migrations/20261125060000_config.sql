-- Configurações editáveis do bot (chave/valor).
-- A chave 'contexto' é o texto de contexto que o bot dá à IA ao escrever legendas.
-- O dono edita pelo Telegram com o comando /contexto. Idempotente: não sobrescreve se já existir.
-- RLS ligado e sem políticas: só as Edge Functions (service_role) acessam.

create table if not exists public.config (
  chave          text primary key,
  valor          text not null,
  atualizado_em  timestamptz not null default now()
);

alter table public.config enable row level security;

insert into public.config (chave, valor) values (
  'contexto',
  'O carro é um VW Polo 2012 (geração 9n4) branco, e a página é do dono, que mostra o carro dele. '
  || 'Escreva em primeira pessoa, como o dono, de forma natural e curta. '
  || 'Foque só no carro: ângulo, brilho, cor e detalhes bem visíveis (rodas, lanternas, vidros). '
  || 'Ignore o cenário: não mencione oficina, loja, estúdio, piso, garagem, banners, marcas de terceiros nem textos que aparecem na foto. '
  || 'Não elogie serviços nem produtos de lojas.'
)
on conflict (chave) do nothing;
