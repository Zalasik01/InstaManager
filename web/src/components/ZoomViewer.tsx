import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus, X } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

interface ZoomViewerProps {
  /** URL da imagem ou null com o visualizador fechado. */
  src: string | null;
  alt: string;
  onFechar: () => void;
}

/** Imagem em tela cheia com zoom, arrastar e pinça (react-zoom-pan-pinch). */
export default function ZoomViewer({ src, alt, onFechar }: ZoomViewerProps) {
  return (
    <Dialog.Root open={src !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/90" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[60] flex flex-col"
        >
          <Dialog.Title className="sr-only">Imagem em tamanho real</Dialog.Title>
          {src ? (
            <TransformWrapper minScale={1} maxScale={6} doubleClick={{ mode: "toggle" }}>
              {({ zoomIn, zoomOut }) => (
                <>
                  <div className="flex items-center justify-between gap-2 p-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        aria-label="Diminuir zoom"
                        onClick={() => zoomOut()}
                        className="bg-surface rounded-lg p-2"
                      >
                        <Minus size={18} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Aumentar zoom"
                        onClick={() => zoomIn()}
                        className="bg-surface rounded-lg p-2"
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                    </div>
                    <Dialog.Close
                      aria-label="Fechar imagem expandida"
                      className="bg-surface rounded-lg p-2"
                    >
                      <X size={18} aria-hidden="true" />
                    </Dialog.Close>
                  </div>
                  <div className="min-h-0 flex-1">
                    <TransformComponent
                      wrapperClass="!size-full"
                      contentClass="!size-full items-center justify-center"
                    >
                      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
                    </TransformComponent>
                  </div>
                </>
              )}
            </TransformWrapper>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
