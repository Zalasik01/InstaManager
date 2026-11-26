import type { ItemLink } from "@/types";

interface LinksTabProps {
  itens: readonly ItemLink[];
}

/** Aba "Links": peças e produtos indicados. (Visual final: fase 2.) */
export default function LinksTab({ itens }: LinksTabProps) {
  const validos = itens.filter((i) => /^https?:\/\//i.test(i.url));
  if (!validos.length) {
    return <p className="text-muted py-10 text-center">Ainda não há links por aqui.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {validos.map((i) => (
        <li key={i.url} className="bg-surface border-line rounded-lg border p-4">
          <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-bold underline">
            {i.titulo}
          </a>
          {i.loja ? <p className="text-muted text-sm">{i.loja}</p> : null}
          {i.descricao ? <p className="mt-1 text-sm">{i.descricao}</p> : null}
          {i.preco ? <p className="text-accent mt-1 text-sm font-bold">{i.preco}</p> : null}
        </li>
      ))}
    </ul>
  );
}
