import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { buscarPerfil } from "@/components/contrato";
import { IconeCompartilhar } from "@/components/icones";
import PushButton from "@/components/PushButton";
import { usePosts } from "@/components/usePosts";
import { compartilharPerfil } from "@/components/util";
import { formatarNumero, numeroValido } from "@/lib/format";
import { obterQueryClient } from "@/lib/query";
import { SITE } from "@/site";

export interface ProfileHeaderProps {
  /** "fotos do carro" e "desde" de src/content/carro ("" esconde o contador). */
  fotos: string;
  desde: string;
}

/**
 * Cabeçalho do perfil: avatar com anel âmbar, @, "Seguir no Instagram" e "Compartilhar" na mesma
 * linha, contadores (contam até o número na primeira vez), bio e o botão de avisos.
 */
export default function ProfileHeader(props: ProfileHeaderProps) {
  return (
    <QueryClientProvider client={obterQueryClient()}>
      <MotionConfig reducedMotion="user">
        <Cabecalho {...props} />
      </MotionConfig>
    </QueryClientProvider>
  );
}

function Cabecalho({ fotos, desde }: ProfileHeaderProps) {
  const { total } = usePosts();
  const perfil = useQuery({
    queryKey: ["perfil"],
    queryFn: ({ signal }) => buscarPerfil(signal),
    staleTime: 5 * 60_000,
  });
  const seguidores = numeroValido(perfil.data?.seguidores);
  const toque = { scale: 0.97 };

  return (
    <section className="profile" aria-label="Perfil">
      <img
        className="avatar"
        src="/img/icon-192.png"
        width={192}
        height={192}
        alt={`Foto de perfil de @${SITE.perfil}: VW Polo branco visto de trás`}
        fetchPriority="high"
        decoding="async"
      />
      <div className="profile-main">
        <h1 className="handle">@{SITE.perfil}</h1>
        <div className="actions">
          <motion.a whileTap={toque} className="follow" href={SITE.instagram} rel="noopener noreferrer">
            Seguir no Instagram
          </motion.a>
          <motion.button
            whileTap={toque}
            type="button"
            className="share"
            onClick={() => void compartilharPerfil()}
          >
            <IconeCompartilhar />
            Compartilhar
          </motion.button>
        </div>
      </div>
      <ul className="stats">
        <li>
          <Contador valor={total} />
          <span>posts</span>
        </li>
        {seguidores != null ? (
          <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <Contador valor={seguidores} />
            <span>seguidores</span>
          </motion.li>
        ) : null}
        {fotos ? (
          <li>
            <b>{fotos}</b>
            <span>fotos do carro</span>
          </li>
        ) : null}
        {desde ? (
          <li>
            <b>{desde}</b>
            <span>desde</span>
          </li>
        ) : null}
      </ul>
      <p className="bio">
        <strong>{SITE.bio.titulo}</strong>
        <span>{SITE.bio.texto}</span>
      </p>
      <PushButton />
    </section>
  );
}

/** Número que conta de 0 até o valor na primeira vez que aparece (direto com movimento reduzido). */
function Contador({ valor }: { valor: number | null }) {
  const reduz = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const jaContou = useRef(false);
  const [texto, setTexto] = useState("–");

  useEffect(() => {
    if (valor == null) return;
    if (jaContou.current || reduz || valor < 2) {
      setTexto(formatarNumero(valor));
      return;
    }
    jaContou.current = true;
    const c = animate(0, valor, {
      duration: Math.min(1.1, 0.5 + valor / 400),
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => setTexto(formatarNumero(Math.round(v))),
    });
    return () => c.stop();
  }, [valor, reduz]);

  return (
    <b ref={ref} aria-live="off">
      {texto}
    </b>
  );
}
