// Estatísticas para o bot: texto do /stats e sugestão de melhores horários para postar.
// Fuso fixo America/Sao_Paulo = UTC-3 (sem horário de verão), igual a horario.ts.
// Data real de publicação de um post = coalesce(agendado_para, atualizado_em)
//   (posts importados guardam a data do Instagram em agendado_para).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DESLOCAMENTO_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3
const DIA_MS = 86400_000;
const ANTECEDENCIA_MIN_MS = 30 * 60 * 1000;

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmt = (n: number) => numero.format(Math.round(n));
const comSinal = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : "0");
const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** "dd/mm" no relógio de Brasília. */
function diaMes(d: Date): string {
  const br = new Date(d.getTime() - DESLOCAMENTO_MS);
  return `${doisDigitos(br.getUTCDate())}/${doisDigitos(br.getUTCMonth() + 1)}`;
}

/** Data (aaaa-mm-dd) de hoje menos `dias`, no relógio de Brasília. */
function diaBr(agora: Date, dias: number): string {
  const br = new Date(agora.getTime() - DESLOCAMENTO_MS - dias * DIA_MS);
  return br.toISOString().slice(0, 10);
}

type PostStats = {
  id: string;
  agendado_para: string | null;
  atualizado_em: string;
  permalink: string | null;
};
type Ultima = { alcance: number | null; visualizacoes: number | null };

const dataPost = (p: PostStats) => new Date(p.agendado_para ?? p.atualizado_em);

/** Última coleta de métricas de cada post (uma consulta só). */
async function ultimasMetricas(db: SupabaseClient, ids: string[]): Promise<Map<string, Ultima>> {
  const mapa = new Map<string, Ultima>();
  if (!ids.length) return mapa;
  const { data, error } = await db
    .from("metricas")
    .select("post_id, alcance, visualizacoes, coletado_em")
    .in("post_id", ids)
    .order("coletado_em", { ascending: false });
  if (error) throw new Error(error.message);
  for (const m of data ?? []) {
    if (!mapa.has(m.post_id)) mapa.set(m.post_id, { alcance: m.alcance, visualizacoes: m.visualizacoes });
  }
  return mapa;
}

/** Variação de seguidores contra o dia mais recente que tenha pelo menos `dias` de idade. */
async function variacao(db: SupabaseClient, atual: number, agora: Date, dias: number): Promise<number | null> {
  const { data } = await db
    .from("seguidores_historico")
    .select("seguidores")
    .lte("dia", diaBr(agora, dias))
    .not("seguidores", "is", null)
    .order("dia", { ascending: false })
    .limit(1)
    .maybeSingle();
  return typeof data?.seguidores === "number" ? atual - data.seguidores : null;
}

/** Texto curto do /stats, em português, pronto para o Telegram (sem parse_mode). */
export async function textoStats(db: SupabaseClient): Promise<string> {
  const agora = new Date();
  const linhas: string[] = ["Estatísticas do perfil", ""];

  // Seguidores.
  const { data: perfil } = await db.from("perfil_ig").select("seguidores").eq("id", 1).maybeSingle();
  const seguidores = typeof perfil?.seguidores === "number" ? perfil.seguidores : null;
  if (seguidores === null) {
    linhas.push("Seguidores: ainda sem leitura do perfil.");
  } else {
    linhas.push(`Seguidores: ${fmt(seguidores)}`);
    const { data: primeiro } = await db
      .from("seguidores_historico")
      .select("dia")
      .order("dia", { ascending: true })
      .limit(1)
      .maybeSingle();
    const [v7, v30] = await Promise.all([
      variacao(db, seguidores, agora, 7),
      variacao(db, seguidores, agora, 30),
    ]);
    if (!primeiro) {
      linhas.push("Variação: histórico começa hoje.");
    } else {
      const [a, m, d] = String(primeiro.dia).split("-");
      const curto = `histórico desde ${d}/${m}/${a}`;
      linhas.push(`Em 7 dias: ${v7 === null ? curto : comSinal(v7)}`);
      linhas.push(`Em 30 dias: ${v30 === null ? curto : comSinal(v30)}`);
    }
  }

  // Posts.
  const { count: total } = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("status", "publicado");
  linhas.push("", `Posts publicados: ${fmt(total ?? 0)}`);

  const desde30 = new Date(agora.getTime() - 30 * DIA_MS).toISOString();
  const desde7 = agora.getTime() - 7 * DIA_MS;
  const { data: posts, error } = await db
    .from("posts")
    .select("id, agendado_para, atualizado_em, permalink")
    .eq("status", "publicado")
    .or(`agendado_para.gte.${desde30},and(agendado_para.is.null,atualizado_em.gte.${desde30})`);
  if (error) throw new Error(error.message);
  const ultimos30 = ((posts ?? []) as PostStats[]).filter((p) => dataPost(p).getTime() >= agora.getTime() - 30 * DIA_MS);
  const mets = await ultimasMetricas(db, ultimos30.map((p) => p.id));

  const comAlcance = (l: PostStats[]) => l.filter((p) => typeof mets.get(p.id)?.alcance === "number");
  const mediaAlcance = (l: PostStats[]) => {
    const c = comAlcance(l);
    return c.length ? c.reduce((s, p) => s + mets.get(p.id)!.alcance!, 0) / c.length : null;
  };
  const ultimos7 = ultimos30.filter((p) => dataPost(p).getTime() >= desde7);
  const m7 = mediaAlcance(ultimos7);
  const m30 = mediaAlcance(ultimos30);
  linhas.push(
    `Alcance médio (7 dias): ${m7 === null ? "sem dados" : `${fmt(m7)} (${comAlcance(ultimos7).length} posts)`}`,
    `Alcance médio (30 dias): ${m30 === null ? "sem dados" : `${fmt(m30)} (${comAlcance(ultimos30).length} posts)`}`,
  );

  const vis = ultimos30
    .map((p) => mets.get(p.id)?.visualizacoes)
    .filter((v): v is number => typeof v === "number");
  if (vis.length) {
    linhas.push(`Visualizações médias (30 dias): ${fmt(vis.reduce((s, v) => s + v, 0) / vis.length)}`);
  }

  const candidatos = comAlcance(ultimos30);
  if (candidatos.length) {
    const melhor = candidatos.reduce((a, b) => (mets.get(a.id)!.alcance! >= mets.get(b.id)!.alcance! ? a : b));
    linhas.push(
      "",
      `Melhor post (30 dias): ${fmt(mets.get(melhor.id)!.alcance!)} de alcance, ${diaMes(dataPost(melhor))}`,
    );
    if (melhor.permalink) linhas.push(melhor.permalink);
  } else if (ultimos30.length) {
    linhas.push("", "Métricas dos últimos 30 dias ainda não coletadas.");
  }

  const links = await linksMaisClicados(db, agora);
  if (links.length) {
    linhas.push(
      "",
      "Links mais clicados (30 dias):",
      ...links.map((l, i) => `${i + 1}. ${l.titulo} · ${fmt(l.cliques)} clique(s)${l.url ? `\n   ${l.url}` : ""}`),
    );
  }

  return linhas.join("\n");
}

