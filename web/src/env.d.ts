/// <reference types="astro/client" />

// Variáveis do Worker (vars em wrangler.jsonc), lidas com `import { env } from "cloudflare:workers"`.
declare module "cloudflare:workers" {
  export const env: {
    SUPABASE_URL: string;
    SUPABASE_PUBLISHABLE_KEY: string;
  };
}

/** Id do build, injetado pelo Vite (define) em astro.config.mjs. */
declare const __BUILD_ID__: string;
