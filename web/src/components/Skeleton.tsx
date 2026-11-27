/** Itens 4:5 brilhando (shimmer) enquanto os posts chegam; renderize dentro de <ul class="grid-posts">. */
export function EsqueletosGrade({ quantidade = 6 }: { quantidade?: number }) {
  return (
    <>
      {Array.from({ length: quantidade }, (_, i) => (
        <li key={`skel-${i}`} className="skel-i" aria-hidden="true" />
      ))}
    </>
  );
}
