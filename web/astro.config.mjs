// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";

import { execSync } from "node:child_process";

const SUPABASE = "https://crzmyemggpgjcrwwuwka.supabase.co";

// Id do build: hash do commit (GITHUB_SHA na CI, git local, ou "dev") + hora do build.
// Vai para <meta name="app-versao"> e /version.json; o navegador compara os dois para se atualizar sozinho.
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 8);
  try {
    return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}
const BUILD_ID = `${commit()}-${Date.now().toString(36)}`;

// https://astro.build/config
export default defineConfig({
  site: "https://polo9n.com.br",
  trailingSlash: "never",
  adapter: cloudflare(),
  // Páginas são estáticas (prerender); só /api/posts e o middleware rodam no Worker.
  integrations: [
    react(),
    sitemap({ filter: (page) => !/\/(404|offline)\/?$/.test(page) }),
    AstroPWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      manifestFilename: "manifest.webmanifest",
      injectRegister: false,
      includeAssets: ["favicon.svg", "img/*.png"],
      manifest: {
        id: "/",
        name: "Polo 9n4",
        short_name: "Polo 9n4",
        description:
          "Perfil de um VW Polo 2012 branco, geração 9n4: fotos do Instagram @polo_9n4_12 e ficha do carro.",
        lang: "pt-BR",
        dir: "ltr",
        start_url: "/?utm_source=pwa",
        scope: "/",
        display: "standalone",
        display_override: ["fullscreen", "standalone"],
        orientation: "portrait",
        background_color: "#0c0c0d",
        theme_color: "#0c0c0d",
        categories: ["lifestyle", "social", "automotive"],
        icons: [
          { src: "/img/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/img/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/img/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Posts",
            short_name: "Posts",
            url: "/#posts",
            icons: [{ src: "/img/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
          {
            name: "O carro",
            short_name: "O carro",
            url: "/#carro",
            icons: [{ src: "/img/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,webmanifest}"],
        globIgnores: ["**/_worker.js/**", "**/404.html", "**/404/**"],
      },
      devOptions: { enabled: false },
    }),
  ],
  vite: { plugins: [tailwindcss()], define: { __BUILD_ID__: JSON.stringify(BUILD_ID) } },
  security: {
    // CSP nativa do Astro: gera <meta http-equiv="content-security-policy"> com hashes de
    // scripts/estilos de cada página (inclui o script das ilhas), sem 'unsafe-inline'.
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        `img-src 'self' data: ${SUPABASE}`,
        `connect-src 'self' ${SUPABASE}`,
        "manifest-src 'self'",
        "worker-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ],
    },
  },
});
