import { QueryClient } from "@tanstack/react-query";

let cliente: QueryClient | undefined;

/**
 * QueryClient único da página. Cada ilha raiz monta o seu <QueryClientProvider>, mas todas
 * apontam para este cliente, então o cache de /api/posts é compartilhado entre elas.
 * No servidor (prerender) devolve um cliente novo a cada chamada, para não vazar estado.
 */
export function obterQueryClient(): QueryClient {
  const opcoes = {
    defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
  };
  if (typeof window === "undefined") return new QueryClient(opcoes);
  cliente ??= new QueryClient(opcoes);
  return cliente;
}
