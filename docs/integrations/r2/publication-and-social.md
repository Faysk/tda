# R2 — publicação e social

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-12

Antes de uma imagem ser tratada como pública, o TDA exige audience aprovada, hash/MIME/bytes/dimensões validados, upload sem overwrite silencioso, read-back, URL HTTPS final, GET anônimo, decode e confirmação de integridade.

Bucket/key ou uma URL válida não bastam. O runtime consome evidência promovida previamente; não faz probe remoto em cada request.

## Entrega pública

O caminho preferido para mídia pública grande/reutilizável é o objeto content-addressed no R2 público servido pelo custom domain `media.dnd.faysk.dev`. `r2.dev` não é endpoint de Production.

O contrato publicado deve manter coerência entre:

- bytes reais;
- extensão/filename;
- `Content-Type` HTTP;
- preload/metadata quando houver;
- URL consumida pelo browser.

Não criar aliases `.avif` que redirecionem para `.webp` e simultaneamente declarar `type="image/avif"`. Se um alias legado precisar sobreviver durante migração, ele deve entregar/streamar o recurso com o MIME real e ser coberto por teste até que o markup use a URL/formato canônico.

Redirect 3xx bem-sucedido não é evidência suficiente de mídia funcional. Para promoção pública, validar o recurso final: status 200/206, MIME, bytes, decode e dimensões no browser.

Para imagens editoriais, não usar Base64/data URI como canal de entrega normal. Base64 só pode ser transporte/build input quando tooling exigir; deve ser materializado em binário antes do build/deploy.

Objetos hashados são imutáveis: conteúdo novo recebe nova key. Isso permite cache agressivo no custom domain sem misturar versões. Nomes mutáveis/compatibilidade usam cache conservador até a migração para URL content-addressed.

## Social

Para metadata social, a ordem desejada é `social -> hero -> cover -> /og/default`, usando somente mídia elegível. Enquanto `social` não existir no runtime, permanece o contrato atual hero -> cover -> fallback oficial.

Cada link compartilhável deve emitir título, descrição, canonical e imagem próprios quando houver mídia específica válida. A `og:image` deve resolver diretamente para uma imagem publicamente decodificável; não deve depender de JavaScript, autenticação ou reconstrução Base64 no cliente.

## Observabilidade

Para mídia crítica de lore/sessão, o release deve validar pelo menos uma superfície consumidora e seus recursos críticos. GET de `/` e `/sessoes` sozinho não prova que `/lore/*` está íntegro.

Quando disponível, usar também observabilidade do provider (R2 Data Access Logs/metrics e Vercel runtime/deployment logs) como diagnóstico, sem substituir o smoke real do browser.

Custom domain é o caminho de Production; cache e CORS são coordenados com Nuvem. Mudança de CORS/cache em objeto já servido pode exigir purge explícito antes da validação final.
