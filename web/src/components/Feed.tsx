import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TAMANHO_PAGINA } from "@/components/contrato";
import PostTile from "@/components/PostTile";
import PostViewer from "@/components/PostViewer";
import { EsqueletosGrade } from "@/components/Skeleton";
import { usePosts } from "@/components/usePosts";
import { compartilharPost, navegandoPorTeclado } from "@/components/util";
import ZoomViewer from "@/components/ZoomViewer";
import { SITE } from "@/site";

/** Margem do scroll infinito: a próxima página é pedida quando o fim da grade chega a ~900px da tela. */
const MARGEM_SCROLL = "0px 0px 900px 0px";
/** Quantas páginas um link #post=<id> pode carregar procurando o post. */
const PAGINAS_DEEP_LINK = 5;

function idDoHash(): string | null {
  const m = /^#post=(.+)$/.exec(window.location.hash);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Grade de 3 colunas com scroll infinito, visualizador do post e imagem expandida.
 * Deve ficar dentro de um <QueryClientProvider> (o da ilha raiz ProfileTabs).
 */
export default function Feed() {
  const { consulta, posts, total } = usePosts();
  const [aberto, setAberto] = useState<number | null>(null);
  const [direcao, setDirecao] = useState(0);
  const [imgIdx, setImgIdx] = useState(0);
  const [zoom, setZoom] = useState<{ indice: number; img: number } | null>(null);
  const origem = useRef<HTMLButtonElement | null>(null);
  const sentinela = useRef<HTMLDivElement>(null);
  const [falhouPaginar, setFalhouPaginar] = useState(false);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = consulta;

  // Pede a próxima página; em erro para de pedir sozinho (só o "Tentar de novo" tenta outra vez).
  const carregarMais = useCallback(async () => {
    const r = await fetchNextPage({ cancelRefetch: false });
    if (r.isError) setFalhouPaginar(true);
    return r;
  }, [fetchNextPage]);

  /* ---------- scroll infinito ---------- */
  useEffect(() => {
    const s = sentinela.current;
    if (!s || !hasNextPage || isFetchingNextPage || falhouPaginar) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) void carregarMais();
      },
      { rootMargin: MARGEM_SCROLL },
    );
    // Reobservar depois de cada página: se a tela ainda tem espaço, já pede a próxima.
    io.observe(s);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, falhouPaginar, carregarMais, posts.length]);

  // Trava a rolagem da página enquanto o visualizador ou o zoom estiverem abertos.
  const travar = aberto !== null || zoom !== null;
  useEffect(() => {
    document.documentElement.classList.toggle("travado", travar);
    return () => document.documentElement.classList.remove("travado");
  }, [travar]);

  /* ---------- visualizador ---------- */
  const abrir = useCallback((i: number, el: HTMLButtonElement | null) => {
    origem.current = el;
    setDirecao(0);
    setImgIdx(0);
    setAberto(i);
  }, []);

  const fechar = useCallback(() => {
    setAberto(null);
    if (/^#post=/.test(window.location.hash)) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // Só quem navega por teclado recebe o foco de volta no card; com mouse/toque nada fica "selecionado".
  const devolverFoco = useCallback(() => {
    const el = origem.current;
    if (navegandoPorTeclado() && el && document.contains(el)) el.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  const irPost = useCallback(
    (delta: number) => {
      if (aberto === null) return;
      const alvo = aberto + delta;
      if (alvo < 0) return;
      if (alvo < posts.length) {
        setDirecao(delta);
        setImgIdx(0);
        setAberto(alvo);
        return;
      }
      if (!hasNextPage) return;
      void carregarMais().then((r) => {
        const n = r.data?.pages.reduce((s, p) => s + p.posts.length, 0) ?? 0;
        if (alvo < n) {
          setDirecao(delta);
          setImgIdx(0);
          setAberto(alvo);
        }
      });
    },
    [aberto, posts.length, hasNextPage, carregarMais],
  );

  /* ---------- link direto #post=<id> ---------- */
  const tentativas = useRef(0);
  const [procurando, setProcurando] = useState<string | null>(null);

  useEffect(() => {
    const ler = () => {
      const id = idDoHash();
      if (id) {
        tentativas.current = 0;
        setProcurando(id);
      }
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  useEffect(() => {
    if (!procurando || consulta.isPending || isFetchingNextPage) return;
    const i = posts.findIndex((p) => String(p.id) === procurando);
    if (i >= 0) {
      setProcurando(null);
      abrir(i, null);
      return;
    }
    if (consulta.isError || !hasNextPage || tentativas.current >= PAGINAS_DEEP_LINK) {
      setProcurando(null);
      if (!consulta.isError) toast("Post não encontrado");
      return;
    }
    tentativas.current += 1;
    void carregarMais();
  }, [procurando, posts, consulta.isPending, consulta.isError, isFetchingNextPage, hasNextPage, carregarMais, abrir]);

  /* ---------- ações dos cards ---------- */
  const expandirDoCard = useCallback((i: number) => setZoom({ indice: i, img: 0 }), []);
  const compartilharDoCard = useCallback(
    (i: number) => {
      const p = posts[i];
      if (p) void compartilharPost(p, 0);
    },
    [posts],
  );

  /* ---------- estados ---------- */
  if (consulta.isPending) {
    return (
      <div role="status" aria-label="Carregando posts">
        <ul className="grid-posts">
          <EsqueletosGrade quantidade={9} />
        </ul>
      </div>
    );
  }

  if (consulta.isError && posts.length === 0) {
    return (
      <div className="status" role="alert">
        <strong>Falha ao carregar os posts</strong>
        Não deu para carregar agora ({consulta.error.message || "erro desconhecido"}). Confira sua
        conexão ou veja os posts direto no <a href={SITE.instagram} rel="noopener noreferrer">Instagram</a>.
        <br />
        <button type="button" onClick={() => void consulta.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="status" role="status">
        <strong>Nada por aqui ainda</strong>
        Os posts aparecem aqui assim que forem publicados no Instagram.
      </div>
    );
  }

  const postZoom = zoom ? (posts[zoom.indice] ?? null) : null;

  return (
    <>
      <ul className="grid-posts">
        {posts.map((post, i) => (
          <PostTile
            key={post.id}
            post={post}
            indice={i}
            atraso={(i % TAMANHO_PAGINA) * 0.035}
            onAbrir={abrir}
            onExpandir={expandirDoCard}
            onCompartilhar={compartilharDoCard}
          />
        ))}
        {isFetchingNextPage ? <EsqueletosGrade quantidade={6} /> : null}
      </ul>

      {falhouPaginar ? (
        <div className="status" role="alert">
          <strong>Falha ao carregar os posts</strong>
          Não deu para carregar mais agora. Confira sua conexão.
          <br />
          <button
            type="button"
            onClick={() => {
              setFalhouPaginar(false);
              void carregarMais();
            }}
          >
            Tentar de novo
          </button>
        </div>
      ) : null}

      <div ref={sentinela} className="sentinela" aria-hidden="true" />

      <PostViewer
        posts={posts}
        total={total ?? posts.length}
        indice={aberto}
        direcao={direcao}
        imgIdx={imgIdx}
        onImgIdx={setImgIdx}
        onPost={irPost}
        onFechar={fechar}
        onDevolverFoco={devolverFoco}
        onExpandir={() => aberto !== null && setZoom({ indice: aberto, img: imgIdx })}
        zoomAberto={zoom !== null}
      />

      <ZoomViewer
        post={postZoom}
        indice={zoom?.img ?? 0}
        onIndice={(i) => {
          setZoom((z) => (z ? { ...z, img: i } : z));
          // Com o visualizador aberto por baixo, o carrossel acompanha a imagem do zoom.
          if (aberto !== null && zoom?.indice === aberto) setImgIdx(i);
        }}
        onFechar={() => setZoom(null)}
      />
    </>
  );
}
