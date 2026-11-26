/** Separa a legenda do Instagram em texto corrido e hashtags. */

// "#palavra" com letras/números/_ de qualquer idioma (acentos incluídos); não pega "a#b".
const HASHTAG = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu;

export interface LegendaSeparada {
  /** Texto sem as hashtags, sem espaços nem linhas em branco sobrando. */
  texto: string;
  /** Hashtags sem o "#", na ordem, sem repetir (ignora maiúsculas). */
  tags: string[];
}

export function separarLegenda(legenda: string | null | undefined): LegendaSeparada {
  const bruta = legenda ?? "";
  const vistas = new Set<string>();
  const tags: string[] = [];
  for (const m of bruta.matchAll(HASHTAG)) {
    const tag = m[1];
    if (!tag) continue;
    const chave = tag.toLocaleLowerCase("pt-BR");
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    tags.push(tag);
  }
  const texto = bruta
    .replace(HASHTAG, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texto, tags };
}
