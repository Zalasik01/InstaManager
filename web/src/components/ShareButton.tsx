import { Check, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

interface ShareButtonProps {
  titulo: string;
  texto: string;
  /** URL absoluta a compartilhar. */
  url: string;
  rotulo?: string;
  className?: string;
}

/** Usa a folha de compartilhar do sistema (Web Share API); sem ela, copia o link. */
export default function ShareButton({
  titulo,
  texto,
  url,
  rotulo = "Compartilhar",
  className,
}: ShareButtonProps) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function compartilhar() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: titulo, text: texto, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* usuário cancelou a folha de compartilhar ou a área de transferência foi negada */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void compartilhar()}
      className={cn(
        "border-line bg-surface hover:border-muted inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold",
        className,
      )}
    >
      {copiado ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
      <span aria-live="polite">{copiado ? "Link copiado" : rotulo}</span>
    </button>
  );
}
