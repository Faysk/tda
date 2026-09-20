# R2 — publicação e social

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-20

Antes de uma imagem ser tratada como pública, o TDA exige audience aprovada, hash/MIME/bytes/dimensões validados, upload sem overwrite silencioso, read-back, URL HTTPS final, GET anônimo, decode e confirmação de integridade.

Bucket/key ou uma URL válida não bastam. O runtime consome evidência promovida previamente; não faz probe remoto em cada request.

Para metadata social, a precedência é responsabilidade do consumidor, sempre usando somente mídia `verified-public`. Quando houver asset `social` próprio e verificado, ele é preferido; na ausência, o consumidor pode usar `hero`/`cover` elegível e por fim `/og/default`. Consumidores que não fornecem imagem verificada ao builder central recebem o fallback oficial.

Cada link compartilhável deve emitir título, descrição, canonical e imagem próprios quando houver mídia específica válida.

Objetos hashados são imutáveis: conteúdo novo recebe nova key. Custom domain é o caminho de Production; `r2.dev` fica reservado a desenvolvimento. Cache e CORS são coordenados com Nuvem.
