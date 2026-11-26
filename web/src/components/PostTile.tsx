import { Images } from "lucide-react";
import type { Post } from "@/types";

interface PostTileProps {
  post: Post;
  /** Posição na grade (as primeiras imagens carregam com prioridade). */
  indice: number;
  onAbrir: (indice: number) => void;
}

/** Miniatura quadrada de um post; abre o visualizador ao clicar. */
export default function PostTile({ post, indice, onAbrir }: PostTileProps) {
  const capa = post.imagens[0];
  const rotulo = post.legenda ? post.legenda.slice(0, 80) : "Post sem legenda";
  return (
    <li className="relative aspect-square">
      <button
        type="button"
        onClick={() => onAbrir(indice)}
        aria-label={`Abrir post: ${rotulo}`}
        className="bg-surface block size-full overflow-hidden"
      >
        {capa ? (
          <img
            crossOrigin="anonymous"
            src={capa}
            alt=""
            width={400}
            height={400}
            loading={indice < 6 ? "eager" : "lazy"}
            decoding="async"
            className="size-full object-cover"
          />
        ) : null}
        {post.imagens.length > 1 ? (
          <Images
            size={18}
            aria-hidden="true"
            className="absolute top-2 right-2 drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]"
          />
        ) : null}
      </button>
    </li>
  );
}
