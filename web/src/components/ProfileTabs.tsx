import * as Tabs from "@radix-ui/react-tabs";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import CarTab from "@/components/CarTab";
import Feed from "@/components/Feed";
import LinksTab from "@/components/LinksTab";
import { obterQueryClient } from "@/lib/query";
import type { FichaMontada, ItemLink } from "@/types";

const ABAS = ["posts", "carro", "links"] as const;
type Aba = (typeof ABAS)[number];

function abaDoHash(): Aba {
  const h = window.location.hash.replace("#", "");
  return ABAS.find((a) => a === h) ?? "posts";
}

export interface ProfileTabsProps {
  ficha: FichaMontada;
  links: readonly ItemLink[];
  /** AAAA-MM-DD, "" quando o dono não preencheu. */
  linksAtualizadoEm?: string;
}

const gatilho =
  "text-muted data-[state=active]:text-fg data-[state=active]:border-accent flex-1 border-b-2 border-transparent py-3 text-sm font-bold";

/**
 * Ilha raiz do perfil: abas Posts / O carro / Links com Radix Tabs (setas, Home e End já
 * vêm prontos), sincronizadas com o hash #posts, #carro e #links. Dona do QueryClientProvider.
 */
export default function ProfileTabs({ ficha, links }: ProfileTabsProps) {
  // No servidor e na hidratação começa em "posts"; o hash real é lido logo após montar.
  const [aba, setAba] = useState<Aba>("posts");

  useEffect(() => {
    setAba(abaDoHash());
    const aoMudarHash = () => setAba(abaDoHash());
    window.addEventListener("hashchange", aoMudarHash);
    return () => window.removeEventListener("hashchange", aoMudarHash);
  }, []);

  function trocar(valor: string) {
    const nova = ABAS.find((a) => a === valor) ?? "posts";
    setAba(nova);
    // replaceState: trocar de aba não empilha histórico nem rola a página.
    window.history.replaceState(null, "", `#${nova}`);
  }

  return (
    <QueryClientProvider client={obterQueryClient()}>
      <Tabs.Root value={aba} onValueChange={trocar}>
        <Tabs.List aria-label="Seções do perfil" className="border-line flex border-b">
          <Tabs.Trigger value="posts" id="tab-posts" className={gatilho}>
            Posts
          </Tabs.Trigger>
          <Tabs.Trigger value="carro" id="tab-carro" className={gatilho}>
            O carro
          </Tabs.Trigger>
          <Tabs.Trigger value="links" id="tab-links" className={gatilho}>
            Links
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="posts" className="pt-4">
          <Feed />
        </Tabs.Content>
        <Tabs.Content value="carro" className="pt-4">
          <CarTab ficha={ficha} />
        </Tabs.Content>
        <Tabs.Content value="links" className="pt-4">
          <LinksTab itens={links} />
        </Tabs.Content>
      </Tabs.Root>
      <Toaster theme="dark" position="bottom-center" />
    </QueryClientProvider>
  );
}
