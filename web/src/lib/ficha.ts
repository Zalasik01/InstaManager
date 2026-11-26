import type { CampoFicha, DadosCarro, FichaMontada, SecaoFicha } from "@/types";

/**
 * Monta a ficha do carro: esconde campos vazios, evita repetir informação
 * (versão igual à geração; valores já mostrados nos destaques) e agrupa em seções.
 * Função pura: não lê arquivo nem rede.
 */

const ROTULOS: Record<string, string> = {
  modelo: "Modelo",
  ano: "Ano",
  geracao: "Geração",
  cor: "Cor",
  versao: "Versão",
  motor: "Motor",
  cambio: "Câmbio",
  rodas: "Rodas",
  pneus: "Pneus",
  suspensao: "Suspensão",
  freios: "Freios",
  escape: "Escape",
  som: "Som",
  quilometragem: "Quilometragem",
};

const DESTAQUES = ["ano", "motor", "cambio", "cor", "versao"] as const;
const MAX_DESTAQUES = 4;

const SECOES: { titulo: string; chaves: string[] }[] = [
  { titulo: "Mecânica", chaves: ["motor", "cambio", "suspensao", "freios", "escape"] },
  { titulo: "Rodas e pneus", chaves: ["rodas", "pneus"] },
  { titulo: "Visual", chaves: ["cor"] },
  { titulo: "Som", chaves: ["som"] },
];

const CONHECIDAS = Object.keys(ROTULOS);

export function rotuloDe(chave: string): string {
  const conhecido = ROTULOS[chave];
  if (conhecido) return conhecido;
  const limpo = chave.replace(/_/g, " ");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

function preenchido(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function campo(chave: string, valor: string): CampoFicha {
  return { chave, rotulo: rotuloDe(chave), valor: valor.trim() };
}

function listaLimpa(itens: readonly string[] | undefined): string[] {
  return (itens ?? []).map((i) => i.trim()).filter((i) => i !== "");
}

export function montarFicha(carro: DadosCarro): FichaMontada {
  const f = carro.ficha;
  const usadas = new Set<string>(["modelo", "geracao"]);

  // Cabeçalho: "Marca · ano · geração" e o nome do modelo.
  const partes = preenchido(f.modelo) ? f.modelo.trim().split(/\s+/) : [];
  const marca = partes.length > 1 ? (partes.shift() ?? "") : "";
  const nome = partes.join(" ");
  const sobretitulo = [marca, f.ano, f.geracao]
    .filter(preenchido)
    .map((s) => s.trim())
    .join(" · ");

  // Versão igual à geração é redundante.
  if (
    preenchido(f.versao) &&
    preenchido(f.geracao) &&
    f.versao.trim().toLowerCase() === f.geracao.trim().toLowerCase()
  ) {
    usadas.add("versao");
  }

  const destaques: CampoFicha[] = [];
  for (const chave of DESTAQUES) {
    if (destaques.length >= MAX_DESTAQUES) break;
    const valor = f[chave];
    if (!preenchido(valor) || usadas.has(chave)) continue;
    usadas.add(chave);
    destaques.push(campo(chave, valor));
  }

  const secoes: SecaoFicha[] = [];
  for (const { titulo, chaves } of SECOES) {
    const campos = chaves.flatMap((chave) => {
      const valor = f[chave];
      if (!preenchido(valor) || usadas.has(chave)) return [];
      usadas.add(chave);
      return [campo(chave, valor)];
    });
    if (campos.length) secoes.push({ titulo, tipo: "campos", campos, chips: [] });
  }

  const mods = listaLimpa(carro.modificacoes);
  if (mods.length) secoes.push({ titulo: "Modificações", tipo: "chips", campos: [], chips: mods });

  // O que sobrou (campos conhecidos e inventados pelo dono). Chaves começadas por "_" são ignoradas.
  const restantes = [...new Set([...CONHECIDAS, ...Object.keys(f)])].flatMap((chave) => {
    const valor = f[chave];
    if (chave.startsWith("_") || usadas.has(chave) || !preenchido(valor)) return [];
    return [campo(chave, valor)];
  });
  if (restantes.length) {
    secoes.push({ titulo: "Mais", tipo: "campos", campos: restantes, chips: [] });
  }

  const extras = listaLimpa(carro.extras);
  if (extras.length) {
    secoes.push({
      titulo: restantes.length ? "Extras" : "Mais",
      tipo: "chips",
      campos: [],
      chips: extras,
    });
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(carro.atualizado_em.trim());
  return { sobretitulo, nome, destaques, secoes, atualizadoEm: m ? m[0] : null };
}
