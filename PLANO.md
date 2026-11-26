# InstaManager: plano consolidado

## Objetivo

Enviar fotos do Polo 2012 (9n4) para um bot do Telegram. O sistema guarda as fotos no Google Drive, a IA escreve uma legenda curta com hashtags, e o post sai no Instagram na hora ou agendado.

Restrição de custo: tudo em planos gratuitos, exceto a IA, que custa centavos por legenda.

## Fluxo

```
Você --foto--> Bot Telegram --webhook--> Edge Function (Supabase)
                                              |
                       +----------------------+----------------------+
                       v                      v                      v
               Google Drive (arquivo)   Supabase Storage       Claude (legenda)
               pasta ano/mês/dia        (URL pública p/ IG)           |
                                              +-----------+----------+
                                                          v
                                  Bot responde com prévia + botões:
                                  [Postar agora] [Agendar] [Regerar legenda] [Cancelar]
                                                          |
                       pg_cron (a cada minuto) --> Edge Function publica --> Instagram Graph API
```

## Peças e o que realmente funciona

### 1. Telegram

- Criar o bot no `@BotFather` e guardar o token.
- Usar **webhook** apontando para uma Edge Function do Supabase. Não precisa de servidor ligado.
- Validar o remetente: só aceitar o seu `chat_id`. Sem isso, qualquer pessoa que achar o bot posta na sua página.
- Enviar a foto **como arquivo/documento**. Foto normal o Telegram comprime, e o Instagram já comprime de novo.
- Várias fotos de uma vez chegam como `media_group_id`. Dá para virar **carrossel** (até 10 imagens).
- Botões inline (`inline_keyboard`) para postar agora, agendar e regerar a legenda.
- Agendar pelo chat: botões de horário prontos (hoje 19h, amanhã 12h) ou texto livre como `amanhã 18:30`.

### 2. Google Drive

- Pasta de destino: `1Du6uK4QpgrF_iVdpFViZ_GdYWwMSj0Me`.
- Organização: `AAAA/MM/DD`, por exemplo `2026/11/25/`. A data vem de quando você enviou. Se preferir a data da foto, dá para ler o EXIF, mas o Telegram remove o EXIF de fotos comuns. Só funciona se enviar como arquivo.
- **Armadilha:** conta de serviço não tem cota de armazenamento no Drive pessoal e falha com `storageQuotaExceeded`. Use **OAuth com refresh token** da sua conta Google (autoriza uma vez, escopo `drive.file`). Guardar o refresh token como secret no Supabase.
- O Drive é o arquivo permanente. Não serve de fonte para o Instagram, porque os links do Drive não entregam a imagem direta de forma confiável.

### 3. Supabase

- **Storage** (bucket público): guarda a cópia temporária que o Instagram precisa baixar. Apagar depois que o post sair.
- **Banco**, tabela `posts`: `id`, `telegram_file_ids`, `drive_file_ids`, `storage_urls`, `legenda`, `status` (`rascunho`, `agendado`, `publicando`, `publicado`, `erro`), `agendado_para`, `ig_media_id`, `erro_msg`, `criado_em`.
- **Edge Functions**: `telegram-webhook` (recebe mensagens e botões) e `publicar` (publica no Instagram).
- **pg_cron** a cada minuto chama `publicar` para os posts com `status = 'agendado'` e `agendado_para <= now()`. Isso é necessário porque a API de publicação do Instagram **não tem agendamento próprio**: quem agenda é a gente.
- Secrets: token do Telegram, token do Instagram, refresh token do Google, chave da Anthropic. Nunca no repositório.

### 4. Instagram (Graph API)

- **Requisito:** a conta precisa ser **Profissional** (Comercial ou Criador). Conta pessoal não publica por API. Mudar é grátis, em Configurações > Tipo de conta.
- Criar um app em developers.facebook.com, com o produto "Instagram" (login do Instagram / API com Instagram Login). Como é só a sua conta, o app pode ficar em **modo de desenvolvimento**, sem passar por App Review.
- Publicar é em 2 passos: `POST /{ig-user-id}/media` com `image_url` e `caption` (cria o container), depois `POST /{ig-user-id}/media_publish` com o `creation_id`.
- Carrossel: um container por imagem com `is_carousel_item=true`, um container pai com `media_type=CAROUSEL` e `children`, depois publica o pai.
- A imagem precisa ser **JPEG** e estar em URL pública. Por isso o passo converte PNG/HEIC para JPEG antes de subir no Storage.
- Limite: 100 publicações por 24 h, sobra de longe.
- Token: o token longo dura 60 dias e precisa ser renovado. Criar um cron semanal que chama o endpoint de refresh e salva o token novo.
- Verificar o status do container (`status_code = FINISHED`) antes do `media_publish`, senão dá erro às vezes.

### 5. Legendas com IA

