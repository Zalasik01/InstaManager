// npm run deploy:preview
// Publica o site no Worker de TESTE "polo9n-preview" (só *.workers.dev), sem as rotas do domínio.
//
// Como: o build roda com CLOUDFLARE_ENV=preview, então o @astrojs/cloudflare grava em
// dist/server/wrangler.json o ambiente "preview" do wrangler.jsonc (nome polo9n-preview, routes vazio).
// Antes de publicar, confere esse arquivo: se tiver qualquer rota ou outro nome, PARA sem publicar.
// Script em Node (e não "CLOUDFLARE_ENV=preview astro build" no package.json) porque o npm no Windows
// roda os scripts no cmd, que não entende essa sintaxe.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ambiente = { ...process.env, CLOUDFLARE_ENV: "preview" };

function rodar(comando, args) {
  const r = spawnSync(comando, args, { stdio: "inherit", env: ambiente, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rodar("npx", ["astro", "build"]);

const config = JSON.parse(readFileSync(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
const rotas = [...(config.routes ?? []), ...(config.route ? [config.route] : [])];
if (config.name !== "polo9n-preview" || rotas.length > 0) {
  console.error(
    `Parei: o build saiu com name="${config.name}" e ${rotas.length} rota(s). O preview não pode levar o domínio.`,
  );
  process.exit(1);
}

rodar("npx", ["wrangler", "deploy", "--name", "polo9n-preview"]);
