/** Ícones próprios (mesmo desenho do site antigo) que o lucide não tem igual. */

interface IconeProps {
  className?: string;
}

/** Duas folhas sobrepostas: post com mais de uma imagem. */
export function IconeCarrossel({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="8" y="3" width="13" height="13" rx="2" fill="currentColor" />
      <path
        d="M5 7v11a2 2 0 0 0 2 2h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Triângulo cheio: post em vídeo (Reel). */
export function IconePlay({ className }: IconeProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

/** Seta saindo da caixa: compartilhar (igual ao botão do perfil no site antigo). */
export function IconeCompartilhar({ className }: IconeProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
