/**
 * Ponte entre a interface e os contratos da API (src/lib/api.ts, src/types.ts).
 * Os componentes importam daqui, para o formato dos dados ficar num só lugar.
 */
export type { Clique as CliqueLink, Comentario, Post } from "@/types";
export {
  buscarComentarios,
  buscarPerfil,
  buscarPosts,
  registrarClique,
  TAMANHO_PAGINA,
} from "@/lib/api";
