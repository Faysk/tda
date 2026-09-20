# Media Storage — documentação do provider atual R2

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-20

Cloudflare R2 é o provider atual do **Media Storage** do TDA. O contrato permanente é provider-neutral e está em [ADR-0018](../../adr/0018-portable-core-github-control-plane.md).

Estes documentos descrevem as garantias de mídia e, quando necessário, os detalhes específicos da implementação atual em R2. Uma futura troca de provider deve preservar as garantias e substituir apenas o edge de storage/configuração.

## Mapa de autoridade

Para evitar contratos concorrentes:

- **ADR-0018** é dona do boundary permanente, portabilidade e política free-first;
- **este índice + documentos filhos** são donos do contrato detalhado de mídia;
- **[r2.md](../r2.md)** resume apenas o provider/configuração atual;
- **[r2-media-runbook.md](../../operations/r2-media-runbook.md)** é dono do procedimento operacional atual;
- **evidências datadas/deployments** provam operações específicas, nunca redefinem o contrato;
- **[r2-governance.md](../r2-governance.md)** é somente alias de compatibilidade para links históricos e não possui autoridade independente.

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
