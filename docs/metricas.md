# Métricas do Instagram: liberar a permissão de Insights

O token atual não tem `instagram_manage_insights`. Sem ela a função `coletar-metricas`
responde `{ok:false, motivo:"sem_permissao_insights"}` e o relatório semanal fica sem dados.

## Passo a passo (app ManagerPostsPolo)

1. Abra developers.facebook.com, **Meus apps**, **ManagerPostsPolo**.
2. No menu lateral: **Casos de uso**, abra o caso do Instagram (login unificado) e clique em **Personalizar**.
3. Em **Permissões e recursos**, ache `instagram_manage_insights` e clique em **Adicionar**.
   Confirme que `instagram_basic` e `instagram_content_publish` continuam adicionadas.
4. Em modo de desenvolvimento a permissão vale para quem tem função no app (você). Não precisa de revisão da Meta.
5. Gere o token novo: business.facebook.com/settings, **Usuários do sistema**, escolha o usuário do sistema (SUAT) do app.
6. Confirme que a conta do Instagram está atribuída a esse usuário com controle total.
7. Clique em **Gerar token**, escolha o app **ManagerPostsPolo**, validade **Nunca**, e marque
   `instagram_basic`, `instagram_content_publish` e **`instagram_manage_insights`**
   (mais as que o token antigo já tinha, como `pages_show_list`).
8. Copie o token (aparece uma vez) e troque o secret, sem colar o valor em commit ou chat público:
   `npx supabase secrets set IG_ACCESS_TOKEN=<token novo>`
9. Teste chamando `coletar-metricas` com o header `x-cron-secret`. Resposta `{"ok":true,...}` indica que funcionou.

## Ativar os agendamentos

1. Escolha um valor longo e aleatório e guarde nos dois lugares:
   `npx supabase secrets set CRON_SECRET=<valor>`
   e no Vault (SQL Editor): `select vault.create_secret('<mesmo valor>', 'cron_secret');`
2. Publique as funções: `npx supabase functions deploy coletar-metricas relatorio-semanal`
3. Aplique a migração `20261125030000_metricas.sql`.

## Observações

- Insights só existem para posts publicados; posts muito recentes podem vir com poucos números.
- Imagem e carrossel não aceitam `impressions`; por isso a coluna `impressoes` fica vazia.
- A nota das hashtags só muda depois de 2 posts com a tag e com métricas coletadas.
