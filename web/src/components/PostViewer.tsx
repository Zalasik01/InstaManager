import * as Dialog from "@radix-ui/react-dialog";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useState } from "react";
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
  const [emblaRef, embla] = useEmblaCarousel({ loop: false });
  const [zoom, setZoom] = useState<string | null>(null);
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
        <div ref={emblaRef} className="overflow-hidden">
          <div className="flex">
            {post.imagens.map((src, i) => (
              <div key={src} className="min-w-0 flex-[0_0_100%]">
                <img
                  crossOrigin="anonymous"
                  src={src}
                  alt={`Foto ${i + 1} de ${post.imagens.length}`}
                  className="max-h-[60dvh] w-full object-contain"
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
              onClick={() => embla?.scrollPrev()}
              className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/60 p-2"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Próxima imagem"
              onClick={() => embla?.scrollNext()}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/60 p-2"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
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
