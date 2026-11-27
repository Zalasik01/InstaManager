import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { buscarComentarios, type Comentario, type Post } from "@/components/contrato";
import {
  compartilharPost,
  numeros,
  permalinkSeguro,
  proporcaoDe,
  resumo,
  type Proporcao,
} from "@/components/util";
import { cn } from "@/lib/cn";
import { dataIso, dataRelativa, formatarData, numeroValido, plural } from "@/lib/format";
import { separarLegenda } from "@/lib/hashtags";
import { SITE } from "@/site";

interface PostViewerProps {
  posts: readonly Post[];
  /** Total de posts no servidor (para "Post N de M" e para saber se há próximo). */
  total: number;
  /** Índice do post aberto, ou null com o visualizador fechado. */
  indice: number | null;
  /** -1 = veio do anterior, 1 = do próximo, 0 = abriu agora (define a animação). */
  direcao: number;
  imgIdx: number;
  onImgIdx: (i: number) => void;
  /** Troca de post (delta -1/1); quem chama carrega mais páginas se preciso. */
  onPost: (delta: number) => void;
  onFechar: () => void;
  /** Chamado depois de fechar (com o foco liberado) para devolver o foco ao card, se fizer sentido. */
  onDevolverFoco: () => void;
  onExpandir: () => void;
  zoomAberto: boolean;
}

const MOLA = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

/**
 * Visualizador no estilo do Instagram (Radix Dialog). Desktop: caixa centralizada com a mídia à
 * esquerda e o painel à direita, setas de post fora da caixa. Celular: tela cheia em coluna.
 */
