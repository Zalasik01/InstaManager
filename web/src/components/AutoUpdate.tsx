import { useEffect } from "react";
import { iniciarAtualizacaoAutomatica } from "@/lib/atualizacao";

/**
 * Sem interface: registra o service worker e mantém o site sempre na versão publicada.
 * Não há botão nem aviso; a página recarrega sozinha quando sai versão nova.
 */
export default function AutoUpdate() {
  useEffect(() => {
    iniciarAtualizacaoAutomatica();
  }, []);
  return null;
}
