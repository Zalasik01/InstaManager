import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Minus, Plus, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import { toast } from "sonner";
import type { Post } from "@/components/contrato";
import { extensao } from "@/components/util";

const ZMAX = 8;
const PASSO = 1.25;

interface ZoomViewerProps {
  /** Post cujas imagens estão expandidas, ou null com o zoom fechado. */
  post: Post | null;
  indice: number;
  onIndice: (i: number) => void;
  onFechar: () => void;
}

interface Medidas {
  src: string;
  nw: number;
  nh: number;
}

/**
 * Imagem em tela cheia na resolução real do arquivo: zoom com roda, pinça e duplo toque,
 * botões + e −, "Ajustar"/"100%", baixar (fetch para blob) e abrir em nova aba.
 */
export default function ZoomViewer({ post, indice, onIndice, onFechar }: ZoomViewerProps) {
  const reduz = useReducedMotion();
  const aberto = post !== null;
  const imgs = post?.imagens ?? [];
  const src = imgs[indice] ?? "";

  return (
    <Dialog.Root open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <AnimatePresence>
        {aberto ? (
          <Dialog.Portal forceMount>
            <Dialog.Content forceMount asChild aria-describedby={undefined}>
              <motion.div
                className="zoom"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduz ? 0 : 0.18 }}
              >
                <Dialog.Title className="sr-only">Imagem em tamanho real</Dialog.Title>
                {post ? (
                  <Palco
                    key={src}
                    post={post}
                    src={src}
                    indice={indice}
                    total={imgs.length}
                    onIndice={onIndice}
                    reduz={!!reduz}
                  />
                ) : null}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface PalcoProps {
  post: Post;
  src: string;
  indice: number;
  total: number;
  onIndice: (i: number) => void;
  reduz: boolean;
}

function Palco({ post, src, indice, total, onIndice, reduz }: PalcoProps) {
  const palco = useRef<HTMLDivElement>(null);
  const controle = useRef<ReactZoomPanPinchContentRef | null>(null);
  const [medidas, setMedidas] = useState<Medidas | null>(null);
  const [erro, setErro] = useState(false);
  const [escala, setEscala] = useState(1);
  const [ajuste, setAjuste] = useState(1);
  const [baixando, setBaixando] = useState(false);

  // Mede a imagem original antes de montar o zoom (a escala 100% é o tamanho real do arquivo).
  useEffect(() => {
    let vivo = true;
    const im = new Image();
    im.decoding = "async";
    im.onload = () => vivo && setMedidas({ src, nw: im.naturalWidth, nh: im.naturalHeight });
    im.onerror = () => vivo && setErro(true);
    im.src = src;
    return () => {
      vivo = false;
    };
  }, [src]);

  // Escala que mostra a imagem inteira no palco (nunca acima de 100%).
  const calcularAjuste = useCallback(() => {
    const el = palco.current;
    if (!el || !medidas) return 1;
    return Math.min(1, el.clientWidth / medidas.nw, el.clientHeight / medidas.nh);
  }, [medidas]);

  useEffect(() => {
    if (!medidas) return;
    const atualizar = () => setAjuste(calcularAjuste());
    atualizar();
    window.addEventListener("resize", atualizar);
    return () => window.removeEventListener("resize", atualizar);
  }, [medidas, calcularAjuste]);

  const tempo = reduz ? 0 : 200;
  const ajustado = Math.abs(escala - ajuste) < 0.001;

  const irPara = useCallback(
    (s: number) => {
      const c = controle.current;
      if (!c) return;
      c.centerView(Math.min(ZMAX, Math.max(ajuste, s)), tempo);
    },
    [ajuste, tempo],
  );

  const alternar = () => irPara(ajustado ? (ajuste < 0.99 ? 1 : 2) : ajuste);

  // Atalhos: + e − mudam o zoom, 0 ajusta à tela, 1 mostra em 100%, setas trocam de imagem.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === "+" || k === "=") irPara(escala * PASSO);
      else if (k === "-" || k === "_") irPara(escala / PASSO);
      else if (k === "0") irPara(ajuste);
      else if (k === "1") irPara(1);
      else if (k === "ArrowLeft" && ajustado && indice > 0) onIndice(indice - 1);
      else if (k === "ArrowRight" && ajustado && indice < total - 1) onIndice(indice + 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [irPara, escala, ajuste, ajustado, indice, total, onIndice]);

  async function baixar() {
    setBaixando(true);
    try {
      const r = await fetch(src, { mode: "cors", credentials: "omit" });
      if (!r.ok) throw new Error("download");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `polo9n-${String(post.id).replace(/[^\w-]/g, "")}-${indice + 1}.${extensao(blob.type)}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast('Não deu para baixar. Tente "Abrir em nova aba".');
    } finally {
      setBaixando(false);
    }
  }

  const pronto = medidas !== null && medidas.src === src;

  return (
    <>
      <div className="z-bar">
        <div className="z-tools">
          <motion.button
            whileTap={{ scale: 0.92 }}
            type="button"
            className="z-btn"
            aria-label="Diminuir zoom"
            disabled={!pronto || ajustado}
            onClick={() => irPara(escala / PASSO)}
          >
            <Minus aria-hidden="true" />
          </motion.button>
          <output className="z-pct" aria-live="off">
            {pronto ? `${Math.round(escala * 100)}%` : ""}
          </output>
          <motion.button
            whileTap={{ scale: 0.92 }}
            type="button"
            className="z-btn"
            aria-label="Aumentar zoom"
            disabled={!pronto || escala >= ZMAX}
            onClick={() => irPara(escala * PASSO)}
          >
            <Plus aria-hidden="true" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            className="z-btn"
            aria-label="Ajustar à tela ou 100%"
            disabled={!pronto}
            onClick={alternar}
          >
            {ajustado ? (ajuste < 0.99 ? "100%" : "Ampliar") : "Ajustar"}
          </motion.button>
        </div>
        <div className="z-tools">
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            className="z-btn"
            disabled={baixando}
            onClick={() => void baixar()}
          >
            <Download aria-hidden="true" />
            Baixar imagem
          </motion.button>
          <a className="z-btn" href={src} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            Abrir em nova aba
          </a>
          <Dialog.Close asChild>
            <motion.button
              whileTap={{ scale: 0.9 }}
              type="button"
              className="icon-btn"
              aria-label="Fechar imagem expandida"
            >
              <X aria-hidden="true" />
            </motion.button>
          </Dialog.Close>
        </div>
      </div>

      <div
        ref={palco}
        className="z-stage"
        // Área rolável precisa receber foco para dar para mover a imagem pelo teclado (setas).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label="Imagem ampliada. Mais e menos mudam o zoom, arraste para mover."
      >
        {pronto ? (
          <TransformWrapper
            key={`${src}-${ajuste}`}
            initialScale={ajuste}
            minScale={ajuste}
            maxScale={ZMAX}
            centerOnInit
            centerZoomedOut
            limitToBounds
            wheel={{ step: 0.15 }}
            doubleClick={{ mode: "toggle", step: 1, animationTime: tempo }}
            zoomAnimation={{ disabled: reduz }}
            velocityAnimation={{ disabled: reduz }}
            onInit={(r) => setEscala(r.state.scale)}
            onTransform={(_r, s) => setEscala(s.scale)}
          >
            {(r) => {
              controle.current = r;
              return (
                <TransformComponent
                  wrapperStyle={{ width: "100%", height: "100%" }}
                  contentStyle={{ width: medidas.nw, height: medidas.nh }}
                >
                  <img
                    src={src}
                    alt={`Imagem ${indice + 1} de ${total} em tamanho real`}
                    width={medidas.nw}
                    height={medidas.nh}
                    draggable={false}
                  />
                </TransformComponent>
              );
            }}
          </TransformWrapper>
        ) : null}
      </div>

      {total > 1 ? (
        <>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="button"
            className="icon-btn z-arrow v-prev"
            aria-label="Imagem anterior"
            disabled={indice <= 0}
            onClick={() => onIndice(indice - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            type="button"
            className="icon-btn z-arrow v-next"
            aria-label="Próxima imagem"
            disabled={indice >= total - 1}
            onClick={() => onIndice(indice + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </motion.button>
        </>
      ) : null}

      <p className="z-res">
        {erro
          ? "Não deu para carregar a imagem."
          : pronto
            ? `${medidas.nw} × ${medidas.nh} px (arquivo original da galeria)`
            : "Carregando..."}
      </p>
    </>
  );
}