type LinkClicado = { titulo: string; url: string; cliques: number };

/**
 * Os 3 links do site mais clicados nos últimos 30 dias (soma de public.cliques_links por link_id).
 * Tabela ausente, vazia ou com erro: devolve lista vazia e a seção some do /stats.
 */
async function linksMaisClicados(db: SupabaseClient, agora: Date): Promise<LinkClicado[]> {
  try {
    const { data, error } = await db
      .from("cliques_links")
      .select("link_id, url, titulo, cliques, dia")
      .gte("dia", diaBr(agora, 30))
      .order("dia", { ascending: false })
      .limit(1000);
    if (error || !data?.length) return [];
    const soma = new Map<string, LinkClicado>();
    for (const r of data) {
      const atual = soma.get(r.link_id);
      // Linhas em ordem do dia mais novo: título e URL ficam os mais recentes.
      if (atual) atual.cliques += Number(r.cliques) || 0;
      else {
        soma.set(r.link_id, {
          titulo: String(r.titulo || r.link_id),
          url: String(r.url ?? ""),
          cliques: Number(r.cliques) || 0,
        });
      }
    }
    return [...soma.values()].filter((l) => l.cliques > 0).sort((a, b) => b.cliques - a.cliques).slice(0, 3);
  } catch {
    return [];
  }
}

export type GrupoHorario = { dia: number /* 0 = domingo */; hora: number; pontuacao: number; amostras: number };

/**
 * Melhores combinações de dia da semana e faixa de 2 h (hora = início da faixa: 0, 2, ..., 22), no fuso de
 * Brasília. Pontuação = média do alcance relativo (alcance do post / mediana de todos). Só grupos com 2 posts
 * ou mais; sem dados suficientes devolve lista vazia. Cálculo em SQL: public.estatisticas_horarios().
 */
export async function melhoresHorarios(db: SupabaseClient, quantos = 3): Promise<GrupoHorario[]> {
  const { data, error } = await db.rpc("estatisticas_horarios");
  if (error) throw new Error(error.message);
  return ((data ?? []) as GrupoHorario[])
    .map((g) => ({
      dia: Number(g.dia),
      hora: Number(g.hora),
      pontuacao: Number(g.pontuacao),
      amostras: Number(g.amostras),
    }))
    .slice(0, Math.max(0, quantos));
}

/** Próxima ocorrência de `dia`/`hora`:00 (relógio de Brasília) com pelo menos 30 min de antecedência. */
function proximaOcorrencia(agora: Date, dia: number, hora: number): Date {
  const br = new Date(agora.getTime() - DESLOCAMENTO_MS);
  for (let d = 0; d <= 7; d++) {
    const ms = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + d, hora, 0);
    if (new Date(ms).getUTCDay() !== dia) continue;
    const instante = new Date(ms + DESLOCAMENTO_MS);
    if (instante.getTime() - agora.getTime() >= ANTECEDENCIA_MIN_MS) return instante;
  }
  // Só chega aqui se a ocorrência de hoje estiver perto demais: mesma hora na semana que vem.
  const ms = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + 7, hora, 0);
  return new Date(ms + DESLOCAMENTO_MS);
}

/**
 * Transforma os melhores grupos nas próximas datas reais (sempre no futuro, 30 min ou mais à frente),
 * em ordem cronológica. Sem dados suficientes devolve lista vazia (o bot fica com os botões padrão).
 */
export async function proximosHorariosSugeridos(db: SupabaseClient, agora: Date, quantos = 3): Promise<Date[]> {
  const grupos = await melhoresHorarios(db, quantos);
  const vistos = new Set<number>();
  const datas: Date[] = [];
  for (const g of grupos) {
    const d = proximaOcorrencia(agora, g.dia, g.hora);
    if (vistos.has(d.getTime())) continue;
    vistos.add(d.getTime());
    datas.push(d);
  }
  return datas.sort((a, b) => a.getTime() - b.getTime());
}
