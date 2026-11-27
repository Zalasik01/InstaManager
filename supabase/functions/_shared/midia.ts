// Preparo de fotos para o feed do Instagram.
// - O feed recusa foto mais alta que 4:5 (0,8) ou mais larga que 1,91:1: recorta pelo centro até o limite mais próximo.
// - PNG e WebP (enviados como documento) viram JPEG, que é o único formato que o Instagram aceita por URL.
// - HEIC não é suportado pela biblioteca: quem chama deve pedir JPEG/PNG ao dono.
// Usa a biblioteca imagescript (TypeScript puro, sem WebAssembly). Decodificar custa CPU, e as Edge Functions têm
// limite de CPU: por isso, quando o JPEG já está dentro da proporção, só o cabeçalho é lido (sem decodificar).

import { Image } from "npm:imagescript@4.0.1";

/** Proporção mínima (largura / altura) aceita no feed: 4:5. */
export const PROPORCAO_MIN = 0.8;
/** Proporção máxima (largura / altura) aceita no feed: 1,91:1. */
export const PROPORCAO_MAX = 1.91;
/** Maior lado depois de reencodar: segura o uso de CPU com fotos grandes enviadas como documento. */
const LADO_MAXIMO = 2160;
/** O Instagram recusa JPEG acima de 8 MB. */
const TAMANHO_MAXIMO = 8 * 1024 * 1024;
/** Folga para não reencodar uma foto que já está no limite exato (ex.: 1080x1350). */
const FOLGA = 0.002;

export type FormatoImagem = "jpeg" | "png" | "webp" | "heic" | "desconhecido";

/** Descobre o formato pelos primeiros bytes (o mime_type do Telegram nem sempre é confiável). */
export function detectarFormato(b: Uint8Array): FormatoImagem {
  if (b.length < 12) return "desconhecido";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  const ascii = (ini: number, fim: number) => String.fromCharCode(...b.subarray(ini, fim));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  // HEIC/HEIF: caixa "ftyp" no byte 4, com marca heic/heix/mif1/msf1/hevc.
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(ascii(8, 12))) return "heic";
  return "desconhecido";
}

/**
 * Lê largura e altura de um JPEG pelo cabeçalho (marcador SOF), já considerando a orientação do EXIF
 * (foto de celular "deitada" no arquivo). Devolve null se não conseguir ler.
 */
function dimensoesJpeg(b: Uint8Array): { w: number; h: number } | null {
  let orientacao = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // bytes de preenchimento
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // marcadores sem tamanho
    if (m === 0xda || m === 0xd9) return null; // começou a imagem e não achou o SOF
    const tam = (b[i + 2] << 8) | b[i + 3];
    if (tam < 2) return null;
    // APP1 com EXIF: procura a tag de orientação (0x0112) no primeiro diretório.
    if (m === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === "Exif") {
      const o = lerOrientacao(b, i + 10, i + 2 + tam);
      if (o) orientacao = o;
    }
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (b[i + 5] << 8) | b[i + 6];
      const w = (b[i + 7] << 8) | b[i + 8];
      if (!w || !h) return null;
      // Orientações 5 a 8 giram 90°: largura e altura trocam.
      return orientacao >= 5 && orientacao <= 8 ? { w: h, h: w } : { w, h };
    }
    i += 2 + tam;
  }
  return null;
}

/** Lê a orientação no bloco TIFF do EXIF (que começa em `ini`). Devolve 0 se não achar. */
function lerOrientacao(b: Uint8Array, ini: number, fim: number): number {
  if (ini + 8 > fim || fim > b.length) return 0;
  const le = b[ini] === 0x49; // "II" = little-endian; "MM" = big-endian
  const u16 = (p: number) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  const u32 = (p: number) =>
    le
      ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
      : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const ifd = ini + u32(ini + 4);
  if (ifd + 2 > fim) return 0;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > fim) return 0;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 0;
}

