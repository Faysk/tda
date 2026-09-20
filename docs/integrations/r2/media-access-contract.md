# Mídia — autorização de staging (registro superseded)

> Status: superseded; proposta genérica não ativada como contrato runtime
> Owner: integrations/media + operations
> Última revisão: 2026-09-20
> Substituído por: autenticação/capabilities normais do TDA + autorização temporária e restrita do Media Storage
> Fonte de verdade: [ADR-0018](../../adr/0018-portable-core-github-control-plane.md), [fluxo de mídia](media-pipeline.md) e contratos da feature consumidora

## Contexto histórico

Este documento registrou a intenção de evitar segredos/endpoints específicos por lore durante a migração inicial de mídia. Essa intenção permanece válida, mas o identificador sugerido `TDA_MEDIA_STAGING_AUTH` **não é configuração canônica atual do produto** e não deve ser introduzido apenas para materializar esta proposta antiga.

A implementação corrente segue uma fronteira mais simples:

- o usuário se autentica pelo TDA normal;
- o servidor valida capability/scope da ação;
- quando upload direto é necessário, o browser recebe somente autorização temporária e restrita ao objeto/lote necessário;
- credenciais permanentes do storage permanecem server-side;
- publicação pública versionada continua na Media Pipeline/CI compartilhada;
- nenhuma lore ganha secret, endpoint ou uploader próprio.

O primeiro consumidor concreto desse padrão é a mídia de entities do World: o servidor valida editor + lease e emite presigned PUT curto para uma pending key; a finalização faz read-back/validação antes de registrar o asset. O rollout continua sujeito ao feature flag e aos gates do ambiente.

## Regra preservada

Autorização da aplicação e credencial do storage são conceitos distintos. Uma capability do TDA nunca equivale a acesso direto ao bucket.

Se surgir no futuro um serviço genérico de intake/staging que precise de uma credencial própria de aplicação, isso exige necessidade real, naming atual e documentação nova; não reativar automaticamente `TDA_MEDIA_STAGING_AUTH`.

Ver também [segurança e custos](security-and-costs.md) e [World entity media](../../features/world-entity-media-foundation.md).
