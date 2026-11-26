# Google Drive: configuração

O bot arquiva cada foto em `AAAA/MM/DD` dentro da pasta raiz do Drive (`1Du6uK4QpgrF_iVdpFViZ_GdYWwMSj0Me`). Usa OAuth com a sua conta, porque conta de serviço não tem cota no Drive pessoal.

## 1. Projeto e API

1. Acesse https://console.cloud.google.com e crie um projeto (ex.: `InstaManager`).
2. Em **APIs e serviços > Biblioteca**, procure **Google Drive API** e clique em **Ativar**.

## 2. Tela de consentimento

1. **APIs e serviços > Tela de consentimento OAuth** (ou "Google Auth Platform").
2. Tipo de usuário: **Externo**. Preencha nome do app e seu e-mail.
3. Em **Usuários de teste**, adicione o seu próprio e-mail.
4. IMPORTANTE: clique em **Publicar app** (status "Em produção"). Apps em modo "Teste" têm o refresh token expirado em 7 dias, e o bot para de arquivar. Em produção sem verificação aparece o aviso "app não verificado": clique em **Avançado > Acessar (não seguro)**. É só você usando.

## 3. Credencial OAuth

1. **Credenciais > Criar credenciais > ID do cliente OAuth**.
2. Tipo: **App da área de trabalho**. (Se usar **Aplicativo da Web**, adicione o URI de redirecionamento `http://127.0.0.1:53682`.)
3. Copie o **ID do cliente** e a **chave secreta**.

## 4. Gerar o refresh token

No PowerShell, na raiz do projeto:

```powershell
$env:GOOGLE_CLIENT_ID="SEU_CLIENT_ID"
$env:GOOGLE_CLIENT_SECRET="SEU_CLIENT_SECRET"
node scripts/google-oauth.mjs
```

Abra a URL impressa, entre com a conta dona do Drive e autorize. O terminal mostra o REFRESH TOKEN. O script não grava nada em arquivo.

## 5. Gravar os secrets no Supabase

```powershell
npx supabase secrets set GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." GOOGLE_REFRESH_TOKEN="..." --remote --yes
```

Depois limpe as variáveis da sessão (`Remove-Item Env:GOOGLE_CLIENT_ID, Env:GOOGLE_CLIENT_SECRET`). Nunca commite esses valores.

## Problemas comuns

- `invalid_grant`: token expirou ou foi revogado (app em modo Teste). Publique o app e gere outro token.
- `File not found` na pasta raiz: a conta autorizada não é dona/editora da pasta.
- Sem refresh token na tela: revogue o acesso em https://myaccount.google.com/permissions e rode de novo.
