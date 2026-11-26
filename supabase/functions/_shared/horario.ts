// Interpretação de horários digitados pelo dono (fuso fixo America/Sao_Paulo = UTC-3, sem horário de verão).
// Funções puras: recebem "agora" por parâmetro, então são fáceis de testar.

const DESLOCAMENTO_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Monta um instante UTC a partir de data/hora no relógio de Brasília. Devolve null se a data não existe (ex.: 31/02). */
function montar(ano: number, mes: number, dia: number, hora: number, minuto: number): Date | null {
  if (hora > 23 || minuto > 59 || mes < 1 || mes > 12 || dia < 1) return null;
  const utc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const conferido = new Date(utc);
  // Se o dia "transbordou" para outro mês, a data era inválida.
  if (conferido.getUTCMonth() !== mes - 1 || conferido.getUTCDate() !== dia) return null;
  return new Date(utc + DESLOCAMENTO_MS);
}

/**
 * Lê um horário em texto livre e devolve o instante (Date em UTC), ou null se não entendeu.
 * Não valida se está no passado: quem chama decide.
 *
 * Formatos aceitos (maiúsculas e acentos tanto faz):
 *   "hoje 21h", "hoje 21:30", "amanhã 18:30", "amanha 18h30", "depois de amanhã 9h"
 *   "25/12 10:00", "25/12/2026 10h", "25/12 às 10h"
 *   "19:30" ou "19h" sozinho = hoje nesse horário
 *
 * Casos de teste (agora = 2026-11-25 15:00 BRT):
 *   "hoje 21h"        -> 2026-11-25 21:00 BRT
 *   "amanhã 18:30"    -> 2026-11-26 18:30 BRT
 *   "25/12 10:00"     -> 2026-12-25 10:00 BRT
 *   "10/01 8h"        -> 2027-01-10 08:00 BRT (data já passou neste ano: vai para o próximo)
 *   "31/02 10h"       -> null (data inexistente)
 *   "amanhã 25h"      -> null
 *   "banana"          -> null
 */
export function interpretarHorario(texto: string, agora: Date = new Date()): Date | null {
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acentos
    .replace(/\s+/g, " ")
    .trim();

  // "agora" no relógio de Brasília, lido com os getters UTC.
  const br = new Date(agora.getTime() - DESLOCAMENTO_MS);
  const anoHoje = br.getUTCFullYear();
  const mesHoje = br.getUTCMonth() + 1;
  const diaHoje = br.getUTCDate();

  // Hora: "21h", "21h30", "21:30", "21".
  const mHora = t.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/);
  if (!mHora) return null;
  const hora = Number(mHora[1]);
  const minuto = mHora[2] ? Number(mHora[2]) : 0;

  // Parte da data = o que sobra antes da hora.
  const antes = t.slice(0, mHora.index).replace(/\bas\b/g, "").trim();

  // Dia relativo.
  if (antes === "" || antes === "hoje") {
    return montar(anoHoje, mesHoje, diaHoje, hora, minuto);
  }
  if (antes === "amanha" || antes === "depois de amanha") {
    const dias = antes === "amanha" ? 1 : 2;
    const alvo = new Date(Date.UTC(anoHoje, mesHoje - 1, diaHoje + dias));
    return montar(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, alvo.getUTCDate(), hora, minuto);
  }

  // Data absoluta: dd/mm ou dd/mm/aaaa (também aceita "-" e ".").
  const mData = antes.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2}|\d{4}))?$/);
  if (mData) {
    const dia = Number(mData[1]);
    const mes = Number(mData[2]);
    if (mData[3]) {
      const ano = mData[3].length === 2 ? 2000 + Number(mData[3]) : Number(mData[3]);
      return montar(ano, mes, dia, hora, minuto);
    }
    // Sem ano: usa o ano atual; se o DIA já passou, vai para o ano que vem.
    const nesteAno = montar(anoHoje, mes, dia, hora, minuto);
    const passouDia = mes < mesHoje || (mes === mesHoje && dia < diaHoje);
    return passouDia ? montar(anoHoje + 1, mes, dia, hora, minuto) : nesteAno;
  }

  return null;
}

/** Formata um instante em pt-BR no fuso de Brasília. Ex.: "qui, 26/11 às 19:00". */
export function formatarHorario(data: Date): string {
  const br = new Date(data.getTime() - DESLOCAMENTO_MS);
  const dia = `${doisDigitos(br.getUTCDate())}/${doisDigitos(br.getUTCMonth() + 1)}`;
  const hora = `${doisDigitos(br.getUTCHours())}:${doisDigitos(br.getUTCMinutes())}`;
  return `${DIAS_SEMANA[br.getUTCDay()]}, ${dia} às ${hora}`;
}

/** Instante de "hoje/amanhã às H:00" no relógio de Brasília (dias = 0 hoje, 1 amanhã). */
export function horaPronta(agora: Date, dias: number, hora: number): Date {
  const br = new Date(agora.getTime() - DESLOCAMENTO_MS);
  const ms = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + dias, hora, 0);
  return new Date(ms + DESLOCAMENTO_MS);
}
