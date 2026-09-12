# World entity media foundation

> Owner: narrative-memory / integrations-media / frontend
> Status: implementação candidata; schema remoto não aplicado
> Última revisão: 2026-09-12

> Contrato de implementação para a primeira imagem canônica de cada elemento do Mundo. Este documento não autoriza migration em Production.

## Objetivo

Dar a cada entidade do World Explorer uma identidade de mídia estável sem transformar URL de entrega em dado canônico. O primeiro papel suportado é `portrait`; galeria e artwork podem evoluir sobre o mesmo contrato.

## Separação de responsabilidades

- PostgreSQL possui identidade do asset, metadados verificados, proveniência e o vínculo semântico entidade → portrait.
- Cloudflare R2 possui os bytes imutáveis.
- O draft do Mundo referencia `assetId`, nunca uma URL arbitrária.
- A projeção pública só resolve URL quando o asset e a entrega pública estiverem verificados.
- Upload para preview/private não implica publicação.
- Publicação de entidade `public_web` exige promoção para `tda-media-public` e verificação de entrega antes de trocar o vínculo público.
- Falha de promoção não deve destruir o retrato público anterior nem consumir o draft/lease que o editor precisa para retry.

## Buckets e chave

Buckets previstos:

- `tda-media-preview` — homologação e upload de rascunho fora de Production;
- `tda-media-private` — staging privado em Production;
- `tda-media-public` — objetos explicitamente promovidos para entrega pública.

Retrato canônico:

`campaigns/{campaign-slug}/entities/{entity-uuid}/portrait/{sha256}.{ext}`

Upload direto temporário:

`uploads/pending/world-entity/{campaign-slug}/{entity-uuid}/{upload-uuid}/{sha256}.{ext}`

O `sha256` da chave canônica torna o objeto imutável e permite read-back/integrity checks. O banco guarda a object key e o asset UUID; consumidores públicos não persistem a URL como identidade. O namespace `uploads/pending/` não é identidade de asset e deve possuir retenção curta separada dos namespaces canônicos.

## Modelo candidato

`media_assets` contém identidade, campaign, role hint, bucket de staging, object key, hash, MIME, bytes, dimensões e estado de verificação/publicação.

`entity_media_bindings` contém o vínculo `(campaign_id, entity_id, role) -> asset_id` e focal point normalizado. A primeira versão aceita somente `role = portrait`, preservando espaço para expansão sem adicionar colunas de URL a `entities`.

O SQL correspondente vive em `supabase/candidates/` até autorização explícita para migration remota.

## Segurança

- Browser roles não recebem grants diretos nas tabelas de mídia.
- Mutação passa por boundary de servidor com autenticação, `campaign.content.edit` e lease válido do World.
- Um upload deve ser validado por magic bytes, MIME permitido, tamanho, dimensões, hash e read-back antes de virar asset utilizável.
- Presigned PUT é bearer capability curta, vinculada a uma única pending key e a um `Content-Type`; CORS do bucket deve aceitar somente as origins e headers necessários.
- O browser nunca recebe presign para a chave canônica do portrait. Mesmo que reutilize a URL enquanto ela estiver válida, consegue sobrescrever somente a pending key descartável; a finalização revalida os bytes antes de criar/reusar o objeto canônico imutável.
- `Content-Length` e hash declarados pelo cliente não são tratados como prova. A finalização lê o objeto do R2 e confirma magic bytes, MIME real, tamanho e SHA-256.
- Assets de outra campaign ou outro entity não podem ser associados por troca de UUID.
- A visibility usada para decidir se o asset precisa estar público vem do `draft_graph` que será publicado, não do estado antigo de `entities`.

## Upload direto para R2

1. O browser calcula SHA-256, MIME esperado e bytes do arquivo local.
2. `requestWorldEntityPortraitUploadAction(...)` reautoriza `campaign.content.edit` + `campaign.world.layout.edit`, valida lease ativa e confirma que o `entityId` pertence ao draft atual.
3. O servidor gera `uploadId` aleatório e URL SigV4 `PUT` de 5 minutos para uma pending key única. A assinatura inclui `Content-Type`; nenhuma credencial R2 é enviada ao browser.
4. O browser envia os bytes diretamente ao R2 com o `Content-Type` assinado.
5. `finalizeWorldEntityPortraitUploadAction(...)` repete autorização, lease e scope, lê exatamente aquela pending key, inspeciona os bytes e compara SHA-256/MIME/tamanho com o intent.
6. Somente após essa verificação o servidor grava/reutiliza a chave canônica via `If-None-Match: *`, faz read-back/hash e registra `media_assets` como `staged` + `read_back_verified`.
7. O asset UUID retornado entra no draft como `primaryMediaAssetId`; upload/finalização por si só não altera `entity_media_bindings` nem publica audiência.
8. Corrida de finalização reaproveita a identidade existente por `(campaign_id, staged_bucket, object_key)` sem sobrescrever asset verificado ou reativar asset `retired`.

