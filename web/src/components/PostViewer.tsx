import * as Dialog from "@radix-ui/react-dialog";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ShareButton from "@/components/ShareButton";
import ZoomViewer from "@/components/ZoomViewer";
import { formatarData, formatarNumero } from "@/lib/format";
import { separarLegenda } from "@/lib/hashtags";
import type { Post } from "@/types";

interface PostViewerProps {
  posts: readonly Post[];
  /** Índice do post aberto em `posts`, ou null com o visualizador fechado. */
  indice: number | null;
  onMudarIndice: (indice: number | null) => void;
}

/** Visualizador de post em diálogo centralizado, com fundo desfocado. */
export default function PostViewer({ posts, indice, onMudarIndice }: PostViewerProps) {
  const post = indice === null ? undefined : posts[indice];
  return (
    <Dialog.Root open={post !== undefined} onOpenChange={(aberto) => !aberto && onMudarIndice(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md" />
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-surface border-line fixed top-1/2 left-1/2 z-50 max-h-[92dvh] w-[min(94vw,56rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border"
        >
          {post && indice !== null ? (
            <Conteudo
              key={post.id}
              post={post}
              temAnterior={indice > 0}
              temProximo={indice < posts.length - 1}
              onAnterior={() => onMudarIndice(indice - 1)}
              onProximo={() => onMudarIndice(indice + 1)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConteudoProps {
  post: Post;
  temAnterior: boolean;
  temProximo: boolean;
  onAnterior: () => void;
  onProximo: () => void;
}

function Conteudo({ post, temAnterior, temProximo, onAnterior, onProximo }: ConteudoProps) {
  // `duration` maior deixa o deslize mais suave; `dragFree: false` mantém o encaixe por imagem.
  const [emblaRef, embla] = useEmblaCarousel({ loop: false, duration: 28 });
  const [selecionada, setSelecionada] = useState(0);
  const [zoom, setZoom] = useState<string | null>(null);

  const atualizarSelecionada = useCallback(() => {
    if (embla) setSelecionada(embla.selectedScrollSnap());
  }, [embla]);

  useEffect(() => {
    if (!embla) return;
    atualizarSelecionada();
    embla.on("select", atualizarSelecionada).on("reInit", atualizarSelecionada);
    return () => {
      embla.off("select", atualizarSelecionada).off("reInit", atualizarSelecionada);
    };
  }, [embla, atualizarSelecionada]);

  const { texto, tags } = separarLegenda(post.legenda);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between p-3">
        <Dialog.Title className="font-bold">@polo_9n4_12</Dialog.Title>
        <Dialog.Close
          aria-label="Fechar"
          className="hover:bg-bg rounded-full p-2"
        >
          <X size={20} aria-hidden="true" />
        </Dialog.Close>
      </div>

      <div className="relative">
        <div ref={emblaRef} className="cursor-grab overflow-hidden active:cursor-grabbing">
          <div className="flex touch-pan-y">
            {post.imagens.map((src, i) => (
              <div key={src} className="min-w-0 flex-[0_0_100%]">
                <img
                  crossOrigin="anonymous"
                  src={src}
                  alt={`Foto ${i + 1} de ${post.imagens.length}`}
                  draggable={false}
                  className={`max-h-[60dvh] w-full object-contain transition-all duration-500 ease-out ${
                    i === selecionada ? "scale-100 opacity-100" : "scale-95 opacity-40"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
        {post.imagens.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Imagem anterior"
              disabled={selecionada === 0}
              onClick={() => embla?.scrollPrev()}
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/60 p-2 transition hover:scale-110 hover:bg-black/80 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Próxima imagem"
              disabled={selecionada === post.imagens.length - 1}
              onClick={() => embla?.scrollNext()}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/60 p-2 transition hover:scale-110 hover:bg-black/80 disabled:pointer-events-none disabled:opacity-0"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <div
              role="tablist"
              aria-label="Fotos do post"
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/40 px-2 py-1.5 backdrop-blur-sm"
            >
              {post.imagens.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  role="tab"
                  aria-selected={i === selecionada}
                  aria-label={`Ir para a foto ${i + 1}`}
                  onClick={() => embla?.scrollTo(i)}
                  className={`h-1.5 rounded-full bg-white transition-all duration-300 ${
                    i === selecionada ? "w-4 opacity-100" : "w-1.5 opacity-50 hover:opacity-80"
                  }`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4 text-sm">
        <p className="text-muted">
          {formatarNumero(post.curtidas)} curtidas · {formatarNumero(post.comentarios)} comentários
          · {formatarNumero(post.visualizacoes)} visualizações
        </p>
        {texto ? <p className="whitespace-pre-line">{texto}</p> : null}
        {tags.length ? (
          <ul aria-label="Hashtags" className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t} className="bg-bg text-muted rounded-full px-3 py-1">
                #{t}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted">{formatarData(post.publicado_em)}</p>

        <div className="flex flex-wrap gap-2">
          <ShareButton
            titulo="Polo 9n4 (@polo_9n4_12)"
            texto={texto.slice(0, 120)}
            url={post.permalink ?? "https://polo9n.com.br/"}
          />
          <button
            type="button"
            onClick={() => setZoom(post.imagens[0] ?? null)}
            className="border-line inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-bold"
          >
            <Maximize2 size={16} aria-hidden="true" />
            Expandir imagem
          </button>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="border-line rounded-lg border px-4 py-2 font-bold"
            >
              Ver no Instagram
            </a>
          ) : null}
        </div>

        <div className="flex justify-between">
          <button
            type="button"
            disabled={!temAnterior}
            onClick={onAnterior}
            className="text-muted disabled:opacity-40"
          >
            Post anterior
          </button>
          <button
            type="button"
            disabled={!temProximo}
            onClick={onProximo}
            className="text-muted disabled:opacity-40"
          >
            Próximo post
          </button>
        </div>
      </div>

      <ZoomViewer src={zoom} alt="Imagem do post em tamanho real" onFechar={() => setZoom(null)} />
    </div>
  );
}
