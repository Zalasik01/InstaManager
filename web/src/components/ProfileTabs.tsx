import * as Tabs from "@radix-ui/react-tabs";
import { QueryClientProvider } from "@tanstack/react-query";
import { motion, MotionConfig, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import CarTab from "@/components/CarTab";
import Feed from "@/components/Feed";
import LinksTab from "@/components/LinksTab";
import { obterQueryClient } from "@/lib/query";
import type { FichaMontada, ItemLink } from "@/types";

const ABAS = ["posts", "carro", "links"] as const;
type Aba = (typeof ABAS)[number];
const ROTULOS: Record<Aba, string> = { posts: "Posts", carro: "O carro", links: "Links" };

function abaDoHash(): Aba {
  const h = window.location.hash.replace("#", "");
  return ABAS.find((a) => a === h) ?? "posts";
}

export interface ProfileTabsProps {
  ficha: FichaMontada;
  links: readonly ItemLink[];
}

/**
 * Ilha raiz do perfil: abas Posts / O carro / Links com Radix Tabs (setas, Home e End já vêm
 * prontos), sincronizadas com o hash #carro e #links. Dona do QueryClientProvider e do Toaster.
 */
export default function ProfileTabs({ ficha, links }: ProfileTabsProps) {
  // No servidor e na hidratação começa em "posts"; o hash real é lido logo após montar.
  const [aba, setAba] = useState<Aba>("posts");
  const [direcao, setDirecao] = useState(0);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inicial = abaDoHash();
    setAba(inicial);
    if (window.location.hash === "#posts") lista.current?.scrollIntoView();
    const aoMudarHash = () => {
      if (/^#(posts|carro|links)$/.test(window.location.hash)) setAba(abaDoHash());
    };
    window.addEventListener("hashchange", aoMudarHash);
    return () => window.removeEventListener("hashchange", aoMudarHash);
  }, []);

  function trocar(valor: string) {
    const nova = ABAS.find((a) => a === valor) ?? "posts";
    setDirecao(Math.sign(ABAS.indexOf(nova) - ABAS.indexOf(aba)));
    setAba(nova);
    // replaceState: trocar de aba não empilha histórico nem rola a página.
    const url =
      nova === "posts" ? window.location.pathname + window.location.search : `#${nova}`;
    window.history.replaceState(null, "", url);
  }

  return (
    <QueryClientProvider client={obterQueryClient()}>
      <MotionConfig reducedMotion="user">
        <Tabs.Root value={aba} onValueChange={trocar}>
          <Tabs.List ref={lista} aria-label="Seções do perfil" className="tabs">
            {ABAS.map((v) => (
              <Tabs.Trigger key={v} value={v} id={`tab-${v}`} asChild>
                <motion.button type="button" whileTap={{ scale: 0.96 }}>
                  {aba === v ? (
                    <motion.span
                      layoutId="aba-ativa"
                      className="tab-ind"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  ) : null}
                  {ROTULOS[v]}
                </motion.button>
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* A grade fica montada ao trocar de aba: volta na mesma posição, sem recarregar. */}
          <Tabs.Content value="posts" forceMount hidden={aba !== "posts"} className="panel">
            <Painel ativo={aba === "posts"} direcao={direcao} animarAoMontar={false}>
              <Feed />
            </Painel>
          </Tabs.Content>
          <Tabs.Content value="carro" className="panel">
            <Painel ativo direcao={direcao}>
              <CarTab ficha={ficha} />
            </Painel>
          </Tabs.Content>
          <Tabs.Content value="links" className="panel">
            <Painel ativo direcao={direcao}>
              <LinksTab itens={links} />
            </Painel>
          </Tabs.Content>
        </Tabs.Root>
        <Toaster
          theme="dark"
          position="bottom-center"
          offset={{ bottom: "5rem" }}
          mobileOffset={{ bottom: "5rem" }}
          toastOptions={{
            style: {
              background: "var(--fg)",
              color: "var(--bg)",
              border: 0,
              borderRadius: "999px",
              fontFamily: "inherit",
              fontWeight: 700,
              justifyContent: "center",
            },
          }}
        />
      </MotionConfig>
    </QueryClientProvider>
  );
}

interface PainelProps {
  ativo: boolean;
  direcao: number;
  /** false na aba que já vem na página (posts): não anima na primeira pintura. */
  animarAoMontar?: boolean;
  children: ReactNode;
}

/** Entrada curta do painel ao trocar de aba (fade + deslize vindo do lado da aba escolhida). */
function Painel({ ativo, direcao, animarAoMontar = true, children }: PainelProps) {
  const reduz = useReducedMotion();
  const [escopo, animar] = useAnimate<HTMLDivElement>();
  const primeira = useRef(true);

  useEffect(() => {
    if (!ativo) return;
    const pular = primeira.current && !animarAoMontar;
    primeira.current = false;
    if (pular || reduz || !escopo.current) return;
    void animar(
      escopo.current,
      { opacity: [0, 1], x: [direcao * 18, 0] },
      { duration: 0.24, ease: [0.2, 0.7, 0.2, 1] },
    );
    // Só reage à ativação; a direção é lida no momento da troca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo]);

  return <div ref={escopo}>{children}</div>;
}
