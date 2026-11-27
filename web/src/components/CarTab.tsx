import { motion, useReducedMotion, type Variants } from "motion/react";
import { dataIso, formatarData } from "@/lib/format";
import type { FichaMontada } from "@/types";

interface CarTabProps {
  /** Ficha já montada no build por montarFicha(). */
  ficha: FichaMontada;
}

/** Aba "O carro": cabeçalho (sem foto), destaques, seções agrupadas e data de atualização. */
export default function CarTab({ ficha }: CarTabProps) {
  const reduz = useReducedMotion();
  const vazia = !ficha.nome && !ficha.sobretitulo && !ficha.destaques.length && !ficha.secoes.length;
  if (vazia) return <p className="car-erro">A ficha do carro ainda está vazia.</p>;

  // Cada bloco entra em sequência, com um deslocamento curto.
  const lista: Variants = { mostra: { transition: { staggerChildren: reduz ? 0 : 0.05 } } };
  const item: Variants = {
    some: reduz ? { opacity: 1 } : { opacity: 0, y: 8 },
    mostra: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.2, 0.7, 0.2, 1] } },
  };

  const iso = ficha.atualizadoEm;
  return (
    <motion.div className="car" variants={lista} initial="some" animate="mostra">
      {ficha.nome || ficha.sobretitulo ? (
        <motion.header className="car-head" variants={item}>
          {ficha.sobretitulo ? <p className="car-eyebrow">{ficha.sobretitulo}</p> : null}
          <h2 className="car-name">{ficha.nome || "O carro"}</h2>
        </motion.header>
      ) : null}

      {ficha.destaques.length ? (
        <motion.dl className="car-hl" variants={item}>
          {ficha.destaques.map((c) => (
            <div key={c.chave}>
              <dt>{c.rotulo}</dt>
              <dd>{c.valor}</dd>
            </div>
          ))}
        </motion.dl>
      ) : null}

      {ficha.secoes.map((s, i) => (
        <motion.section
          key={s.titulo}
          className="car-sec"
          aria-labelledby={`carro-s-${i}`}
          variants={item}
        >
          <h2 id={`carro-s-${i}`}>{s.titulo}</h2>
          {s.tipo === "campos" ? (
            <dl className="car-list">
              {s.campos.map((c) => (
                <div key={c.chave}>
                  <dt>{c.rotulo}</dt>
                  <dd>{c.valor}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <ul className="car-chips">
              {s.chips.map((m, k) => (
                <li key={`${m}-${k}`}>{m}</li>
              ))}
            </ul>
          )}
        </motion.section>
      ))}

      {iso ? (
        <motion.p className="car-upd" variants={item}>
          Atualizado em <time dateTime={dataIso(iso) ?? iso}>{formatarData(iso)}</time>
        </motion.p>
      ) : null}
    </motion.div>
  );
}
