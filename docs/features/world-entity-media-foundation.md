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

Retrato:

`campaigns/{campaign-slug}/entities/{entity-uuid}/portrait/{sha256}.{ext}`

O `sha256` torna o objeto imutável e permite read-back/integrity checks. O banco guarda a object key e o asset UUID; consumidores públicos não persistem a URL como identidade.

## Modelo candidato

`media_assets` contém identidade, campaign, role hint, bucket de staging, object key, hash, MIME, bytes, dimensões e estado de verificação/publicação.

`entity_media_bindings` contém o vínculo `(campaign_id, entity_id, role) -> asset_id` e focal point normalizado. A primeira versão aceita somente `role = portrait`, preservando espaço para expansão sem adicionar colunas de URL a `entities`.

O SQL correspondente vive em `supabase/candidates/` até autorização explícita para migration remota.

## Segurança

- Browser roles não recebem grants diretos nas tabelas de mídia.
- Mutação passa por boundary de servidor com autenticação, `campaign.content.edit` e lease válido do World.
- Um upload deve ser validado por magic bytes, MIME permitido, tamanho, dimensões, hash e read-back antes de virar asset utilizável.
- Presigned upload, quando habilitado, é bearer capability curta e deve restringir object key e Content-Type; CORS do bucket deve aceitar somente as origins necessárias.
- Assets de outra campaign ou outro entity não podem ser associados por troca de UUID.
- A visibility usada para decidir se o asset precisa estar público vem do `draft_graph` que será publicado, não do estado antigo de `entities`.

## Publicação

1. O editor escolhe um asset no draft (`primaryMediaAssetId`).
2. O draft continua privado e recuperável enquanto a lease existir.
3. Antes de consumir a lease, o servidor valida todos os assets pedidos pelo draft. Para entidade `public_web`, promove o objeto imutável para `tda-media-public` e confirma read-back + entrega pública.
4. Se promoção/verificação falhar, a publicação é bloqueada como `media_pending`; graph/layout e bindings não são publicados e a lease/draft permanece disponível para retry.
5. Com a mídia pronta, o wrapper SQL candidato `publish_world_edit_state_with_media_atomic(...)` valida o mesmo draft/lease, chama a publicação factual/layout existente e aplica `entity_media_bindings` dentro da mesma transação PostgreSQL.
6. Qualquer falha SQL depois da chamada factual reverte também graph/layout, evitando estado factual publicado com binding de mídia parcialmente aplicado.
7. Bindings de entidades não públicas podem continuar apontando para assets verificados em staging privado; URL pública só é projetada para assets explicitamente `verified_public`.

## Primeira UX

O inspector de Conduzir terá uma seção `Imagem do elemento` com preview, adicionar/trocar/remover e drag-and-drop. Nós continuam circulares; a imagem usa crop `cover` e fallback para iniciais. Focal point começa em `(0.5, 0.5)` e poderá ganhar ajuste visual na fase de polimento.

## Limites iniciais

PNG e WebP; até 8 MiB; dimensões entre 1 e 16384 pixels por eixo. O pipeline deve favorecer derivados pequenos para node/avatar e não servir o original de vários megabytes como thumbnail.

## Não objetivos desta fase

- galeria completa;
- vídeo/áudio;
- edição destrutiva do original;
- URLs externas arbitrárias;
- alteração do modelo de auth/canon/audience;
- aplicação automática do SQL candidato em Production.
