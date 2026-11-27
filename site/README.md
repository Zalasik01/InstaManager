# Site polo9n.com.br

Site estático (Cloudflare Worker com Static Assets). Páginas: `/`, `/privacidade`, `/termos`, mais `404.html`. Arquivos em `public/`.

## Testar local

```
cd site
npx wrangler dev
```

## Publicar

O domínio `polo9n.com.br` já está ativo no Cloudflare. Um único comando publica o site e mantém ligados o
endereço principal e o `www` (que redireciona para o principal):

```
cd site
npx wrangler login   # uma vez só
npx wrangler deploy
```

Cada publicação gera uma versão nova: o site se atualiza sozinho para todos os visitantes (veja `src/index.ts`).
