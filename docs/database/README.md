# Banco de dados — índice

> Status: vigente
> Owner: dados/Supabase
> Última revisão: 2026-09-07
> Fonte de verdade física: Supabase `dmrqnbdvbkfqzctcerbx`

Este diretório documenta o PostgreSQL/Supabase do TDA. Ele separa **contrato físico**, **regra de domínio**, **segurança** e **fotografia observada**.

## Documentos

- [Catálogo das 43 tabelas públicas](schema-catalog.md)
- [Relacionamentos e ownership](relationships.md)
- [RLS, RBAC, RPCs e segurança](security.md)
- [Inventário de RPCs privilegiadas](rpc-inventory.md)
- [Migrations e evolução do schema](migrations.md)
- [Reconciliações do migration history](migration-reconciliations.md)
- [Log de verificações de produção](verification-log.md)
- [Modelo canônico de domínio](../data-model.md)
- [Auditoria datada do banco](../database-audit.md)
- [Runbook operacional do banco / Supabase](../operations/database-runbook.md)
- [`supabase/README.md`](../../supabase/README.md) — regras das migrations no repositório.

## Banco canônico

- projeto Supabase: `dmrqnbdvbkfqzctcerbx`;
- campanha principal: `yuhara-main`;
- schema de aplicação principal: `public`;
- Auth: `auth.users` ligado a `profiles.auth_user_id` quando identidade foi vinculada;
- RLS: habilitado em todas as tabelas públicas observadas na revisão de 2026-09-06.

## Domínios físicos

| Domínio | Tabelas principais |
| --- | --- |
| campanha/identidade | `campaigns`, `profiles`, `campaign_members`, `profile_characters`, `profile_claims` |
| RBAC/governança | `permission_catalog`, `role_definitions`, `role_permissions`, `role_assignments`, `dm_tenures`, `ordo_access_members` |
| sessão/evidência | `sessions`, `participants`, `recording_files`, `transcript_segments`, `roll20_events`, `session_markers`, `table_notes`, `discord_interactions`, `historical_documents` |
| classificação/revisão | `segment_classifications`, `canon_candidates`, `quote_candidates`, `outtake_candidates`, `review_decisions` |
| memória/publicação | `entities`, `entity_mentions`, `canon_entries`, `publications`, `audit_log` |
| processamento | `processing_jobs`, `processing_job_steps`, `transcription_cache`, `ai_usage_ledger` |
| Craig/áudio | `craig_manifests`, `craig_track_extraction_steps`, `audio_chunks`, `audio_speech_slices`, `audio_artifacts`, `audio_artifact_events`, `audio_retention_policies` |
| integração externa | `external_api_clients`, `external_api_keys` |

## Regras estruturais

1. Não criar banco paralelo para o reboot.
2. DDL nova somente via migration.
3. Dados de produção não são resetados para simplificar desenvolvimento.
4. Fonte/evidência não é promovida diretamente para canon.
5. Pessoas (`profiles`) e objetos narrativos (`entities`) são identidades diferentes.
6. `entities` é registry única para PC/NPC/local/item/etc.
7. `metadata`/JSONB não deve absorver relações centrais que merecem FK/tabela própria.
8. Exclusão/renomeação de legado só após provar independência.
9. RLS/grants/RPCs são parte do contrato e exigem revisão de consumidores.
10. Contagens de linhas e warnings pertencem a auditorias datadas, não ao contrato permanente.

## Como atualizar estes docs

### Nova tabela

Atualizar:

- migration;
- `schema-catalog.md`;
- `relationships.md` se houver FK/ownership importante;
- documento de domínio dono;
- `security.md` se houver policy/grant/RPC;
- feature catalog/roadmap se representar nova capability.

### Nova coluna estrutural

Documentar quando altera identidade, estado, visibilidade, provenance, relacionamento, retenção ou contrato de API.

### Novo enum/check

Documentar a semântica dos valores e transições permitidas. Não depender apenas do SQL para explicar regra de negócio.

### Backfill

Registrar:

- fonte do valor;
- condição de matching;
- invariantes antes/depois;
- ambiguidades deixadas pendentes;
- por que não inventa informação ausente.

### Verificação operacional

Registrar em `verification-log.md` quando houver revalidação relevante de produção, aplicação de migration, investigação de drift, revisão de advisors ou incidente de banco.

### Nova RPC privilegiada

Atualizar obrigatoriamente:

- migration da function/grant;
- `security.md`;
- `rpc-inventory.md` com classe, caller, auth interna e decisão de grant;
- testes positivos e negativos da autorização;
- `verification-log.md` após aplicação em produção.

## O que não deve ser documentado aqui

- secrets/credenciais;
- dumps de dados narrativos privados;
- tokens/hash de API;
- PII desnecessária;
- valores temporários de debug.
