// Gera o REFRESH TOKEN do Google Drive (uma vez só).
// Uso (PowerShell):
//   $env:GOOGLE_CLIENT_ID="..."; $env:GOOGLE_CLIENT_SECRET="..."; node scripts/google-oauth.mjs
// Não grava nada em arquivo: o token só aparece na tela.
import http from "node:http";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORTA = 53682;
const REDIRECT = `http://127.0.0.1:${PORTA}`;
// Escopo completo: drive.file não enxerga a pasta que já existia no Drive.
const ESCOPO = "https://www.googleapis.com/auth/drive";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nas variáveis de ambiente.");
  process.exit(1);
}

const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: ESCOPO,
  access_type: "offline",
  prompt: "consent",
});

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  const erro = u.searchParams.get("error");
  const code = u.searchParams.get("code");
  if (!code && !erro) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (erro) {
    res.end(`Autorização negada: ${erro}. Volte ao terminal.`);
    console.error(`Autorização negada: ${erro}`);
    servidor.close();
    process.exitCode = 1;
    return;
  }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description ?? j.error ?? r.status);
    if (!j.refresh_token) {
      throw new Error("O Google não devolveu refresh token. Revogue o acesso do app em myaccount.google.com/permissions e rode de novo.");
    }
    res.end("Pronto! Pode fechar esta aba e voltar ao terminal.");
    console.log("\nREFRESH TOKEN (guarde como secret GOOGLE_REFRESH_TOKEN):\n");
    console.log(j.refresh_token);
    console.log();
  } catch (e) {
    res.end("Falhou. Veja o terminal.");
    console.error(`Erro ao trocar o código por tokens: ${e.message}`);
    process.exitCode = 1;
  }
  servidor.close();
});

servidor.listen(PORTA, "127.0.0.1", () => {
  console.log("Abra esta URL no navegador e autorize com a conta dona do Drive:\n");
  console.log(url);
  console.log(`\nAguardando o retorno em ${REDIRECT} ...`);
});
