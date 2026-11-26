/** Formatação pt-BR: números compactos e datas. Funções puras, testadas em test/format.test.ts. */

const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR");

/** 1234 -> "1,2 mil"; 999 -> "999"; null/NaN -> "–". */
export function formatarNumero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return Math.abs(n) < 1000 ? inteiro.format(n) : compacto.format(n);
}

/** Número completo com separador de milhar: 12345 -> "12.345". */
export function formatarInteiro(n: number): string {
  return inteiro.format(n);
}

function paraData(entrada: string | Date): Date | null {
  if (entrada instanceof Date) return Number.isNaN(entrada.getTime()) ? null : entrada;
  // "AAAA-MM-DD" puro vira data LOCAL (new Date("2026-11-26") seria UTC e recuaria um dia no Brasil).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entrada.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(entrada);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "26 de novembro de 2026". Entrada inválida vira "". */
export function formatarData(entrada: string | Date): string {
  const d = paraData(entrada);
  return d ? d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }) : "";
}

/** "26/11/2026". Entrada inválida vira "". */
export function formatarDataCurta(entrada: string | Date): string {
  const d = paraData(entrada);
  return d ? d.toLocaleDateString("pt-BR") : "";
}

/** Valor para o atributo datetime de <time> (AAAA-MM-DD) ou null. */
export function dataIso(entrada: string | Date): string | null {
  const d = paraData(entrada);
  if (!d) return null;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
