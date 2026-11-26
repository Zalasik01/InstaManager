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
  /** URLs absolutas das imagens (Supabase Storage, bucket "galeria"). */
  imagens: string[];
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
export interface PerfilPublico {
  seguidores: number | null;
  seguindo: number | null;
  posts: number | null;
  atualizado_em: string | null;
}
