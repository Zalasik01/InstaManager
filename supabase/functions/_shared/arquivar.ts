// Guarda as fotos de um post já publicado: cópia pública na galeria do site e arquivo no Google Drive.
// Nunca derruba quem chama: se algo falhar, só registra no log.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarParaDrive } from "./drive.ts";
import { enviarParaGaleria } from "./galeria.ts";

export async function arquivarPostNoDrive(
  db: SupabaseClient,
  post: { id: string; storage_paths: string[] },
): Promise<void> {
  // Sem as credenciais do Google, só o Drive fica desligado (em silêncio); a galeria do site continua.
  const driveLigado = !!Deno.env.get("GOOGLE_REFRESH_TOKEN");

  try {
    const idsDrive: string[] = [];
    const caminhosGaleria: string[] = [];
    for (const [i, caminho] of post.storage_paths.entries()) {
      const { data, error } = await db.storage.from("fotos").download(caminho);
      if (error) throw error;
      const bytes = new Uint8Array(await data.arrayBuffer());
      // O caminho no Storage é AAAA/MM/DD/uuid.jpg: reaproveita a data e o nome.
      const [ano, mes, dia] = caminho.split("/");
      const data_foto = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
      // Galeria do site: primeiro, para a foto aparecer mesmo que o Drive falhe.
      caminhosGaleria.push(await enviarParaGaleria(db, bytes, `${post.id}_${i + 1}.jpg`, data_foto));
      if (driveLigado) idsDrive.push(await enviarParaDrive(bytes, caminho.split("/").pop()!, data_foto));
    }
    const { error: erroUpdate } = await db.from("posts").update({
      galeria_paths: caminhosGaleria,
      ...(driveLigado ? { drive_file_ids: idsDrive } : {}),
    }).eq("id", post.id);
    if (erroUpdate) throw erroUpdate;

    // Só chega aqui se a galeria e (quando ligado) o Drive confirmaram TODOS os uploads e os ids foram
    // gravados. Aí as fotos saem do Storage `fotos` para poupar espaço do plano free. O `storage_paths`
    // fica na linha do post de propósito (histórico); os arquivos é que deixam de existir no bucket.
    // Se algo acima falhar, cai no catch e nada é apagado.
    const { error: erroRemover } = await db.storage.from("fotos").remove(post.storage_paths);
    if (erroRemover) console.error("Storage: falha ao apagar fotos já arquivadas:", erroRemover);
  } catch (e) {
    console.error("Arquivar:", e);
  }
}