- Claude via API com visão (modelo pequeno, `claude-haiku-5-5`), enviando a foto e um prompt fixo. Custo na casa de centavos por post.
- Prompt de estilo, adaptado ao seu caso de **zero seguidores**:
  - Legenda curta, 1 a 2 linhas, tom de quem ama o carro.
  - **Sem perguntas e sem pedir comentário.**
  - Contexto fixo: VW Polo 2012, "9n4" (a geração do Polo), visual, detalhes que aparecem na foto.
  - 15 a 25 hashtags, misturando grandes (`#vw`, `#volkswagen`), médias (`#polo`, `#carrosrebaixados`) e de nicho (`#polo9n4`, `#polo2012`). Hashtags de nicho pequeno é onde conta sem seguidores.
  - Hashtags depois de uma linha em branco, no fim da legenda.
- Você pode escrever uma dica junto com a foto no Telegram ("rodas novas", "no pôr do sol") e a IA usa na legenda.
- O botão "Regerar" pede outra versão.

## Claude como gestor de hashtags e engajamento

Limite importante: o modelo **não enxerga o Instagram em tempo real**. Ele não sabe sozinho quais hashtags estão em alta hoje. Precisa de dados. Três fontes que funcionam, da mais simples à mais pesada:

1. **Banco de hashtags curado (fase inicial, custo zero).** Tabela `hashtags` no Supabase com `tag`, `tamanho` (grande, média, nicho), `tema` (polo, vw, carros rebaixados, etc.) e `ultimo_uso`. O Claude monta cada legenda escolhendo do banco: poucas grandes, várias médias e de nicho, **rotacionando** para não repetir o mesmo bloco em todo post (repetição é tratada como spam). Ele também sugere tags novas, que entram no banco como "não testadas".
2. **Aprendizado com os seus próprios posts (a melhor fonte).** A API de Insights devolve alcance, curtidas, salvamentos e impressões por post. Um cron diário grava isso na tabela `metricas`. O Claude recebe o histórico (hashtags usadas x alcance) e ajusta: sobe a nota das tags dos posts que alcançaram mais e aposenta as que não rendem. Também descobre os melhores dias e horários para agendar.
3. **Busca de tendências (opcional, depois).** Duas rotas, ambas com ressalvas:
   - Busca de hashtag da Graph API (`ig_hashtag_search`): mostra posts populares de uma hashtag, mas limita a **30 hashtags diferentes por 7 dias** e exige o recurso "Instagram Public Content Access", que passa por revisão da Meta.
   - Claude com a ferramenta de busca na web: acha hashtags usadas em perfis de Polo e VW. Custa mais por chamada, então rodar uma vez por semana, não por post.

Rotina semanal sugerida: o Claude gera um relatório no Telegram com "o que funcionou, o que cortar, que tags testar e que horário usar".

Modelo: o Haiku dá conta de legenda, escolha de tags e leitura de métricas. Só a busca na web ou uma análise mais profunda justifica um modelo maior.

## O que ajuda a crescer sem seguidores

- Hashtags de nicho valem mais do que perguntas. Alcance vem delas e de Reels/Explorar.
- Constância: 3 a 5 posts por semana, em horários parecidos. O agendamento resolve isso.
- Carrossel de 5 a 10 fotos costuma render mais do que foto solta.
- Seguir e interagir com contas de Polo e VW a partir do seu perfil faz mais diferença do que qualquer legenda. Isso é manual, a API não deve fazer (automatizar like e follow dá bloqueio).
- Reels de vídeo curto alcançam mais. Fica como fase futura (a API aceita `media_type=REELS`).

## Fases

1. **Base:** projeto Supabase, bot no Telegram, webhook respondendo só ao seu `chat_id`.
2. **Armazenamento:** foto vai para o Drive (`AAAA/MM/DD`) e para o Storage; registro na tabela `posts`.
3. **Legenda:** Claude gera a legenda; bot mostra prévia com botões.
4. **Publicar agora:** fluxo completo até o Instagram, com uma foto.
5. **Agendar:** pg_cron + horário pelo chat.
6. **Carrossel:** agrupar várias fotos por `media_group_id`.
6b. **Hashtags inteligentes:** tabelas `hashtags` e `metricas`, rotação de tags, cron diário de Insights, relatório semanal no Telegram.
7. **Acabamento:** refresh do token do Instagram, limpeza do Storage, mensagens de erro claras no Telegram.
8. **Depois:** Reels, fila automática de posts, estatísticas simples.

## O que preciso de você

- Confirmar que o Instagram é conta **Profissional** (ou converter).
- Criar o bot no `@BotFather` e passar o token (por canal seguro, não em commit).
- Seu `chat_id` do Telegram (o bot mostra no primeiro `/start`).
- Escolher o projeto Supabase: reaproveitar um existente ou criar um novo só para isso.
- Criar o app na Meta e a autorização OAuth do Google. Eu guio o passo a passo quando chegarmos nessas fases.

## Decisões pendentes

- Estrutura de pastas no Drive: `AAAA/MM/DD` (padrão proposto) ou só `AAAA-MM`?
- Linguagem das funções: TypeScript nas Edge Functions (padrão do Supabase).
- Legenda só em português, ou misturar algumas hashtags em inglês para alcance maior?
