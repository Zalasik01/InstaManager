/// <reference types="astro/client" />

// Variáveis e bindings do Worker (wrangler.jsonc), lidos com `import { env } from "cloudflare:workers"`.
declare module "cloudflare:workers" {
  export const env: {
    SUPABASE_URL: string;
    SUPABASE_PUBLISHABLE_KEY: string;
    /** Arquivos estáticos (dist/client), servidos pelo Worker porque run_worker_first está ligado. */
    ASSETS: { fetch(input: Request | string): Promise<Response> };
    /** Preenchido pelo Cloudflare: cada deploy tem um id novo (version_metadata no wrangler.jsonc). */
    CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
  };
}

/** Cache de borda padrão do Cloudflare (Cache API). */
interface CacheStorage {
  readonly default: Cache;
}

/** Id do build, injetado pelo Vite (define) em astro.config.mjs. */
declare const __BUILD_ID__: string;
