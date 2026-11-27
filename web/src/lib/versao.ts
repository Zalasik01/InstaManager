import { env } from "cloudflare:workers";

/**
 * Id da versão do app (servidor). Em produção é o id do deploy do Cloudflare (CF_VERSION_METADATA,
 * 8 primeiros caracteres, igual ao site antigo). Sem o binding (astro dev/preview), cai no id do build,
 * que é o mesmo que o Base.astro grava no HTML; assim a página e o /version.json sempre concordam.
 */
export function versaoDoApp(): string {
  const id = env.CF_VERSION_METADATA?.id;
  return id ? id.slice(0, 8) : __BUILD_ID__;
}
