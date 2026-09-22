# World entity media foundation

> Owner: narrative-memory / integrations-media / frontend
> Status: implementação candidata; schema remoto não aplicado
> Última revisão: 2026-09-22

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

Upload temporário same-origin em chunks:

`uploads/pending/world-entity/{campaign-slug}/{entity-uuid}/{upload-uuid}/{sha256}.part-{nn}`

O `sha256` da chave canônica torna o objeto imutável e permite read-back/integrity checks. O banco guarda a object key e o asset UUID; consumidores públicos não persistem a URL como identidade. O namespace `uploads/pending/` não é identidade de asset e deve possuir retenção curta separada dos namespaces canônicos.

## Modelo candidato

`media_assets` contém identidade, campaign, role hint, bucket de staging, object key, hash, MIME, bytes, dimensões e estado de verificação/publicação.

`entity_media_bindings` contém o vínculo `(campaign_id, entity_id, role) -> asset_id` e focal point normalizado. A primeira versão aceita somente `role = portrait`, preservando espaço para expansão sem adicionar colunas de URL a `entities`.

O vínculo da entidade é protegido também no banco por FK composta `(campaign_id, entity_id) -> entities(campaign_id, id)`. O `id` de entidade já é globalmente único; a constraint composta redundante existe para tornar o isolamento entre campanhas uma invariável relacional, sem depender apenas de checagens da aplicação.

O SQL correspondente vive em `supabase/candidates/` até autorização explícita para migration remota.

## Segurança

- Browser roles não recebem grants diretos nas tabelas de mídia.
- Mutação passa por boundary de servidor com autenticação, `campaign.content.edit` e lease válido do World.
- Um upload deve ser validado por magic bytes, MIME permitido, tamanho, dimensões, hash e read-back antes de virar asset utilizável.
- O browser não recebe credenciais R2 nem URL presigned. Upload passa por `PUT /api/world/entity-media/upload` same-origin, autenticado, limitado a chunks de 2 MiB e reautorizado contra capability + lease + entity em cada parte.
- O browser nunca escreve a chave canônica do portrait. Só consegue enviar chunks temporários vinculados a campaign/entity/upload/hash; a finalização revalida o conjunto completo antes de criar/reusar o objeto canônico imutável.
- `Content-Length` e hash declarados pelo cliente não são tratados como prova. A finalização lê o objeto do R2 e confirma magic bytes, MIME real, tamanho e SHA-256.
- Assets de outra campaign ou outro entity não podem ser associados por troca de UUID.
- A visibility usada para decidir se o asset precisa estar público vem do `draft_graph` que será publicado, não do estado antigo de `entities`.
- O wrapper de publicação exige correspondência exata entre `p_bindings` e a intenção de mídia persistida no `draft_graph` da mesma lease: UUID do asset, remoção explícita e focal point não podem ser trocados por um caller interno sem invalidar a publicação.

## Upload same-origin para R2 privado

1. O browser calcula SHA-256, MIME esperado e tamanho do arquivo local.
2. `requestWorldEntityPortraitUploadAction(...)` reautoriza `campaign.content.edit` + `campaign.world.layout.edit`, valida lease ativa, confirma que o `entityId` pertence ao draft e retorna somente `uploadId` + tamanho de chunk.
3. O browser divide os bytes em chunks de 2 MiB e envia cada parte para `PUT /api/world/entity-media/upload`, com `credentials: same-origin`.
4. A rota recusa origin divergente, exige `application/octet-stream`, valida UUID/hash/part/total, confirma o tamanho exato da parte e reexecuta autorização + lease/entity antes de escrever no R2.
5. Em Production, chunks e objeto canônico de staging usam a credencial privada `R2_PRIVATE_*` no bucket `tda-media-private`; o browser nunca recebe essa credencial.
6. `finalizeWorldEntityPortraitUploadAction(...)` repete autorização, lê exatamente todas as partes esperadas, reconstrói o arquivo e compara SHA-256/MIME/tamanho com o intent.
7. Somente após magic bytes, dimensões e hash passarem o servidor grava/reutiliza a chave canônica via `If-None-Match: *`, faz read-back/hash e registra `media_assets` como `staged` + `read_back_verified`.
8. Se dois finalizadores materializarem o mesmo hash simultaneamente, `412 Precondition Failed` no PUT condicional não autoriza overwrite: o segundo fluxo continua somente para o read-back obrigatório e aceita o objeto apenas se hash/tamanho permanecerem idênticos.
9. Depois do objeto canônico validado, os chunks temporários são removidos best-effort. Resíduos de falha continuam restritos ao namespace `uploads/pending/world-entity/` e não viram identidade de asset.
10. O asset UUID retornado entra no draft como `primaryMediaAssetId`; upload/finalização por si só não altera `entity_media_bindings` nem publica audiência.
11. Corrida de finalização reaproveita a identidade existente por `(campaign_id, staged_bucket, object_key)` sem sobrescrever asset verificado ou reativar asset `retired`.