export default function PostViewer(props: PostViewerProps) {
  const { posts, total, indice, direcao, onPost, onFechar, onDevolverFoco, zoomAberto } = props;
  const reduz = !!useReducedMotion();
  const post = indice === null ? undefined : posts[indice];
  const aberto = post !== undefined;
  const fecharRef = useRef<HTMLButtonElement>(null);
  const [proporcoes, setProporcoes] = useState<Record<string, Proporcao>>({});

  const marcarProporcao = useCallback((id: string, p: Proporcao) => {
    setProporcoes((atual) => (atual[id] === p ? atual : { ...atual, [id]: p }));
  }, []);

  const fechar = useCallback(() => {
    // Não deixa o vídeo tocando durante a animação de saída.
    document.querySelectorAll<HTMLVideoElement>(".viewer video").forEach((v) => v.pause());
    onFechar();
  }, [onFechar]);

  const temProximo = indice !== null && (indice < posts.length - 1 || posts.length < total);

  // Troca de post; se o botão focado ficar desabilitado (chegou na ponta), o foco vai para o Fechar.
  const irPost = useCallback(
    (delta: number) => {
      onPost(delta);
      window.setTimeout(() => {
        const a = document.activeElement as HTMLButtonElement | null;
        if (!a || a === document.body || a.disabled) fecharRef.current?.focus();
      }, 0);
    },
    [onPost],
  );

  // Teclado: com carrossel, as setas trocam a imagem; na ponta (ou sem carrossel), trocam o post.
  useEffect(() => {
    if (!aberto || zoomAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLVideoElement) return; // setas do vídeo avançam/voltam o vídeo
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      const n = post && !post.video ? post.imagens.length : 0;
      const alvo = props.imgIdx + d;
      if (n > 1 && alvo >= 0 && alvo < n) props.onImgIdx(alvo);
      else if (d < 0 ? (indice ?? 0) > 0 : temProximo) irPost(d);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, zoomAberto, post, props, indice, temProximo, irPost]);

  const variantes: Variants = {
    entra: (d: number) => (reduz ? { opacity: 0 } : d === 0 ? { opacity: 0, scale: 0.97 } : { opacity: 0, x: d * 56 }),
    centro: { opacity: 1, x: 0, scale: 1 },
    sai: (d: number) => (reduz ? { opacity: 0 } : d === 0 ? { opacity: 0, scale: 0.97 } : { opacity: 0, x: d * -56 }),
  };

  const proporcao = post ? (proporcoes[post.id] ?? "r-45") : "r-45";

  return (
    <Dialog.Root open={aberto} onOpenChange={(a) => !a && fechar()}>
      <AnimatePresence>
        {aberto && post ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                className="viewer-bg"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduz ? 0 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                fecharRef.current?.focus();
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                onDevolverFoco();
              }}
            >
              <motion.div
                className={cn("viewer", proporcao)}
                initial={{ opacity: 0, scale: reduz ? 1 : 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduz ? 1 : 0.97 }}
                transition={reduz ? { duration: 0 } : { opacity: { duration: 0.18 }, scale: MOLA }}
                onClick={(e) => {
                  // Clique no fundo (fora da caixa e dos botões) fecha.
                  if (e.target === e.currentTarget) fechar();
                }}
              >
                <Dialog.Title className="sr-only">
                  {`Post ${(indice ?? 0) + 1} de ${total || posts.length}`}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <motion.button
                    ref={fecharRef}
                    whileTap={{ scale: 0.9 }}
                    type="button"
                    className="icon-btn v-x"
                    aria-label="Fechar"
                  >
                    <X aria-hidden="true" strokeWidth={2} />
                  </motion.button>
                </Dialog.Close>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  type="button"
                  className="icon-btn v-post v-pl"
                  aria-label="Post anterior"
                  disabled={(indice ?? 0) <= 0}
                  onClick={() => irPost(-1)}
                >
                  <ChevronLeft aria-hidden="true" strokeWidth={2.2} />
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  type="button"
                  className="icon-btn v-post v-pr"
                  aria-label="Próximo post"
                  disabled={!temProximo}
                  onClick={() => irPost(1)}
                >
                  <ChevronRight aria-hidden="true" strokeWidth={2.2} />
                </motion.button>

                <AnimatePresence initial={false} custom={direcao}>
                  <Caixa
                    key={post.id}
                    post={post}
                    numero={(indice ?? 0) + 1}
                    total={total || posts.length}
                    direcao={direcao}
                    variantes={variantes}
                    reduz={reduz}
                    imgIdx={props.imgIdx}
                    onImgIdx={props.onImgIdx}
                    onExpandir={props.onExpandir}
                    zoomAberto={zoomAberto}
                    marcarProporcao={marcarProporcao}
                  />
                </AnimatePresence>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface CaixaProps {
  /** Repassado pelo AnimatePresence. */
  ref?: React.Ref<HTMLDivElement>;
  post: Post;
  numero: number;
  total: number;
  direcao: number;
  variantes: Variants;
  reduz: boolean;
  imgIdx: number;
  onImgIdx: (i: number) => void;
  onExpandir: () => void;
  zoomAberto: boolean;
  marcarProporcao: (id: string, p: Proporcao) => void;
}

function Caixa({
  ref,
  post,
  numero,
  total,
  direcao,
  variantes,
  reduz,
  imgIdx,
  onImgIdx,
  onExpandir,
  zoomAberto,
  marcarProporcao,
}: CaixaProps) {
  const { texto, tags } = separarLegenda(post.legenda);
  const nums = numeros(post);
  const link = permalinkSeguro(post);
  const data = formatarData(post.publicado_em);
  const iso = (() => {
    const d = new Date(post.publicado_em);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  })();

  return (
    <motion.div
      ref={ref}
      className={cn("v-box", !texto && !tags.length && "compact")}
      custom={direcao}
      variants={variantes}
      initial="entra"
      animate="centro"
      exit="sai"
      transition={reduz ? { duration: 0 } : { x: MOLA, scale: MOLA, opacity: { duration: 0.16 } }}
    >
      <Midia
        post={post}
        reduz={reduz}
        imgIdx={imgIdx}
        onImgIdx={onImgIdx}
        zoomAberto={zoomAberto}
        marcarProporcao={marcarProporcao}
      />
      <div className="v-info">
        <div className="v-top">
          <img className="v-av" src="/img/icon-192.png" alt="" width={32} height={32} />
          <span>@{SITE.perfil}</span>
        </div>
        <div className="v-scroll">
          {nums.length ? <p className="v-nums">{nums.join(" · ")}</p> : null}
          {texto ? <p className="v-cap">{texto}</p> : null}
          {tags.length ? (
            <ul className="chips" aria-label="Hashtags">
              {tags.map((t) => (
                <li key={t}>#{t}</li>
              ))}
            </ul>
          ) : null}
          {data ? (
            <p className="v-date">
              <time dateTime={iso}>{data}</time>
            </p>
          ) : null}
          <Comentarios postId={post.id} />
        </div>
        <div className="v-actions">
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            className="share"
            onClick={() => void compartilharPost(post, imgIdx)}
          >
            Compartilhar
          </motion.button>
          {!post.video && post.imagens.length ? (
            <motion.button whileTap={{ scale: 0.95 }} type="button" className="share" onClick={onExpandir}>
              Expandir imagem
            </motion.button>
          ) : null}
          {link ? (
            <a href={link} rel="noopener noreferrer" target="_blank">
              Ver no Instagram
            </a>
          ) : null}
        </div>
        <p className="v-count">
          Post {numero} de {total}
        </p>
      </div>
    </motion.div>
  );
}

interface MidiaProps {
  post: Post;
  reduz: boolean;
  imgIdx: number;
  onImgIdx: (i: number) => void;
  zoomAberto: boolean;
  marcarProporcao: (id: string, p: Proporcao) => void;
}

/**
 * Carrossel = trilho com uma imagem por "slide", rolagem horizontal nativa e scroll-snap: o swipe é
 * do próprio navegador (acompanha o dedo e encaixa). O JS só acompanha a rolagem para saber qual
 * imagem está na tela e rola o trilho quando a troca vem das setas ou do teclado. Não dá a volta
 * e nunca troca de post por swipe.
 */
function Midia({ post, reduz, imgIdx, onImgIdx, zoomAberto, marcarProporcao }: MidiaProps) {
  const trilho = useRef<HTMLDivElement>(null);
  const daRolagem = useRef(imgIdx);
  const rolandoPara = useRef<number | null>(null);
  const raf = useRef(0);
  const imgs = post.imagens;
  const multi = imgs.length > 1 && !post.video;
  const r = resumo(post);

  const rolarPara = useCallback(
    (i: number, animar: boolean) => {
      const tr = trilho.current;
      const w = tr?.clientWidth;
      if (!tr || !w) return;
      rolandoPara.current = animar ? i : null;
      tr.scrollTo({ left: i * w, behavior: animar && !reduz ? "smooth" : "auto" });
      // Garantia: se o evento final de rolagem não chegar, libera depois de um tempo.
      if (animar) window.setTimeout(() => (rolandoPara.current = null), 700);
    },
    [reduz],
  );

  // Troca vinda de fora (setas, teclado, zoom): rola o trilho até a imagem.
  useEffect(() => {
    if (daRolagem.current === imgIdx) return;
    daRolagem.current = imgIdx;
    rolarPara(imgIdx, !zoomAberto);
  }, [imgIdx, zoomAberto, rolarPara]);

  // Girar o celular muda a largura: mantém a mesma imagem encaixada.
  useEffect(() => {
    const aoRedimensionar = () => rolarPara(daRolagem.current, false);
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [rolarPara]);

  const aoRolar = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const tr = trilho.current;
      const w = tr?.clientWidth;
      if (!tr || !w || !tr.children.length) return;
      const i = Math.max(0, Math.min(tr.children.length - 1, Math.round(tr.scrollLeft / w)));
      if (rolandoPara.current !== null) {
        if (i === rolandoPara.current && Math.abs(tr.scrollLeft - i * w) < 2) rolandoPara.current = null;
        return;
      }
      if (i !== daRolagem.current) {
        daRolagem.current = i;
        onImgIdx(i);
      }
    });
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className="v-media">
      {post.video ? (
        // Os vídeos vêm do Instagram, que não fornece arquivo de legenda (<track>) pela API.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          key={post.video}
          src={post.video}
          poster={imgs[0]}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) marcarProporcao(post.id, proporcaoDe(v.videoWidth, v.videoHeight));
          }}
        />
      ) : (
        <div
          ref={trilho}
          className="v-track"
          role="group"
          aria-roledescription="carrossel"
          aria-label="Imagens do post"
          tabIndex={-1}
          onScroll={aoRolar}
        >
          {imgs.map((u, i) => (
            <div className="v-slide" key={`${u}-${i}`}>
              <img
                src={u}
                alt={`Imagem ${i + 1} de ${imgs.length}${r ? `. ${r}` : ". Foto do Polo 9n4"}`}
                aria-hidden={i === imgIdx ? undefined : true}
                width={1080}
                height={1080}
                decoding="async"
                draggable={false}
                onLoad={
                  i === 0
                    ? (e) => {
                        // Proporção do Instagram: a 1ª imagem define a caixa (o carrossel inteiro segue ela).
                        const im = e.currentTarget;
                        if (im.naturalWidth && im.naturalHeight)
                          marcarProporcao(post.id, proporcaoDe(im.naturalWidth, im.naturalHeight));
                      }
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
      {multi ? (
        <>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="button"
            className="icon-btn v-arrow v-prev"
            aria-label="Imagem anterior"
            disabled={imgIdx <= 0}
            onClick={() => onImgIdx(Math.max(0, imgIdx - 1))}
          >
            <ChevronLeft aria-hidden="true" strokeWidth={2.2} />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="button"
            className="icon-btn v-arrow v-next"
            aria-label="Próxima imagem"
            disabled={imgIdx >= imgs.length - 1}
            onClick={() => onImgIdx(Math.min(imgs.length - 1, imgIdx + 1))}
          >
            <ChevronRight aria-hidden="true" strokeWidth={2.2} />
          </motion.button>
          <div className="dots" aria-hidden="true">
            {imgs.map((u, i) => (
              <i key={`${u}-${i}`} className={i === imgIdx ? "on" : undefined} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Comentários do Instagram, buscados ao abrir o post (erro silencioso: a seção some). */
function Comentarios({ postId }: { postId: string }) {
  const q = useQuery({
    queryKey: ["comentarios", postId],
    queryFn: () => buscarComentarios(postId),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  if (q.isError) return null;
  const lista: Comentario[] = q.data?.slice(0, 20) ?? [];
  return (
    <section className="v-com" aria-labelledby={`v-com-${postId}`} aria-busy={q.isPending}>
      <h2 className="v-com-t" id={`v-com-${postId}`}>
        Comentários
      </h2>
      {q.isPending ? (
        <div className="grid gap-2" aria-hidden="true">
          <div className="v-com-skel w-3/4" />
          <div className="v-com-skel w-1/2" />
        </div>
      ) : lista.length ? (
        <motion.ul
          className="v-com-lista"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {lista.map((c, i) => {
            const quando = c.criado_em ? dataRelativa(c.criado_em) : "";
            const cu = numeroValido(c.curtidas);
            const meta = [quando, cu ? plural(cu, "curtida", "curtidas") : ""].filter(Boolean);
            return (
              <li key={`${c.usuario}-${c.criado_em}-${i}`}>
                <p>
                  {c.usuario ? <b>{c.usuario}</b> : null}
                  {String(c.texto ?? "")}
                </p>
                {meta.length ? (
                  <span
                    className="v-com-meta"
                    title={c.criado_em ? formatarData(c.criado_em) : undefined}
                  >
                    {c.criado_em ? (
                      <time dateTime={dataIso(c.criado_em) ?? undefined}>{meta.join(" · ")}</time>
                    ) : (
                      meta.join(" · ")
                    )}
                  </span>
                ) : null}
              </li>
            );
          })}
        </motion.ul>
      ) : (
        <p className="v-com-vazio">Nenhum comentário ainda.</p>
      )}
    </section>
  );
}
