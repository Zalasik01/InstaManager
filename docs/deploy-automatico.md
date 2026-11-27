# Deploy automático (GitHub Actions)

Com isto ligado, cada commit na `master` é checado e publicado sozinho. O agente não precisa mais rodar
`supabase functions deploy` nem `npx wrangler deploy` à mão. **Migrações do banco continuam manuais.**

## Como funciona

| Workflow | Quando roda | O que faz |
|---|---|---|
| `checar.yml` ("Checar") | Todo push e pull request | Só a parte que mudou: `deno check` nas funções, `node --check` + `deno check` no `site/`, `npm ci` + lint + check + build no `web/`. |
| `publicar.yml` ("Publicar") | Chamado pelo Checar em push na `master`, se as checagens passaram. Também à mão (Run workflow). | Publica só as Edge Functions alteradas (todas, se `supabase/functions/_shared/` mudou), com `--no-verify-jwt`. Publica o site da pasta `SITE_DIR` no Worker `polo9n`, se essa pasta mudou. |
| `migracoes.yml` ("Migrações do banco (manual)") | Só à mão | Mostra a simulação (`--dry-run`) e, se a confirmação for `aplicar`, roda `supabase db push` em produção. |

Um deploy de funções e um do site por vez: se chegar outro commit, ele espera o atual terminar.

## 1. Token da Cloudflare

1. Cloudflare > **My Profile > API Tokens > Create Token**.
2. Use o modelo **Edit Cloudflare Workers** e restrinja:
   - **Account Resources**: só a conta do polo9n.
   - **Zone Resources**: só a zona `polo9n.com.br`.
   - O mínimo que importa: `Account > Workers Scripts > Edit` e `Zone > Workers Routes > Edit`. O modelo já traz
     `Account Settings > Read` e `User > Memberships/User Details > Read`, que o Wrangler usa para se identificar.
   - Se o deploy reclamar dos domínios próprios (`custom_domain`), acrescente `Zone > DNS > Edit` na mesma zona.
3. Copie o token (aparece uma vez só).
4. **Account ID**: no painel da Cloudflare, em **Workers & Pages**, coluna da direita ("Account ID"), ou rode
   `npx wrangler whoami` dentro de `site/`.

## 2. Token do Supabase

1. Supabase > ícone da conta > **Account > Access Tokens > Generate new token**.
2. Copie o token (`sbp_...`).
3. `SUPABASE_PROJECT_REF` é `crzmyemggpgjcrwwuwka`.
4. `SUPABASE_DB_PASSWORD` é a senha do banco (Project Settings > Database). Só o workflow de migrações usa.

## 3. Cadastrar no GitHub

No terminal, dentro do repositório (troque os `...` pelos valores; não cole valores reais em arquivos):

```bash
gh secret set CLOUDFLARE_API_TOKEN --body "..."
gh secret set CLOUDFLARE_ACCOUNT_ID --body "..."
gh secret set SUPABASE_ACCESS_TOKEN --body "..."
gh secret set SUPABASE_PROJECT_REF --body "crzmyemggpgjcrwwuwka"
gh secret set SUPABASE_DB_PASSWORD --body "..."

# Pasta do site publicada: o site agora é o Astro, na pasta "web".
gh variable set SITE_DIR --body "web"

# Interruptor da publicação automática. Enquanto não for "sim", cada commit só faz as CHECAGENS (nada é
# publicado). Cadastre os segredos acima ANTES de ligar.
gh variable set PUBLICAR_AUTOMATICO --body "sim"

# Environment usado pelo workflow de migrações.
gh api -X PUT repos/Zalasik01/InstaManager/environments/producao
```

Sem `--body`, o `gh secret set NOME` pede o valor no terminal e ele não fica no histórico do shell.

Pela interface: **Settings > Secrets and variables > Actions** (aba Secrets e aba Variables) e
**Settings > Environments > New environment > `producao`**.

## 4. Environment `producao` (aprovação)

Em **Settings > Environments > producao**, marque **Required reviewers** e escolha a sua conta. Assim o workflow
de migrações só roda depois que você aprovar na tela do GitHub.

## 5. O site é o `web/` (Astro)

O site publicado no `polo9n.com.br` agora é o `web/`. O deploy roda `npm ci && npm run build` em `web/` antes de
publicar. A pasta antiga `site/` fica no repositório só como referência. Para publicar na hora, sem esperar um
commit: **Actions > Publicar > Run workflow**, marque "Publicar o site".

## 6. Rodar à mão

- **Republicar funções**: Actions > Publicar > Run workflow, campo funções = `todas` ou nomes separados por espaço
  (ex.: `telegram-webhook alerta-alta`).
- **Migrações**: Actions > Migrações do banco (manual) > Run workflow. Deixe `simular` para só ver o que seria
  aplicado. Digite `aplicar` para aplicar de verdade.

## Limitações

- Só publica o que mudou **no push**. Se um deploy falhar, o commit seguinte não repete o que ficou para trás:
  republique à mão (passo 6).
- Se dois commits ficarem na fila enquanto um deploy roda, o GitHub descarta o do meio. O site não perde nada,
  porque cada deploy publica a pasta inteira. Uma função alterada só no commit descartado precisa ser republicada à mão.
- Uma função apagada do repositório não é apagada do Supabase.
- Os runners do GitHub não têm IPv6. Se as migrações falharem com `IPv6 is not supported`, o banco precisa ser
  alcançado pelo pooler (IPv4): use a URL do pooler em `--remote=<url>` no `migracoes.yml`.
- A CLI do Supabase está fixada na versão `3.4.0` nos workflows. Ao atualizar, confira as opções `--remote` e `--yes`.
