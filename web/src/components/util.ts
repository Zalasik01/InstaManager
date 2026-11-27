/** Utilidades da interface: textos do post, navegação por teclado, compartilhar e copiar. */
import { toast } from "sonner";
import { numeroValido, plural } from "@/lib/format";
import { separarLegenda } from "@/lib/hashtags";
import { SITE } from "@/site";
import type { Post } from "@/components/contrato";

/* ---------- teclado x ponteiro ----------
   Só quem navega por teclado precisa que o foco volte ao card depois de fechar o visualizador;
   com mouse/toque o card não deve ficar "selecionado". */
let viaTeclado = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === " " || e.key.startsWith("Arrow"))
        viaTeclado = true;
    },
    true,
  );
  document.addEventListener("pointerdown", () => (viaTeclado = false), true);
}
export const navegandoPorTeclado = () => viaTeclado;

/* ---------- textos do post ---------- */

/** Legenda sem hashtags, numa linha, cortada em 90 caracteres (rótulos e textos de compartilhar). */
export function resumo(p: Post): string {
  const t = separarLegenda(p.legenda).texto.replace(/\s+/g, " ");
  return t.length > 90 ? `${t.slice(0, 87)}...` : t;
}

/** ["1,2 mil visualizações", "37 curtidas", ...] só com os números que existem. */
export function numeros(p: Post): string[] {
  const out: string[] = [];
  const v = numeroValido(p.visualizacoes);
  const c = numeroValido(p.curtidas);
  const m = numeroValido(p.comentarios);
  if (v != null) out.push(plural(v, "visualização", "visualizações"));
  if (c != null) out.push(plural(c, "curtida", "curtidas"));
  if (m != null) out.push(plural(m, "comentário", "comentários"));
  return out;
}

/** Proporção do Instagram mais próxima de largura/altura: 4:5, 1:1, 4:3 ou 1,91:1. */
export type Proporcao = "r-45" | "r-11" | "r-43" | "r-191";
export function proporcaoDe(largura: number, altura: number): Proporcao {
  const r = largura / altura;
  return r <= 0.9 ? "r-45" : r < 1.15 ? "r-11" : r < 1.6 ? "r-43" : "r-191";
}

export function permalinkSeguro(p: Post): string | null {
  return typeof p.permalink === "string" && /^https:\/\/(www\.)?instagram\.com\//.test(p.permalink)
    ? p.permalink
    : null;
}

export function extensao(tipo: string): string {
  return tipo === "image/png" ? "png" : tipo === "image/webp" ? "webp" : "jpg";
}

/* ---------- compartilhar ---------- */

export async function copiar(texto: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
    } else {
      const ta = document.createElement("textarea");
      ta.value = texto;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("copy");
    }
    toast("Link copiado");
  } catch {
    toast("Não deu para copiar o link");
  }
}

function cancelou(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

interface DadosCompartilhar {
  title: string;
  text: string;
  url: string;
}

/** Web Share (com a foto como arquivo, quando o aparelho aceita); sem Web Share, copia o link. */
export async function compartilhar(dados: DadosCompartilhar, arquivoUrl?: string): Promise<void> {
  if (typeof navigator.share !== "function") return copiar(dados.url);
  const apenasLink = async () => {
    try {
      await navigator.share(dados);
    } catch (e) {
      if (!cancelou(e)) await copiar(dados.url);
    }
  };
  let comArquivo = false;
  try {
    comArquivo =
      !!arquivoUrl &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File([""], "a.jpg", { type: "image/jpeg" })] });
  } catch {
    /* sem suporte a arquivos */
  }
  if (!comArquivo || !arquivoUrl) return apenasLink();
  try {
    const r = await fetch(arquivoUrl, { mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error("imagem");
    const b = await r.blob();
    const f = new File([b], `polo9n.${extensao(b.type)}`, { type: b.type || "image/jpeg" });
    if (!navigator.canShare({ files: [f] })) throw new Error("arquivo");
    await navigator.share({ title: dados.title, text: `${dados.text} ${dados.url}`, files: [f] });
  } catch (e) {
    if (!cancelou(e)) await apenasLink();
  }
}

export function compartilharPost(p: Post, indiceImagem = 0): Promise<void> {
  const r = resumo(p);
  return compartilhar(
    {
      title: SITE.nome,
      text: r || `Foto do ${SITE.nome} (@${SITE.perfil})`,
      url: `${location.origin}/#post=${encodeURIComponent(p.id)}`,
    },
    p.video ? undefined : p.imagens[indiceImagem],
  );
}

export function compartilharPerfil(): Promise<void> {
  return compartilhar({
    title: `${SITE.nome} (@${SITE.perfil})`,
    text: "VW Polo 2012 branco, geração 9n4. Fotos e ficha do carro.",
    url: `${location.origin}/`,
  });
}

/* ---------- links das peças ---------- */

/** Hash FNV-1a de 32 bits em base 36 (curto e estável entre builds). */
function hashCurto(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Id estável do link: slug do título + hash curto da URL, só [a-z0-9-], até 80 caracteres. */
export function idDoLink(titulo: string, url: string): string {
  const h = hashCurto(url);
  const slug = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80 - h.length - 1)
    .replace(/-+$/g, "");
  return slug ? `${slug}-${h}` : h;
}
