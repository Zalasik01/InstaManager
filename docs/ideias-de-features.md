# Ideias de features: site e bot do Telegram

Lista de sugestões para o InstaManager (bot do Telegram + site polo9n.com.br), numeradas e agrupadas.
Cada item traz o ganho e um tamanho estimado: **P** (pequeno, horas), **M** (médio, 1 a 2 dias), **G** (grande, vários dias).
Itens marcados com ⚠ têm limitação da API do Instagram/Meta, explicada no próprio item.

No fim há uma sugestão de ordem para começar.

---

## Bot do Telegram

### Publicação

1. **Publicar Reels e vídeos pelo bot** (M). Hoje o bot publica só fotos e carrossel. A API aceita `media_type=REELS` com envio do vídeo, capa (`cover_url`) e escolha de quadro da capa (`thumb_offset`). Mandar o vídeo no Telegram e publicar como Reel.
2. **Publicar Stories** (M). A API aceita `media_type=STORIES` (foto ou vídeo). Botão "Publicar como Story" na prévia. Não dá para colocar figurinhas, enquetes nem música por API.
3. **Reels de teste (trial reels)** (P). A API tem `trial_params`: o Reel aparece primeiro só para quem não te segue, e você decide depois se vai para o perfil. Bom para testar conteúdo sem "sujar" o feed.
4. **Converter PNG/HEIC/WebP para JPEG automaticamente** (P). Hoje só JPEG é aceito. Converter no próprio bot evita ter que pensar no formato.
5. **Ajuste automático de proporção** (P). Se a foto for mais alta que 4:5 ou mais larga que 1,91:1, o Instagram recusa. O bot corta/encaixa na proporção aceita e mostra a prévia antes.
6. **Texto alternativo (alt text) nas fotos** (P). A API aceita descrição de acessibilidade por imagem. O Gemini gera a descrição junto com a legenda.
7. **Marcar local e pessoas/colaboradores** (P). Campos `location_id`, `user_tags` e `collaborators`. Ex.: marcar a loja que instalou uma peça como colaboradora (o post aparece nos dois perfis).
8. **Fila de rascunhos** (M). Mandar várias fotos ao longo da semana, deixar como rascunho e o bot sugere/agenda nos melhores horários automaticamente.
9. **Legenda por áudio** (P). Mandar um áudio no Telegram ("essa é a roda nova, aro 17"), o Gemini transcreve e vira a dica da legenda.
10. **Escolher entre 3 legendas** (P). Em vez de uma legenda e "Regerar", o bot já mostra 3 opções curtas (ou "só hashtags") para escolher com um toque.
11. **Detecção de foto repetida** (P). Avisar se a foto enviada já foi publicada antes (comparação simples por hash/semelhança).

### Interação e comunidade

12. **Aviso de comentário novo no Telegram** (M). Com o webhook da Meta (passo 3 da configuração do app, já disponível), o bot recebe cada comentário novo e manda no chat.
13. **Responder comentários pelo Telegram** (P, depois do 12). A permissão `instagram_manage_comments` já está concedida. Botão "Responder" no aviso do comentário; também ocultar/excluir comentário ofensivo.
14. **Resposta sugerida pela IA** (P, depois do 13). O Gemini sugere 2 respostas curtas no seu tom para cada comentário.
15. **Mensagens diretas (DM) no Telegram** (G) ⚠. A permissão `instagram_manage_messages` está concedida, mas o recurso exige o webhook de mensagens e só permite responder dentro de 24 h da última mensagem da pessoa (regra da Meta).

### Gestão e análise pelo bot

16. **Resumo diário curto** (P). Toda manhã: seguidores de ontem para hoje, alcance do último post e se há algo agendado.
17. **Alerta de post em alta** (P). Se um post passa de X vezes o alcance médio nas primeiras horas, o bot avisa (bom momento para postar Story chamando para ele).
18. **Melhor horário para postar** (M). Com o histórico de métricas, o bot calcula os horários/dias com mais alcance e passa a sugerir esses horários nos botões de agendamento.
19. **Comando /stats** (P). Números da conta na hora: seguidores, posts, alcance médio dos últimos 7 e 30 dias, melhor post.
20. **Exportar dados em CSV** (P). Botão no /menu que manda um arquivo com todas as métricas por post, para abrir no Excel/Sheets.
21. **Editar legenda de post já publicado** ⚠. A API não permite editar legenda depois de publicado (só comentários). Fica registrado para não perdermos tempo: só dá para excluir e republicar.

