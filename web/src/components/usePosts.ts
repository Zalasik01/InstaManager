import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buscarPosts, TAMANHO_PAGINA } from "@/components/contrato";

/**
 * Posts paginados de /api/posts (12 por página). A mesma chave em qualquer ilha divide o cache,
 * então o contador do perfil e a grade usam uma só requisição.
 */
export function usePosts() {
  const consulta = useInfiniteQuery({
    queryKey: ["posts", TAMANHO_PAGINA],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => buscarPosts(pageParam, TAMANHO_PAGINA, signal),
    getNextPageParam: (ultima, todas) => {
      const carregados = todas.reduce((soma, p) => soma + p.posts.length, 0);
      return carregados < ultima.total && ultima.posts.length > 0 ? carregados : undefined;
    },
    staleTime: 5 * 60_000,
  });
  const posts = useMemo(() => consulta.data?.pages.flatMap((p) => p.posts) ?? [], [consulta.data]);
  const total = consulta.data?.pages.at(-1)?.total ?? null;
  return { consulta, posts, total };
}
