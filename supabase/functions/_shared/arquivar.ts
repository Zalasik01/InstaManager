// Guarda os arquivos de um post já publicado: cópia pública na galeria do site e arquivo no Google Drive.
// Foto/carrossel (JPEG): cada foto vai para a galeria e para o Drive.
// Reel (MP4): o vídeo vai para a galeria (video_path) e para o Drive; a capa (miniatura que o Telegram mandou
//   com o vídeo) vira a imagem da galeria (galeria_paths = [capa]). Assim o post aparece no site na hora,
//   sem esperar a sincronização com o Instagram.
// Quando tudo deu certo, os arquivos saem do bucket `fotos` para poupar espaço.
// Nunca derruba quem chama: se algo falhar, só registra no log.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarArquivoParaDrive, enviarParaDrive } from "./drive.ts";
import { enviarParaGaleria, enviarVideoParaGaleria } from "./galeria.ts";
import { ehVideoPath } from "./instagram.ts";
import { comOriginais } from "./opcoes.ts";

export type PostParaArquivar = {
  id: string;
  storage_paths: string[];
  /** file_id da capa do vídeo no Telegram (só Reels). */
  capa_file_id?: string | null;
};

/** Data do arquivo a partir do caminho no Storage (AAAA/MM/DD/uuid.ext). */
function dataDoCaminho(caminho: string): Date {
  const [ano, mes, dia] = caminho.split("/");
  const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  return Number.isFinite(d.getTime()) ? d : new Date();
}

/**
 * Arquiva o post (foto, carrossel ou Reel). Devolve o caminho da primeira imagem na galeria
 * (foto ou capa do Reel), para a notificação do site usar, ou null se não houver.
 */
export async function arquivarPostNoDrive(
  db: SupabaseClient,
  post: PostParaArquivar,
): Promise<string | null> {
  if (!post.storage_paths?.length) return null;
  if (ehVideoPath(post.storage_paths[0])) return arquivarReel(db, post);

  // Sem as credenciais do Google, só o Drive fica desligado (em silêncio); a galeria do site continua.
  const driveLigado = !!Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const caminhosGaleria: string[] = [];

  try {
    const idsDrive: string[] = [];
    for (const [i, caminho] of post.storage_paths.entries()) {
      const { data, error } = await db.storage.from("fotos").download(caminho);
      if (error) throw error;
      const bytes = new Uint8Array(await data.arrayBuffer());
      // O caminho no Storage é AAAA/MM/DD/uuid.jpg: reaproveita a data e o nome.
      const data_foto = dataDoCaminho(caminho);
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
    // Se algo acima falhar, cai no catch e nada é apagado. comOriginais inclui a versão sem marca d'água.
    const { error: erroRemover } = await db.storage.from("fotos").remove(comOriginais(post.storage_paths));
    if (erroRemover) console.error("Storage: falha ao apagar fotos já arquivadas:", erroRemover);
  } catch (e) {
    console.error("Arquivar:", e);
  }
  return caminhosGaleria[0] ?? null;
}

/** Baixa a capa (JPEG) do vídeo pela Bot API do Telegram. Devolve null se não houver ou não for JPEG. */
async function baixarCapaTelegram(fileId: string | null | undefined): Promise<Uint8Array | null> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!fileId || !token) return null;
  const info = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json());
  if (!info?.ok) throw new Error(`getFile da capa falhou: ${info?.description ?? "sem resposta"}`);
  const r = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`download da capa falhou (${r.status})`);
  const b = new Uint8Array(await r.arrayBuffer());
  return b[0] === 0xff && b[1] === 0xd8 ? b : null;
}

/** Reel: vídeo e capa na galeria, vídeo no Drive. Devolve o caminho da capa na galeria (ou null). */
async function arquivarReel(db: SupabaseClient, post: PostParaArquivar): Promise<string | null> {
  const driveLigado = !!Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const caminho = post.storage_paths[0];
  const data_video = dataDoCaminho(caminho);
  let capa: string | null = null;

  try {
    const { data, error } = await db.storage.from("fotos").download(caminho);
    if (error) throw error;
    const bytes = new Uint8Array(await data.arrayBuffer());

    // 1. Galeria do site: o vídeo (o site toca de lá) e a capa (sem imagem o post não entra na lista do site).
    const videoPath = await enviarVideoParaGaleria(db, bytes, `${post.id}.mp4`, data_video);
    try {
      const jpeg = await baixarCapaTelegram(post.capa_file_id);
      if (jpeg) capa = await enviarParaGaleria(db, jpeg, `${post.id}_capa.jpg`, data_video);
    } catch (e) {
      // Sem capa o post só aparece no site depois da sincronização (que pega a capa do Instagram).
      console.error("Arquivar Reel: capa falhou:", (e as Error).message);
    }
    const { error: erroGaleria } = await db.from("posts").update({
      video_path: videoPath,
      ...(capa ? { galeria_paths: [capa] } : {}),
    }).eq("id", post.id);
    if (erroGaleria) throw erroGaleria;

    // 2. Drive: o MP4 inteiro, na pasta do dia.
    if (driveLigado) {
      const id = await enviarArquivoParaDrive(bytes, caminho.split("/").pop()!, data_video, "video/mp4");
      const { error: erroDrive } = await db.from("posts").update({ drive_file_ids: [id] }).eq("id", post.id);
      if (erroDrive) throw erroDrive;
    }

    // 3. Tudo confirmado: o vídeo sai do bucket `fotos` (o storage_paths fica na linha, como histórico).
    const { error: erroRemover } = await db.storage.from("fotos").remove([caminho]);
    if (erroRemover) console.error("Storage: falha ao apagar o vídeo já arquivado:", erroRemover);
  } catch (e) {
    console.error("Arquivar Reel:", e);
  }
  return capa;
}
