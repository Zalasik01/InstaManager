import { Eye, Pin } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { memo, useState } from "react";
import type { Post } from "@/components/contrato";
import { IconeCarrossel, IconePlay } from "@/components/icones";
import { numeros, resumo } from "@/components/util";
import { cn } from "@/lib/cn";
import { formatarNumero, numeroValido } from "@/lib/format";
import { separarLegenda } from "@/lib/hashtags";

interface PostTileProps {
  post: Post;
  /** Posição na grade (as primeiras imagens carregam com prioridade). */
  indice: number;
  /** Atraso da entrada (s), escalonado dentro de cada página carregada. */
  atraso: number;
  onAbrir: (indice: number, origem: HTMLButtonElement) => void;
  onExpandir: (indice: number) => void;
  onCompartilhar: (indice: number) => void;
}

type Estado = "carregando" | "pronto" | "falhou";

/**
 * Card 4:5 da grade: a foto inteira (contain) sobre ela mesma desfocada, contador de visualizações,
 * ícones de carrossel/vídeo/fixado e, só com mouse, um véu com legenda, números e ações.
 */
function PostTile({ post, indice, atraso, onAbrir, onExpandir, onCompartilhar }: PostTileProps) {
  const reduz = useReducedMotion();
  const capa = post.imagens[0];
  const [estado, setEstado] = useState<Estado>(capa ? "carregando" : "falhou");
  const nums = numeros(post);
  const vis = numeroValido(post.visualizacoes);
  const legenda = separarLegenda(post.legenda).texto;
  const multi = post.imagens.length > 1;
  const rotulo =
    `Abrir post: ${resumo(post) || "sem legenda"}` +
    (post.fixado ? " (fixado)" : "") +
    (multi ? ` (${post.imagens.length} imagens)` : "") +
    (post.video ? " (vídeo)" : "") +
    (vis != null && nums[0] ? `, ${nums[0]}` : "");
  const prioridade = indice < 6;

  return (
    <motion.li
      data-post-id={post.id}
      initial={reduz ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: [0.2, 0.7, 0.2, 1], delay: reduz ? 0 : atraso }}
    >
      <motion.button
        type="button"
        whileTap={reduz ? {} : { scale: 0.97 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={cn("tile", estado, vis != null && "has-views")}
        aria-label={rotulo}
        onClick={(e) => onAbrir(indice, e.currentTarget)}
      >
        {capa ? (
          <>
            {/* Camada de fundo: a mesma foto desfocada, para preencher as sobras do tile 4:5. */}
            <motion.img
              className="bg"
              src={capa}
              alt=""
              aria-hidden="true"
              width={400}
              height={500}
              loading={prioridade ? "eager" : "lazy"}
              decoding="async"
              initial={false}
              animate={{ opacity: estado === "pronto" ? 1 : 0 }}
              transition={{ duration: reduz ? 0 : 0.45 }}
            />
            <motion.img
              className="fg"
              src={capa}
              alt=""
              width={400}
              height={500}
              loading={prioridade ? "eager" : "lazy"}
              decoding="async"
              {...(prioridade && indice < 3 ? { fetchPriority: "high" as const } : {})}
              onLoad={() => setEstado("pronto")}
              onError={() => setEstado("falhou")}
              initial={false}
              animate={{ opacity: estado === "pronto" ? 1 : 0 }}
              transition={{ duration: reduz ? 0 : 0.45 }}
            />
          </>
        ) : null}
        {post.fixado ? <Pin className="fixo" aria-hidden="true" fill="currentColor" strokeWidth={2} /> : null}
        {post.video ? <IconePlay className="multi" /> : multi ? <IconeCarrossel className="multi" /> : null}
        {vis != null ? (
          <span className="views">
            <Eye aria-hidden="true" strokeWidth={2} />
            {formatarNumero(vis)}
          </span>
        ) : null}
      </motion.button>

      <div className="veil">
        {legenda ? (
          <p className="veil-cap" aria-hidden="true">
            {legenda}
          </p>
        ) : null}
        {nums.length ? (
          <p className="veil-nums" aria-hidden="true">
            {nums.join(" · ")}
          </p>
        ) : null}
        <div className="veil-act">
          {!post.video ? (
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              aria-label="Expandir imagem do post"
              onClick={() => onExpandir(indice)}
            >
              Expandir
            </motion.button>
          ) : null}
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            aria-label="Compartilhar este post"
            onClick={() => onCompartilhar(indice)}
          >
            Compartilhar
          </motion.button>
        </div>
      </div>
    </motion.li>
  );
}

export default memo(PostTile);
