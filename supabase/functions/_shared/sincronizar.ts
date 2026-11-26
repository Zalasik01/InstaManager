// Sincroniza o banco (e o Drive) com o que existe de verdade no perfil do Instagram.
//
// 1. Post no Instagram que não está no banco   -> importa (legenda, data, hashtags e a imagem para o Drive).
// 2. Post no banco que não existe mais no Insta -> apaga a linha (e as métricas) e manda as fotos do Drive
//                                                  para a LIXEIRA (recuperável por 30 dias).
// 3. Post importado sem imagem no Drive         -> baixa a imagem e arquiva.
//
// Travas de segurança (apagar é irreversível no banco):
// - só considera "sumido" quem a lista COMPLETA do Instagram não traz; qualquer erro na leitura aborta tudo;
// - lista vazia do Instagram, ou mais da metade dos posts sumindo, cancela as remoções;
// - posts mexidos há menos de 15 minutos são ignorados (o Instagram pode demorar a listar um post novo);
// - o bot só executa depois de o dono confirmar o plano.
//
// Vídeos e Reels: guarda a capa (thumbnail), não o vídeo. Stories não aparecem na API de listagem.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enviarParaDrive, moverParaLixeira } from "./drive.ts";

const GRAPH = "https://graph.facebook.com/v23.0";
const MAX_MIDIAS = 500;
const MAX_IMAGENS_POR_RODADA = 25;
const ORCAMENTO_MS = 90_000;
const CAMPOS =
  "id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url,children{media_url,media_type,thumbnail_url}";

export type Midia = {
  id: string;
  caption?: string;
  media_type: string;
  permalink?: string;
  timestamp: string;
  media_url?: string;
  thumbnail_url?: string;
  children?: { data: { media_url?: string; media_type: string; thumbnail_url?: string }[] };
};

type PostBanco = {
  id: string;
  ig_media_id: string;
  legenda: string | null;
  agendado_para: string | null;
  atualizado_em: string;
  drive_file_ids: string[];
  origem: string;
};

export type Plano = {
  noInstagram: number;
  noBanco: number;
  importar: Midia[];
  remover: PostBanco[];
  semImagem: Midia[]; // posts importados que já estão no banco mas sem imagem no Drive
  driveAtivo: boolean;
  avisoRemocao?: string; // motivo de as remoções terem sido canceladas
};

export type Resultado = {
  importados: number;
  removidos: number;
  arquivosNaLixeira: number;
  imagensArquivadas: number;
  restantes: number; // imagens que ficaram para a próxima rodada (tempo ou limite)
  falhas: string[];
};

const driveAtivo = () => !!Deno.env.get("GOOGLE_REFRESH_TOKEN");

/** Lê TODOS os posts do perfil (até MAX_MIDIAS). Qualquer falha lança: nunca devolve lista parcial. */
async function listarMidias(): Promise<Midia[]> {
  const ig = Deno.env.get("IG_USER_ID");
  const token = Deno.env.get("IG_ACCESS_TOKEN");
  if (!ig || !token) throw new Error("IG_USER_ID ou IG_ACCESS_TOKEN ausente");

  const todas: Midia[] = [];
  let url: string | null = `${GRAPH}/${ig}/media?fields=${encodeURIComponent(CAMPOS)}&limit=50`;
  while (url) {
    const r: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json();
    if (!r.ok) throw new Error(`Instagram: ${j?.error?.message ?? r.status}`);
    todas.push(...(j.data ?? []));
    if (todas.length > MAX_MIDIAS) throw new Error(`Mais de ${MAX_MIDIAS} posts: sincronização não suportada`);
    url = j.paging?.next ?? null;
  }
  return todas;
}

/** URLs das imagens de um post: foto, cada foto do carrossel ou a capa de vídeo/Reel. */
export function imagensDe(m: Midia): string[] {
  const doItem = (x: { media_type: string; media_url?: string; thumbnail_url?: string }) =>
    x.media_type === "VIDEO" ? x.thumbnail_url : x.media_url;
  const lista = m.media_type === "CAROUSEL_ALBUM"
    ? (m.children?.data ?? []).map(doItem)
    : [doItem(m)];
  return lista.filter((u): u is string => !!u);
}

