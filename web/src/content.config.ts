import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/** Texto opcional: "" (vazio) significa "não mostrar no site". */
const texto = z.string().default("");

const carro = defineCollection({
  loader: glob({ pattern: "carro.json", base: "./src/content/carro" }),
  schema: z.object({
    _ajuda: z.string().optional(),
    atualizado_em: texto,
    desde: texto,
    fotos: texto,
    ficha: z.record(z.string(), z.string()).default({}),
    modificacoes: z.array(z.string()).default([]),
    extras: z.array(z.string()).default([]),
  }),
});

const links = defineCollection({
  loader: glob({ pattern: "links.json", base: "./src/content/links" }),
  schema: z.object({
    _ajuda: z.string().optional(),
    atualizado_em: texto,
    itens: z
      .array(
        z.object({
          titulo: z.string().min(1),
          url: z.string().url(),
          categoria: texto,
          loja: texto,
          descricao: texto,
          preco: texto,
          data: texto,
        }),
      )
      .default([]),
  }),
});

/** Páginas jurídicas em Markdown (texto migrado sem alteração do site antigo). */
const legal = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/legal" }),
  schema: z.object({
    titulo: z.string(),
    descricao: z.string(),
    ogDescricao: z.string(),
    /** AAAA-MM-DD */
    atualizado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

export const collections = { carro, links, legal };
