# Reparo do site e entrega pública de imagens

> Status: implementado parcialmente; promoção R2 pendente
> Owner: integrations/media
> Última revisão: 2026-09-07
> Fonte de verdade: SQL aplicado, HTML público, GET de imagens e Cloudflare

## Três estados distintos

1. **Incidente resolvido em produção:** 11 capas e 11 heroes carregam no HTML e no otimizador da versão publicada. As 12 URLs quebradas foram substituídas por arquivos no commit imutável GitHub `48f8a43e8145e782d3bf4186a4a9b4218a92c643`; as 10 referências que já funcionavam foram preservadas. Não houve deployment. A coordenação também confirmou no navegador 11/11 capas com `complete=true` e `naturalWidth>0`.
2. **R2 público verificado:** 22 uploads aditivos, 12.045.969 bytes, read-back S3/hash e GET HTTPS anônimo/hash/decodificação/MIME passaram. `media.dnd.faysk.dev` está ativo, TLS mínimo 1.2. O bucket contém somente as 22 imagens revisadas. As duas imagens PNG de 29/07 foram preservadas como PNG.
3. **Consumo definitivo R2 pelo site pendente:** a versão publicada ainda rejeita esse host em `model.ts` e no otimizador Next. O patch restrito adiciona apenas host/prefixo público exatos e testes. As referências de banco continuam GitHub/Supabase até a publicação deliberada dessa correção e seu teste em produção. Nenhuma outra feature foi publicada.

## Evidências

- [Upload e read-back](evidence/session-media-upload-2026-09-07.json).
- [Registro de entrega pública R2](evidence/r2-publication-registry-2026-09-07.json), separado do inventário histórico; `referenceStatus=not-promoted`.
- [Manifesto no contrato exato da #47](evidence/metadata-image-manifest-2026-09-07.json): Record por **sourceSessionId**, com cover/hero `state=verified-public`, `mimeType`, hash, bytes, dimensões, timestamp e flags de read-back/entrega. `session.id` do modelo público é sourceSessionId, enquanto a key R2 usa o UUID canônico. O gerador/testes impedem associar os IDs ou variantes de outra sessão. O builder e o registry runtime pertencem à #47; este artefato não é importado automaticamente por esta PR.
- [22 imagens consumidas pelo site](evidence/site-public-images-2026-09-07.json): GET das origens com hash/decodificação, `<img>` no HTML de lista/detalhe e GET/decodificação da URL real do otimizador. O HTTP incorreto das duas origens PNG históricas está registrado; MIME real vem do decoder.
- [Snapshot anterior](evidence/media-db-before-2026-09-07.json), [snapshot posterior](evidence/media-db-after-2026-09-07.json) e [recibo](evidence/media-repair-receipt-2026-09-07.json).
- [Estado público/privado e DNS](evidence/media-cloudflare-delivery-2026-09-07.json): private/preview sem domínio e sem `r2.dev`; DNS do site inalterado. O novo hostname estava livre, sem wildcard conflitante, antes da associação ao bucket público.

## Alteração de banco executada

O SQL `tools/media/operations/repair-legacy-images-2026-09-07.sql` foi aplicado no projeto `dmrqnbdvbkfqzctcerbx`. Transação única, locks por linha, filtro por UUID + sourceSessionId + campanha + status publicado e comparação de ambos os valores anteriores. Foram alterados somente `sessions.metadata.coverImageUrl` e `heroImageUrl` de seis sessões. Os hashes das outras colunas e das demais chaves de metadata permaneceram iguais nas 11 sessões. Nenhum trigger customizado foi encontrado em sessions antes do write.

O script aborta a transação inteira se qualquer comparação falhar. Ele não tenta forçar reexecução sobre o estado já reparado. O rollback `tools/media/operations/rollback-legacy-images-2026-09-07.sql` compara primeiro as referências imutáveis esperadas e aborta se houve edição posterior; não sobrescreve valores novos silenciosamente. O rollback foi preparado, **não executado**, pois reintroduziria as URLs quebradas.

Os SQLs são operações de dados sem DDL permanente; não criam migrations de schema, funções ou grants. Os snapshots contêm apenas identidades/referências e hashes de preservação, sem exportar textos, transcrições ou usuários.

## Cache e consumidor correto

A aplicação lê `sessions.metadata->>coverImageUrl` e `heroImageUrl` no repositório público, filtrando campanha/status. Não lê uma tabela alternativa de assets. Não existe cache persistente explícito nessa consulta; `React.cache` no detalhe deduplica a consulta no request. O HTML público refletiu as referências corrigidas após novo GET, sem deploy ou purge. As URLs imutáveis novas também geram novas chaves no cache do otimizador.

## Promoção R2 após release compatível

1. Revisar/publicar deliberadamente **somente** o patch de allowlist e dependências previamente aprovadas. O commit runtime é separado dos recibos/documentação. Não publicar um conjunto de outras PRs por conveniência.
2. Confirmar que a versão publicada aceita `media.dnd.faysk.dev/campaigns/yuhara-main/sessions/**`: GET real `/_next/image?url=<URL-R2>&w=640&q=75` para WebP e PNG deve retornar imagem decodificável. A origem HTTPS direta funcionando não substitui esse gate.
3. Revalidar todos os 22 GETs públicos e hashes contra o registro; renovar evidência se o estado mudou. Reconciliar qualquer mudança de registro da #47 explicitamente.
4. Fazer novo SELECT/snapshot das 11 sessões e comparar com o [estado pós-reparo](evidence/media-db-after-2026-09-07.json). O SQL preparado `tools/media/operations/promote-r2-images-after-release.sql` exige exatamente esses valores atuais, inclusive as 12 referências temporárias GitHub. Qualquer edição concorrente provoca exceção e rollback da transação inteira. Não adaptar o snapshot automaticamente para ignorar divergência.
5. Após os gates, aplicar a promoção de 11 sessões/22 campos e guardar recibo; verificar novamente o restante dos dados por hashes. O script foi **preparado, não executado** nesta entrega.
6. Verificar HTML de Home/lista/11 detalhes, 11 capas/11 heroes via otimizador, navegador e metadata. Atualizar o estado de referência somente após sucesso.
7. Se necessário, `tools/media/operations/rollback-r2-images-after-release.sql` restaura as referências funcionais atuais GitHub/Supabase, apenas se ainda coincidirem com os valores R2 promovidos. Uma edição posterior causa aborto integral. Não restaura automaticamente as 12 URLs antigas quebradas.

Originais, objetos R2 e referências históricas permanecem preservados. Nenhum delete, mudança de schema/auth, áudio, produto pago ou alteração de buckets privados faz parte desta operação. A migração definitiva da #25 permanece aberta até os gates de consumo pelo site e metadata.