Pending uploads não são apagados de forma síncrona pela finalização porque a própria presigned URL ainda pode ser reutilizada até expirar e recriar o objeto. A limpeza deve ser feita por lifecycle explícito e curto aplicado somente ao prefixo `uploads/pending/`, nunca aos objetos canônicos.

## Preview privado do rascunho

`/api/world/entity-media/{assetId}` é a superfície de leitura do portrait ainda privado. A rota fica atrás do mesmo feature flag e exige `campaign.content.edit`; o browser nunca recebe `staged_bucket` nem `object_key` como identidade.

Antes de responder, a rota resolve campaign + asset por UUID, rejeita asset `retired`/não verificado, reconstrói a chave canônica esperada e relê os bytes do R2. Magic bytes, SHA-256, MIME, tamanho e dimensões precisam continuar iguais ao registro. A resposta usa `Cache-Control: private, no-store` e `X-Content-Type-Options: nosniff`; falha de auth/integridade não faz fallback para bucket público.

O draft hidratado e alterações locais podem usar essa rota como `imageUrl`; a projeção pública continua independente e só usa URL pública verificada.

## Publicação

1. O editor escolhe um asset no draft (`primaryMediaAssetId`).
2. O draft continua privado e recuperável enquanto a lease existir.
3. Antes de consumir a lease, o servidor valida todos os assets pedidos pelo draft. Para entidade `public_web`, promove o objeto imutável para `tda-media-public` e confirma read-back + entrega pública.
4. Se promoção/verificação falhar, a publicação é bloqueada como `media_pending`; graph/layout e bindings não são publicados e a lease/draft permanece disponível para retry.
5. Com a mídia pronta, o wrapper SQL candidato `publish_world_edit_state_with_media_atomic(...)` valida o mesmo draft/lease, chama a publicação factual/layout existente e aplica `entity_media_bindings` dentro da mesma transação PostgreSQL.
6. Qualquer falha SQL depois da chamada factual reverte também graph/layout, evitando estado factual publicado com binding de mídia parcialmente aplicado.
7. Bindings de entidades não públicas podem continuar apontando para assets verificados em staging privado; URL pública só é projetada para assets explicitamente `verified_public`.

## Primeira UX

O inspector de **Conduzir** já integra `WorldEntityMediaEditor`: preview circular, adicionar/trocar/remover, file picker e drag-and-drop, cálculo SHA-256 no browser e estados de preparação/upload/finalização. Quando a finalização retorna o asset UUID, o editor grava `primaryMediaAssetId` no draft e preserva/inicializa o focal point; a projeção de draft troca o retrato do node imediatamente pela rota privada, sem alterar o Mundo publicado.

Remover o portrait grava `primaryMediaAssetId = null` no draft e restaura o fallback de iniciais no canvas. O feature flag continua fail-closed e desligado por default enquanto schema/R2/CORS não forem autorizados no ambiente; integrar a superfície visual não ativa infraestrutura remota por efeito colateral.

Nós continuam circulares; a imagem usa crop `cover`, fallback para iniciais e respeita `imageFocalPoint` via `object-position`. O focal point inicia em `(0.5, 0.5)` e já pode ser ajustado horizontal e verticalmente no inspector, com ação para recentralizar; derivados pequenos para avatar/node continuam pendentes.

## Limites iniciais

PNG e WebP; até 8 MiB; dimensões entre 1 e 16384 pixels por eixo. Presigned PUT expira em 5 minutos. O pipeline deve favorecer derivados pequenos para node/avatar e não servir o original de vários megabytes como thumbnail.

## Não objetivos desta fase

- galeria completa;
- vídeo/áudio;
- edição destrutiva do original;
- URLs externas arbitrárias;
- alteração do modelo de auth/canon/audience;
- aplicação automática do SQL candidato em Production;
- configurar lifecycle/CORS remoto como efeito colateral de build ou deploy.
