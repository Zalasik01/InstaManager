import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { buscarPerfil, buscarPosts } from "@/lib/api";
import { formatarNumero } from "@/lib/format";
import { obterQueryClient } from "@/lib/query";

function Numeros() {
  const posts = useQuery({
    queryKey: ["posts-total"],
    queryFn: ({ signal }) => buscarPosts(0, 1, signal),
    select: (r) => r.total,
  });
  const perfil = useQuery({
    queryKey: ["perfil"],
    queryFn: ({ signal }) => buscarPerfil(signal),
    staleTime: 300_000,
  });
  const seguidores = perfil.data?.seguidores ?? null;

  return (
    <>
      <li className="flex flex-col">
        <b className="text-base">{posts.data === undefined ? "–" : formatarNumero(posts.data)}</b>
        <span className="text-muted">posts</span>
      </li>
      {/* Sem o número (ainda não coletado ou erro): o item some em vez de mostrar "–". */}
      {seguidores !== null ? (
        <li className="flex flex-col">
          <b className="text-base">{formatarNumero(seguidores)}</b>
          <span className="text-muted">seguidores</span>
        </li>
      ) : null}
    </>
  );
}

/** Itens "posts" e "seguidores" do cabeçalho do perfil (ilha raiz própria; renderize dentro de <ul>). */
export default function ProfileStats() {
  return (
    <QueryClientProvider client={obterQueryClient()}>
      <Numeros />
    </QueryClientProvider>
  );
}
