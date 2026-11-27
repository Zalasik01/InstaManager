import { Bell, BellOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from "@/lib/push";

/**
 * Botão discreto "Avisar novos posts" / "Desativar avisos" abaixo da bio. A permissão só é pedida
 * no clique. No iPhone sem o app instalado não há Web Push: o botão mostra como instalar.
 */
export default function PushButton() {
  const [estado, setEstado] = useState<EstadoPush>("indisponivel");
  const [ocupado, setOcupado] = useState(false);
  const [dica, setDica] = useState(false);

  useEffect(() => {
    let vivo = true;
    estadoPush()
      .then((e) => vivo && setEstado(e))
      .catch(() => {
        /* sem service worker: fica escondido */
      });
    return () => {
      vivo = false;
    };
  }, []);

  // Sem suporte ou com as notificações negadas: nada aparece (a pessoa já decidiu, não insiste).
  if (estado === "indisponivel" || estado === "bloqueado") return null;

  const ativo = estado === "ativo";
  const precisaInstalar = estado === "precisa-instalar";

  async function alternar() {
    if (precisaInstalar) {
      setDica((d) => !d);
      return;
    }
    setOcupado(true);
    try {
      if (ativo) {
        setEstado(await desativarPush());
        toast("Avisos desativados");
      } else {
        const e = await ativarPush();
        setEstado(e);
        if (e === "ativo") toast("Pronto: você será avisado de posts novos");
      }
    } catch {
      toast("Não deu para ativar os avisos agora");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="push">
      <motion.button
        whileTap={{ scale: 0.96 }}
        type="button"
        className="push-btn"
        aria-pressed={precisaInstalar ? undefined : ativo}
        aria-expanded={precisaInstalar ? dica : undefined}
        disabled={ocupado}
        onClick={() => void alternar()}
      >
        {ativo ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
        <span>{ativo ? "Desativar avisos" : "Avisar novos posts"}</span>
      </motion.button>
      <AnimatePresence initial={false}>
        {dica ? (
          <motion.p
            className="push-dica"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            No iPhone, os avisos só funcionam com o app instalado: toque em Compartilhar e depois em
            Adicionar à Tela de Início.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