Esse caminho elimina CORS do R2 como requisito para a UX de upload e evita ampliar a credencial privada com permissão administrativa de bucket apenas para suportar browser direct upload.

## Preview privado do rascunho

`/api/world/entity-media/{assetId}` é a superfície de leitura do portrait ainda privado. A rota fica atrás do mesmo feature flag e exige `campaign.content.edit`; o browser nunca recebe `staged_bucket` nem `object_key` como identidade.

Antes de responder, a rota resolve campaign + asset por UUID, rejeita asset `retired`/não verificado, reconstrói a chave canônica esperada e relê os bytes do R2. Magic bytes, SHA-256, MIME, tamanho e dimensões precisam continuar iguais ao registro. A resposta usa `Cache-Control: private, no-store` e `X-Content-Type-Options: nosniff`; falha de auth/integridade não faz fallback para bucket público.

O draft hidratado e alterações locais podem usar essa rota como `imageUrl`; a projeção pública continua independente e só usa URL pública verificada. No node, essa URL autenticada é renderizada com `next/image` em modo `unoptimized`, porque o otimizador do Next não deve ser a ponte de autenticação para uma origem privada. Depois de publicado, o URL imutável em `media.dnd.faysk.dev/campaigns/{campaign}/entities/...` volta ao pipeline normal de otimização do Next e está explicitamente coberto por `remotePatterns`.

A hidratação adiciona intenção de mídia somente quando já existe binding persistido. Entidades sem portrait permanecem sem `primaryMediaAssetId`; `null` é reservado para uma remoção explícita feita pelo editor. Isso evita transformar uma simples abertura do modo Conduzir em centenas de remoções/no-ops artificiais no próximo publish.

## Publicação

1. O editor escolhe um asset no draft (`primaryMediaAssetId`).
2. O draft continua privado e recuperável enquanto a lease existir.
3. Antes de consumir a lease, o servidor valida todos os assets pedidos pelo draft. Para entidade `public_web`, promove o objeto imutável para `tda-media-public` e confirma read-back + entrega pública.
4. Se promoção/verificação falhar, a publicação é bloqueada como `media_pending`; graph/layout e bindings não são publicados e a lease/draft permanece disponível para retry.
5. Com a mídia pronta, o wrapper SQL candidato `publish_world_edit_state_with_media_atomic(...)` valida o mesmo draft/lease, exige que os bindings recebidos correspondam à intenção salva nessa lease, chama a publicação factual/layout existente e aplica `entity_media_bindings` dentro da mesma transação PostgreSQL.
6. Qualquer falha SQL depois da chamada factual reverte também graph/layout, evitando estado factual publicado com binding de mídia parcialmente aplicado.
7. Bindings de entidades não públicas podem continuar apontando para assets verificados em staging privado; URL pública só é projetada para assets explicitamente `verified_public`.
8. No boundary da aplicação, uma publicação exclusivamente de mídia é reportada como `saved` mesmo quando graph/layout retornam `unchanged`, evitando feedback enganoso de “nada para publicar”.

## Validação e ativação controlada

O gate padrão antes da ativação é o PostgreSQL 16 efêmero da CI, que executa o contrato SQL candidato e os testes sintéticos sem tocar no Supabase remoto. **Não é requisito manter um projeto ou uma development branch Supabase dedicada de homologação para esta fase.** Infraestrutura isolada adicional só deve ser criada se surgir um risco específico que não possa ser validado de forma razoável pela CI e por smoke controlado, e sempre como decisão explícita de custo/operação.

