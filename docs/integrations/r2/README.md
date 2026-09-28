# Media Storage — documentação do provider atual R2

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-29

Cloudflare R2 é o **storage canônico vigente de todo blob/object storage do TDA**. O nome **Media Storage** identifica o boundary arquitetural compartilhado; não existe um segundo storage por trás desse nome. Hoje não há Azure Blob Storage, Amazon S3, Supabase Storage ou outro backend de blobs configurado.

O contrato continua isolando detalhes de provider conforme [ADR-0018](../../adr/0018-portable-core-github-control-plane.md), para que uma migração futura seja possível sem espalhar dependências pelo domínio. Isso é portabilidade, não coexistência: até uma decisão/migração explícita substituir o provider, todos os consumidores de blobs devem usar os buckets e contratos R2 documentados aqui.

## Ordem de leitura para qualquer trabalho de mídia

1. [ADR-0018](../../adr/0018-portable-core-github-control-plane.md) — GitHub como control plane, providers substituíveis, Media Storage obrigatório e free-first.
2. [Fluxo obrigatório de preparação e entrega](media-pipeline.md) — fases, responsabilidades e evidências.
3. [Placement](placement.md) — destino por ambiente e visibilidade.
4. [Identidade e keys](identity-and-keys.md) — identidade, hash e endereços imutáveis.
5. [Variantes e crops](variants-and-crops.md) — proporção, resolução e qualidade perceptível.
6. [Publicação e social](publication-and-social.md) — elegibilidade e previews.
7. [Lifecycle](lifecycle.md) — estados, retenção e rollback.
8. [Segurança e custos](security-and-costs.md) — credenciais, escopo e franquias.
9. [Runbook operacional](../../operations/r2-media-runbook.md) — execução, diagnóstico e recuperação.

A [visão do provider atual](../r2.md) resume buckets, origem pública, secrets e evidências históricas.

## Regra de leitura

- **ADR/contrato:** diz como o sistema deve funcionar.
- **runbook vigente:** diz como operar agora e registra drift conhecido.
- **evidência datada:** prova apenas o instante registrado.
- **documento histórico:** explica uma migração anterior, não governa a operação atual.

A existência de URL, key, manifest, PR ou step verde não prova sozinha que um objeto foi publicado. Publicação exige evidência compatível com o fluxo: upload/reuso, read-back e, quando público, entrega HTTPS verificada.

- [Do ZIP à produção](../../operations/zip-to-production.md) — pacote completo e validação dos consumidores.
