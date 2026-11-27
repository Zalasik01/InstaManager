import { useEffect, useState } from "react";

/** Botão "Tentar de novo" e, se houver, os últimos posts guardados no cache do aparelho. */
export default function OfflineActions() {
  const [fotos, setFotos] = useState<string[]>([]);

  useEffect(() => {
    const recarregar = () => window.location.reload();
    window.addEventListener("online", recarregar);

    // Procura a última resposta de /api/posts em qualquer cache do app. Falhas são ignoradas.
    void (async () => {
      try {
        if (!("caches" in window)) return;
        for (const nome of (await caches.keys()).reverse()) {
          const cache = await caches.open(nome);
          const req = (await cache.keys()).find((r) => new URL(r.url).pathname === "/api/posts");
          const resp = req ? await cache.match(req) : undefined;
          if (!resp) continue;
          const j = (await resp.json()) as { posts?: { imagens?: unknown }[] };
          const urls = (j.posts ?? [])
            .map((p) => (Array.isArray(p.imagens) ? p.imagens[0] : null))
            .filter((u): u is string => typeof u === "string" && /^(https:\/\/|\/)/.test(u))
            .slice(0, 9);
          if (urls.length) {
            setFotos(urls);
            return;
          }
        }
      } catch {
        /* sem posts salvos */
      }
    })();

    return () => window.removeEventListener("online", recarregar);
  }, []);

  return (
    <>
      <button type="button" className="btn" onClick={() => window.location.reload()}>
        Tentar de novo
      </button>
      {fotos.length ? (
        <section className="offline-posts" aria-labelledby="salvos-t">
          <h2 id="salvos-t">Últimos posts salvos neste aparelho</h2>
          <ul>
            {fotos.map((u) => (
              <li key={u}>
                <img src={u} alt="Foto de um post salvo" width={400} height={400} decoding="async" loading="lazy" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
