# Campaign identity — inventário de consumidores

> Status: baseline para #1123; atualização obrigatória quando um consumer deixa de depender do technical slug
> Owner: database / identity-access / routing
> Última revisão: 2026-09-30
> Contrato: ADR-0020 e `docs/architecture/multi-campaign.md`

Este inventário separa **UUID relacional**, **technical slug** e **public route key** para impedir que um rename editorial quebre RBAC, processamento, mídia ou links.

## Matriz de consumidores confirmados

| Classe | Evidência atual | Identidade usada hoje | Regra de #1123 / owner seguinte |
| --- | --- | --- | --- |
| RBAC assignments | `role_assignments.scope_type='campaign'` + `scope_id` textual; fixtures de permissions usam `yuhara-main` | technical slug | preservar `campaigns.slug`; hardening/discovery pertence a #1134 |
| RPCs de acesso | `access_directory(campaign_slug)`, `has_campaign_role_slug(campaign_slug,...)` documentados em `docs/database/security.md` | technical slug | não trocar por `public_slug`; #1134 decide discovery multi-campaign |
| transcript handoff | `prepare_transcript_handoff_atomic` resolve `campaignId` por UUID e compara assignment de campaign com `campaigns.slug` | UUID + technical slug | padrão correto: UUID para ownership, slug apenas para scope legado |
| Edit permissions route | `src/app/edit/[campaignSlug]/permissions/*` recebe `campaignSlug` | technical slug | rota permanece compatível; navegação campaign-aware pertence a #1136 |
| Edit entrypoint | `src/features/edit/navigation-entry.ts` importa `CAMPAIGN_SLUG` | hardcode technical slug | remover default implícito em #1136/#1128; #1123 não altera UX |
| sessões públicas | `src/features/sessions/*` projeta UUID, technical slug, `public_slug` e nome | UUID + public route key; technical slug só para fallback legado | #1125 introduz arquivo agregado/scoped e detalhe campaign-qualified; fallback pré-migration permanece restrito a `yuhara-main` |
| allowlist de mídia de sessão | `src/features/sessions/model.ts` aceita `/campaigns/yuhara-main/sessions/` | technical slug embutido na key atual | generalização de namespace pertence a #1135; rename público não move bytes |
| contrato de keys R2 | `docs/integrations/r2/identity-and-keys.md` usa `campaigns/{campaign}/...` | identidade estável exigida, implementação atual ainda slug-like | #1135 deve derivar de identidade imutável; nunca de `name`/`public_slug` |
| processamento local | arquitetura atual ainda possui entrypoint histórico `/edit/processamento` sem campaign na URL | default implícito/ausente | #1128 exige campaign explícita antes de submit/handoff |
| source session lookups | migrations de transcript filtram `campaign_id + source_session_id` | UUID + source ID | manter; nunca introduzir lookup global por source ID |
| entity slug | índice atual é `(campaign_id, slug)` | UUID + slug narrativo | colisão entre campaigns é válida; #1123 preserva isso |
| fixtures/testes | permissions usa `yuhara-main`; transcript handoff usa `synthetic-campaign` | technical slug sintético | #1138 adiciona matriz A/B sem dados reais |

## O que pode mudar sem migration relacional

- `campaigns.name`;
- `campaigns.public_slug`, desde que o valor anterior vire alias histórico;
- presentation/copy/SEO derivados da projection pública.

## O que não muda por rename editorial

- `campaigns.id`;
- `campaigns.slug`;
- FKs campaign-owned;
- `role_assignments.scope_id` legado;
- media keys já publicadas;
- idempotency/receipts históricos;
- source provenance.

## Estado do candidate #1123

`supabase/candidates/20260930174200_first_class_campaign_registry.sql`:

- adiciona lifecycle, visibility, public route key e aliases;
- preserva `yuhara-main` como technical slug;
- registra `yuhara-main` como alias pública de **Crônicas da Mesa**;
- cria **Antes que seja tarde** apenas como identidade `active/private`;
- bloqueia colisões canonical↔alias;
- reforça `profile_characters(campaign_id, entity_id)` e `canon_entries(campaign_id, entity_id)` contra entity de campaign irmã;
- bloqueia participant→entity cross-campaign e raw session/entity moves que quebrariam essa relação;
- não muda RBAC/RPCs/rotas/mídia/processamento.

## Regra de manutenção

Ao remover uma dependência do technical slug, atualizar esta matriz na mesma PR. Não apagar o technical slug ou aliases enquanto qualquer consumer listado continuar ativo.
