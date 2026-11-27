import { ExternalLink } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { registrarClique } from "@/components/contrato";
import { idDoLink } from "@/components/util";
import { formatarData } from "@/lib/format";
import type { ItemLink } from "@/types";

interface LinksTabProps {
  itens: readonly ItemLink[];
}

interface LinkPronto {
  item: ItemLink;
  url: URL;
  categoria: string;
  titulo: string;
  id: string;
}

function urlSegura(u: string): URL | null {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x : null;
  } catch {
    return null;
  }
}

function cheio(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** "AAAA-MM-DD" vira "26 de novembro de 2026"; outro texto aparece como está. */
function dataLink(d: string): string {
  if (!cheio(d)) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d.trim()) ? formatarData(d) : d.trim();
}

/** Aba "Links": peças do carro agrupadas por categoria, com filtro quando há 2 ou mais categorias. */
export default function LinksTab({ itens }: LinksTabProps) {
  const reduz = useReducedMotion();
  const [filtro, setFiltro] = useState("");

  const { lista, categorias } = useMemo(() => {
    const lista: LinkPronto[] = itens.flatMap((item) => {
      const url = urlSegura(item.url);
      if (!url) return [];
      const titulo = cheio(item.titulo) ? item.titulo.trim() : url.hostname;
      return [
        {
          item,
          url,
          titulo,
          categoria: cheio(item.categoria) ? item.categoria.trim() : "Outros",
          id: idDoLink(titulo, url.href),
        },
      ];
    });
    const categorias = [...new Set(lista.map((x) => x.categoria))].sort(
      (a, b) => Number(a === "Outros") - Number(b === "Outros"),
    );
    return { lista, categorias };
  }, [itens]);

  if (!lista.length) {
    return (
      <div className="car">
        <p className="car-erro">Em breve: as peças que coloquei no Polo, com link para cada uma.</p>
      </div>
    );
  }

  const visiveis = categorias.filter((c) => !filtro || c === filtro);

  return (
    <div className="car">
      {categorias.length >= 2 ? (
        <div className="lk-filtro" role="group" aria-label="Filtrar por categoria">
          {["", ...categorias].map((c) => (
            <motion.button
              key={c || "todas"}
              whileTap={{ scale: 0.95 }}
              type="button"
              aria-pressed={filtro === c}
              onClick={() => setFiltro(c)}
            >
              {c || "Todas"}
            </motion.button>
          ))}
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {visiveis.map((c) => (
          <motion.section
            key={c}
            className="car-sec"
            layout={!reduz}
            initial={reduz ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <h2>{c}</h2>
            <ul className="lk">
              {lista
                .filter((x) => x.categoria === c)
                .map((x, i) => (
                  <Cartao key={x.id} link={x} atraso={reduz ? 0 : i * 0.04} reduz={!!reduz} />
                ))}
            </ul>
          </motion.section>
        ))}
      </AnimatePresence>

      <p className="car-upd">Alguns links podem ser de afiliados.</p>
    </div>
  );
}

function Cartao({ link, atraso, reduz }: { link: LinkPronto; atraso: number; reduz: boolean }) {
  const { item, url, titulo, id } = link;
  const meta = [cheio(item.loja) ? item.loja.trim() : "", url.hostname].filter(Boolean).join(" · ");
  const pequeno = [cheio(item.preco) ? item.preco.trim() : "", dataLink(item.data)]
    .filter(Boolean)
    .join(" · ");
  return (
    <motion.li
      initial={reduz ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduz ? {} : { y: -2 }}
      transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1], delay: atraso }}
    >
      <h3 className="lk-t">{titulo}</h3>
      <p className="lk-m">{meta}</p>
      {cheio(item.descricao) ? <p className="lk-d">{item.descricao.trim()}</p> : null}
      {pequeno ? <p className="lk-p">{pequeno}</p> : null}
      <motion.a
        whileTap={{ scale: 0.96 }}
        className="lk-go"
        href={url.href}
        target="_blank"
        rel="noopener noreferrer nofollow sponsored"
        aria-label={`Ver peça: ${titulo} (abre em nova aba)`}
        // Conta o clique sem segurar a navegação: o link abre normalmente.
        onClick={() => registrarClique({ linkId: id, url: url.href, titulo })}
        onAuxClick={(e) => e.button === 1 && registrarClique({ linkId: id, url: url.href, titulo })}
      >
        Ver peça
        <ExternalLink aria-hidden="true" size={15} />
      </motion.a>
    </motion.li>
  );
}
