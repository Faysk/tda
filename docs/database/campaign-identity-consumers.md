# Campaign identity — inventário de consumidores

> Status: baseline operacional de #1123; atualizar quando um consumer deixar de depender do technical slug
> Owner: database / identity-access / routing
> Última revisão: 2026-09-30

Este inventário separa **UUID relacional**, **technical slug** e **public route key** para que rename editorial não quebre RBAC, processamento, mídia, caches ou links. O contrato principal continua em ADR-0020 e `docs/architecture/multi-campaign.md`.

## Consumidores confirmados

| Classe | Evidência atual | Identidade usada hoje | Owner da convergência |
| --- | --- | --- | --- |
| RBAC assignments | `role_assignments.scope_type='campaign'` + `scope_id` textual | technical slug | #1134 |
| helpers/RPCs de acesso | `access_directory(campaign_slug)`, `has_campaign_role_slug(...)` | technical slug | #1134 |
| transcript handoff/publicação | resolve campaign por UUID e compara assignment de campaign pelo slug | UUID + technical slug | manter ownership por UUID; compatibilidade de scope segue #1134 |
| Edit permissions | `/edit/[campaignSlug]/permissions` | technical slug | #1136 |
| entrada do Edit | `src/features/edit/navigation-entry.ts` importa `CAMPAIGN_SLUG` | hardcode technical slug | #1136 |
| sessões públicas | `src/features/sessions/model.ts` filtra `campaigns.slug === CAMPAIGN_SLUG` | hardcode technical slug | #1125/#1127 |
| allowlist de mídia de sessão | `/campaigns/yuhara-main/sessions/` em `src/features/sessions/model.ts` | technical slug embutido em key já publicada | #1135 |
| keys R2 | `docs/integrations/r2/identity-and-keys.md` usa `campaigns/{campaign}/...` | identidade estável exigida; consumers legados ainda slug-like | #1135 |
| processamento local | entrypoint histórico `/edit/processamento` ainda não carrega campaign explícita na URL | default implícito | #1128 |
| source-session lookup | migrations de transcript usam `campaign_id + source_system + source_session_id` | UUID + source identity | manter campaign-qualified |
| entity slug | índice físico é `(campaign_id, slug)` | UUID + slug narrativo | manter colisão A/B válida |
| tests/fixtures | permissions usa `yuhara-main`; handoff usa campaign sintética | technical slug sintético | #1138 amplia matriz A/B |

## Invariantes

Rename editorial altera `campaigns.name`. Rename de URL pública altera `public_slug`; o valor anterior vira alias histórico. Nenhum desses eventos altera automaticamente:

- `campaigns.id`;
- `campaigns.slug`;
- FKs campaign-owned;
- scopes RBAC textuais legados;
- media keys já publicadas;
- receipts/idempotency keys históricos;
- provenance de source IDs.

O candidate #1123 torna `campaigns.slug` imutável após criação e mantém aliases fora de autorização. A campaign **Crônicas da Mesa** conserva `yuhara-main` como technical slug; **Antes que seja tarde** recebe identidade própria sem importar sessions/entities/canon/memberships/grants da campaign legado.

## Regra de manutenção

Toda PR que retirar um consumer do technical slug atualiza esta matriz. Não remover o technical slug nem aliases enquanto qualquer consumer listado continuar ativo.
