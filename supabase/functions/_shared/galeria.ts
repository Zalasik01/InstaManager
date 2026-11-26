// Cópia pública das imagens dos posts, para o site ler (bucket `galeria`, público).
// Caminho: AAAA/MM/<nome>.jpg, com a data do post. Nunca lança por falha de rede: quem chama decide.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Envia o JPEG para o bucket `galeria` e devolve o caminho dentro do bucket. */
export async function enviarParaGaleria(
  db: SupabaseClient,
  bytes: Uint8Array,
  nome: string,
  data: Date,
): Promise<string> {
  const ano = String(data.getUTCFullYear());
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  const caminho = `${ano}/${mes}/${nome}`;
  // upsert: rodar de novo (ex.: sincronização repetida) não dá erro de arquivo existente.
  const { error } = await db.storage.from("galeria").upload(caminho, bytes, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error(`Galeria: ${error.message}`);
  return caminho;
}

/** Remove imagens da galeria (post apagado do perfil). Falhas só vão para o log. */
export async function removerDaGaleria(db: SupabaseClient, caminhos: string[]): Promise<void> {
  if (!caminhos.length) return;
  const { error } = await db.storage.from("galeria").remove(caminhos);
  if (error) console.error("Galeria: falha ao remover:", error.message);
}
