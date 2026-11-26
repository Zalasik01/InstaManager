# Site polo9n.com.br

Site estático (Cloudflare Worker com Static Assets). Páginas: `/`, `/privacidade`, `/termos`, mais `404.html`. Arquivos em `public/`.

## Testar local

```
cd site
npx wrangler dev
```

## Publicar

```
cd site
npx wrangler login   # uma vez só
npx wrangler deploy
```

O domínio polo9n.com.br já está no Cloudflare. As rotas (`polo9n.com.br` e `www.polo9n.com.br`) são criadas como domínio personalizado pelo `wrangler.jsonc` no deploy.
