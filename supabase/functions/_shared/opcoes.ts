// Opções liga/desliga do bot, guardadas na tabela config (valor 'on' ou 'off'; sem linha = desligada).
// Também ficam aqui os nomes dos arquivos da marca d'água no Storage `fotos`, que vários módulos precisam
// conhecer (este arquivo é leve: não carrega a fonte nem a biblioteca de imagens).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Chaves das opções na tabela config. */
export const OPCAO_STORY_AUTOMATICO = "story_automatico";
export const OPCAO_MARCA_DAGUA = "marca_dagua";

/** true se a opção está 'on'. Falha de leitura conta como desligada (nunca derruba quem chama). */
export async function opcaoLigada(db: SupabaseClient, chave: string): Promise<boolean> {
  try {
    const { data } = await db.from("config").select("valor").eq("chave", chave).maybeSingle();
    return data?.valor === "on";
  } catch {
    return false;
  }
}

/** Inverte a opção e devolve o novo estado (true = ligada). */
export async function alternarOpcao(db: SupabaseClient, chave: string): Promise<boolean> {
  const nova = !(await opcaoLigada(db, chave));
  const { error } = await db.from("config").upsert({
    chave,
    valor: nova ? "on" : "off",
    atualizado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Config: ${error.message}`);
  return nova;
}

// Foto com marca d'água: o Storage guarda as duas versões, lado a lado.
//   AAAA/MM/DD/<uuid>_marca.jpg  -> a que vai para o feed (fica em storage_paths)
//   AAAA/MM/DD/<uuid>.jpg        -> a original, usada se a foto virar Story (Story não leva marca)
const SUFIXO_MARCA = "_marca.jpg";

/** Caminho da versão com marca a partir do caminho original (`x.jpg` -> `x_marca.jpg`). */
export const caminhoComMarca = (original: string) => original.replace(/\.jpg$/i, "") + SUFIXO_MARCA;

/** Caminho da versão sem marca. Caminho que não é de marca volta igual. */
export const caminhoSemMarca = (caminho: string) =>
  caminho.endsWith(SUFIXO_MARCA) ? caminho.slice(0, -SUFIXO_MARCA.length) + ".jpg" : caminho;

/** Os caminhos mais as originais sem marca: use ao apagar do Storage, para não deixar arquivo órfão. */
export const comOriginais = (caminhos: string[]) =>
  [...new Set(caminhos.flatMap((c) => (c.endsWith(SUFIXO_MARCA) ? [c, caminhoSemMarca(c)] : [c])))];
