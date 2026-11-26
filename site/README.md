# Site polo9n.com.br

Site estático (Cloudflare Worker com Static Assets). Páginas: `/`, `/privacidade`, `/termos`, mais `404.html`. Arquivos em `public/`.

## Testar local

```
cd site
npx wrangler dev
```

## Publicar em duas etapas

**1. Agora (domínio ainda não ativo).** Publica no endereço provisório `polo9n.<conta>.workers.dev`:

```
cd site
npx wrangler login   # uma vez só
npx wrangler deploy
```

**2. Quando o domínio estiver ativo.** No Registro.br, troque os servidores de nomes (DNS) de `polo9n.com.br`
pelos dois que o Cloudflare mostra no painel da zona. Quando a zona ficar "Ativa", ligue o domínio:

```
cd site
npx wrangler deploy -c wrangler.dominio.jsonc
```

Esse comando cria o domínio personalizado (`polo9n.com.br` e `www.polo9n.com.br`). Se a zona ainda não estiver
ativa, o comando falha sem estragar o que já está publicado.
