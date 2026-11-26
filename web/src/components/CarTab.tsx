import { dataIso, formatarData } from "@/lib/format";
import type { FichaMontada } from "@/types";

interface CarTabProps {
  /** Ficha já montada no build por montarFicha(). */
  ficha: FichaMontada;
}

/** Aba "O carro": cabeçalho, destaques e seções da ficha. (Visual final: fase 2.) */
export default function CarTab({ ficha }: CarTabProps) {
  const vazia = !ficha.nome && !ficha.destaques.length && !ficha.secoes.length;
  if (vazia) return <p className="text-muted py-10 text-center">A ficha do carro ainda está vazia.</p>;

  const iso = ficha.atualizadoEm;
  return (
    <div className="flex flex-col gap-6">
      {ficha.nome || ficha.sobretitulo ? (
        <header>
          {ficha.sobretitulo ? <p className="text-accent text-sm font-bold">{ficha.sobretitulo}</p> : null}
          <h2 className="text-2xl font-extrabold">{ficha.nome || "O carro"}</h2>
        </header>
      ) : null}

      {ficha.destaques.length ? (
        <dl className="grid grid-cols-2 gap-3">
          {ficha.destaques.map((c) => (
            <div key={c.chave} className="bg-surface border-line rounded-lg border p-3">
              <dt className="text-muted text-xs">{c.rotulo}</dt>
              <dd className="font-bold">{c.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {ficha.secoes.map((s) => (
        <section key={s.titulo} aria-label={s.titulo}>
          <h3 className="mb-2 font-extrabold">{s.titulo}</h3>
          {s.tipo === "campos" ? (
            <dl className="divide-line divide-y">
              {s.campos.map((c) => (
                <div key={c.chave} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">{c.rotulo}</dt>
                  <dd className="text-right">{c.valor}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {s.chips.map((m) => (
                <li key={m} className="bg-surface border-line rounded-full border px-3 py-1 text-sm">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {iso ? (
        <p className="text-muted text-xs">
          Atualizado em <time dateTime={dataIso(iso) ?? iso}>{formatarData(iso)}</time>
        </p>
      ) : null}
    </div>
  );
}