---

## Site (polo9n.com.br)

### Conteúdo

22. **Página própria para cada post** (M). Endereço `polo9n.com.br/p/<id>` com título, imagem de compartilhamento (Open Graph) do próprio post e botão de voltar ao perfil. Melhora muito o compartilhamento no WhatsApp e a busca no Google.
23. **Linha do tempo do carro** (M). Aba "Histórico" com cada modificação em ordem (data, peça, foto antes/depois, link da peça). Conta a história do projeto.
24. **Filtro por hashtag e por tipo** (P). Tocar numa hashtag mostra só os posts dela; filtro "Fotos / Vídeos / Carrosséis".
25. **Antes e depois interativo** (M). Comparador com arraste (foto antiga × atual) para modificações como película, rodas e rebaixamento.
26. **Comentários do Instagram no visualizador** (M). Mostrar os últimos comentários de cada post (leitura via API, permissão já concedida).
27. **Aba Links com preço e status** (P). Nos links das peças: preço pago, onde comprou, "recomendo / não recomendo" e data da instalação.

### Engajamento

28. **Notificação de post novo (Web Push)** (M). Quem instalou o app recebe um aviso no celular quando sai post novo. Gratuito, sem app de loja.
29. **Feed RSS** (P). `polo9n.com.br/feed.xml` com os posts, para quem usa leitores de notícias ou automações.
30. **Gerador de "card" para Story** (M). Botão que gera uma imagem pronta (foto + @ + QR code) para repostar o post no Story.
31. **Página "Sobre" com contato** (P). Para lojas e marcas que queiram parceria; contato pelo Instagram.

### Qualidade e desempenho

32. **Imagens em tamanhos diferentes** (M). Gerar miniaturas menores para a grade (hoje a grade baixa a imagem cheia). Página abre mais rápido no 4G.
33. **Estatísticas de visita sem cookies** (P). Cloudflare Web Analytics (gratuito, não usa cookies, não precisa de aviso de privacidade extra): visitas, páginas e países.
34. **Concluir a reconstrução com framework** (G). Terminar a versão em Astro + React + Tailwind (pasta `web/`) com tudo o que o site atual já faz, e trocar o site publicado por ela.
35. **Domínio www** (P). Ligar `www.polo9n.com.br` redirecionando para o endereço principal (hoje o `www` não tem DNS).

---

## Análise periódica da conta

36. **Histórico diário de seguidores** (P). Hoje só o número atual é guardado. Gravar um registro por dia permite ver crescimento por semana/mês e o efeito de cada post.
37. **Painel de análise privado** (M). Uma página só sua (protegida por login) com gráficos: seguidores no tempo, alcance por post, tipo de post que mais rende (Reel × foto × carrossel), mapa de calor de horários e desempenho das hashtags.
38. **Relatório mensal** (P). Além do semanal: comparação mês a mês, melhores e piores posts, tags que subiram e caíram, e 3 recomendações da IA.
39. **Teste A/B de horário e formato** (M). O bot alterna horários/formatos de propósito por algumas semanas e mede qual rende mais, em vez de depender de palpite.
40. **Pesquisa de hashtags em alta** (G) ⚠. A busca de hashtag da Meta (`ig_hashtag_search`) exige revisão do app ("Instagram Public Content Access") e limita 30 hashtags por semana. Possível, mas depende de aprovação da Meta.

---

## Fora de alcance (para não perder tempo)

- **Música nos posts**: a API do Instagram não permite (confirmado na documentação oficial).
- **Editar legenda depois de publicado**: não existe na API.
- **Ver quem visitou o perfil / seguidores de concorrentes**: não existe na API.

---

## Sugestão de ordem para começar

1. **36 — Histórico diário de seguidores** (P): base de toda a análise; quanto antes começar a gravar, mais histórico.
2. **12 + 13 — Aviso e resposta de comentários pelo Telegram** (M): engajamento direto, e responder rápido ajuda o alcance.
3. **1 — Publicar Reels pelo bot** (M): Reels são o formato que mais alcança contas pequenas.
4. **18 — Melhor horário para postar** (M): usa os dados que já estão sendo coletados.
5. **22 — Página própria para cada post** (M): compartilhamento melhor no WhatsApp e no Google.
