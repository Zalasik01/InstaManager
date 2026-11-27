/** Tipos compartilhados entre a API, as ilhas React e os utilitários. */

/** Post público já pronto para o navegador (resposta de /api/posts). */
export interface Post {
  id: string;
  legenda: string;
  publicado_em: string;
  permalink: string | null;
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  /** Vídeo/Reel: URL do MP4 direto no Supabase Storage (Range/206); null para foto. */
  video: string | null;
  /** Imagens pelo próprio domínio, no formato "/m/AAAA/MM/arquivo.jpg" (rota com cache de borda). */
  imagens: string[];
  /** Post fixado no topo do perfil (os fixados vêm primeiro na lista). */
  fixado: boolean;
}

export interface PostsResposta {
  total: number;
  posts: Post[];
}

/** Conteúdo de src/content/carro/carro.json (campo vazio significa "não mostrar"). */
export interface DadosCarro {
  atualizado_em: string;
  desde: string;
  fotos: string;
  ficha: Record<string, string>;
  modificacoes: string[];
  extras: string[];
}

export interface ItemLink {
  titulo: string;
  url: string;
  categoria: string;
  loja: string;
  descricao: string;
  preco: string;
  data: string;
}

export interface DadosLinks {
  atualizado_em: string;
  itens: ItemLink[];
}

/** Resultado de montarFicha: o que a aba "O carro" desenha. */
export interface CampoFicha {
  chave: string;
  rotulo: string;
  valor: string;
}

export interface SecaoFicha {
  titulo: string;
  tipo: "campos" | "chips";
  campos: CampoFicha[];
  chips: string[];
}

export interface FichaMontada {
  /** Linha pequena acima do nome, ex.: "Volkswagen · 2012 · 9n4". */
  sobretitulo: string;
  /** Nome do modelo sem a marca, ex.: "Polo". */
  nome: string;
  destaques: CampoFicha[];
  secoes: SecaoFicha[];
  /** Data de atualização (AAAA-MM-DD) ou null. */
  atualizadoEm: string | null;
}

/** Resposta de /api/perfil (números públicos do Instagram; null quando ainda não coletados). */
export interface Perfil {
  seguidores: number | null;
  seguindo: number | null;
  posts: number | null;
  atualizado_em: string | null;
}

/** Nome antigo de Perfil, mantido para o código que já o usa. */
export type PerfilPublico = Perfil;

/** Comentário do Instagram de um post (resposta de /api/comentarios). */
export interface Comentario {
  usuario: string;
  texto: string;
  curtidas: number | null;
  criado_em: string;
}

export interface ComentariosResposta {
  comentarios: Comentario[];
}

/** Clique num link da aba "Links" (POST /api/clique). */
export interface Clique {
  linkId: string;
  url: string;
  titulo: string;
}
