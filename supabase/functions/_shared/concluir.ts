// Etapas finais depois de publicar um post de FEED ou um Reel (agora pelo bot ou pelo agendador):
// 1. Story automático (só FEED, se a opção 'story_automatico' estiver ligada): a primeira foto vira Story.
// 2. Arquivamento: galeria do site (o post aparece no site na hora) e Google Drive.
// 3. Aviso de post novo para quem ativou as notificações do site.
// Nada aqui derruba a publicação principal: cada etapa tem o seu try/catch.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { arquivarPostNoDrive } from "./arquivar.ts";
import { publicarStory, type TipoPost } from "./instagram.ts";
import { caminhoSemMarca, OPCAO_STORY_AUTOMATICO, opcaoLigada } from "./opcoes.ts";
import { notificarNovoPost } from "./push.ts";

export type PostPublicado = {
  id: string;
  storage_paths: string[];
  legenda?: string | null;
  capa_file_id?: string | null;
};

export async function concluirPublicacao(
  db: SupabaseClient,
  post: PostPublicado,
  tipo: TipoPost,
  avisar: (texto: string) => Promise<unknown>,
): Promise<void> {
  if (tipo !== "FEED" && tipo !== "REELS") return;

  // 1. Story automático: antes do arquivamento, que apaga os arquivos do bucket `fotos`.
  if (tipo === "FEED" && post.storage_paths?.length && await opcaoLigada(db, OPCAO_STORY_AUTOMATICO)) {
    try {
      // Story usa a foto sem marca d'água (quando a marca está ligada, a original fica ao lado no Storage).
      const url = db.storage.from("fotos").getPublicUrl(caminhoSemMarca(post.storage_paths[0])).data.publicUrl;
      await publicarStory(url, false);
      await avisar("Story automático publicado com a primeira foto. Ele fica no ar por 24 horas.").catch(() => {});
    } catch (e) {
      console.error("Story automático:", e);
      await avisar(`O post saiu, mas o Story automático falhou: ${(e as Error).message}`).catch(() => {});
    }
  }

  // 2. Galeria do site e Drive (nunca lança).
  const imagem = await arquivarPostNoDrive(db, post);

  // 3. Notificação do site, com a imagem da galeria quando houver.
  try {
    await notificarNovoPost(db, {
      id: post.id,
      legenda: post.legenda,
      imagem: imagem ? db.storage.from("galeria").getPublicUrl(imagem).data.publicUrl : null,
    });
  } catch (e) {
    console.error("push:", e);
  }
}
