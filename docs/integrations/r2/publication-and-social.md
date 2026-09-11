# R2 — publicação e social

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-11

Antes de uma imagem ser tratada como pública, o TDA exige audience aprovada, hash/MIME/bytes/dimensões validados, upload sem overwrite silencioso, read-back, URL HTTPS final, GET anônimo, decode e confirmação de integridade.

Bucket/key ou uma URL válida não bastam. O runtime consome evidência promovida previamente; não faz probe remoto em cada request.

Para metadata social, a ordem desejada é `social -> hero -> cover -> /og/default`, usando somente mídia elegível. Enquanto `social` não existir no runtime, permanece o contrato atual hero -> cover -> fallback oficial.

Cada link compartilhável deve emitir título, descrição, canonical e imagem próprios quando houver mídia específica válida.

Objetos hashados são imutáveis: conteúdo novo recebe nova key. Custom domain é o caminho de Production; `r2.dev` fica reservado a desenvolvimento. Cache e CORS são coordenados com Nuvem.
