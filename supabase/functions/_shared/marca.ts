// Marca d'água opcional nas fotos de FEED (config 'marca_dagua' = 'on').
// Escreve "@polo_9n4_12" pequeno no canto inferior direito: branco, ~70% de opacidade, com sombra suave,
// altura proporcional à largura da foto (~3%). Não é usada em Story nem em vídeo.
// Fonte: Nunito Sans (SIL Open Font License 1.1, veja fontes/LICENSE-OFL.txt), embutida em base64.
// Usa imagescript (o mesmo de midia.ts): decodificar e reencodar custa CPU, então só roda com a opção ligada.

import { Image } from "npm:imagescript@4.0.1";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";
import { NUNITO_SANS_TTF_BASE64 } from "./fontes/nunito_sans.ts";

export const TEXTO_MARCA = "@polo_9n4_12";

let fonte: Uint8Array | null = null;

/** Devolve um novo JPEG com a marca d'água. Lança erro se não conseguir (quem chama usa a foto sem marca). */
export async function aplicarMarcaDagua(jpeg: Uint8Array): Promise<Uint8Array> {
  fonte ??= decodeBase64(NUNITO_SANS_TTF_BASE64);
  // A orientação do EXIF é aplicada na decodificação: o JPEG novo já sai "em pé".
  const img = await Image.decode(jpeg, { maxPixels: 50_000_000 });

  // Tamanho da letra: ~3% da largura (mínimo de 14 px para continuar legível em foto pequena).
  const tamanho = Math.max(14, Math.round(img.width * 0.03));
  const texto = await Image.renderText(TEXTO_MARCA, {
    font: fonte,
    size: tamanho,
    color: 0xffffffff,
    variations: { weight: 700 },
  });
  // Sombra preta suave, um pouco para baixo: mantém o texto legível sobre fundo claro.
  texto.dropShadow({
    x: 0,
    y: Math.max(1, Math.round(tamanho * 0.06)),
    blur: Math.max(1, tamanho * 0.12),
    color: 0x00000099,
  });

  const margem = Math.round(img.width * 0.025);
  img.composite(texto, {
    x: Math.max(0, img.width - texto.width - margem),
    y: Math.max(0, img.height - texto.height - margem),
    opacity: 0.7,
  });
  return await img.encodeJPEG({ quality: 90 });
}
