// Arquiva no Google Drive as fotos de um post já publicado.
// Nunca derruba quem chama: se o Drive não estiver configurado ou falhar, só registra no log.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarParaDrive } from "./drive.ts";

export async function arquivarPostNoDrive(
  db: SupabaseClient,
  post: { id: string; storage_paths: string[] },
): Promise<void> {
  // Sem as credenciais do Google, o recurso fica desligado em silêncio.
  if (!Deno.env.get("GOOGLE_REFRESH_TOKEN")) return;

  try {
    const ids: string[] = [];
    for (const caminho of post.storage_paths) {
      const { data, error } = await db.storage.from("fotos").download(caminho);
      if (error) throw error;
      const bytes = new Uint8Array(await data.arrayBuffer());
      // O caminho no Storage é AAAA/MM/DD/uuid.jpg: reaproveita a data e o nome.
      const [ano, mes, dia] = caminho.split("/");
      const data_foto = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
      ids.push(await enviarParaDrive(bytes, caminho.split("/").pop()!, data_foto));
    }
    const { error: erroUpdate } = await db.from("posts").update({ drive_file_ids: ids }).eq("id", post.id);
    if (erroUpdate) throw erroUpdate;

    // Só chega aqui se o Drive confirmou TODOS os uploads e o id de cada arquivo foi gravado.
    // Aí as fotos saem do Storage para poupar espaço do plano free. O `storage_paths` fica
    // na linha do post de propósito (histórico); os arquivos é que deixam de existir no bucket.
    // Se algo acima falhar, cai no catch e nada é apagado.
    const { error: erroRemover } = await db.storage.from("fotos").remove(post.storage_paths);
    if (erroRemover) console.error("Storage: falha ao apagar fotos já arquivadas:", erroRemover);
  } catch (e) {
    console.error("Drive:", e);
  }
}
