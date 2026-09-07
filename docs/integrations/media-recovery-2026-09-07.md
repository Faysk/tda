# Recuperação de imagens — 2026-09-07

> Status: auditoria observada
> Owner: integrations/media
> Última revisão: 2026-09-07
> Fonte de verdade: binários recuperados, SELECT de sessões publicadas e HEAD das chaves propostas

## Resultado e limites

Recuperadas **22/22 imagens, 12.045.969 bytes (11,49 MiB)**, sem recompressão. As 11 associações sessão/cover/hero foram revalidadas por leitura do banco de produção. SHA-256, MIME real, dimensões e decodificação completa foram verificados localmente. As 22 chaves propostas responderam ausentes ao HEAD autenticado no R2. Nenhum upload, alteração de referências, delete, publicação de bucket, DNS ou deployment foi executado. Nenhum áudio foi baixado.

Clone isolado da main `3e3c2dcb98a30ef28a1d4bbc6b5ce76ad1d66efc`. Fonte GitHub fixada no commit histórico `48f8a43e8145e782d3bf4186a4a9b4218a92c643`, originalmente `codex/local-first-production`. As 14 imagens coincidem com tamanho e identidade Git blob SHA-1 da árvore desse commit; o SHA-256 de destino é calculado independentemente sobre os bytes baixados.

## Artefatos auditáveis

- [Manifesto completo](evidence/session-media-recovery-2026-09-07.json): 22 associações, origens original/resolvida, hashes, MIME, dimensões, bytes, bucket/key e estados separados de recuperação/publicação.
- [Verificação das origens](evidence/session-media-source-checks-2026-09-07.json): 14 identidades Git blob verificadas e as 12 respostas HTTP 404 das URLs históricas.
- [Repetição validada](evidence/session-media-repeat-2026-09-07.json): 22 hashes/keys e timestamps dos originais locais inalterados após novo download, decodificação e HEAD; nenhuma escrita remota.
- Inventário executável: `tools/media/session-image-sources.json`, com expectativas fixas para detectar alteração de conteúdo ou troca de variante.
- Procedimento, comandos, contrato de metadata e rollback: [documento dono R2](r2.md#recuperação-executável-da-issue-25).

Os binários originais ficam apenas no diretório local de recuperação, fora do Git. Os JSONs versionados não contêm credenciais nem URLs assinadas.

## Correção do inventário anterior

As duas imagens de **29/07** são PNG reais, com assinatura `89504e470d0a1a0a`. O GitHub responde `image/webp` por causa do filename, mas isso não altera o formato. Os 3.346.255 bytes de cover e 3.081.082 bytes de hero foram preservados como PNG. O destino usa `.png` e `image/png`. As demais 20 imagens são WebP reais. O [inventário anterior](media-inventory-2026-09-07.md) permanece uma fotografia histórica, não deve ser interpretado como validação de conteúdo binário.

A sessão cujo `sourceSessionId` começa com `manual-2026-07-05` possui `session_date=2026-07-04` e imagens de 04/07; essa associação foi confirmada no banco, sem inferir data pelo identificador de origem.

## Validação

O dry-run operacional verificou o banco, baixou/decodificou as 22 origens e consultou somente as 22 chaves planejadas no R2. A repetição confirmou os mesmos hashes/keys/bytes e timestamps de modificação dos originais locais. `pnpm check` e `pnpm build` passaram em Node 24.19.0; os testes de recuperação foram integrados ao CI da PR.

Os testes sintéticos cobrem pares completos, troca de associação, URL com credencial, MIME pelos bytes, WebP/PNG truncados, conteúdo alterado, preservação local, dry-run sem PUT, upload seguido de skip idempotente, colisões de tamanho/MIME/hash, HEAD enganoso com GET divergente, erro de permissão, bucket inexistente, corrida HEAD/PUT com condição, falha de read-back e flags inválidas. O `pnpm test` inclui esses testes; não usam banco, R2 ou credenciais reais.

## Pendências da issue #25

Permanecem pendentes os 22 uploads reais e respectivos read-backs, a decisão/validação da entrega pública, a troca reversível de referências e a validação visual de frontend/metadata após promoção. A recuperação local não conclui a migração nem torna uma URL R2 elegível para `og:image`. As 12 URLs históricas continuam quebradas em produção; o contrato da #47 exige fallback até entrega pública validada.
