# R2 — publicação e social

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-20

Antes de uma imagem ser tratada como pública, o TDA exige audience aprovada, hash/MIME/bytes/dimensões validados, upload sem overwrite silencioso, read-back, URL HTTPS final, GET anônimo, decode e confirmação de integridade.

Bucket/key ou uma URL válida não bastam. O runtime consome evidência promovida previamente; não faz probe remoto em cada request.

Para metadata social, a ordem desejada é `social -> hero -> cover -> /og/default`, usando somente mídia elegível. Enquanto `social` não existir no runtime, permanece o contrato atual hero -> cover -> fallback oficial.

Cada link compartilhável deve emitir título, descrição, canonical e imagem próprios quando houver mídia específica válida.

Objetos hashados são imutáveis: conteúdo novo recebe nova key. O custom domain `media.dnd.faysk.dev` é o caminho público de Production. `r2.dev` **não faz parte do contrato do TDA e está desabilitado nos buckets atuais**; Preview/Development não devem depender de uma URL pública de desenvolvimento por conveniência. Cache e CORS são configurados conforme o consumer real.