export async function planejar(db: SupabaseClient): Promise<Plano> {
  const midias = await listarMidias(); // lança se falhar: nada é apagado
  const ids = new Set(midias.map((m) => m.id));

  const { data, error } = await db.from("posts")
    .select("id,ig_media_id,legenda,agendado_para,atualizado_em,drive_file_ids,origem")
    .eq("status", "publicado").not("ig_media_id", "is", null);
  if (error) throw new Error(`Banco: ${error.message}`);
  const banco = (data ?? []) as PostBanco[];
  const noBanco = new Set(banco.map((p) => p.ig_media_id));

  const importar = midias.filter((m) => !noBanco.has(m.id));

  const corte = Date.now() - 15 * 60 * 1000;
  let remover = banco.filter((p) => !ids.has(p.ig_media_id) && new Date(p.atualizado_em).getTime() < corte);

  let avisoRemocao: string | undefined;
  if (remover.length && midias.length === 0) {
    avisoRemocao = "O Instagram devolveu uma lista vazia. Por segurança, não vou apagar nada.";
    remover = [];
  } else if (remover.length > Math.max(3, banco.length / 2)) {
    avisoRemocao = `${remover.length} de ${banco.length} posts parecem sumidos. Isso é muito, então não vou apagar nada. Confira a conta e o token.`;
    remover = [];
  }

  const porId = new Map(midias.map((m) => [m.id, m]));
  const semImagem = driveAtivo()
    ? banco.filter((p) => p.origem === "importado" && !p.drive_file_ids?.length && porId.has(p.ig_media_id))
      .map((p) => porId.get(p.ig_media_id)!)
    : [];

  return { noInstagram: midias.length, noBanco: banco.length, importar, remover, semImagem, driveAtivo: driveAtivo(), avisoRemocao };
}

/** Baixa as imagens do post e arquiva no Drive (AAAA/MM/DD da data do post). Devolve os ids do Drive. */
async function arquivarImagens(m: Midia): Promise<string[]> {
  const ids: string[] = [];
  const data = new Date(m.timestamp);
  const urls = imagensDe(m);
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(urls[i], { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`download da imagem falhou (${r.status})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("a imagem não é JPEG");
    ids.push(await enviarParaDrive(bytes, `${m.id}_${i + 1}.jpg`, data));
  }
  return ids;
}

export async function executar(db: SupabaseClient, chat_id: number, plano: Plano): Promise<Resultado> {
  const inicio = Date.now();
  const res: Resultado = {
    importados: 0, removidos: 0, arquivosNaLixeira: 0, imagensArquivadas: 0, restantes: 0, falhas: [],
  };
  let imagens = 0;
  const cabe = () => imagens < MAX_IMAGENS_POR_RODADA && Date.now() - inicio < ORCAMENTO_MS;

  // 1. Remover o que sumiu do Instagram.
  for (const p of plano.remover) {
    if (p.drive_file_ids?.length && driveAtivo()) {
      for (const f of p.drive_file_ids) {
        try {
          await moverParaLixeira(f);
          res.arquivosNaLixeira++;
        } catch (e) {
          res.falhas.push(`Drive ${f.slice(0, 8)}…: ${(e as Error).message.slice(0, 80)}`);
        }
      }
    }
    // As métricas saem junto (on delete cascade).
    const { error } = await db.from("posts").delete().eq("id", p.id);
    if (error) res.falhas.push(`Banco: ${error.message.slice(0, 80)}`);
    else res.removidos++;
  }

  // 2. Importar o que existe no Instagram e não está no banco.
  for (const m of plano.importar) {
    const { data, error } = await db.from("posts").insert({
      chat_id,
      status: "publicado",
      ig_media_id: m.id,
      legenda: m.caption ?? "",
      permalink: m.permalink ?? null,
      origem: "importado",
      agendado_para: m.timestamp, // data real do post (o relatório usa como "quando saiu")
      criado_em: m.timestamp,
      atualizado_em: new Date().toISOString(), // mantém o post na janela de 30 dias das métricas
    }).select("id").single();
    if (error) {
      res.falhas.push(`Importar ${m.id}: ${error.message.slice(0, 80)}`);
      continue;
    }
    res.importados++;
    await db.rpc("registrar_usos_hashtags", { p_post_id: data.id, p_quando: m.timestamp });

    if (plano.driveAtivo && cabe()) {
      try {
        const driveIds = await arquivarImagens(m);
        imagens += driveIds.length;
        res.imagensArquivadas += driveIds.length;
        await db.from("posts").update({ drive_file_ids: driveIds }).eq("id", data.id);
      } catch (e) {
        res.falhas.push(`Imagem ${m.id}: ${(e as Error).message.slice(0, 80)}`);
      }
    } else if (plano.driveAtivo) {
      res.restantes += imagensDe(m).length;
    }
  }

  // 3. Posts importados antes que ainda estão sem imagem no Drive.
  for (const m of plano.semImagem) {
    if (!cabe()) {
      res.restantes += imagensDe(m).length;
      continue;
    }
    try {
      const driveIds = await arquivarImagens(m);
      imagens += driveIds.length;
      res.imagensArquivadas += driveIds.length;
      await db.from("posts").update({ drive_file_ids: driveIds }).eq("ig_media_id", m.id);
    } catch (e) {
      res.falhas.push(`Imagem ${m.id}: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // 4. Recalcula a contagem de uso das hashtags a partir dos posts que sobraram.
  const { error: erroUsos } = await db.rpc("recalcular_usos_hashtags");
  if (erroUsos) res.falhas.push(`Hashtags: ${erroUsos.message.slice(0, 80)}`);

  return res;
}
