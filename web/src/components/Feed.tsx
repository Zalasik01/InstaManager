import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { buscarPosts, TAMANHO_PAGINA } from "@/lib/api";
import { GradeSkeleton } from "@/components/Skeleton";
import PostTile from "@/components/PostTile";
import PostViewer from "@/components/PostViewer";

/**
 * Grade de 3 colunas com "Carregar mais" (useInfiniteQuery em /api/posts).
 * Deve ficar dentro de um <QueryClientProvider> (o da ilha raiz ProfileTabs).
 */
export default function Feed() {
  const consulta = useInfiniteQuery({
    queryKey: ["posts", TAMANHO_PAGINA],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => buscarPosts(pageParam, TAMANHO_PAGINA, signal),
    getNextPageParam: (ultima, todas) => {
      const carregados = todas.reduce((soma, p) => soma + p.posts.length, 0);
      return carregados < ultima.total && ultima.posts.length > 0 ? carregados : undefined;
    },
  });
  const [aberto, setAberto] = useState<number | null>(null);

  const posts = useMemo(() => consulta.data?.pages.flatMap((p) => p.posts) ?? [], [consulta.data]);

  if (consulta.isPending) return <GradeSkeleton />;

  if (consulta.isError) {
    return (
      <div role="alert" className="text-muted py-10 text-center">
        <p>Não consegui carregar os posts agora.</p>
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          className="bg-accent text-accent-fg mt-4 rounded-lg px-4 py-2 font-bold"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return <p className="text-muted py-10 text-center">Ainda não há posts por aqui.</p>;
  }

  return (
    <>
      <ul className="grid grid-cols-3 gap-1">
        {posts.map((post, i) => (
          <PostTile key={post.id} post={post} indice={i} onAbrir={setAberto} />
        ))}
      </ul>

      {consulta.hasNextPage ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={consulta.isFetchingNextPage}
            onClick={() =>
              void consulta
                .fetchNextPage()
                .then((r) => r.isError && toast.error("Não consegui carregar mais posts."))
            }
            className="border-line bg-surface rounded-lg border px-5 py-2 font-bold disabled:opacity-60"
          >
            {consulta.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      ) : null}

      <PostViewer posts={posts} indice={aberto} onMudarIndice={setAberto} />
    </>
  );
}
