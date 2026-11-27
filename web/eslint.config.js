import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", ".astro/", ".wrangler/", "node_modules/", "public/", "worker-configuration.d.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  // O preset "jsx-a11y-recommended" do eslint-plugin-astro registra o plugin jsx-a11y de novo (outra cópia),
  // o que quebra o ESLint ("Cannot redefine plugin"). A acessibilidade fica coberta no bloco dos .ts/.tsx.
  {
    files: ["**/*.{ts,tsx}"],
    ...jsxA11y.flatConfigs.recommended,
    plugins: { ...jsxA11y.flatConfigs.recommended.plugins, "react-hooks": reactHooks },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
    languageOptions: { globals: { ...globals.browser } },
  },
  { files: ["src/sw.ts"], languageOptions: { globals: { ...globals.serviceworker } } },
  { files: ["*.mjs", "*.config.*", "scripts/**/*.mjs"], languageOptions: { globals: { ...globals.node } } },
  // __BUILD_ID__ é uma constante injetada no build (define do Vite) e trocada pelo Worker pela versão do deploy.
  { files: ["**/*.astro"], languageOptions: { globals: { __BUILD_ID__: "readonly" } } },
);