`TDA_WORLD_ENTITY_MEDIA_ENABLED` permanece `false` até uma decisão explícita de rollout. Quando a feature estiver pronta para ativação, o candidato deve seguir o procedimento normal do ambiente alvo: revisar migration/history e dry-run, configurar o storage necessário, habilitar a flag de forma controlada e executar um smoke pequeno com poucas entidades antes de ampliar o uso. Production não deve ser usado como ambiente de experimentação; qualquer mutação nela continua sujeita aos gates normais de release.

O antigo helper de CORS/presign de Preview não faz mais parte do caminho de runtime do editor. A ativação do portrait não depende de CORS remoto no bucket: browser fala somente com a aplicação same-origin, e a aplicação fala com R2 server-side. Lifecycle curto para `uploads/pending/world-entity/` continua desejável como higiene operacional, mas não é requisito de correção/autorização do upload.

## Validação automatizada do candidato

A CI executa `tools/world-entity-media-db.py` em um PostgreSQL 16 efêmero, acessível apenas por Unix socket, sem TCP e sem herdar credenciais `PG*`. O runner reaplica a fixture/migrations e os contratos sintéticos canônicos do World antes de executar o SQL em `supabase/candidates/`; ele não se conecta ao Supabase e não promove migration.

O contrato sintético cobre RLS deny-by-default, ausência de grants para `anon`/`authenticated`, isolamento de campaign pela FK composta, rejeição de binding que não corresponda ao draft da lease, bloqueio `media_not_verified` sem consumir o rascunho e publicação atômica do portrait depois de o asset sintético estar marcado como verificado. O job existente de `world-layout-db` continua rodando separadamente para provar que o candidato não substitui os guardrails de layout/graph.

O contrato automatizado cobre identidade/tamanho dos chunks e mantém qualquer política remota de lifecycle como etapa operacional explícita, nunca efeito colateral de build/deploy. CORS remoto não participa mais do runtime de upload.

## Primeira UX

O inspector de **Conduzir** já integra `WorldEntityMediaEditor`: preview circular, adicionar/trocar/remover, file picker e drag-and-drop, cálculo SHA-256 no browser e estados de preparação/upload/finalização. Quando a finalização retorna o asset UUID, o editor grava `primaryMediaAssetId` no draft e preserva/inicializa o focal point; a projeção de draft troca o retrato do node imediatamente pela rota privada, sem alterar o Mundo publicado.

Remover o portrait grava `primaryMediaAssetId = null` no draft e restaura o fallback de iniciais no canvas. O feature flag continua fail-closed e desligado por default enquanto schema/R2/credenciais privadas não estiverem autorizados e validados no ambiente; integrar a superfície visual não ativa infraestrutura remota por efeito colateral.

Nós continuam circulares; a imagem usa crop `cover`, fallback para iniciais e respeita `imageFocalPoint` via `object-position`. O focal point inicia em `(0.5, 0.5)` e já pode ser ajustado horizontal e verticalmente no inspector, com ação para recentralizar.

Nesta fundação não existe derivado físico `portrait-node` por antecipação. O retrato público pequeno usa `next/image`; o preview privado autenticado fica `unoptimized` para preservar auth. O smoke controlado mede bytes/requests com múltiplos portraits e só transforma um derivado pequeno em requisito antes da ativação se a medição provar necessidade, sempre derivando do master e registrando provenance própria.

## Limites iniciais

PNG e WebP; de 24 bytes até 8 MiB; dimensões entre 1 e 16384 pixels por eixo; upload em chunks de 2 MiB. O pipeline deve favorecer entrega proporcional ao slot e nunca promover thumbnail como novo master.

## Não objetivos desta fase

- galeria completa;
- vídeo/áudio;
- edição destrutiva do original;
- URLs externas arbitrárias;
- alteração do modelo de auth/canon/audience;
- aplicação automática do SQL candidato em Production;
- configurar lifecycle/política remota de bucket como efeito colateral de build ou deploy.