/** Texto amigável da proporção: "3:4", "9:16", "1,91:1" ou o número com vírgula. */
export function formatarProporcao(w: number, h: number): string {
  const r = w / h;
  const conhecidas: Array<[string, number]> = [
    ["1:1", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["2:3", 2 / 3], ["9:16", 9 / 16], ["1:2", 1 / 2],
    ["5:4", 5 / 4], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:9", 16 / 9], ["1,91:1", 1.91], ["2:1", 2], ["21:9", 21 / 9],
  ];
  for (const [nome, valor] of conhecidas) if (Math.abs(r - valor) / valor < 0.01) return nome;
  return `${r.toFixed(2).replace(".", ",")}:1`;
}

export type ResultadoAjuste = {
  /** JPEG pronto para o feed (o original, se nada precisou mudar). */
  bytes: Uint8Array;
  /** true se a proporção foi corrigida (recorte). */
  mudou: boolean;
  /** Proporção original, ex.: "9:16". */
  de: string;
  /** Proporção final, ex.: "4:5". */
  para: string;
  /** true se o arquivo foi reencodado (conversão de PNG/WebP, redução de tamanho ou recorte). */
  reencodado: boolean;
};

/**
 * Deixa a foto pronta para o feed: corrige a proporção (recorte central até 4:5 ou 1,91:1), converte PNG/WebP
 * em JPEG e reduz fotos grandes (maior lado até 2160 px) quando precisa reencodar.
 * JPEG já dentro da proporção e abaixo de 8 MB volta intacto, sem decodificar.
 * Lança erro para HEIC e formatos desconhecidos (a mensagem já serve para o dono).
 */
export async function ajustarProporcao(entrada: Uint8Array): Promise<ResultadoAjuste> {
  const formato = detectarFormato(entrada);
  if (formato === "heic") throw new Error("Foto em HEIC não é suportada. Envie como foto normal, ou o arquivo em JPEG ou PNG.");
  if (formato === "desconhecido") throw new Error("Formato de imagem não suportado. Envie JPEG, PNG ou WebP.");

  // Caminho rápido: JPEG dentro da proporção e do tamanho volta sem decodificar.
  if (formato === "jpeg" && entrada.length <= TAMANHO_MAXIMO) {
    const d = dimensoesJpeg(entrada);
    if (d) {
      const r = d.w / d.h;
      if (r >= PROPORCAO_MIN - FOLGA && r <= PROPORCAO_MAX + FOLGA) {
        const p = formatarProporcao(d.w, d.h);
        return { bytes: entrada, mudou: false, de: p, para: p, reencodado: false };
      }
    }
  }

  // Daqui em diante vai reencodar. A orientação do EXIF é aplicada na decodificação (padrão da biblioteca).
  const img = await Image.decode(entrada, { maxPixels: 50_000_000 });
  const de = formatarProporcao(img.width, img.height);

  // Reduz antes de recortar: menos pixels para recortar e para codificar.
  const maior = Math.max(img.width, img.height);
  if (maior > LADO_MAXIMO) {
    if (img.width >= img.height) img.resize({ width: LADO_MAXIMO });
    else img.resize({ height: LADO_MAXIMO });
  }

  let mudou = false;
  const r = img.width / img.height;
  if (r < PROPORCAO_MIN - FOLGA) {
    // Alta demais: corta em cima e embaixo, por igual. floor garante largura/altura >= 0,8.
    const h = Math.floor(img.width / PROPORCAO_MIN);
    img.crop(0, Math.floor((img.height - h) / 2), img.width, h);
    mudou = true;
  } else if (r > PROPORCAO_MAX + FOLGA) {
    // Larga demais: corta nas laterais, por igual. floor garante largura/altura <= 1,91.
    const w = Math.floor(img.height * PROPORCAO_MAX);
    img.crop(Math.floor((img.width - w) / 2), 0, w, img.height);
    mudou = true;
  }

  // Fundo branco para PNG/WebP com transparência (JPEG não tem canal alfa; o padrão seria preto).
  const bytes = await img.encodeJPEG({ quality: 90, background: 0xffffffff });
  return { bytes, mudou, de, para: formatarProporcao(img.width, img.height), reencodado: true };
}
